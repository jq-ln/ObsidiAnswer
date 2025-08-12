import { App, Editor, MarkdownView, Modal, Notice, Plugin, PluginSettingTab, Setting, TFile, WorkspaceLeaf } from 'obsidian';
import { RAGEngine } from './src/rag-engine';
import { RAGView, VIEW_TYPE_RAG } from './src/rag-view';
import { RAGSettings, DEFAULT_SETTINGS } from './src/settings';

export default class RAGPlugin extends Plugin {
	settings: RAGSettings;
	ragEngine: RAGEngine;

	async onload() {
		await this.loadSettings();

		// Initialize RAG engine
		this.ragEngine = new RAGEngine(this.app, this.settings);

		// Register view
		this.registerView(
			VIEW_TYPE_RAG,
			(leaf) => new RAGView(leaf, this)
		);

		// Add ribbon icon
		this.addRibbonIcon('brain-circuit', 'ObsidiAnswer', (evt: MouseEvent) => {
			this.activateView();
		});

		// Add command to open RAG view
		this.addCommand({
			id: 'open-rag-view',
			name: 'ObsidiAnswer: Open Assistant',
			callback: () => {
				this.activateView();
			}
		});

		// Add command to ask question about current note
		this.addCommand({
			id: 'ask-about-current-note',
			name: 'ObsidiAnswer: Ask About Current Note',
			editorCallback: (editor: Editor, view: MarkdownView) => {
				this.askAboutCurrentNote(view.file);
			}
		});

		// Add command to index vault
		this.addCommand({
			id: 'index-vault',
			name: 'ObsidiAnswer: Index Vault',
			callback: async () => {
				new Notice('Starting vault indexing...');
				await this.ragEngine.indexVault();
				new Notice('Vault indexing completed!');
			}
		});

		// Add command to force rebuild index
		this.addCommand({
			id: 'force-rebuild-index',
			name: 'ObsidiAnswer: Force Vault Re-Index',
			callback: async () => {
				new Notice('Starting complete vault re-indexing...');
				await this.ragEngine.forceRebuildIndex();
				new Notice('Vault re-indexing completed!');
			}
		});

		// Add command to show index stats
		this.addCommand({
			id: 'show-index-stats',
			name: 'ObsidiAnswer: Show Index Statistics',
			callback: () => {
				const stats = this.ragEngine.getIndexStats();
				new Notice(`Index Stats: ${stats.totalFiles} files, ${stats.totalChunks} chunks, ${stats.totalEmbeddings} embeddings`);
				console.log('ObsidiAnswer Index Statistics:', stats);
			}
		});

		// Add command to reset similarity threshold
		this.addCommand({
			id: 'reset-similarity-threshold',
			name: 'ObsidiAnswer: Reset Similarity Threshold to 0.3',
			callback: async () => {
				this.settings.similarityThreshold = 0.3;
				await this.saveSettings();
				new Notice('Similarity threshold reset to 0.3');
			}
		});

		// This adds a settings tab so the user can configure various aspects of the plugin
		this.addSettingTab(new RAGSettingTab(this.app, this));

		// Initialize the RAG engine when plugin loads (non-blocking)
		this.ragEngine.initialize().catch(error => {
			console.error('Error initializing RAG engine:', error);
			new Notice('Error initializing ObsidiAnswer. Check console for details.');
		});
	}

	onunload() {
		this.ragEngine?.cleanup();
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
		// Update RAG engine settings reference (no complex logic)
		this.ragEngine.updateSettings(this.settings);
		console.log('[ObsidiAnswer] Settings saved and updated');
	}

	async activateView() {
		const { workspace } = this.app;

		let leaf: WorkspaceLeaf | null = null;
		const leaves = workspace.getLeavesOfType(VIEW_TYPE_RAG);

		if (leaves.length > 0) {
			// A leaf with our view already exists, use that
			leaf = leaves[0];
		} else {
			// Our view could not be found in the workspace, create a new leaf
			// in the right sidebar for it
			leaf = workspace.getRightLeaf(false);
			await leaf.setViewState({ type: VIEW_TYPE_RAG, active: true });
		}

		// "Reveal" the leaf in case it is in a collapsed sidebar
		workspace.revealLeaf(leaf);
	}

	async askAboutCurrentNote(file: TFile | null) {
		if (!file) {
			new Notice('No active note found');
			return;
		}

		// Open RAG view and focus on the current note
		await this.activateView();
		
		// Get the RAG view and set context to current note
		const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_RAG);
		if (leaves.length > 0) {
			const ragView = leaves[0].view as RAGView;
			ragView.setContextNote(file);
		}
	}
}

class RAGSettingTab extends PluginSettingTab {
	plugin: RAGPlugin;

	constructor(app: App, plugin: RAGPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const {containerEl} = this;

		containerEl.empty();

		new Setting(containerEl)
			.setName('OpenAI API Key')
			.setDesc('Your OpenAI API key for embeddings and chat completions')
			.addText(text => text
				.setPlaceholder('sk-...')
				.setValue(this.plugin.settings.openaiApiKey)
				.onChange(async (value) => {
					this.plugin.settings.openaiApiKey = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Embedding Model')
			.setDesc('OpenAI model to use for generating embeddings')
			.addDropdown(dropdown => dropdown
				.addOption('text-embedding-3-small', 'text-embedding-3-small (Recommended)')
				.addOption('text-embedding-3-large', 'text-embedding-3-large')
				.addOption('text-embedding-ada-002', 'text-embedding-ada-002 (Legacy)')
				.setValue(this.plugin.settings.embeddingModel)
				.onChange(async (value) => {
					this.plugin.settings.embeddingModel = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Chat Model')
			.setDesc('OpenAI model to use for generating responses')
			.addDropdown(dropdown => dropdown
				.addOption('gpt-4o', 'GPT-4o (Recommended)')
				.addOption('gpt-4o-mini', 'GPT-4o Mini')
				.addOption('gpt-4-turbo', 'GPT-4 Turbo')
				.addOption('gpt-3.5-turbo', 'GPT-3.5 Turbo')
				.setValue(this.plugin.settings.chatModel)
				.onChange(async (value) => {
					this.plugin.settings.chatModel = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Max Results')
			.setDesc('Maximum number of relevant documents to retrieve')
			.addSlider(slider => slider
				.setLimits(1, 20, 1)
				.setValue(this.plugin.settings.maxResults)
				.setDynamicTooltip()
				.onChange(async (value) => {
					this.plugin.settings.maxResults = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Similarity Threshold')
			.setDesc('Minimum similarity score for retrieved documents (0-1)')
			.addSlider(slider => slider
				.setLimits(0, 1, 0.05)
				.setValue(this.plugin.settings.similarityThreshold)
				.setDynamicTooltip()
				.onChange(async (value) => {
					this.plugin.settings.similarityThreshold = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Auto-index on startup')
			.setDesc('Automatically index the vault when Obsidian starts')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.autoIndex)
				.onChange(async (value) => {
					this.plugin.settings.autoIndex = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Include file paths in context')
			.setDesc('Include file paths and folder structure in the context sent to the AI')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.includeFilePaths)
				.onChange(async (value) => {
					this.plugin.settings.includeFilePaths = value;
					await this.plugin.saveSettings();
				}));
	}
}
