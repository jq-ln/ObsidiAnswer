import { ProviderType } from './providers/provider-factory';

export interface RAGSettings {
	// Provider settings
	provider: ProviderType;
	openaiApiKey: string;
	llamaBaseUrl: string;
	llamaApiKey: string;

	// Model settings
	embeddingModel: string;
	chatModel: string;
	maxTokens: number;
	temperature: number;

	// Search settings
	maxResults: number;
	similarityThreshold: number;

	// General settings
	autoIndex: boolean;
	includeFilePaths: boolean;
	indexPath: string;
}

export const DEFAULT_SETTINGS: RAGSettings = {
	// Provider settings
	provider: 'openai',
	openaiApiKey: '',
	llamaBaseUrl: '',
	llamaApiKey: '',

	// Model settings
	embeddingModel: 'text-embedding-3-small',
	chatModel: 'gpt-4o',
	maxTokens: 1000,
	temperature: 0.7,

	// Search settings
	maxResults: 5,
	similarityThreshold: 0.3,

	// General settings
	autoIndex: true,
	includeFilePaths: true,
	indexPath: '.obsidian/plugins/obsidianswer/index'
};
