import { html, css, LitElement } from '../../assets/lit-core-2.7.4.min.js';
import './AppHeader.js';
import '../views/MainView.js';
import '../views/CustomizeView.js';
import '../views/HelpView.js';
import '../views/HistoryView.js';
import '../views/AssistantView.js';
import '../views/OnboardingView.js';
import '../views/AdvancedView.js';
import '../views/SidePanel.js';

// Voice assistant helper provides speech recognition via the Web Speech API.
// It exports a startListening() function that returns a stop function.
import { startListening } from '../../utils/voiceAssistant.js';
// Live streaming helper integrates with Gemini Live via backend
import { startLiveStreaming } from '../../utils/liveStreamer.js';
import { logger as defaultLogger } from '../../utils/logger.js';

// Use global logger if available, falling back to the imported logger or console
const logger = globalThis.logger || defaultLogger || console;

export class CheatingDaddyApp extends LitElement {
    static styles = css`
        * {
            box-sizing: border-box;
            font-family:
                'Inter',
                -apple-system,
                BlinkMacSystemFont,
                sans-serif;
            margin: 0px;
            padding: 0px;
            cursor: default;
            user-select: none;
        }

        :host {
            display: block;
            width: 100%;
            height: 100vh;
            background-color: var(--background-transparent);
            color: var(--text-color);
        }

        .window-container {
            height: 100vh;
            border-radius: 7px;
            overflow: hidden;
        }

        .container {
            display: flex;
            flex-direction: column;
            height: 100%;
        }

        .main-content {
            flex: 1;
            padding: var(--main-content-padding);
            overflow-y: auto;
            margin-top: var(--main-content-margin-top);
            border-radius: var(--content-border-radius);
            transition: all 0.15s ease-out;
            background: var(--main-content-background);
            /* Add a frosted glass effect. The backdrop-filter property blurs and
             * saturates whatever is behind the main content, giving a liquid
             * glass look reminiscent of modern UI designs. Including the
             * vendor prefixed version ensures support on WebKit browsers. */
            backdrop-filter: blur(30px) saturate(180%);
            -webkit-backdrop-filter: blur(30px) saturate(180%);
        }

        .main-content.with-border {
            border: 1px solid var(--border-color);
        }

        .main-content.assistant-view {
            padding: 10px;
            border: none;
        }

        .assistant-container {
            display: flex;
            height: 100%;
        }

        .assistant-container assistant-view {
            flex: 1;
        }

        .main-content.onboarding-view {
            padding: 0;
            border: none;
            background: transparent;
        }

        .view-container {
            opacity: 1;
            transform: translateY(0);
            transition:
                opacity 0.15s ease-out,
                transform 0.15s ease-out;
            height: 100%;
        }

        .view-container.entering {
            opacity: 0;
            transform: translateY(10px);
        }

        ::-webkit-scrollbar {
            width: 6px;
            height: 6px;
        }

        ::-webkit-scrollbar-track {
            background: var(--scrollbar-background);
            border-radius: 3px;
        }

        ::-webkit-scrollbar-thumb {
            background: var(--scrollbar-thumb);
            border-radius: 3px;
        }

        ::-webkit-scrollbar-thumb:hover {
            background: var(--scrollbar-thumb-hover);
        }
    `;

    static properties = {
        currentView: { type: String },
        statusText: { type: String },
        startTime: { type: Number },
        isRecording: { type: Boolean },
        sessionActive: { type: Boolean },
        selectedProfile: { type: String },
        selectedLanguage: { type: String },
        responses: { type: Array },
        currentResponseIndex: { type: Number },
        selectedScreenshotInterval: { type: String },
        selectedImageQuality: { type: String },
        layoutMode: { type: String },
        advancedMode: { type: Boolean },
        sessionId: { type: String },
        transcripts: { type: Array },
        notes: { type: String },
        _viewInstances: { type: Object, state: true },
        _isClickThrough: { state: true },
        _awaitingNewResponse: { state: true },
        shouldAnimateResponse: { type: Boolean },
        audioLevel: { type: Number },
    };

    constructor() {
        super();
        this.currentView = localStorage.getItem('onboardingCompleted') ? 'main' : 'onboarding';
        this.statusText = '';
        this.startTime = null;
        this.isRecording = false;
        this.sessionActive = false;
        this.selectedProfile = localStorage.getItem('selectedProfile') || 'interview';
        this.selectedLanguage = localStorage.getItem('selectedLanguage') || 'en-US';
        this.selectedScreenshotInterval = localStorage.getItem('selectedScreenshotInterval') || '5';
        this.selectedImageQuality = localStorage.getItem('selectedImageQuality') || 'medium';
        this.layoutMode = localStorage.getItem('layoutMode') || 'normal';
        this.advancedMode = localStorage.getItem('advancedMode') === 'true';
        this.responses = [];
        this.currentResponseIndex = -1;
        this._viewInstances = new Map();
        this._isClickThrough = false;
        this._awaitingNewResponse = false;
        this._currentResponseIsComplete = true;
        this.shouldAnimateResponse = false;
        this.sessionId = null;
        this.transcripts = [];
        this.notes = '';
        this.audioLevel = 0;

        // Apply layout mode to document root
        this.updateLayoutMode();
    }

    connectedCallback() {
        super.connectedCallback();

        // Set up IPC listeners if available
        if (window.electron) {
            this._updateResponseHandler = (_, response) => {
                this.setResponse(response);
            };
            this._updateStatusHandler = (_, status) => {
                this.setStatus(status);
            };
            this._clickThroughHandler = (_, isEnabled) => {
                this._isClickThrough = isEnabled;
            };
            window.electron.onUpdateResponse?.(this._updateResponseHandler);
            window.electron.onUpdateStatus?.(this._updateStatusHandler);
            window.electron.onClickThroughToggled?.(this._clickThroughHandler);
        }

        // Start the voice assistant to listen for spoken questions and
        // automatically query the local Gemini backend. The callback
        // assigns responses via setResponse(). A stop function is saved
        // so it can be cleaned up in disconnectedCallback().

        // Start the voice assistant to listen for spoken questions and
        // automatically query the local Gemini backend. The callback
        // assigns responses via setResponse(). A stop function is saved
        // so it can be cleaned up in disconnectedCallback().
        this._stopVoiceAssistant = startListening(async transcript => {
            try {
                const res = await fetch('http://localhost:3001/ask', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ prompt: transcript }),
                });
                const data = await res.json();
                if (data.reply) {
                    this.setResponse(data.reply);
                    if (this.sessionId) {
                        this.transcripts = [
                            ...this.transcripts,
                            { transcription: transcript, ai_response: data.reply },
                        ];
                        try {
                            await fetch(`http://localhost:3001/history/${this.sessionId}/turn`, {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({
                                    transcription: transcript,
                                    ai_response: data.reply,
                                    notes: this.notes,
                                }),
                            });
                        } catch (err) {
                            logger.error('Failed to post turn:', err);
                        }
                    }
                }
            } catch (err) {
                logger.error('Voice assistant fetch failed:', err);
            }
        });

        // Start live streaming of audio and screen using the new LLMClient
        // workflow. Responses and status updates feed directly into the UI.
        startLiveStreaming({
            onResponse: response => {
                if (response) this.setResponse(response);
            },
            onStatus: status => this.setStatus(status),
            onError: err => logger.error('Live streaming error:', err),
            onAudioLevel: level => {
                this.audioLevel = level;
                this.requestUpdate();
            },
        })
            .then(stopFn => {
                this._stopLiveStreaming = stopFn;
            })
            .catch(err => {
                logger.error('Failed to start live streaming:', err);
            });
    }

    disconnectedCallback() {
        // Stop the voice assistant when the component is detached.
        if (this._stopVoiceAssistant) {
            this._stopVoiceAssistant();
            this._stopVoiceAssistant = null;
        }

        // Stop live streaming if it's active
        if (this._stopLiveStreaming) {
            this._stopLiveStreaming();
            this._stopLiveStreaming = null;
        }

        super.disconnectedCallback();
        if (window.electron) {
            window.electron.removeUpdateResponseListener?.(this._updateResponseHandler);
            window.electron.removeUpdateStatusListener?.(this._updateStatusHandler);
            window.electron.removeClickThroughToggledListener?.(this._clickThroughHandler);
        }
    }

    setStatus(text) {
        this.statusText = text;

        // Mark response as complete when we get certain status messages
        if (text.includes('Ready') || text.includes('Listening') || text.includes('Error')) {
            this._currentResponseIsComplete = true;
            logger.info('[setStatus] Marked current response as complete');
            const last = this.responses?.length ? this.responses[this.responses.length - 1] : null;
            if (last) this.maybeSpeak(last);
        }
    }

    maybeSpeak(text) {
        try {
            const enabled = localStorage.getItem('enableTTS') === 'true';
            if (!enabled) return;
            if (!window.speechSynthesis) return;
            const utter = new SpeechSynthesisUtterance(text);
            utter.rate = 1.0;
            utter.pitch = 1.0;
            speechSynthesis.cancel();
            speechSynthesis.speak(utter);
        } catch (_e) {
            /* empty */
        }
    }

    setResponse(response) {
        // Check if this looks like a filler response (very short responses to hmm, ok, etc)
        const isFillerResponse =
            response.length < 30 &&
            (response.toLowerCase().includes('hmm') ||
                response.toLowerCase().includes('okay') ||
                response.toLowerCase().includes('next') ||
                response.toLowerCase().includes('go on') ||
                response.toLowerCase().includes('continue'));

        if (this._awaitingNewResponse || this.responses.length === 0) {
            // Always add as new response when explicitly waiting for one
            this.responses = [...this.responses, response];
            this.currentResponseIndex = this.responses.length - 1;
            this._awaitingNewResponse = false;
            this._currentResponseIsComplete = false;
            logger.info('[setResponse] Pushed new response:', response);
        } else if (!this._currentResponseIsComplete && !isFillerResponse && this.responses.length > 0) {
            // For substantial responses, update the last one (streaming behavior)
            // Only update if the current response is not marked as complete
            this.responses = [...this.responses.slice(0, this.responses.length - 1), response];
            logger.info('[setResponse] Updated last response:', response);
        } else {
            // For filler responses or when current response is complete, add as new
            this.responses = [...this.responses, response];
            this.currentResponseIndex = this.responses.length - 1;
            this._currentResponseIsComplete = false;
            logger.info('[setResponse] Added response as new:', response);
        }
        this.shouldAnimateResponse = true;
        this.requestUpdate();
    }

    // Header event handlers
    handleCustomizeClick() {
        this.currentView = 'customize';
        this.requestUpdate();
    }

    handleHelpClick() {
        this.currentView = 'help';
        this.requestUpdate();
    }

    handleHistoryClick() {
        this.currentView = 'history';
        this.requestUpdate();
    }

    handleAdvancedClick() {
        this.currentView = 'advanced';
        this.requestUpdate();
    }

    async handleClose() {
        if (this.currentView === 'customize' || this.currentView === 'help' || this.currentView === 'history') {
            this.currentView = 'main';
        } else if (this.currentView === 'assistant') {
            cheddar.stopCapture();

            // Close the session
            if (window.electron?.closeSession) {
                await window.electron.closeSession();
            }
            this.sessionActive = false;
            this.currentView = 'main';
            logger.info('Session closed');
        } else {
            // Quit the entire application
            if (window.electron?.quitApplication) {
                await window.electron.quitApplication();
            }
        }
    }

    async handleHideToggle() {
        if (window.electron?.toggleWindowVisibility) {
            await window.electron.toggleWindowVisibility();
        }
    }

    // Main view event handlers
    async handleStart() {
        // check if api key is empty do nothing
        const apiKey = localStorage.getItem('apiKey')?.trim();
        if (!apiKey || apiKey === '') {
            // Trigger the red blink animation on the API key input
            const mainView = this.shadowRoot.querySelector('main-view');
            if (mainView && mainView.triggerApiKeyError) {
                mainView.triggerApiKeyError();
            }
            return;
        }

        await cheddar.initializeGemini(this.selectedProfile, this.selectedLanguage);
        // Pass the screenshot interval as string (including 'manual' option)
        cheddar.startCapture(this.selectedScreenshotInterval, this.selectedImageQuality);
        this.responses = [];
        this.currentResponseIndex = -1;
        this.startTime = Date.now();
        this.sessionId = self.crypto?.randomUUID?.() ?? Date.now().toString();
        this.transcripts = [];
        this.notes = '';
        try {
            await fetch(`http://localhost:3001/history/${this.sessionId}/turn`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sessionStart: true, notes: '' }),
            });
        } catch (error) {
            logger.error('Failed to start session history:', error);
        }
        this.currentView = 'assistant';
    }

    async handleAPIKeyHelp() {
        if (window.electron?.openExternal) {
            await window.electron.openExternal('https://cheatingdaddy.com/help/api-key');
        }
    }

    // Customize view event handlers
    handleProfileChange(profile) {
        this.selectedProfile = profile;
    }

    handleLanguageChange(language) {
        this.selectedLanguage = language;
    }

    handleScreenshotIntervalChange(interval) {
        this.selectedScreenshotInterval = interval;
    }

    handleImageQualityChange(quality) {
        this.selectedImageQuality = quality;
        localStorage.setItem('selectedImageQuality', quality);
    }

    handleAdvancedModeChange(advancedMode) {
        this.advancedMode = advancedMode;
        localStorage.setItem('advancedMode', advancedMode.toString());
    }

    handleBackClick() {
        this.currentView = 'main';
        this.requestUpdate();
    }

    // Help view event handlers
    async handleExternalLinkClick(url) {
        if (window.electron?.openExternal) {
            await window.electron.openExternal(url);
        }
    }

    // Assistant view event handlers
    async handleSendText(message) {
        const result = await window.cheddar.sendTextMessage(message);

        if (!result.success) {
            logger.error('Failed to send message:', result.error);
            this.setStatus('Error sending message: ' + result.error);
        } else {
            this.setStatus('Message sent...');
            this._awaitingNewResponse = true;
        }
    }

    async handleNotesChange(e) {
        const newNotes = e?.detail?.value ?? e?.target?.value ?? '';
        this.notes = newNotes;
        if (!this.sessionId) return;
        try {
            await fetch(`http://localhost:3001/history/${this.sessionId}/turn`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ notes: this.notes }),
            });
        } catch (error) {
            logger.error('Failed to save notes:', error);
        }
    }

    handleResponseIndexChanged(e) {
        this.currentResponseIndex = e.detail.index;
        this.shouldAnimateResponse = false;
        this.requestUpdate();
    }

    // Onboarding event handlers
    handleOnboardingComplete() {
        this.currentView = 'main';
    }

    updated(changedProperties) {
        super.updated(changedProperties);

        // Only notify main process of view change if the view actually changed
        if (changedProperties.has('currentView') && window.electron?.viewChanged) {
            window.electron.viewChanged(this.currentView);

            // Add a small delay to smooth out the transition
            const viewContainer = this.shadowRoot?.querySelector('.view-container');
            if (viewContainer) {
                viewContainer.classList.add('entering');
                requestAnimationFrame(() => {
                    viewContainer.classList.remove('entering');
                });
            }
        }

        // Only update localStorage when these specific properties change
        if (changedProperties.has('selectedProfile')) {
            localStorage.setItem('selectedProfile', this.selectedProfile);
        }
        if (changedProperties.has('selectedLanguage')) {
            localStorage.setItem('selectedLanguage', this.selectedLanguage);
        }
        if (changedProperties.has('selectedScreenshotInterval')) {
            localStorage.setItem('selectedScreenshotInterval', this.selectedScreenshotInterval);
        }
        if (changedProperties.has('selectedImageQuality')) {
            localStorage.setItem('selectedImageQuality', this.selectedImageQuality);
        }
        if (changedProperties.has('layoutMode')) {
            this.updateLayoutMode();
        }
        if (changedProperties.has('advancedMode')) {
            localStorage.setItem('advancedMode', this.advancedMode.toString());
        }
    }

    renderCurrentView() {
        // Only re-render the view if it hasn't been cached or if critical properties changed
        switch (this.currentView) {
            case 'onboarding':
                return html`
                    <onboarding-view .onComplete=${() => this.handleOnboardingComplete()} .onClose=${() => this.handleClose()}></onboarding-view>
                `;

            case 'main':
                return html`
                    <main-view
                        .onStart=${() => this.handleStart()}
                        .onAPIKeyHelp=${() => this.handleAPIKeyHelp()}
                        .onLayoutModeChange=${layoutMode => this.handleLayoutModeChange(layoutMode)}
                    ></main-view>
                `;

            case 'customize':
                return html`
                    <customize-view
                        .selectedProfile=${this.selectedProfile}
                        .selectedLanguage=${this.selectedLanguage}
                        .selectedScreenshotInterval=${this.selectedScreenshotInterval}
                        .selectedImageQuality=${this.selectedImageQuality}
                        .layoutMode=${this.layoutMode}
                        .advancedMode=${this.advancedMode}
                        .onProfileChange=${profile => this.handleProfileChange(profile)}
                        .onLanguageChange=${language => this.handleLanguageChange(language)}
                        .onScreenshotIntervalChange=${interval => this.handleScreenshotIntervalChange(interval)}
                        .onImageQualityChange=${quality => this.handleImageQualityChange(quality)}
                        .onLayoutModeChange=${layoutMode => this.handleLayoutModeChange(layoutMode)}
                        .onAdvancedModeChange=${advancedMode => this.handleAdvancedModeChange(advancedMode)}
                    ></customize-view>
                `;

            case 'help':
                return html` <help-view .onExternalLinkClick=${url => this.handleExternalLinkClick(url)}></help-view> `;

            case 'history':
                return html` <history-view></history-view> `;

            case 'advanced':
                return html` <advanced-view></advanced-view> `;

            case 'assistant':
                return html`
                    <div class="assistant-container">
                        <assistant-view
                            .responses=${this.responses}
                            .currentResponseIndex=${this.currentResponseIndex}
                            .selectedProfile=${this.selectedProfile}
                            .onSendText=${message => this.handleSendText(message)}
                            .shouldAnimateResponse=${this.shouldAnimateResponse}
                            @response-index-changed=${this.handleResponseIndexChanged}
                            @response-animation-complete=${() => {
                                this.shouldAnimateResponse = false;
                                this._currentResponseIsComplete = true;
                                logger.info('[response-animation-complete] Marked current response as complete');
                                this.requestUpdate();
                            }}
                        ></assistant-view>
                        <side-panel
                            .notes=${this.notes}
                            .transcripts=${this.transcripts}
                            .selectedProfile=${this.selectedProfile}
                            @notes-change=${e => this.handleNotesChange(e)}
                        ></side-panel>
                    </div>
                `;

            default:
                return html`<div>Unknown view: ${this.currentView}</div>`;
        }
    }

    render() {
        const mainContentClass = `main-content ${
            this.currentView === 'assistant' ? 'assistant-view' : this.currentView === 'onboarding' ? 'onboarding-view' : 'with-border'
        }`;

        return html`
            <div class="window-container">
                <div class="container">
                    <app-header
                        .currentView=${this.currentView}
                        .statusText=${this.statusText}
                        .startTime=${this.startTime}
                        .advancedMode=${this.advancedMode}
                        .audioLevel=${this.audioLevel}
                        .onCustomizeClick=${() => this.handleCustomizeClick()}
                        .onHelpClick=${() => this.handleHelpClick()}
                        .onHistoryClick=${() => this.handleHistoryClick()}
                        .onAdvancedClick=${() => this.handleAdvancedClick()}
                        .onCloseClick=${() => this.handleClose()}
                        .onBackClick=${() => this.handleBackClick()}
                        .onHideToggleClick=${() => this.handleHideToggle()}
                        ?isClickThrough=${this._isClickThrough}
                    ></app-header>
                    <div class="${mainContentClass}">
                        <div class="view-container">${this.renderCurrentView()}</div>
                    </div>
                </div>
            </div>
        `;
    }

    updateLayoutMode() {
        // Apply or remove compact layout class to document root
        if (this.layoutMode === 'compact') {
            document.documentElement.classList.add('compact-layout');
        } else {
            document.documentElement.classList.remove('compact-layout');
        }
    }

    async handleLayoutModeChange(layoutMode) {
        this.layoutMode = layoutMode;
        localStorage.setItem('layoutMode', layoutMode);
        this.updateLayoutMode();

        // Notify main process about layout change for window resizing
        if (window.electron?.updateSizes) {
            try {
                await window.electron.updateSizes();
            } catch (error) {
                logger.error('Failed to update sizes in main process:', error);
            }
        }

        this.requestUpdate();
    }
}

customElements.define('cheating-daddy-app', CheatingDaddyApp);
