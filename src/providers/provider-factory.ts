import { BaseLLMProvider, ProviderConfig } from './base-provider';
import { OpenAIProvider } from './openai-provider';
import { LlamaProvider } from './llama-provider';

export type ProviderType = 'openai' | 'llama';

export interface ProviderInfo {
	id: ProviderType;
	name: string;
	description: string;
	requiresApiKey: boolean;
	requiresBaseUrl: boolean;
}

export class ProviderFactory {
	private static providers: ProviderInfo[] = [
		{
			id: 'openai',
			name: 'OpenAI',
			description: 'OpenAI GPT models (requires API key)',
			requiresApiKey: true,
			requiresBaseUrl: false
		},
		{
			id: 'llama',
			name: 'Llama (Self-hosted)',
			description: 'Self-hosted Llama models (requires base URL)',
			requiresApiKey: false,
			requiresBaseUrl: true
		}
	];

	static getAvailableProviders(): ProviderInfo[] {
		return [...this.providers];
	}

	static getProviderInfo(providerId: ProviderType): ProviderInfo | undefined {
		return this.providers.find(p => p.id === providerId);
	}

	static createProvider(providerId: ProviderType, config: ProviderConfig): BaseLLMProvider {
		switch (providerId) {
			case 'openai':
				return new OpenAIProvider(config);
			case 'llama':
				return new LlamaProvider(config);
			default:
				throw new Error(`Unknown provider: ${providerId}`);
		}
	}

	static validateConfig(providerId: ProviderType, config: ProviderConfig): string[] {
		const errors: string[] = [];
		const providerInfo = this.getProviderInfo(providerId);
		
		if (!providerInfo) {
			errors.push(`Unknown provider: ${providerId}`);
			return errors;
		}

		if (providerInfo.requiresApiKey && !config.apiKey) {
			errors.push(`${providerInfo.name} requires an API key`);
		}

		if (providerInfo.requiresBaseUrl && !config.baseUrl) {
			errors.push(`${providerInfo.name} requires a base URL`);
		}

		if (!config.embeddingModel) {
			errors.push('Embedding model is required');
		}

		if (!config.chatModel) {
			errors.push('Chat model is required');
		}

		return errors;
	}
}
