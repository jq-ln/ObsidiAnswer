import { App, TFile, Vault } from 'obsidian';
import { RAGSettings } from './settings';

export interface FileVersion {
	path: string;
	mtime: number; // Last modified time
	size: number;
	hash: string; // Content hash for integrity
}

export interface DocumentChunk {
	id: string; // Unique chunk identifier
	fileVersion: FileVersion;
	content: string;
	metadata: {
		file: string;
		path: string;
		tags?: string[];
		frontmatter?: any;
		chunkIndex: number;
		totalChunks: number;
		startOffset?: number; // Character offset in original file
		endOffset?: number;
	};
	embedding?: number[];
	embeddingModel?: string; // Track which model generated this
	createdAt: number;
	updatedAt: number;
}

export interface VaultIndex {
	version: string; // Index format version
	createdAt: number;
	updatedAt: number;
	settings: {
		embeddingModel: string;
		chunkSize: number;
		chunkOverlap: number;
	};
	files: Record<string, FileVersion>; // path -> version info
	chunks: Record<string, DocumentChunk>; // chunkId -> chunk
	stats: {
		totalFiles: number;
		totalChunks: number;
		totalEmbeddings: number;
		lastFullIndex: number;
	};
}

export class IndexManager {
	private app: App;
	private settings: RAGSettings;
	private index: VaultIndex;
	private indexPath: string;

	constructor(app: App, settings: RAGSettings) {
		this.app = app;
		this.settings = settings;
		this.indexPath = `${settings.indexPath}/vault-index.json`;
		this.index = this.createEmptyIndex();
	}

	private createEmptyIndex(): VaultIndex {
		return {
			version: '1.0.0',
			createdAt: Date.now(),
			updatedAt: Date.now(),
			settings: {
				embeddingModel: this.settings.embeddingModel,
				chunkSize: 1000,
				chunkOverlap: 200
			},
			files: {},
			chunks: {},
			stats: {
				totalFiles: 0,
				totalChunks: 0,
				totalEmbeddings: 0,
				lastFullIndex: 0
			}
		};
	}

	async loadIndex(): Promise<void> {
		try {
			console.log(`[IndexManager] Loading index from ${this.indexPath}`);

			if (await this.app.vault.adapter.exists(this.indexPath)) {
				const content = await this.app.vault.adapter.read(this.indexPath);
				this.index = JSON.parse(content);

				console.log(`[IndexManager] Loaded index with ${this.index.stats.totalFiles} files, ${this.index.stats.totalChunks} chunks, ${this.index.stats.totalEmbeddings} embeddings`);
				console.log(`[IndexManager] Index embedding model: ${this.index.settings.embeddingModel}, Current setting: ${this.settings.embeddingModel}`);

				// Validate index version and settings
				await this.validateIndex();

				console.log(`[IndexManager] After validation: ${this.index.stats.totalFiles} files, ${this.index.stats.totalChunks} chunks, ${this.index.stats.totalEmbeddings} embeddings`);
			} else {
				console.log(`[IndexManager] No existing index found, creating new one`);
				// Create new index
				this.index = this.createEmptyIndex();
				await this.saveIndex();
			}
		} catch (error) {
			console.error('[IndexManager] Error loading index:', error);
			this.index = this.createEmptyIndex();
		}
	}

	private async validateIndex(): Promise<void> {
		let needsRebuild = false;

		// Check index version compatibility
		if (this.index.version !== '1.0.0') {
			console.log('[IndexManager] Index version incompatible, rebuilding...');
			needsRebuild = true;
		}

		// Check if embedding model changed - but only if we have embeddings
		const hasEmbeddings = this.index.stats.totalEmbeddings > 0;
		if (hasEmbeddings && this.index.settings.embeddingModel !== this.settings.embeddingModel) {
			console.log(`[IndexManager] Embedding model changed from ${this.index.settings.embeddingModel} to ${this.settings.embeddingModel}, rebuilding index...`);
			needsRebuild = true;
		} else if (!hasEmbeddings) {
			console.log('[IndexManager] No embeddings found, updating index settings without rebuild');
			// Update settings in index to match current settings
			this.index.settings.embeddingModel = this.settings.embeddingModel;
		}

		if (needsRebuild) {
			await this.rebuildIndex();
		} else {
			// Update settings to current values
			this.index.settings = {
				embeddingModel: this.settings.embeddingModel,
				chunkSize: 1000,
				chunkOverlap: 200
			};
		}
	}

	async saveIndex(): Promise<void> {
		try {
			console.log(`[IndexManager] Saving index to ${this.indexPath}`);
			console.log(`[IndexManager] Index stats before save:`, this.index.stats);

			this.index.updatedAt = Date.now();

			// Ensure directory exists - extract directory from path
			const pathParts = this.indexPath.split('/');
			if (pathParts.length > 1) {
				const indexDir = pathParts.slice(0, -1).join('/');
				if (!(await this.app.vault.adapter.exists(indexDir))) {
					console.log(`[IndexManager] Creating directory: ${indexDir}`);
					await this.app.vault.adapter.mkdir(indexDir);
				}
			}

			const content = JSON.stringify(this.index, null, 2);
			console.log(`[IndexManager] Writing ${content.length} characters to index file`);
			await this.app.vault.adapter.write(this.indexPath, content);
			console.log(`[IndexManager] Successfully saved index`);
		} catch (error) {
			console.error('[IndexManager] Error saving index:', error);
			throw error; // Re-throw to see if this is causing issues
		}
	}

	async getFileVersion(file: TFile): Promise<FileVersion> {
		const stat = await this.app.vault.adapter.stat(file.path);
		const content = await this.app.vault.read(file);
		
		return {
			path: file.path,
			mtime: stat?.mtime || 0,
			size: stat?.size || 0,
			hash: this.hashContent(content)
		};
	}

	private hashContent(content: string): string {
		// Simple hash function - could use crypto.subtle in production
		let hash = 0;
		for (let i = 0; i < content.length; i++) {
			const char = content.charCodeAt(i);
			hash = ((hash << 5) - hash) + char;
			hash = hash & hash; // Convert to 32-bit integer
		}
		return hash.toString(36);
	}

	async isFileUpToDate(file: TFile): Promise<boolean> {
		const currentVersion = await this.getFileVersion(file);
		const indexedVersion = this.index.files[file.path];

		if (!indexedVersion) return false;

		return (
			indexedVersion.mtime === currentVersion.mtime &&
			indexedVersion.size === currentVersion.size &&
			indexedVersion.hash === currentVersion.hash
		);
	}

	async getOutdatedFiles(): Promise<TFile[]> {
		const allFiles = this.app.vault.getMarkdownFiles();
		const outdatedFiles: TFile[] = [];

		console.log(`[IndexManager] Checking ${allFiles.length} files for updates`);
		console.log(`[IndexManager] Currently have ${Object.keys(this.index.files).length} files in index`);

		for (const file of allFiles) {
			if (!(await this.isFileUpToDate(file))) {
				console.log(`[IndexManager] File needs update: ${file.path}`);
				outdatedFiles.push(file);
			}
		}

		// Also check for deleted files
		const currentPaths = new Set(allFiles.map(f => f.path));
		for (const indexedPath of Object.keys(this.index.files)) {
			if (!currentPaths.has(indexedPath)) {
				console.log(`[IndexManager] File was deleted, removing from index: ${indexedPath}`);
				// File was deleted, remove from index
				await this.removeFileFromIndex(indexedPath);
			}
		}

		console.log(`[IndexManager] Found ${outdatedFiles.length} outdated files`);
		return outdatedFiles;
	}

	async removeFileFromIndex(filePath: string): Promise<void> {
		// Remove file version
		delete this.index.files[filePath];

		// Remove all chunks for this file
		const chunksToRemove = Object.keys(this.index.chunks).filter(
			chunkId => this.index.chunks[chunkId].fileVersion.path === filePath
		);

		for (const chunkId of chunksToRemove) {
			delete this.index.chunks[chunkId];
		}

		// Update stats
		this.updateStats();
		await this.saveIndex();
	}

	async addFileToIndex(file: TFile, chunks: DocumentChunk[]): Promise<void> {
		console.log(`[IndexManager] Adding file to index: ${file.path} with ${chunks.length} chunks`);

		const fileVersion = await this.getFileVersion(file);
		console.log(`[IndexManager] File version:`, fileVersion);

		// Remove old chunks for this file
		await this.removeFileFromIndex(file.path);

		// Add new file version
		this.index.files[file.path] = fileVersion;
		console.log(`[IndexManager] Added file version for ${file.path}`);

		// Add new chunks
		for (const chunk of chunks) {
			chunk.fileVersion = fileVersion;
			chunk.updatedAt = Date.now();
			this.index.chunks[chunk.id] = chunk;
			console.log(`[IndexManager] Added chunk ${chunk.id}`);
		}

		// Update stats
		this.updateStats();
		console.log(`[IndexManager] Updated stats:`, this.index.stats);

		await this.saveIndex();
		console.log(`[IndexManager] Saved index for ${file.path}`);
	}

	private updateStats(): void {
		this.index.stats.totalFiles = Object.keys(this.index.files).length;
		this.index.stats.totalChunks = Object.keys(this.index.chunks).length;
		this.index.stats.totalEmbeddings = Object.values(this.index.chunks)
			.filter(chunk => chunk.embedding).length;
	}

	async rebuildIndex(): Promise<void> {
		this.index = this.createEmptyIndex();
		this.index.stats.lastFullIndex = Date.now();
		await this.saveIndex();
	}

	getChunks(): DocumentChunk[] {
		return Object.values(this.index.chunks);
	}

	getChunksWithEmbeddings(): DocumentChunk[] {
		return Object.values(this.index.chunks).filter(chunk => chunk.embedding);
	}

	getIndexStats() {
		return {
			...this.index.stats,
			indexSize: JSON.stringify(this.index).length,
			avgChunkSize: this.index.stats.totalChunks > 0 
				? Object.values(this.index.chunks)
					.reduce((sum, chunk) => sum + chunk.content.length, 0) / this.index.stats.totalChunks
				: 0
		};
	}

	async updateChunkEmbedding(chunkId: string, embedding: number[]): Promise<void> {
		if (this.index.chunks[chunkId]) {
			this.index.chunks[chunkId].embedding = embedding;
			this.index.chunks[chunkId].embeddingModel = this.settings.embeddingModel;
			this.index.chunks[chunkId].updatedAt = Date.now();

			this.updateStats();
			await this.saveIndex();
		}
	}

	updateSettings(settings: RAGSettings): void {
		console.log('[IndexManager] Updating settings without recreating index');
		this.settings = settings;
		// Update the index path in case it changed
		this.indexPath = `${settings.indexPath}/vault-index.json`;
	}
}
