import { App, TFile, Notice, normalizePath } from 'obsidian';
import { RAGSettings } from './settings';
import { IndexManager, DocumentChunk } from './index-manager';
import { BaseLLMProvider, ProviderConfig } from './providers/base-provider';
import { ProviderFactory } from './providers/provider-factory';

// Minimal debug logger to silence verbose logs by default
const DEBUG_LOGS = false;
const debug = (...args: unknown[]) => { if (DEBUG_LOGS) console.log(...args); };


export interface IndexingProgress {
	current: number;
	total: number;
	currentFile?: string;
	phase: 'chunking' | 'embedding' | 'complete';
}

export interface SearchResult {
	chunk: DocumentChunk;
	similarity: number;
}

export class RAGEngine {
	private app: App;
	private settings: RAGSettings;
	private indexManager: IndexManager;
	private llmProvider: BaseLLMProvider;
	public isInitialized = false;
	private progressCallback?: (progress: IndexingProgress) => void;
	private debounceTimer?: NodeJS.Timeout;
	private pendingFiles = new Set<string>();
	private isIndexing = false;

	constructor(app: App, settings: RAGSettings) {
		this.app = app;
		this.settings = settings;
		this.indexManager = new IndexManager(app, settings);
		this.llmProvider = this.createProvider(settings);
	}

	private createProvider(settings: RAGSettings): BaseLLMProvider {
		const config: ProviderConfig = {
			apiKey: settings.provider === 'openai' ? settings.openaiApiKey : settings.llamaApiKey,
			baseUrl: settings.provider === 'llama' ? settings.llamaBaseUrl : undefined,
			embeddingModel: settings.embeddingModel,
			chatModel: settings.chatModel,
			maxTokens: settings.maxTokens,
			temperature: settings.temperature
		};

		return ProviderFactory.createProvider(settings.provider, config);
	}

	async initialize() {
		console.log('[ObsidiAnswer] Starting initialization...');
		await this.indexManager.loadIndex();
		this.isInitialized = true;
		console.log('[ObsidiAnswer] Index loaded, initialization complete');

		// Set up file watching for automatic indexing
		this.setupFileWatching();

		// Run auto-indexing in background if enabled, but only after layout is ready
		if (this.settings.autoIndex) {
			const startIndexing = () => {
				console.log('[ObsidiAnswer] Starting background auto-indexing (layout ready)...');
				this.indexVault().then(() => {
					new Notice('ObsidiAnswer: Vault indexing completed');
				}).catch(error => {
					console.error('[ObsidiAnswer] Background indexing failed:', error);
					new Notice('ObsidiAnswer: Background indexing failed. Check console for details.');
				});
			};
			const ws: any = this.app.workspace as any;
			if (typeof ws.onLayoutReady === 'function') {
				ws.onLayoutReady(startIndexing);
			} else {
				setTimeout(startIndexing, 3000);
			}
		}
	}

	updateSettings(settings: RAGSettings) {
		console.log('[ObsidiAnswer] Updating settings and provider');
		const oldProvider = this.settings.provider;
		this.settings = settings;

		// Recreate provider if provider type changed or if key settings changed
		if (oldProvider !== settings.provider) {
			console.log(`[ObsidiAnswer] Provider changed from ${oldProvider} to ${settings.provider}`);
			this.llmProvider = this.createProvider(settings);
		} else {
			// Update existing provider config
			this.llmProvider.updateConfig({
				apiKey: settings.provider === 'openai' ? settings.openaiApiKey : settings.llamaApiKey,
				baseUrl: settings.provider === 'llama' ? settings.llamaBaseUrl : undefined,
				embeddingModel: settings.embeddingModel,
				chatModel: settings.chatModel,
				maxTokens: settings.maxTokens,
				temperature: settings.temperature
			});
		}
	}

	async indexVault(): Promise<void> {
		if (!this.llmProvider.isConfigured()) {
			const providerName = this.llmProvider.getName();
			new Notice(`Please configure ${providerName} in settings first`);
			return;
		}

		try {
			debug('[ObsidiAnswer] Checking for updates...');

			// Get files that need updating
			const outdatedFiles = await this.indexManager.getOutdatedFiles();

			if (outdatedFiles.length === 0) {
				debug('[ObsidiAnswer] Vault index is up to date!');
				this.notifyProgress({ current: 0, total: 0, phase: 'complete' });
				return;
			}

			new Notice(`Updating ${outdatedFiles.length} files...`);

			let processedFiles = 0;
			const totalFiles = outdatedFiles.length;

			// Start progress tracking
			this.notifyProgress({
				current: 0,
				total: totalFiles,
				phase: 'chunking',
				currentFile: outdatedFiles[0]?.name
			});

			for (const file of outdatedFiles) {
				try {
					this.notifyProgress({
						current: processedFiles,
						total: totalFiles,
						phase: 'embedding',
						currentFile: file.name
					});

					await this.indexFile(file);
					processedFiles++;

					this.notifyProgress({
						current: processedFiles,
						total: totalFiles,
						phase: processedFiles === totalFiles ? 'complete' : 'embedding',
						currentFile: processedFiles < totalFiles ? outdatedFiles[processedFiles]?.name : undefined
					});

					// Update progress every 5 files
					if (processedFiles % 5 === 0) {
						new Notice(`Updated ${processedFiles}/${totalFiles} files...`);
					}
				} catch (error) {
					console.error(`Error indexing file ${file.path}:`, error);
				}
			}

			// Final progress update
			this.notifyProgress({ current: totalFiles, total: totalFiles, phase: 'complete' });

			const stats = this.indexManager.getIndexStats();
			new Notice(`Indexing completed! ${stats.totalChunks} chunks, ${stats.totalEmbeddings} embeddings.`);
		} catch (error) {
			console.error('Error during vault indexing:', error);
			new Notice('Error during vault indexing. Check console for details.');
			this.notifyProgress({ current: 0, total: 0, phase: 'complete' });
		}
	}

	private async indexFile(file: TFile): Promise<void> {
		console.log(`[ObsidiAnswer] Indexing file: ${file.path}`);

		const content = await this.app.vault.read(file);
		const chunkData = this.chunkDocument(content, file);

		console.log(`[ObsidiAnswer] Created ${chunkData.length} chunks for ${file.path}`);

		// Convert to full DocumentChunk objects (fileVersion will be added by IndexManager)
		const chunks: DocumentChunk[] = chunkData.map(chunk => ({
			...chunk,
			fileVersion: {
				path: file.path,
				mtime: 0, // Will be set by IndexManager
				size: 0,
				hash: ''
			}
		}));

		// Add chunks to index (without embeddings first)
		console.log(`[ObsidiAnswer] Adding ${chunks.length} chunks to index for ${file.path}`);
		await this.indexManager.addFileToIndex(file, chunks);

		// Generate embeddings for each chunk
		console.log(`[ObsidiAnswer] Generating embeddings for ${chunks.length} chunks`);
		for (const chunk of chunks) {
			try {
				const embedding = await this.generateEmbedding(chunk.content);
				await this.indexManager.updateChunkEmbedding(chunk.id, embedding);
				console.log(`[ObsidiAnswer] Generated embedding for chunk ${chunk.id}`);
			} catch (error) {
				console.error(`[ObsidiAnswer] Error generating embedding for chunk ${chunk.id}:`, error);
				throw error; // Re-throw to see if this is causing silent failures
			}
		}

		console.log(`[ObsidiAnswer] Completed indexing file: ${file.path}`);
	}

	private chunkDocument(content: string, file: TFile): Omit<DocumentChunk, 'fileVersion'>[] {
		// Parse frontmatter
		const frontmatterRegex = /^---\n([\s\S]*?)\n---\n/;
		const frontmatterMatch = content.match(frontmatterRegex);
		let frontmatter: any = {};
		let bodyContent = content;

		if (frontmatterMatch) {
			try {
				// Simple YAML parsing for basic frontmatter
				const yamlContent = frontmatterMatch[1];
				const lines = yamlContent.split('\n');
				for (const line of lines) {
					const colonIndex = line.indexOf(':');
					if (colonIndex > 0) {
						const key = line.substring(0, colonIndex).trim();
						const value = line.substring(colonIndex + 1).trim();
						frontmatter[key] = value;
					}
				}
			} catch (error) {
				console.warn(`Error parsing frontmatter for ${file.path}:`, error);
			}
			bodyContent = content.substring(frontmatterMatch[0].length);
		}

		// Extract tags from content
		const tagRegex = /#[\w-]+/g;
		const tags = [...bodyContent.matchAll(tagRegex)].map(match => match[0]);

		// Simple chunking by paragraphs (can be improved)
		const paragraphs = bodyContent.split('\n\n').filter(p => p.trim().length > 0);
		const chunks: Omit<DocumentChunk, 'fileVersion'>[] = [];
		const chunkSize = 1000; // characters

		let currentChunk = '';
		let chunkIndex = 0;

		for (const paragraph of paragraphs) {
			if (currentChunk.length + paragraph.length > chunkSize && currentChunk.length > 0) {
				// Create chunk
				chunks.push({
					id: `${file.path}:${chunkIndex}`,
					content: currentChunk.trim(),
					metadata: {
						file: file.name,
						path: file.path,
						tags: tags,
						frontmatter: frontmatter,
						chunkIndex: chunkIndex,
						totalChunks: 0 // Will be updated later
					},
					createdAt: Date.now(),
					updatedAt: Date.now()
				});
				currentChunk = paragraph;
				chunkIndex++;
			} else {
				currentChunk += (currentChunk ? '\n\n' : '') + paragraph;
			}
		}

		// Add final chunk
		if (currentChunk.trim()) {
			chunks.push({
				id: `${file.path}:${chunkIndex}`,
				content: currentChunk.trim(),
				metadata: {
					file: file.name,
					path: file.path,
					tags: tags,
					frontmatter: frontmatter,
					chunkIndex: chunkIndex,
					totalChunks: 0
				},
				createdAt: Date.now(),
				updatedAt: Date.now()
			});
		}

		// Update total chunks count and add missing properties
		chunks.forEach((chunk, index) => {
			chunk.metadata.totalChunks = chunks.length;
			if (!chunk.id) {
				chunk.id = `${file.path}:${index}`;
			}
			if (!chunk.createdAt) {
				chunk.createdAt = Date.now();
			}
			if (!chunk.updatedAt) {
				chunk.updatedAt = Date.now();
			}
		});

		return chunks;
	}

	private async generateEmbedding(text: string): Promise<number[]> {
		const response = await this.llmProvider.generateEmbedding(text);
		return response.embedding;
	}

	private cosineSimilarity(a: number[], b: number[]): number {
		const dotProduct = a.reduce((sum, val, i) => sum + val * b[i], 0);
		const magnitudeA = Math.sqrt(a.reduce((sum, val) => sum + val * val, 0));
		const magnitudeB = Math.sqrt(b.reduce((sum, val) => sum + val * val, 0));
		return dotProduct / (magnitudeA * magnitudeB);
	}

	async search(query: string, contextFile?: TFile): Promise<SearchResult[]> {
		const chunks = this.indexManager.getChunksWithEmbeddings();

		console.log(`[ObsidiAnswer] Searching ${chunks.length} chunks with embeddings`);

		if (chunks.length === 0) {
			throw new Error('No embeddings found. Please run indexing first.');
		}

		// Generate embedding for query
		const queryEmbedding = await this.generateEmbedding(query);

		// Calculate similarities
		const results: SearchResult[] = [];
		const allSimilarities: number[] = [];

		for (const chunk of chunks) {
			if (!chunk.embedding) continue;

			// If context file is specified, prioritize chunks from that file
			const isContextFile = contextFile && chunk.metadata.path === contextFile.path;

			const similarity = this.cosineSimilarity(queryEmbedding, chunk.embedding);
			allSimilarities.push(similarity);

			// Apply context file boost
			const adjustedSimilarity = isContextFile ? similarity * 1.2 : similarity;

			if (adjustedSimilarity >= this.settings.similarityThreshold) {
				results.push({
					chunk: chunk,
					similarity: adjustedSimilarity
				});
			}
		}

		// Log similarity statistics
		const maxSim = Math.max(...allSimilarities);
		const minSim = Math.min(...allSimilarities);
		const avgSim = allSimilarities.reduce((a, b) => a + b, 0) / allSimilarities.length;

		console.log(`[ObsidiAnswer] Similarity stats - Max: ${maxSim.toFixed(3)}, Min: ${minSim.toFixed(3)}, Avg: ${avgSim.toFixed(3)}`);
		console.log(`[ObsidiAnswer] Threshold: ${this.settings.similarityThreshold}, Results found: ${results.length}`);

		// Sort by similarity and return top results
		return results
			.sort((a, b) => b.similarity - a.similarity)
			.slice(0, this.settings.maxResults);
	}

	async query(question: string, contextFile?: TFile): Promise<string> {
		try {
			// Search for relevant documents
			const searchResults = await this.search(question, contextFile);

			if (searchResults.length === 0) {
				return "I couldn't find any relevant information in your vault to answer that question. Try rephrasing your question or check if the vault has been indexed.";
			}

			// Prepare context from search results
			const context = searchResults.map((result, index) => {
				const { chunk } = result;
				const pathInfo = this.settings.includeFilePaths ? `[${chunk.metadata.path}]` : `[Document ${index + 1}]`;
				return `${pathInfo}\n${chunk.content}`;
			}).join('\n\n---\n\n');

			// Generate response using OpenAI
			const response = await this.generateResponse(question, context, contextFile);
			return response;

		} catch (error) {
			console.error('Error in RAG query:', error);
			throw error;
		}
	}

	private async generateResponse(question: string, context: string, contextFile?: TFile): Promise<string> {
		const contextInfo = contextFile ? `focusing on the note "${contextFile.name}"` : "across your entire vault";

		const systemPrompt = `You are a helpful AI assistant that answers questions based on the user's Obsidian vault content.

You have access to relevant excerpts from their notes. Use this information to provide accurate, helpful answers. When referencing information, you can mention which note it came from if helpful.

If the provided context doesn't contain enough information to fully answer the question, say so and suggest what additional information might be helpful.

Context information ${contextInfo}:
${context}`;

		const messages = [
			{ role: 'system', content: systemPrompt },
			{ role: 'user', content: question }
		];

		const response = await this.llmProvider.generateChatResponse(messages);
		return response.content;
	}

	private setupFileWatching() {
		if (!this.settings.autoIndexOnChange) {
			console.log('[ObsidiAnswer] Auto-indexing on file changes is disabled');
			return;
		}

		console.log('[ObsidiAnswer] Setting up file watching...');

		// Listen for file modifications
		this.app.vault.on('modify', (file) => {
			if (file instanceof TFile && file.extension === 'md') {
				console.log(`[ObsidiAnswer] File modified: ${file.path}`);
				this.scheduleFileIndex(file.path);
			}
		});

		// Listen for file creation
		this.app.vault.on('create', (file) => {
			if (file instanceof TFile && file.extension === 'md') {
				console.log(`[ObsidiAnswer] File created: ${file.path}`);
				this.scheduleFileIndex(file.path);
			}
		});

		// Listen for file deletion
		this.app.vault.on('delete', (file) => {
			if (file instanceof TFile && file.extension === 'md') {
				console.log(`[ObsidiAnswer] File deleted: ${file.path}`);
				this.scheduleFileRemoval(file.path);
			}
		});

		// Listen for file rename/move
		this.app.vault.on('rename', (file, oldPath) => {
			if (file instanceof TFile && file.extension === 'md') {
				console.log(`[ObsidiAnswer] File renamed: ${oldPath} -> ${file.path}`);
				// Remove old path and index new path
				this.scheduleFileRemoval(oldPath);
				this.scheduleFileIndex(file.path);
			}
		});
	}

	private scheduleFileIndex(filePath: string) {
		// Add to pending files
		this.pendingFiles.add(filePath);

		// Clear existing timer
		if (this.debounceTimer) {
			clearTimeout(this.debounceTimer);
		}

		// Set new timer with configurable debounce delay
		this.debounceTimer = setTimeout(() => {
			this.processPendingFiles();
		}, this.settings.debounceDelay);
	}

	private scheduleFileRemoval(filePath: string) {
		// Remove from index immediately (no debounce needed for deletions)
		this.indexManager.removeFileFromIndex(filePath).catch(error => {
			console.error(`[ObsidiAnswer] Error removing file from index: ${filePath}`, error);
		});
	}

	private async processPendingFiles() {
		if (this.isIndexing || this.pendingFiles.size === 0) {
			return;
		}

		this.isIndexing = true;
		const filesToProcess = Array.from(this.pendingFiles);
		this.pendingFiles.clear();

		console.log(`[ObsidiAnswer] Checking ${filesToProcess.length} pending files for changes...`);

		try {
			const actuallyUpdatedFiles: string[] = [];

			for (const filePath of filesToProcess) {
				const file = this.app.vault.getAbstractFileByPath(filePath);
				if (file instanceof TFile && file.extension === 'md') {
					try {
						// Check if file actually needs updating
						const needsUpdate = !(await this.indexManager.isFileUpToDate(file));

						if (needsUpdate) {
							await this.indexFile(file);
							actuallyUpdatedFiles.push(file.path);
							console.log(`[ObsidiAnswer] Auto-indexed: ${file.path}`);
						} else {
							console.log(`[ObsidiAnswer] File already up-to-date, skipping: ${file.path}`);
						}
					} catch (error) {
						console.error(`[ObsidiAnswer] Error auto-indexing file: ${file.path}`, error);
					}
				}
			}

			if (actuallyUpdatedFiles.length > 0) {
				new Notice(`ObsidiAnswer: Updated ${actuallyUpdatedFiles.length} file(s)`);
				console.log(`[ObsidiAnswer] Actually updated files:`, actuallyUpdatedFiles);
			} else {
				console.log(`[ObsidiAnswer] No files needed updating (all were already current)`);
			}
		} finally {
			this.isIndexing = false;
		}
	}

	cleanup() {
		// Clean up resources if needed
		if (this.debounceTimer) {
			clearTimeout(this.debounceTimer);
		}
		this.isInitialized = false;
	}

	// Utility methods for debugging and monitoring
	getIndexStats() {
		return this.indexManager.getIndexStats();
	}

	async forceRebuildIndex(): Promise<void> {
		await this.indexManager.rebuildIndex();
		await this.indexVault();
	}

	setProgressCallback(callback: (progress: IndexingProgress) => void) {
		this.progressCallback = callback;
	}

	private notifyProgress(progress: IndexingProgress) {
		if (this.progressCallback) {
			this.progressCallback(progress);
		}
	}
}
