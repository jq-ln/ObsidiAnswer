# Automatic File Watching & Indexing

## Overview

ObsidiAnswer now includes intelligent file watching that automatically keeps your index up-to-date as you work. No more manual re-indexing when you create, edit, or delete files!

## How It Works

### File Events Monitored
- **File Creation**: New `.md` files are automatically indexed
- **File Modification**: Changed files are re-indexed with updated content
- **File Deletion**: Removed files are cleaned from the index
- **File Rename/Move**: Old entries are removed, new paths are indexed

### Debouncing System
To prevent excessive API calls and indexing operations:
- **Batching**: Multiple file changes are grouped together
- **Debounce Delay**: Configurable wait time (default: 2 seconds)
- **Smart Processing**: Only processes files once per batch

## Configuration

### Settings Available

1. **Auto-index on startup** (Default: `true`)
   - Indexes the entire vault when Obsidian starts
   - Catches any changes made while Obsidian was closed

2. **Auto-index on file changes** (Default: `true`)
   - Enables real-time file watching
   - Automatically processes file create/modify/delete/rename events

3. **Debounce delay** (Default: `2000ms`)
   - Wait time before processing pending file changes
   - Range: 500ms to 10 seconds
   - Higher values = fewer API calls, lower responsiveness

### When to Adjust Settings

**High Activity Scenarios** (increase debounce delay):
- Bulk file operations
- Large imports/exports
- Plugin installations that modify many files
- Working with templates that create multiple files

**Real-time Scenarios** (decrease debounce delay):
- Active note-taking sessions
- Collaborative editing
- Immediate search needs

## Behavior Examples

### Single File Edit
```
1. User edits "Project Notes.md"
2. File modification event triggered
3. 2-second timer starts
4. If no other changes, file is re-indexed after 2 seconds
5. User sees "ObsidiAnswer: Updated 1 file(s)" notification
```

### Bulk Operations
```
1. User creates 5 new files rapidly
2. Each creation resets the 2-second timer
3. After 2 seconds of no activity, all 5 files are processed
4. User sees "ObsidiAnswer: Updated 5 file(s)" notification
```

### File Deletion
```
1. User deletes "Old Notes.md"
2. File is immediately removed from index (no debounce)
3. Chunks and embeddings are cleaned up
4. No notification (silent cleanup)
```

## Performance Considerations

### Efficient Processing
- **Incremental Updates**: Only changed files are processed
- **Batch Operations**: Multiple changes processed together
- **Background Processing**: Doesn't block UI interactions
- **Smart Filtering**: Only `.md` files are monitored

### Resource Management
- **API Rate Limiting**: Debouncing prevents API spam
- **Memory Efficient**: Old chunks are properly cleaned up
- **Disk I/O**: Index saves are batched with file operations

### Monitoring
Check console logs for file watching activity:
```
[ObsidiAnswer] File modified: Project Notes.md
[ObsidiAnswer] Processing 3 pending files...
[ObsidiAnswer] Auto-indexed: Project Notes.md
```

## Troubleshooting

### File Changes Not Detected
1. **Check Settings**: Ensure "Auto-index on file changes" is enabled
2. **File Type**: Only `.md` files are monitored
3. **Provider Config**: Ensure your LLM provider is properly configured
4. **Console Logs**: Check for error messages

### Too Many API Calls
1. **Increase Debounce**: Set delay to 5-10 seconds
2. **Disable Auto-indexing**: Turn off file watching temporarily
3. **Manual Indexing**: Use commands for controlled indexing

### Missing Updates
1. **Check Debounce**: Very high delays might feel unresponsive
2. **Manual Refresh**: Use "Index Vault" command to catch up
3. **Restart Plugin**: Reload ObsidiAnswer if issues persist

## Advanced Usage

### Selective Indexing
Currently all `.md` files are monitored. Future versions may include:
- Folder-based filtering
- Tag-based inclusion/exclusion
- File size limits
- Custom file patterns

### Integration with Other Plugins
File watching works alongside:
- **Templater**: New files from templates are auto-indexed
- **Daily Notes**: New daily notes are automatically included
- **Folder Notes**: Folder structure changes are tracked
- **File Explorer**: Drag-and-drop operations are detected

### Performance Tuning
For large vaults (1000+ files):
- Increase debounce delay to 5+ seconds
- Consider disabling auto-indexing during bulk operations
- Use manual indexing for major reorganizations

## Migration from Manual Indexing

### Existing Users
- File watching is enabled by default
- Existing index is preserved
- No re-indexing required
- Can disable if preferred

### Workflow Changes
**Before**: Edit files → Remember to re-index → Query
**After**: Edit files → Query (indexing happens automatically)

This system makes ObsidiAnswer truly "set and forget" - your knowledge base stays current without any manual intervention!
