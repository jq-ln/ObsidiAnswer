const fs = require('fs');
const path = require('path');

// Paths
const sourceDir = __dirname + '/..'; // RAG directory
const targetDir = path.join(__dirname, '../../vault/.obsidian/plugins/obsidianswer');

// Files to copy
const filesToCopy = [
    'main.js',
    'manifest.json',
    'styles.css'
];

function ensureDirectoryExists(dirPath) {
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
        console.log(`Created directory: ${dirPath}`);
    }
}

function copyFile(source, target) {
    try {
        fs.copyFileSync(source, target);
        console.log(`Copied: ${path.basename(source)}`);
    } catch (error) {
        console.error(`Error copying ${source}:`, error.message);
    }
}

function cleanupTarget() {
    // Remove old files if they exist
    filesToCopy.forEach(file => {
        const targetFile = path.join(targetDir, file);
        if (fs.existsSync(targetFile)) {
            fs.unlinkSync(targetFile);
        }
    });
}

function main() {
    console.log('🔄 Syncing plugin to vault...');
    
    // Ensure target directory exists
    ensureDirectoryExists(targetDir);
    
    // Clean up old files
    cleanupTarget();
    
    // Copy new files
    filesToCopy.forEach(file => {
        const sourcePath = path.join(sourceDir, file);
        const targetPath = path.join(targetDir, file);
        
        if (fs.existsSync(sourcePath)) {
            copyFile(sourcePath, targetPath);
        } else {
            console.warn(`⚠️  Source file not found: ${file}`);
        }
    });
    
    console.log('✅ Plugin sync completed!');
    console.log(`📁 Plugin installed to: ${targetDir}`);
    console.log('💡 Restart Obsidian or reload the plugin to see changes.');
}

main();
