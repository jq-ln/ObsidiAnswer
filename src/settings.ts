export interface RAGSettings {
	openaiApiKey: string;
	embeddingModel: string;
	chatModel: string;
	maxResults: number;
	similarityThreshold: number;
	autoIndex: boolean;
	includeFilePaths: boolean;
	indexPath: string;
}

export const DEFAULT_SETTINGS: RAGSettings = {
	openaiApiKey: '',
	embeddingModel: 'text-embedding-3-small',
	chatModel: 'gpt-4o',
	maxResults: 5,
	similarityThreshold: 0.7,
	autoIndex: true,
	includeFilePaths: true,
	indexPath: '.obsidian/plugins/obsidian-rag-plugin/index'
};
