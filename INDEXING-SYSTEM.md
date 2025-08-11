# Persistent Indexing System

## Overview

The RAG plugin now implements a robust, persistent indexing system that ensures chunks, embeddings, and metadata stay perfectly synchronized. This addresses the critical need for reliable data persistence and consistency.

## Key Features

### 🔄 **Sync Integrity**
- **File Version Tracking**: Uses mtime, size, and content hash to detect changes
- **Incremental Updates**: Only re-processes files that have actually changed
- **Atomic Operations**: Chunks and embeddings are updated together
- **Consistency Checks**: Validates index integrity on startup

### 💾 **Persistent Storage**
- **JSON-based**: Uses Obsidian's file system APIs for reliable storage
- **Human-readable**: Index files can be inspected and debugged
- **Incremental Saves**: Updates are saved immediately, not batched
- **Backup-friendly**: Standard JSON format works with any backup system

### 🚀 **Performance Optimizations**
- **Smart Indexing**: Only processes outdated files
- **Embedding Caching**: Embeddings persist across Obsidian restarts
- **Model Validation**: Rebuilds index when embedding model changes
- **Progress Tracking**: Real-time feedback during indexing operations

## Architecture

### Core Components

1. **IndexManager** (`src/index-manager.ts`)
   - Manages the persistent vault index
   - Handles file version tracking and change detection
   - Provides atomic chunk and embedding operations

2. **VaultIndex Structure**
   ```typescript
   {
     version: "1.0.0",
     settings: { embeddingModel, chunkSize, etc. },
     files: { "path/to/file.md": FileVersion },
     chunks: { "chunkId": DocumentChunk },
     stats: { totalFiles, totalChunks, etc. }
   }
   ```

3. **DocumentChunk Enhanced**
   ```typescript
   {
     id: "file.md:0",
     fileVersion: FileVersion,
     content: "chunk text",
     metadata: { file, path, tags, frontmatter, etc. },
     embedding: number[],
     embeddingModel: "text-embedding-3-small",
     createdAt: timestamp,
     updatedAt: timestamp
   }
   ```

## File Change Detection

### Multi-layer Validation
1. **Modified Time**: Quick check using file system mtime
2. **File Size**: Catches truncations and major edits
3. **Content Hash**: Detects any content changes, even with same size
4. **Embedding Model**: Rebuilds if model settings change

### Change Scenarios Handled
- ✅ File content modified
- ✅ File renamed/moved
- ✅ File deleted
- ✅ New files added
- ✅ Embedding model changed
- ✅ Plugin settings updated

## Storage Location

```
vault/
└── .obsidian/
    └── plugins/
        └── obsidian-rag-plugin/
            └── index/
                └── vault-index.json
```

## Index Operations

### Startup Sequence
1. Load existing index from JSON
2. Validate index version and settings
3. Check for file changes since last run
4. Update only outdated files
5. Generate embeddings for new chunks

### File Update Process
1. Detect file changes using version tracking
2. Remove old chunks for changed files
3. Re-chunk the updated content
4. Generate new embeddings
5. Update index atomically
6. Save to persistent storage

### Embedding Generation
1. Create chunks without embeddings first
2. Generate embeddings one by one
3. Update each chunk immediately
4. Handle API errors gracefully
5. Track embedding model used

## Benefits

### For Users
- **Fast Startup**: No re-indexing unless files changed
- **Reliable**: Never lose embeddings due to crashes
- **Transparent**: Clear progress feedback during updates
- **Efficient**: Only pays API costs for actual changes

### For Developers
- **Debuggable**: Human-readable JSON index files
- **Testable**: Clear separation of concerns
- **Extensible**: Easy to add new metadata fields
- **Maintainable**: Well-defined interfaces and error handling

## Future Enhancements

### Performance
- **SQLite Migration**: For very large vaults (10k+ files)
- **Batch Embedding**: Process multiple chunks per API call
- **Background Indexing**: Non-blocking updates
- **Compression**: Reduce index file size

### Features
- **Index Versioning**: Migrate between index formats
- **Partial Rebuilds**: Rebuild specific file types or folders
- **Index Analytics**: Track usage patterns and performance
- **Export/Import**: Share indexes between devices

## Error Handling

### Graceful Degradation
- **Corrupted Index**: Rebuilds automatically
- **API Failures**: Retries with exponential backoff
- **File System Errors**: Logs and continues with other files
- **Memory Limits**: Processes files in batches

### Recovery Mechanisms
- **Index Validation**: Checks integrity on startup
- **Automatic Repair**: Fixes common corruption issues
- **Manual Rebuild**: Force complete re-indexing
- **Backup Strategy**: Maintains previous index versions

This persistent indexing system provides the robust foundation needed for the advanced RAG features outlined in your README, ensuring that chunks, embeddings, and metadata remain perfectly synchronized across all operations.
