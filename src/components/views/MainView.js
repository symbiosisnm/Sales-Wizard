import { html, css, LitElement } from '../../assets/lit-core-2.7.4.min.js';
import { resizeLayout } from '../../utils/windowResize.js';

export class MainView extends LitElement {
    static styles = css`
        * {
            font-family: 'Inter', sans-serif;
            cursor: default;
            user-select: none;
        }

        .welcome {
            font-size: 24px;
            margin-bottom: 8px;
            font-weight: 600;
            margin-top: auto;
        }

        .input-group {
            display: flex;
            gap: 12px;
            margin-bottom: 20px;
        }

        .input-group input {
            flex: 1;
        }

        input {
            background: var(--input-background);
            color: var(--text-color);
            border: 1px solid var(--button-border);
            padding: 10px 14px;
            width: 100%;
            border-radius: 8px;
            font-size: 14px;
            transition: border-color 0.2s ease;
        }

        input:focus {
            outline: none;
            border-color: var(--focus-border-color);
            box-shadow: 0 0 0 3px var(--focus-box-shadow);
            background: var(--input-focus-background);
        }

        input::placeholder {
            color: var(--placeholder-color);
        }

        /* Red blink animation for empty API key */
        input.api-key-error {
            animation: blink-red 1s ease-in-out;
            border-color: #ff4444;
        }

        @keyframes blink-red {
            0%,
            100% {
                border-color: var(--button-border);
                background: var(--input-background);
            }
            25%,
            75% {
                border-color: #ff4444;
                background: rgba(255, 68, 68, 0.1);
            }
            50% {
                border-color: #ff6666;
                background: rgba(255, 68, 68, 0.15);
            }
        }

        .start-button {
            background: var(--start-button-background);
            color: var(--start-button-color);
            border: 1px solid var(--start-button-border);
            padding: 8px 16px;
            border-radius: 8px;
            font-size: 13px;
            font-weight: 500;
            white-space: nowrap;
            display: flex;
            align-items: center;
            gap: 6px;
        }

        .start-button:hover {
            background: var(--start-button-hover-background);
            border-color: var(--start-button-hover-border);
        }

        .start-button.initializing {
            opacity: 0.5;
        }

        .start-button.initializing:hover {
            background: var(--start-button-background);
            border-color: var(--start-button-border);
        }

        .shortcut-icons {
            display: flex;
            align-items: center;
            gap: 2px;
            margin-left: 4px;
        }

        .shortcut-icons svg {
            width: 14px;
            height: 14px;
        }

        .shortcut-icons svg path {
            stroke: currentColor;
        }

        .description {
            color: var(--description-color);
            font-size: 14px;
            margin-bottom: 24px;
            line-height: 1.5;
        }

        .focus-stack {
            display: flex;
            flex-direction: column;
            gap: 12px;
            margin-bottom: 18px;
            padding: 14px;
            border-radius: 16px;
            border: 1px solid rgba(255, 255, 255, 0.1);
            background: rgba(255, 255, 255, 0.04);
            backdrop-filter: blur(18px) saturate(140%);
            -webkit-backdrop-filter: blur(18px) saturate(140%);
        }

        .focus-title {
            font-size: 13px;
            font-weight: 700;
            letter-spacing: 0.08em;
            text-transform: uppercase;
            color: rgba(255, 255, 255, 0.62);
        }

        .focus-caption {
            color: rgba(255, 255, 255, 0.68);
            font-size: 13px;
            line-height: 1.45;
        }

        .focus-field {
            display: flex;
            flex-direction: column;
            gap: 6px;
        }

        .focus-label {
            font-size: 11px;
            font-weight: 700;
            letter-spacing: 0.08em;
            text-transform: uppercase;
            color: rgba(255, 255, 255, 0.56);
        }

        .focus-error {
            border-color: #ff6868 !important;
            box-shadow: 0 0 0 3px rgba(255, 104, 104, 0.14) !important;
        }

        .link {
            color: var(--link-color);
            text-decoration: underline;
            cursor: pointer;
        }

        .shortcut-hint {
            color: var(--description-color);
            font-size: 11px;
            opacity: 0.8;
        }

        :host {
            height: 100%;
            display: flex;
            flex-direction: column;
            width: 100%;
            max-width: 500px;
        }
    `;

    static properties = {
        onStart: { type: Function },
        onAPIKeyHelp: { type: Function },
        isInitializing: { type: Boolean },
        onLayoutModeChange: { type: Function },
        showApiKeyError: { type: Boolean },
        showFocusError: { type: Boolean },
        focusConfig: { type: Object },
        knowledgeItems: { type: Array },
        sessionOptions: { type: Object },
        ffmpegAvailable: { type: Boolean },
    };

    constructor() {
        super();
        this.onStart = () => {};
        this.onAPIKeyHelp = () => {};
        this.isInitializing = false;
        this.onLayoutModeChange = () => {};
        this.showApiKeyError = false;
        this.showFocusError = false;
        this.focusConfig = {
            jobTitle: '',
            objective: '',
            priorityTopics: '',
            guidelineText: '',
            selectedKnowledgeIds: [],
            webSearchEnabled: true,
        };
        this.knowledgeItems = [];
        this.sessionOptions = {
            captureSystemAudio: false,
            rememberImports: false,
            videoAssistMode: 'rolling-clip',
            clipWindowSeconds: 8,
        };
        this.ffmpegAvailable = false;
        this._apiKeyStartTimer = null;
        this.boundKeydownHandler = this.handleKeydown.bind(this);
    }

    connectedCallback() {
        super.connectedCallback();
        window.electron?.onSessionInitializing?.((event, isInitializing) => {
            this.isInitializing = isInitializing;
        });

        // Add keyboard event listener for Ctrl+Enter (or Cmd+Enter on Mac)
        document.addEventListener('keydown', this.boundKeydownHandler);

        // Load and apply layout mode on startup
        this.loadLayoutMode();
        // Resize window for this view
        resizeLayout();
    }

    disconnectedCallback() {
        super.disconnectedCallback();
        window.electron?.removeSessionInitializingListeners?.();
        if (this._apiKeyStartTimer) {
            clearTimeout(this._apiKeyStartTimer);
            this._apiKeyStartTimer = null;
        }
        // Remove keyboard event listener
        document.removeEventListener('keydown', this.boundKeydownHandler);
    }

    handleKeydown(e) {
        const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
        const isStartShortcut = isMac ? e.metaKey && e.key === 'Enter' : e.ctrlKey && e.key === 'Enter';

        if (isStartShortcut) {
            e.preventDefault();
            this.handleStartClick();
        }
    }

    async handleInput(e) {
        const value = e.target.value;
        localStorage.setItem('apiKey', value);
        // Prefer secure store via IPC, fallback to localStorage
        try {
            if (window.electron?.secureSetApiKey) {
                await window.electron.secureSetApiKey(value);
            }
        } catch (_e) {
            localStorage.setItem('apiKey', value);
        }
        // Clear error state when user starts typing
        if (this.showApiKeyError) {
            this.showApiKeyError = false;
        }

        const trimmed = value.trim();
        if (trimmed.startsWith('sk-') && trimmed.length > 20) {
            if (this._apiKeyStartTimer) {
                clearTimeout(this._apiKeyStartTimer);
            }
            this._apiKeyStartTimer = setTimeout(() => {
                this._apiKeyStartTimer = null;
                this.handleStartClick();
            }, 350);
        }
    }

    emitFocusConfigChange(patch) {
        this.focusConfig = {
            ...(this.focusConfig || {}),
            ...patch,
        };
        this.dispatchEvent(
            new CustomEvent('focus-config-change', {
                detail: { config: this.focusConfig },
                bubbles: true,
                composed: true,
            })
        );
    }

    emitSessionOptionsChange(patch) {
        this.sessionOptions = {
            ...(this.sessionOptions || {}),
            ...patch,
        };
        this.dispatchEvent(
            new CustomEvent('session-options-change', {
                detail: { options: this.sessionOptions },
                bubbles: true,
                composed: true,
            })
        );
    }

    emitKnowledgeSelection(id, selected) {
        this.dispatchEvent(
            new CustomEvent('knowledge-selection-change', {
                detail: { id, selected },
                bubbles: true,
                composed: true,
            })
        );
    }

    handleFocusInput(storageKey, configKey, e) {
        localStorage.setItem(storageKey, e.target.value);
        this.emitFocusConfigChange({ [configKey]: e.target.value });
        if (this.showFocusError) {
            this.showFocusError = false;
        }
    }

    async getSecureApiKeyWithTimeout(timeoutMs = 1800) {
        if (!window.electron?.secureGetApiKey) {
            return '';
        }

        let timeoutId;
        const timeout = new Promise(resolve => {
            timeoutId = window.setTimeout(() => resolve({ success: false, timeout: true }), timeoutMs);
        });
        const request = window.electron.secureGetApiKey().catch(() => ({ success: false }));
        const res = await Promise.race([request, timeout]);
        window.clearTimeout(timeoutId);

        return res?.success && res.value ? res.value.trim() : '';
    }

    async firstUpdated() {
        try {
            const secureApiKey = await this.getSecureApiKeyWithTimeout();
            if (secureApiKey) {
                const input = this.renderRoot?.querySelector('input[type="password"]');
                if (input) input.value = secureApiKey;
                localStorage.setItem('apiKey', secureApiKey);
            }
        } catch (_e) {
            /* empty */
        }
    }

    handleStartClick() {
        if (this.isInitializing) {
            return;
        }
        this.onStart();
    }

    handleAPIKeyHelpClick() {
        this.onAPIKeyHelp();
    }

    loadLayoutMode() {
        const savedLayoutMode = localStorage.getItem('layoutMode');
        if (savedLayoutMode && savedLayoutMode !== 'normal') {
            // Notify parent component to apply the saved layout mode
            this.onLayoutModeChange(savedLayoutMode);
        }
    }

    // Method to trigger the red blink animation
    triggerApiKeyError() {
        this.showApiKeyError = true;
        // Remove the error class after 1 second
        setTimeout(() => {
            this.showApiKeyError = false;
        }, 1000);
    }

    getStartButtonText() {
        const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;

        const cmdIcon = html`<svg width="14px" height="14px" viewBox="0 0 24 24" stroke-width="2" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M9 6V18" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path>
            <path d="M15 6V18" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path>
            <path
                d="M9 6C9 4.34315 7.65685 3 6 3C4.34315 3 3 4.34315 3 6C3 7.65685 4.34315 9 6 9H18C19.6569 9 21 7.65685 21 6C21 4.34315 19.6569 3 18 3C16.3431 3 15 4.34315 15 6"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
            ></path>
            <path
                d="M9 18C9 19.6569 7.65685 21 6 21C4.34315 21 3 19.6569 3 18C3 16.3431 4.34315 15 6 15H18C19.6569 15 21 16.3431 21 18C21 19.6569 19.6569 21 18 21C16.3431 21 15 19.6569 15 18"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
            ></path>
        </svg>`;

        const enterIcon = html`<svg width="14px" height="14px" stroke-width="2" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path
                d="M10.25 19.25L6.75 15.75L10.25 12.25"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
            ></path>
            <path
                d="M6.75 15.75H12.75C14.9591 15.75 16.75 13.9591 16.75 11.75V4.75"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
            ></path>
        </svg>`;

        if (isMac) {
            return html`Start Session <span class="shortcut-icons">${cmdIcon}${enterIcon}</span>`;
        } else {
            return html`Start Session <span class="shortcut-icons">Ctrl${enterIcon}</span>`;
        }
    }

    renderKnowledgePicker() {
        if (!Array.isArray(this.knowledgeItems) || !this.knowledgeItems.length) {
            return html`<div class="focus-caption">No saved knowledge items yet. You can attach them from the live Knowledge tab after import.</div>`;
        }

        const selectedIds = new Set(this.focusConfig?.selectedKnowledgeIds || []);
        return html`
            <div class="focus-field">
                <div class="focus-label">Remembered Knowledge</div>
                <div class="focus-caption">Select saved pages, visuals, or notes that should outrank stale context for this session.</div>
                <div style="display:flex;flex-direction:column;gap:8px;max-height:180px;overflow:auto;">
                    ${this.knowledgeItems.slice(0, 8).map(
                        item => html`
                            <label style="display:flex;gap:10px;align-items:flex-start;padding:10px 12px;border-radius:12px;border:1px solid rgba(255,255,255,0.1);background:rgba(255,255,255,0.04);">
                                <input
                                    type="checkbox"
                                    .checked=${selectedIds.has(item.id)}
                                    @change=${e => this.emitKnowledgeSelection(item.id, e.target.checked)}
                                />
                                <span style="display:flex;flex-direction:column;gap:4px;">
                                    <span style="font-size:13px;font-weight:600;color:rgba(255,255,255,0.92);">${item.title}</span>
                                    <span style="font-size:12px;line-height:1.45;color:rgba(255,255,255,0.62);">${item.summary || item.kind}</span>
                                </span>
                            </label>
                        `
                    )}
                </div>
            </div>
        `;
    }

    render() {
        return html`
            <div class="welcome">Sales Wizard</div>

            <div class="input-group">
                <input
                    type="password"
                    placeholder="Enter your OpenAI API key"
                    .value=${localStorage.getItem('apiKey') || ''}
                    @input=${this.handleInput}
                    class="${this.showApiKeyError ? 'api-key-error' : ''}"
                />
                <button @click=${this.handleStartClick} class="start-button ${this.isInitializing ? 'initializing' : ''}">
                    ${this.getStartButtonText()}
                </button>
            </div>
            <p class="shortcut-hint">Paste your OpenAI API key once. Saved keys launch straight into live mode.</p>
            <p class="description">
                Need an API key?
                <span @click=${this.handleAPIKeyHelpClick} class="link">Get one from OpenAI</span>
            </p>
        `;
    }
}

customElements.define('main-view', MainView);
