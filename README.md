# ObsidiAnswer

An intelligent knowledge retrieval and question-answering plugin for Obsidian that uses RAG (Retrieval-Augmented Generation) to help you find and understand information across your entire vault.

## Features

- 🧠 **Intelligent Question Answering**: Ask natural language questions about your vault content
- 🔍 **Semantic Search**: Find relevant information even when exact keywords don't match
- 📝 **Context-Aware**: Focus queries on specific notes or search across your entire vault
- 🚀 **Real-time Chat Interface**: Interactive chat experience for exploring your knowledge
- ⚡ **Automatic Indexing**: Keeps your vault indexed and ready for queries
- 🎯 **Configurable Settings**: Customize models, similarity thresholds, and more

## How It Works

The plugin uses advanced AI techniques to understand and retrieve information from your vault:

1. **Indexing**: Your notes are processed and converted into semantic embeddings
2. **Retrieval**: When you ask a question, the most relevant content is found using similarity search
3. **Generation**: An AI model generates a comprehensive answer based on the retrieved context

## Installation

### From Obsidian Community Plugins (Recommended)

1. Open Obsidian Settings
2. Go to Community Plugins and disable Safe Mode
3. Click Browse and search for "ObsidiAnswer"
4. Install and enable the plugin

### Manual Installation

1. Download the latest release from GitHub
2. Extract the files to your vault's `.obsidian/plugins/obsidian-rag-plugin/` folder
3. Reload Obsidian and enable the plugin in Settings

## Setup

1. **Get an OpenAI API Key**:
   - Visit [OpenAI's website](https://platform.openai.com/api-keys)
   - Create an account and generate an API key
   - Note: This plugin requires an OpenAI API key and will incur usage costs

2. **Configure the Plugin**:
   - Open Obsidian Settings → Community Plugins → ObsidiAnswer
   - Enter your OpenAI API key
   - Adjust other settings as needed (defaults work well for most users)

3. **Index Your Vault**:
   - The plugin will automatically index your vault on startup (if enabled)
   - Or manually run "Index vault for RAG" from the command palette
   - Indexing may take a few minutes for large vaults

## Usage

### Opening the Assistant

- Click the brain icon in the ribbon
- Use the command palette: "ObsidiAnswer: Open Assistant"
- Use the hotkey (if configured)

### Asking Questions

Simply type natural language questions about your vault content:

- "What did I write about machine learning?"
- "Summarize my thoughts on productivity"
- "What are the main themes in my daily notes from last month?"
- "How do I configure my development environment?"

### Context-Specific Queries

- Use "ObsidiAnswer: Ask About Current Note" command while viewing a note
- The assistant will focus on that specific note for more targeted answers

## Settings

- **OpenAI API Key**: Your API key for accessing OpenAI services
- **Embedding Model**: Model used for creating semantic embeddings (default: text-embedding-3-small)
- **Chat Model**: Model used for generating responses (default: gpt-4o)
- **Max Results**: Number of relevant chunks to retrieve (default: 5)
- **Similarity Threshold**: Minimum similarity score for relevance (default: 0.7)
- **Auto-index**: Automatically index vault on startup (default: enabled)
- **Include File Paths**: Show file paths in context (default: enabled)

## Privacy and Data

- Your notes are processed locally and sent to OpenAI only for embedding generation and question answering
- No data is stored on external servers beyond OpenAI's processing
- Embeddings are cached locally to improve performance
- Review OpenAI's privacy policy for their data handling practices

## Troubleshooting

### Common Issues

1. **"Please set your OpenAI API key"**
   - Ensure you've entered a valid API key in settings
   - Check that your API key has sufficient credits

2. **"Vault not indexed"**
   - Run the "Index vault for RAG" command
   - Check the console for any indexing errors

3. **Poor search results**
   - Try adjusting the similarity threshold
   - Ensure your vault has been recently indexed
   - Rephrase your question with different keywords

### Performance Tips

- Indexing large vaults may take time - be patient during initial setup
- The plugin works best with well-structured, descriptive content
- Use specific questions rather than very broad queries for better results

## Development

### Building from Source

```bash
npm install
npm run build
```

### Development Mode

```bash
npm run dev
```

## Contributing

Contributions are welcome! Please see our contributing guidelines and submit pull requests to the GitHub repository.

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Support

- Report bugs and request features on GitHub Issues
- Join the discussion in the Obsidian community forums
- Check the documentation for detailed usage guides

## Acknowledgments

- Built with the Obsidian Plugin API
- Powered by OpenAI's embedding and language models
- Inspired by the RAG (Retrieval-Augmented Generation) research community
