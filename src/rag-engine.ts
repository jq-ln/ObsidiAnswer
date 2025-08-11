import { App, TFile, Notice, normalizePath } from 'obsidian';
import { RAGSettings } from './settings';

export interface DocumentChunk {
	content: string;
	metadata: {
		file: string;
		path: string;
		tags?: string[];
		frontmatter?: any;
		chunkIndex: number;
		totalChunks: number;
	};
	embedding?: number[];
}

export interface SearchResult {
	chunk: DocumentChunk;
	similarity: number;
}

export class RAGEngine {
	private app: App;
	private settings: RAGSettings;
	private documents: DocumentChunk[] = [];
	private isIndexed = false;

	constructor(app: App, settings: RAGSettings) {
		this.app = app;
		this.settings = settings;
	}

	async initialize() {
		if (this.settings.autoIndex) {
			await this.indexVault();
		}
	}

	async updateSettings(settings: RAGSettings) {
		this.settings = settings;
		// Re-index if API key changed
		if (settings.openaiApiKey && !this.isIndexed) {
			await this.indexVault();
		}
	}

	async indexVault(): Promise<void> {
		if (!this.settings.openaiApiKey) {
			new Notice('Please set your OpenAI API key in settings first');
			return;
		}

		try {
			new Notice('Starting vault indexing...');
			
			// Get all markdown files
			const files = this.app.vault.getMarkdownFiles();
			this.documents = [];

			let processedFiles = 0;
			const totalFiles = files.length;

			for (const file of files) {
				try {
					await this.indexFile(file);
					processedFiles++;
					
					// Update progress every 10 files
					if (processedFiles % 10 === 0) {
						new Notice(`Indexed ${processedFiles}/${totalFiles} files...`);
					}
				} catch (error) {
					console.error(`Error indexing file ${file.path}:`, error);
				}
			}

			this.isIndexed = true;
			new Notice(`Vault indexing completed! Indexed ${this.documents.length} chunks from ${totalFiles} files.`);
		} catch (error) {
			console.error('Error during vault indexing:', error);
			new Notice('Error during vault indexing. Check console for details.');
		}
	}

	private async indexFile(file: TFile): Promise<void> {
		const content = await this.app.vault.read(file);
		const chunks = this.chunkDocument(content, file);

		for (const chunk of chunks) {
			// Generate embedding for the chunk
			const embedding = await this.generateEmbedding(chunk.content);
			chunk.embedding = embedding;
			this.documents.push(chunk);
		}
	}

	private chunkDocument(content: string, file: TFile): DocumentChunk[] {
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
		const chunks: DocumentChunk[] = [];
		const chunkSize = 1000; // characters
		
		let currentChunk = '';
		let chunkIndex = 0;

		for (const paragraph of paragraphs) {
			if (currentChunk.length + paragraph.length > chunkSize && currentChunk.length > 0) {
				// Create chunk
				chunks.push({
					content: currentChunk.trim(),
					metadata: {
						file: file.name,
						path: file.path,
						tags: tags,
						frontmatter: frontmatter,
						chunkIndex: chunkIndex,
						totalChunks: 0 // Will be updated later
					}
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
				content: currentChunk.trim(),
				metadata: {
					file: file.name,
					path: file.path,
					tags: tags,
					frontmatter: frontmatter,
					chunkIndex: chunkIndex,
					totalChunks: 0
				}
			});
		}

		// Update total chunks count
		chunks.forEach(chunk => {
			chunk.metadata.totalChunks = chunks.length;
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
		if (!this.isIndexed) {
			throw new Error('Vault not indexed. Please run indexing first.');
		}

		// Generate embedding for query
		const queryEmbedding = await this.generateEmbedding(query);

		// Calculate similarities
		const results: SearchResult[] = [];
		
		for (const doc of this.documents) {
			if (!doc.embedding) continue;

			// If context file is specified, prioritize chunks from that file
			const isContextFile = contextFile && doc.metadata.path === contextFile.path;
			
			const similarity = this.cosineSimilarity(queryEmbedding, doc.embedding);
			
			// Apply context file boost
			const adjustedSimilarity = isContextFile ? similarity * 1.2 : similarity;
			
			if (adjustedSimilarity >= this.settings.similarityThreshold) {
				results.push({
					chunk: doc,
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
		this.documents = [];
		this.isIndexed = false;
	}
}
