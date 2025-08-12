import { BaseLLMProvider, EmbeddingResponse, ChatResponse, ProviderConfig } from './base-provider';

export class LlamaProvider extends BaseLLMProvider {
	constructor(config: ProviderConfig) {
		super(config);
	}

	getName(): string {
		return 'Llama (Self-hosted)';
	}

	isConfigured(): boolean {
		return !!this.config.baseUrl;
	}

	getAvailableEmbeddingModels(): string[] {
		return [
			'llama3-8b',
			'llama3-70b',
			'sentence-transformers/all-MiniLM-L6-v2',
			'sentence-transformers/all-mpnet-base-v2'
		];
	}

	getAvailableChatModels(): string[] {
		return [
			'llama3-8b-instruct',
			'llama3-70b-instruct',
			'llama3.1-8b-instruct',
			'llama3.1-70b-instruct'
		];
	}

	async generateEmbedding(text: string): Promise<EmbeddingResponse> {
		console.log(`[Llama] Generating embedding for text of length ${text.length}`);
		
		if (!this.config.baseUrl) {
			throw new Error('Llama base URL not configured');
		}
		
		// This will depend on your self-hosted setup
		// Common endpoints: /v1/embeddings (OpenAI-compatible) or /embed
		const response = await fetch(`${this.config.baseUrl}/v1/embeddings`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				// Add auth headers if needed
				...(this.config.apiKey && { 'Authorization': `Bearer ${this.config.apiKey}` })
			},
			body: JSON.stringify({
				input: text,
				model: this.config.embeddingModel,
			}),
		});

		console.log(`[Llama] API response status: ${response.status}`);

		if (!response.ok) {
			const errorText = await response.text();
			console.error(`[Llama] API error: ${response.status} ${response.statusText}`, errorText);
			throw new Error(`Llama API error: ${response.status} ${response.statusText} - ${errorText}`);
		}

		const data = await response.json();
		
		// Handle different response formats
		let embedding: number[];
		if (data.data && data.data[0] && data.data[0].embedding) {
			// OpenAI-compatible format
			embedding = data.data[0].embedding;
		} else if (data.embedding) {
			// Direct embedding format
			embedding = data.embedding;
		} else {
			throw new Error('Unexpected embedding response format');
		}
		
		console.log(`[Llama] Generated embedding with ${embedding.length} dimensions`);
		
		return {
			embedding,
			dimensions: embedding.length
		};
	}

	async generateChatResponse(messages: Array<{role: string, content: string}>): Promise<ChatResponse> {
		console.log(`[Llama] Generating chat response for ${messages.length} messages`);
		
		if (!this.config.baseUrl) {
			throw new Error('Llama base URL not configured');
		}

		// Common endpoints: /v1/chat/completions (OpenAI-compatible) or /chat
		const response = await fetch(`${this.config.baseUrl}/v1/chat/completions`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				...(this.config.apiKey && { 'Authorization': `Bearer ${this.config.apiKey}` })
			},
			body: JSON.stringify({
				model: this.config.chatModel,
				messages: messages,
				temperature: this.config.temperature || 0.7,
				max_tokens: this.config.maxTokens || 1000,
			}),
		});

		console.log(`[Llama] Chat API response status: ${response.status}`);

		if (!response.ok) {
			const errorText = await response.text();
			console.error(`[Llama] Chat API error: ${response.status} ${response.statusText}`, errorText);
			throw new Error(`Llama Chat API error: ${response.status} ${response.statusText} - ${errorText}`);
		}

		const data = await response.json();
		
		// Handle different response formats
		let content: string;
		if (data.choices && data.choices[0] && data.choices[0].message) {
			// OpenAI-compatible format
			content = data.choices[0].message.content;
		} else if (data.response) {
			// Direct response format
			content = data.response;
		} else {
			throw new Error('Unexpected chat response format');
		}
		
		console.log(`[Llama] Generated response with ${content.length} characters`);
		
		return {
			content,
			usage: data.usage ? {
				promptTokens: data.usage.prompt_tokens || 0,
				completionTokens: data.usage.completion_tokens || 0,
				totalTokens: data.usage.total_tokens || 0
			} : undefined
		};
	}
}
