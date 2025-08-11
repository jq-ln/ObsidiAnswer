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
			const indexFile = this.app.vault.adapter.path.join(
				this.app.vault.adapter.basePath,
				this.indexPath
			);
			
			if (await this.app.vault.adapter.exists(indexFile)) {
				const content = await this.app.vault.adapter.read(indexFile);
				this.index = JSON.parse(content);
				
				// Validate index version and settings
				await this.validateIndex();
			} else {
				// Create new index
				this.index = this.createEmptyIndex();
				await this.saveIndex();
			}
		} catch (error) {
			console.error('Error loading index:', error);
			this.index = this.createEmptyIndex();
		}
	}

	private async validateIndex(): Promise<void> {
		let needsRebuild = false;

		// Check if embedding model changed
		if (this.index.settings.embeddingModel !== this.settings.embeddingModel) {
			console.log('Embedding model changed, rebuilding index...');
			needsRebuild = true;
		}

		// Check index version compatibility
		if (this.index.version !== '1.0.0') {
			console.log('Index version incompatible, rebuilding...');
			needsRebuild = true;
		}

		if (needsRebuild) {
			await this.rebuildIndex();
		}
	}

	async saveIndex(): Promise<void> {
		try {
			this.index.updatedAt = Date.now();
			
			// Ensure directory exists
			const indexDir = this.app.vault.adapter.path.dirname(this.indexPath);
			await this.app.vault.adapter.mkdir(indexDir);
			
			const content = JSON.stringify(this.index, null, 2);
			await this.app.vault.adapter.write(this.indexPath, content);
		} catch (error) {
			console.error('Error saving index:', error);
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

		for (const file of allFiles) {
			if (!(await this.isFileUpToDate(file))) {
				outdatedFiles.push(file);
			}
		}

		// Also check for deleted files
		const currentPaths = new Set(allFiles.map(f => f.path));
		for (const indexedPath of Object.keys(this.index.files)) {
			if (!currentPaths.has(indexedPath)) {
				// File was deleted, remove from index
				await this.removeFileFromIndex(indexedPath);
			}
		}

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
		const fileVersion = await this.getFileVersion(file);

		// Remove old chunks for this file
		await this.removeFileFromIndex(file.path);

		// Add new file version
		this.index.files[file.path] = fileVersion;

		// Add new chunks
		for (const chunk of chunks) {
			chunk.fileVersion = fileVersion;
			chunk.updatedAt = Date.now();
			this.index.chunks[chunk.id] = chunk;
		}

		// Update stats
		this.updateStats();
		await this.saveIndex();
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
}
