import { App, TFile, Notice, normalizePath } from 'obsidian';
import { RAGSettings } from './settings';
import { IndexManager, DocumentChunk } from './index-manager';

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
	public isInitialized = false;
	private progressCallback?: (progress: IndexingProgress) => void;

	constructor(app: App, settings: RAGSettings) {
		this.app = app;
		this.settings = settings;
		this.indexManager = new IndexManager(app, settings);
	}

	// Get current settings (in case they've been updated)
	private getCurrentSettings(): RAGSettings {
		return this.settings;
	}

	async initialize() {
		console.log('[ObsidiAnswer] Starting initialization...');
		await this.indexManager.loadIndex();
		this.isInitialized = true;
		console.log('[ObsidiAnswer] Index loaded, initialization complete');

		// Run auto-indexing in background if enabled, but only after layout is ready
		if (this.settings.autoIndex) {
			const startIndexing = () => {
				debug('[ObsidiAnswer] Starting background auto-indexing (layout ready)...');
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
		console.log('[ObsidiAnswer] Updating settings reference');
		this.settings = settings;
		// Don't do anything else - settings will be used on next operation
	}

	async indexVault(): Promise<void> {
		if (!this.settings.openaiApiKey) {
			new Notice('Please set your OpenAI API key in settings first');
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
		debug(`[ObsidiAnswer] Indexing file: ${file.path}`);

		const content = await this.app.vault.read(file);
		const chunkData = this.chunkDocument(content, file);

		debug(`[ObsidiAnswer] Created ${chunkData.length} chunks for ${file.path}`);

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
		debug(`[ObsidiAnswer] Adding ${chunks.length} chunks to index for ${file.path}`);
		await this.indexManager.addFileToIndex(file, chunks);

		// Generate embeddings for each chunk
		debug(`[ObsidiAnswer] Generating embeddings for ${chunks.length} chunks`);
		for (const chunk of chunks) {
			try {
				const embedding = await this.generateEmbedding(chunk.content);
				await this.indexManager.updateChunkEmbedding(chunk.id, embedding);
				debug(`[ObsidiAnswer] Generated embedding for chunk ${chunk.id}`);
			} catch (error) {
				console.error(`[ObsidiAnswer] Error generating embedding for chunk ${chunk.id}:`, error);
				throw error; // Re-throw to see if this is causing silent failures
			}
		}

		debug(`[ObsidiAnswer] Completed indexing file: ${file.path}`);
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
		debug(`[ObsidiAnswer] Generating embedding for text of length ${text.length}`);

		if (!this.settings.openaiApiKey) {
			throw new Error('OpenAI API key not configured');
		}

		const response = await fetch('https://api.openai.com/v1/embeddings', {
			method: 'POST',
			headers: {
				'Authorization': `Bearer ${this.settings.openaiApiKey}`,
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({
				input: text,
				model: this.settings.embeddingModel,
			}),
		});

		console.log(`[ObsidiAnswer] OpenAI API response status: ${response.status}`);

		if (!response.ok) {
			const errorText = await response.text();
			console.error(`[ObsidiAnswer] OpenAI API error: ${response.status} ${response.statusText}`, errorText);
			throw new Error(`OpenAI API error: ${response.status} ${response.statusText} - ${errorText}`);
		}

		const data = await response.json();
		console.log(`[ObsidiAnswer] Generated embedding with ${data.data[0].embedding.length} dimensions`);
		return data.data[0].embedding;
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

		const response = await fetch('https://api.openai.com/v1/chat/completions', {
			method: 'POST',
			headers: {
				'Authorization': `Bearer ${this.settings.openaiApiKey}`,
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({
				model: this.settings.chatModel,
				messages: [
					{ role: 'system', content: systemPrompt },
					{ role: 'user', content: question }
				],
				temperature: 0.7,
				max_tokens: 1000,
			}),
		});

		if (!response.ok) {
			throw new Error(`OpenAI API error: ${response.statusText}`);
		}

		const data = await response.json();
		return data.choices[0].message.content;
	}

	cleanup() {
		// Clean up resources if needed
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
