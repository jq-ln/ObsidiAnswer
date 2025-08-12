export interface EmbeddingResponse {
	embedding: number[];
	dimensions: number;
}

export interface ChatResponse {
	content: string;
	usage?: {
		promptTokens: number;
		completionTokens: number;
		totalTokens: number;
	};
}

export interface ProviderConfig {
	apiKey?: string;
	baseUrl?: string;
	embeddingModel: string;
	chatModel: string;
	maxTokens?: number;
	temperature?: number;
}

export abstract class BaseLLMProvider {
	protected config: ProviderConfig;

	constructor(config: ProviderConfig) {
		this.config = config;
	}

	abstract getName(): string;
	abstract isConfigured(): boolean;
	abstract generateEmbedding(text: string): Promise<EmbeddingResponse>;
	abstract generateChatResponse(messages: Array<{role: string, content: string}>): Promise<ChatResponse>;
	abstract getAvailableEmbeddingModels(): string[];
	abstract getAvailableChatModels(): string[];

	updateConfig(config: Partial<ProviderConfig>): void {
		this.config = { ...this.config, ...config };
	}

	getConfig(): ProviderConfig {
		return { ...this.config };
	}
}
