import { BaseLLMProvider, EmbeddingResponse, ChatResponse, ProviderConfig } from './base-provider';

export class OpenAIProvider extends BaseLLMProvider {
	private readonly baseUrl = 'https://api.openai.com/v1';

	constructor(config: ProviderConfig) {
		super(config);
	}

	getName(): string {
		return 'OpenAI';
	}

	isConfigured(): boolean {
		return !!this.config.apiKey;
	}

	getAvailableEmbeddingModels(): string[] {
		return [
			'text-embedding-3-small',
			'text-embedding-3-large',
			'text-embedding-ada-002'
		];
	}

	getAvailableChatModels(): string[] {
		return [
			'gpt-4o',
			'gpt-4o-mini',
			'gpt-4-turbo',
			'gpt-4',
			'gpt-3.5-turbo'
		];
	}

	async generateEmbedding(text: string): Promise<EmbeddingResponse> {
		console.log(`[OpenAI] Generating embedding for text of length ${text.length}`);
		
		if (!this.config.apiKey) {
			throw new Error('OpenAI API key not configured');
		}
		
		const response = await fetch(`${this.baseUrl}/embeddings`, {
			method: 'POST',
			headers: {
				'Authorization': `Bearer ${this.config.apiKey}`,
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({
				input: text,
				model: this.config.embeddingModel,
			}),
		});

		console.log(`[OpenAI] API response status: ${response.status}`);

		if (!response.ok) {
			const errorText = await response.text();
			console.error(`[OpenAI] API error: ${response.status} ${response.statusText}`, errorText);
			throw new Error(`OpenAI API error: ${response.status} ${response.statusText} - ${errorText}`);
		}

		const data = await response.json();
		const embedding = data.data[0].embedding;
		
		console.log(`[OpenAI] Generated embedding with ${embedding.length} dimensions`);
		
		return {
			embedding,
			dimensions: embedding.length
		};
	}

	async generateChatResponse(messages: Array<{role: string, content: string}>): Promise<ChatResponse> {
		console.log(`[OpenAI] Generating chat response for ${messages.length} messages`);
		
		if (!this.config.apiKey) {
			throw new Error('OpenAI API key not configured');
		}

		const response = await fetch(`${this.baseUrl}/chat/completions`, {
			method: 'POST',
			headers: {
				'Authorization': `Bearer ${this.config.apiKey}`,
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({
				model: this.config.chatModel,
				messages: messages,
				temperature: this.config.temperature || 0.7,
				max_tokens: this.config.maxTokens || 1000,
			}),
		});

		console.log(`[OpenAI] Chat API response status: ${response.status}`);

		if (!response.ok) {
			const errorText = await response.text();
			console.error(`[OpenAI] Chat API error: ${response.status} ${response.statusText}`, errorText);
			throw new Error(`OpenAI Chat API error: ${response.status} ${response.statusText} - ${errorText}`);
		}

		const data = await response.json();
		const content = data.choices[0].message.content;
		
		console.log(`[OpenAI] Generated response with ${content.length} characters`);
		
		return {
			content,
			usage: data.usage ? {
				promptTokens: data.usage.prompt_tokens,
				completionTokens: data.usage.completion_tokens,
				totalTokens: data.usage.total_tokens
			} : undefined
		};
	}
}
