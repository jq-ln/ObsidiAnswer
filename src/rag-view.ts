import { ItemView, WorkspaceLeaf, TFile, MarkdownRenderer, Component } from 'obsidian';
import RAGPlugin from '../main';
import { IndexingProgress } from './rag-engine';

export const VIEW_TYPE_RAG = 'rag-view';

export class RAGView extends ItemView {
	plugin: RAGPlugin;
	private chatContainer: HTMLElement;
	private inputContainer: HTMLElement;
	private questionInput: HTMLInputElement;
	private sendButton: HTMLButtonElement;
	private contextNote: TFile | null = null;
	private chatHistory: Array<{role: 'user' | 'assistant', content: string}> = [];
	private progressContainer: HTMLElement;
	private progressBar: HTMLElement;
	private progressText: HTMLElement;

	constructor(leaf: WorkspaceLeaf, plugin: RAGPlugin) {
		super(leaf);
		this.plugin = plugin;

		// Set up progress callback
		this.plugin.ragEngine.setProgressCallback((progress) => {
			this.updateProgress(progress);
		});
	}

	getViewType() {
		return VIEW_TYPE_RAG;
	}

	getDisplayText() {
		return 'ObsidiAnswer';
	}

	getIcon() {
		return 'brain-circuit';
	}

	async onOpen() {
		const container = this.containerEl.children[1];
		container.empty();
		container.createEl('h2', { text: 'ObsidiAnswer' });

		// Create chat container
		this.chatContainer = container.createEl('div', { 
			cls: 'rag-chat-container',
			attr: { style: 'height: 60%; overflow-y: auto; border: 1px solid var(--background-modifier-border); padding: 10px; margin-bottom: 10px;' }
		});

		// Create input container
		this.inputContainer = container.createEl('div', { 
			cls: 'rag-input-container',
			attr: { style: 'display: flex; gap: 10px;' }
		});

		// Create question input
		this.questionInput = this.inputContainer.createEl('input', {
			type: 'text',
			placeholder: 'Ask a question about your vault...',
			attr: { style: 'flex: 1; padding: 8px;' }
		});

		// Create send button
		this.sendButton = this.inputContainer.createEl('button', {
			text: 'Send',
			attr: { style: 'padding: 8px 16px;' }
		});

		// Add event listeners
		this.questionInput.addEventListener('keypress', (e) => {
			if (e.key === 'Enter') {
				this.handleQuestion();
			}
		});

		this.sendButton.addEventListener('click', () => {
			this.handleQuestion();
		});

		// Add context note display
		const contextContainer = container.createEl('div', {
			cls: 'rag-context-container',
			attr: { style: 'margin-bottom: 10px; padding: 8px; background: var(--background-secondary); border-radius: 4px;' }
		});

		contextContainer.createEl('div', {
			text: 'Context: All vault notes',
			cls: 'rag-context-display',
			attr: { style: 'font-size: 0.9em; color: var(--text-muted);' }
		});

		// Add progress container (initially hidden)
		this.progressContainer = container.createEl('div', {
			cls: 'rag-progress-container',
			attr: { style: 'margin-bottom: 10px; padding: 8px; background: var(--background-secondary); border-radius: 4px; display: none;' }
		});

		const progressLabel = this.progressContainer.createEl('div', {
			text: 'Indexing vault...',
			attr: { style: 'font-size: 0.9em; color: var(--text-muted); margin-bottom: 4px;' }
		});

		// Progress bar background
		const progressBarBg = this.progressContainer.createEl('div', {
			attr: { style: 'width: 100%; height: 8px; background: var(--background-modifier-border); border-radius: 4px; overflow: hidden;' }
		});

		// Progress bar fill
		this.progressBar = progressBarBg.createEl('div', {
			attr: { style: 'height: 100%; background: var(--interactive-accent); width: 0%; transition: width 0.3s ease;' }
		});

		// Progress text
		this.progressText = this.progressContainer.createEl('div', {
			text: '0/0',
			attr: { style: 'font-size: 0.8em; color: var(--text-muted); margin-top: 4px; text-align: center;' }
		});

		// Add welcome message
		this.addMessage('assistant', 'Hello! I\'m ObsidiAnswer, your intelligent knowledge assistant. I can help you find information across your entire vault. Ask me anything about your notes!');
	}

	async onClose() {
		// Clean up if needed
	}

	setContextNote(file: TFile) {
		this.contextNote = file;
		const contextDisplay = this.containerEl.querySelector('.rag-context-display');
		if (contextDisplay) {
			contextDisplay.textContent = `Context: ${file.name}`;
		}
	}

	private async handleQuestion() {
		const question = this.questionInput.value.trim();
		if (!question) return;

		// Clear input
		this.questionInput.value = '';
		this.sendButton.disabled = true;
		this.sendButton.textContent = 'Thinking...';

		// Add user message to chat
		this.addMessage('user', question);

		try {
			// Get response from RAG engine
			const response = await this.plugin.ragEngine.query(question, this.contextNote);
			
			// Add assistant response to chat
			this.addMessage('assistant', response);
		} catch (error) {
			console.error('RAG query error:', error);
			this.addMessage('assistant', 'Sorry, I encountered an error while processing your question. Please check your API key and try again.');
		} finally {
			this.sendButton.disabled = false;
			this.sendButton.textContent = 'Send';
		}
	}

	private addMessage(role: 'user' | 'assistant', content: string) {
		this.chatHistory.push({ role, content });

		const messageEl = this.chatContainer.createEl('div', {
			cls: `rag-message rag-message-${role}`,
			attr: { 
				style: `margin-bottom: 10px; padding: 8px; border-radius: 4px; ${
					role === 'user' 
						? 'background: var(--interactive-accent); color: var(--text-on-accent); margin-left: 20%;' 
						: 'background: var(--background-secondary); margin-right: 20%;'
				}`
			}
		});

		const roleEl = messageEl.createEl('div', {
			text: role === 'user' ? 'You' : 'Assistant',
			attr: { style: 'font-weight: bold; margin-bottom: 4px; font-size: 0.9em;' }
		});

		const contentEl = messageEl.createEl('div', {
			cls: 'rag-message-content'
		});

		// Render markdown content
		if (role === 'assistant') {
			MarkdownRenderer.renderMarkdown(content, contentEl, '', new Component());
		} else {
			contentEl.textContent = content;
		}

		// Scroll to bottom
		this.chatContainer.scrollTop = this.chatContainer.scrollHeight;
	}

	clearChat() {
		this.chatHistory = [];
		this.chatContainer.empty();
		this.addMessage('assistant', 'Chat cleared! How can I help you?');
	}

	private updateProgress(progress: IndexingProgress) {
		if (progress.phase === 'complete' || progress.total === 0) {
			// Hide progress bar
			this.progressContainer.style.display = 'none';
		} else {
			// Show and update progress bar
			this.progressContainer.style.display = 'block';

			const percentage = progress.total > 0 ? (progress.current / progress.total) * 100 : 0;
			this.progressBar.style.width = `${percentage}%`;

			this.progressText.textContent = `${progress.current}/${progress.total}`;

			// Update current file if available
			if (progress.currentFile) {
				const label = this.progressContainer.querySelector('div:first-child') as HTMLElement;
				if (label) {
					label.textContent = `Indexing: ${progress.currentFile}`;
				}
			}
		}
	}
}
