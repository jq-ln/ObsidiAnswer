# RAG Plugin Setup

## Quick Start

```bash
cd ObsidiAnswer
npm install
npm run build:sync
```

## What this does:

1. **npm install** - Installs all dependencies (should work without errors now)
2. **npm run build:sync** - Builds the plugin and copies it to the vault

## Files copied to vault:
- `main.js` - Compiled plugin code
- `manifest.json` - Plugin metadata  
- `styles.css` - UI styling

## Plugin location:
`vault/.obsidian/plugins/obsidian-rag-plugin/`

## After running build:sync:
1. Open Obsidian
2. Go to Settings → Community Plugins
3. Find "RAG Knowledge Assistant" and enable it
4. Configure your OpenAI API key in the plugin settings
5. The plugin will auto-index your vault on startup

## Development workflow:
- `npm run dev` - Development build with watch mode
- `npm run build` - Production build
- `npm run build:sync` - Build and copy to vault for testing
