import { App, TFile, Notice, normalizePath } from 'obsidian';
import { RAGSettings } from './settings';
import { IndexManager, DocumentChunk } from './index-manager';

export interface SearchResult {
	chunk: DocumentChunk;
	similarity: number;
}

export class RAGEngine {
	private app: App;
	private settings: RAGSettings;
	private indexManager: IndexManager;
	private isInitialized = false;

	constructor(app: App, settings: RAGSettings) {
		this.app = app;
		this.settings = settings;
		this.indexManager = new IndexManager(app, settings);
	}

	async initialize() {
		await this.indexManager.loadIndex();
		this.isInitialized = true;

		if (this.settings.autoIndex) {
			await this.indexVault();
		}
	}

	async updateSettings(settings: RAGSettings) {
		const oldEmbeddingModel = this.settings.embeddingModel;
		this.settings = settings;

		// Update index manager settings
		this.indexManager = new IndexManager(this.app, settings);
		await this.indexManager.loadIndex();

		// Re-index if embedding model changed or if not indexed yet
		if (settings.openaiApiKey &&
			(oldEmbeddingModel !== settings.embeddingModel || !this.isInitialized)) {
			await this.indexVault();
		}
	}

	async indexVault(): Promise<void> {
		if (!this.settings.openaiApiKey) {
			new Notice('Please set your OpenAI API key in settings first');
			return;
		}

		try {
			new Notice('Checking for updates...');

			// Get files that need updating
			const outdatedFiles = await this.indexManager.getOutdatedFiles();

			if (outdatedFiles.length === 0) {
				new Notice('Vault index is up to date!');
				return;
			}

			new Notice(`Updating ${outdatedFiles.length} files...`);

			let processedFiles = 0;
			const totalFiles = outdatedFiles.length;

			for (const file of outdatedFiles) {
				try {
					await this.indexFile(file);
					processedFiles++;

					// Update progress every 5 files
					if (processedFiles % 5 === 0) {
						new Notice(`Updated ${processedFiles}/${totalFiles} files...`);
					}
				} catch (error) {
					console.error(`Error indexing file ${file.path}:`, error);
				}
			}

			const stats = this.indexManager.getIndexStats();
			new Notice(`Indexing completed! ${stats.totalChunks} chunks, ${stats.totalEmbeddings} embeddings.`);
		} catch (error) {
			console.error('Error during vault indexing:', error);
			new Notice('Error during vault indexing. Check console for details.');
		}
	}

	private async indexFile(file: TFile): Promise<void> {
		const content = await this.app.vault.read(file);
		const chunkData = this.chunkDocument(content, file);

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
		await this.indexManager.addFileToIndex(file, chunks);

		// Generate embeddings for each chunk
		for (const chunk of chunks) {
			try {
				const embedding = await this.generateEmbedding(chunk.content);
				await this.indexManager.updateChunkEmbedding(chunk.id, embedding);
			} catch (error) {
				console.error(`Error generating embedding for chunk ${chunk.id}:`, error);
			}
		}
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

		if (!response.ok) {
			throw new Error(`OpenAI API error: ${response.statusText}`);
		}

		const data = await response.json();
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

		if (chunks.length === 0) {
			throw new Error('No embeddings found. Please run indexing first.');
		}

		// Generate embedding for query
		const queryEmbedding = await this.generateEmbedding(query);

		// Calculate similarities
		const results: SearchResult[] = [];

		for (const chunk of chunks) {
			if (!chunk.embedding) continue;

			// If context file is specified, prioritize chunks from that file
			const isContextFile = contextFile && chunk.metadata.path === contextFile.path;

			const similarity = this.cosineSimilarity(queryEmbedding, chunk.embedding);

			// Apply context file boost
			const adjustedSimilarity = isContextFile ? similarity * 1.2 : similarity;

			if (adjustedSimilarity >= this.settings.similarityThreshold) {
				results.push({
					chunk: chunk,
					similarity: adjustedSimilarity
				});
			}
		}

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
}
