# Multi-Provider Architecture

## Overview

ObsidiAnswer now supports multiple LLM providers through a flexible, extensible architecture. This allows users to choose between OpenAI's hosted models or self-hosted solutions like Llama.

## Architecture

### Core Components

1. **BaseLLMProvider** (`src/providers/base-provider.ts`)
   - Abstract base class defining the provider interface
   - Standardizes embedding and chat response generation
   - Handles provider configuration management

2. **OpenAIProvider** (`src/providers/openai-provider.ts`)
   - Implements OpenAI API integration
   - Supports all current OpenAI models
   - Handles API key authentication

3. **LlamaProvider** (`src/providers/llama-provider.ts`)
   - Implements self-hosted Llama integration
   - Supports OpenAI-compatible endpoints
   - Flexible authentication (API key optional)

4. **ProviderFactory** (`src/providers/provider-factory.ts`)
   - Creates and manages provider instances
   - Validates provider configurations
   - Provides metadata about available providers

## Supported Providers

### OpenAI
- **Models**: GPT-4o, GPT-4o Mini, GPT-4 Turbo, GPT-3.5 Turbo
- **Embeddings**: text-embedding-3-small, text-embedding-3-large, text-embedding-ada-002
- **Requirements**: API key
- **Endpoint**: https://api.openai.com/v1

### Llama (Self-hosted)
- **Models**: Llama3-8B, Llama3-70B, Llama3.1 variants
- **Embeddings**: Sentence Transformers models
- **Requirements**: Base URL (API key optional)
- **Endpoint**: Configurable (e.g., http://localhost:8080/v1)

## Configuration

### Settings Structure
```typescript
interface RAGSettings {
  // Provider selection
  provider: 'openai' | 'llama';
  
  // OpenAI settings
  openaiApiKey: string;
  
  // Llama settings
  llamaBaseUrl: string;
  llamaApiKey: string; // Optional
  
  // Model settings
  embeddingModel: string;
  chatModel: string;
  maxTokens: number;
  temperature: number;
}
```

### UI Features
- **Provider Selection**: Dropdown to choose between providers
- **Dynamic Settings**: UI adapts based on selected provider
- **Model Lists**: Automatically populated from provider capabilities
- **Validation**: Real-time validation of required fields

## API Compatibility

### OpenAI-Compatible Endpoints
The Llama provider supports OpenAI-compatible endpoints:
- `/v1/embeddings` - For generating embeddings
- `/v1/chat/completions` - For chat responses

### Custom Endpoints
Easy to extend for providers with different API formats:
- Custom response parsing
- Different authentication methods
- Alternative endpoint structures

## Usage Examples

### OpenAI Configuration
```typescript
{
  provider: 'openai',
  openaiApiKey: 'sk-...',
  embeddingModel: 'text-embedding-3-small',
  chatModel: 'gpt-4o'
}
```

### Llama Configuration
```typescript
{
  provider: 'llama',
  llamaBaseUrl: 'http://localhost:8080',
  llamaApiKey: '', // Optional
  embeddingModel: 'sentence-transformers/all-MiniLM-L6-v2',
  chatModel: 'llama3-8b-instruct'
}
```

## Benefits

### For Users
- **Choice**: Use hosted or self-hosted solutions
- **Privacy**: Keep data local with self-hosted models
- **Cost Control**: Avoid per-token charges with local models
- **Flexibility**: Switch providers without losing data

### For Developers
- **Extensible**: Easy to add new providers
- **Maintainable**: Clean separation of concerns
- **Testable**: Mock providers for testing
- **Consistent**: Uniform interface across providers

## Future Extensions

### Planned Providers
- **Anthropic Claude**: Via API
- **Google Gemini**: Via API
- **Ollama**: Local model runner
- **Hugging Face**: Hosted inference

### Advanced Features
- **Provider Fallback**: Automatic failover between providers
- **Load Balancing**: Distribute requests across multiple instances
- **Cost Tracking**: Monitor usage and costs per provider
- **Performance Metrics**: Compare provider response times

## Migration

### From OpenAI-only Version
Existing installations automatically migrate:
1. Provider defaults to 'openai'
2. Existing API keys preserved
3. Model settings maintained
4. No data loss or re-indexing required

### Settings Migration
```typescript
// Old format
{ openaiApiKey: 'sk-...', embeddingModel: '...' }

// New format (automatic)
{ 
  provider: 'openai', 
  openaiApiKey: 'sk-...', 
  embeddingModel: '...',
  llamaBaseUrl: '',
  llamaApiKey: ''
}
```

This architecture provides a solid foundation for supporting multiple AI providers while maintaining backward compatibility and ease of use.
