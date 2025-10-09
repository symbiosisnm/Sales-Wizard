import { html, css, LitElement } from '../../assets/lit-core-2.7.4.min.js';
import './AppHeader.js';
import '../views/MainView.js';
import '../views/CustomizeView.js';
import '../views/HelpView.js';
import '../views/HistoryView.js';
import '../views/AssistantView.js';
import '../views/OnboardingView.js';
import '../views/AdvancedView.js';
import './SidePanel.js';

// Voice assistant helper provides speech recognition via the Web Speech API.
// It exports a startListening() function that returns a stop function.
import { startListening } from '../../utils/voiceAssistant.js';
// Live streaming helper integrates with Gemini Live via backend
import { startLiveStreaming } from '../../utils/liveStreamer.js';
import defaultLogger from '../../utils/logger.js';

// Use global logger if available, falling back to the imported logger or console
const logger = globalThis.logger || defaultLogger || console;

export class SalesWizardApp extends LitElement {
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
        connectionState: { type: String },
        audioState: { type: String },
        screenState: { type: String },
        connectionMessage: { type: String },
        audioMessage: { type: String },
        screenMessage: { type: String },
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
        notes: { type: Array },
        manualNotes: { type: String },
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
        this.connectionState = 'disconnected';
        this.audioState = 'idle';
        this.screenState = 'idle';
        this.connectionMessage = 'WebSocket disconnected';
        this.audioMessage = 'Microphone idle';
        this.screenMessage = 'Screen capture idle';
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
        this.notes = [];
        this.manualNotes = '';
        this.audioLevel = 0;
        this._saveConversationTurnHandler = null;

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
            this._saveConversationTurnHandler = (_, payload) => {
                if (!payload) {
                    return;
                }

                const { fullHistory, turn } = payload;
                if (Array.isArray(fullHistory)) {
                    this.transcripts = fullHistory.map(item => ({ ...item }));
                } else if (turn && typeof turn === 'object') {
                    this.transcripts = [...this.transcripts, { ...turn }];
                }
                this.requestUpdate();
            };
            window.electron.onUpdateResponse?.(this._updateResponseHandler);
            window.electron.onUpdateStatus?.(this._updateStatusHandler);
            window.electron.onClickThroughToggled?.(this._clickThroughHandler);
            window.electron.onSaveConversationTurn?.(this._saveConversationTurnHandler);
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
                if (!window.electron?.assistantAsk) {
                    throw new Error('assistantAsk IPC bridge unavailable');
                }

                const result = await window.electron.assistantAsk(transcript);
                if (!result?.success) {
                    throw new Error(result?.error || 'Assistant request failed');
                }

                const reply = result?.data?.reply?.trim?.() || '';
                if (!reply) {
                    return;
                }

                this.setResponse(reply);
                if (this.sessionId) {
                    this.transcripts = [
                        ...this.transcripts,
                        { transcription: transcript, ai_response: reply },
                    ];
                    try {
                        await this.persistHistoryTurn({
                            transcription: transcript,
                            ai_response: reply,
                            notes: this.noteText,
                        });
                    } catch (err) {
                        logger.error('Failed to post turn:', err);
                    }
                }
            } catch (err) {
                logger.error('Voice assistant request failed:', err);
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
            onNote: note => {
                if (note) {
                    const normalizedNote = {
                        ...note,
                        type: note.type || 'auto',
                        text: typeof note.text === 'string' ? note.text : '',
                        timestamp:
                            typeof note.timestamp === 'number'
                                ? note.timestamp
                                : Date.now(),
                    };
                    this.notes = [...this.notes, normalizedNote];
                    this.persistNotes();
                    this.requestUpdate();
                }
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
            window.electron.removeSaveConversationTurnListener?.(this._saveConversationTurnHandler);
        }
    }

    setStatus(status) {
        const normalized = this._normalizeStatusPayload(status);
        const messageForText =
            normalized.message ||
            normalized.connection?.message ||
            normalized.audio?.message ||
            normalized.screen?.message ||
            (typeof status === 'string' ? status : '');

        if (normalized.connection) {
            const { state, message } = normalized.connection;
            if (state) this.connectionState = state;
            if (message) this.connectionMessage = message;
        }

        if (normalized.audio) {
            const { state, message } = normalized.audio;
            if (state) this.audioState = state;
            if (message) this.audioMessage = message;
        }

        if (normalized.screen) {
            const { state, message } = normalized.screen;
            if (state) this.screenState = state;
            if (message) this.screenMessage = message;
        }

        if (messageForText) {
            this.statusText = messageForText;

            // Mark response as complete when we get certain status messages
            if (
                messageForText.includes('Ready') ||
                messageForText.includes('Listening') ||
                messageForText.includes('Error')
            ) {
                this._currentResponseIsComplete = true;
                logger.info('[setStatus] Marked current response as complete');
                const last = this.responses?.length ? this.responses[this.responses.length - 1] : null;
                if (last) this.maybeSpeak(last);
            }
        }
    }

    _normalizeStatusPayload(status) {
        const normalized = {
            message: '',
            connection: null,
            audio: null,
            screen: null,
        };

        if (status && typeof status === 'object') {
            const baseMessage = this._extractMessage(status);
            normalized.message = baseMessage;

            if ('connection' in status || status.type === 'connection') {
                normalized.connection = this._coerceState('connection', status.connection ?? status.state ?? status.value, baseMessage || status.message || status.msg);
            }

            if ('audio' in status || status.type === 'audio') {
                normalized.audio = this._coerceState('audio', status.audio ?? status.state ?? status.value, baseMessage || status.message || status.msg);
            }

            if ('screen' in status || status.type === 'screen') {
                normalized.screen = this._coerceState('screen', status.screen ?? status.state ?? status.value, baseMessage || status.message || status.msg);
            }

            if (!normalized.connection && status.states?.connection) {
                normalized.connection = this._coerceState('connection', status.states.connection, baseMessage);
            }

            if (!normalized.audio && status.states?.audio) {
                normalized.audio = this._coerceState('audio', status.states.audio, baseMessage);
            }

            if (!normalized.screen && status.states?.screen) {
                normalized.screen = this._coerceState('screen', status.states.screen, baseMessage);
            }

            if (!normalized.connection && typeof status.connection === 'object') {
                normalized.connection = this._coerceState('connection', status.connection?.state ?? status.connection?.value, status.connection?.message ?? baseMessage);
            }
            if (!normalized.audio && typeof status.audio === 'object') {
                normalized.audio = this._coerceState('audio', status.audio?.state ?? status.audio?.value, status.audio?.message ?? baseMessage);
            }
            if (!normalized.screen && typeof status.screen === 'object') {
                normalized.screen = this._coerceState('screen', status.screen?.state ?? status.screen?.value, status.screen?.message ?? baseMessage);
            }

            return normalized;
        }

        if (typeof status === 'string') {
            normalized.message = status;
            const connectionState = this._inferStateFromMessage('connection', status);
            if (connectionState) normalized.connection = { state: connectionState, message: status };
            const audioState = this._inferStateFromMessage('audio', status);
            if (audioState) normalized.audio = { state: audioState, message: status };
            const screenState = this._inferStateFromMessage('screen', status);
            if (screenState) normalized.screen = { state: screenState, message: status };
        }

        return normalized;
    }

    _extractMessage(status) {
        if (!status || typeof status !== 'object') return '';
        if (typeof status.message === 'string') return status.message;
        if (typeof status.msg === 'string') return status.msg;
        if (typeof status.text === 'string') return status.text;
        return '';
    }

    _coerceState(kind, rawState, message) {
        if (!rawState && rawState !== 0) return null;
        const state = this._mapState(kind, rawState);
        if (!state) return null;
        const defaults = {
            connection: {
                connected: 'WebSocket connected',
                connecting: 'Connecting to WebSocket',
                disconnected: 'WebSocket disconnected',
                error: 'WebSocket error',
            },
            audio: {
                capturing: 'Microphone streaming',
                idle: 'Microphone idle',
                error: 'Microphone error',
            },
            screen: {
                sharing: 'Screen sharing active',
                idle: 'Screen capture idle',
                error: 'Screen capture error',
            },
        };
        return { state, message: message || defaults[kind]?.[state] || '' };
    }

    _mapState(kind, value) {
        if (value == null) return null;
        const key = String(value).toLowerCase();
        const map = {
            connection: {
                connected: 'connected',
                connect: 'connected',
                open: 'connected',
                ready: 'connected',
                online: 'connected',
                connecting: 'connecting',
                pending: 'connecting',
                opening: 'connecting',
                disconnected: 'disconnected',
                closed: 'disconnected',
                ending: 'disconnected',
                ended: 'disconnected',
                idle: 'disconnected',
                error: 'error',
                failed: 'error',
                timeout: 'error',
            },
            audio: {
                capturing: 'capturing',
                recording: 'capturing',
                listening: 'capturing',
                active: 'capturing',
                starting: 'capturing',
                idle: 'idle',
                stopped: 'idle',
                muted: 'idle',
                ended: 'idle',
                error: 'error',
                failed: 'error',
                denied: 'error',
            },
            screen: {
                sharing: 'sharing',
                capturing: 'sharing',
                streaming: 'sharing',
                active: 'sharing',
                idle: 'idle',
                stopped: 'idle',
                ended: 'idle',
                off: 'idle',
                error: 'error',
                failed: 'error',
                blocked: 'error',
                denied: 'error',
            },
        };

        return map[kind]?.[key] ?? null;
    }

    _inferStateFromMessage(kind, message) {
        if (kind === 'connection') {
            if (/(ws open|connected|ready|live session connected)/i.test(message)) return 'connected';
            if (/(connecting|opening|initialising|initializing)/i.test(message)) return 'connecting';
            if (/(closed|ended|disconnected|session closed)/i.test(message)) return 'disconnected';
            if (/(error|invalid|timeout|failed)/i.test(message)) return 'error';
        }
        if (kind === 'audio') {
            if (/(listening|microphone (active|streaming)|audio capture started)/i.test(message)) return 'capturing';
            if (/(microphone idle|audio capture stopped|microphone muted)/i.test(message)) return 'idle';
            if (/(audio|microphone).*(error|denied|failed)/i.test(message)) return 'error';
        }
        if (kind === 'screen') {
            if (/(screen capture (started|active)|sharing screen|screen streaming)/i.test(message)) return 'sharing';
            if (/(screen capture ended|stopped|screen idle)/i.test(message)) return 'idle';
            if (/(screen capture request was blocked|screen streaming failed|screen capture error)/i.test(message)) return 'error';
        }
        return null;
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
            window.salesWizard?.stopCapture?.();

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

        await window.salesWizard.initializeGemini(this.selectedProfile, this.selectedLanguage);
        // Pass the screenshot interval as string (including 'manual' option)
        window.salesWizard.startCapture(this.selectedScreenshotInterval, this.selectedImageQuality);
        this.responses = [];
        this.currentResponseIndex = -1;
        this.startTime = Date.now();
        this.sessionId = self.crypto?.randomUUID?.() ?? Date.now().toString();
        this.transcripts = [];
        this.notes = [];
        this.manualNotes = '';
        try {
            await this.persistHistoryTurn({ sessionStart: true, notes: '' });
        } catch (error) {
            logger.error('Failed to start session history:', error);
        }
        this.currentView = 'assistant';
    }

    async handleAPIKeyHelp() {
        if (window.electron?.openExternal) {
            await window.electron.openExternal('https://saleswizard.ai/help/api-key');
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
        const result = await window.salesWizard.sendTextMessage(message);

        if (!result.success) {
            logger.error('Failed to send message:', result.error);
            this.setStatus('Error sending message: ' + result.error);
        } else {
            this.setStatus('Message sent...');
            this._awaitingNewResponse = true;
        }
    }

    async handleManualNotesChange(e) {
        const newNotes = e?.detail?.value ?? e?.target?.value ?? '';
        this.manualNotes = newNotes;
        await this.persistNotes();
    }

    async handleStructuredNotesChange(e) {
        const updatedNotes = Array.isArray(e?.detail?.notes) ? e.detail.notes : [];
        this.notes = updatedNotes.map(note => ({
            ...note,
            type: note.type || 'auto',
            text: typeof note.text === 'string' ? note.text : '',
            timestamp: typeof note.timestamp === 'number' ? note.timestamp : Date.now(),
        }));
        await this.persistNotes();
    }

    async persistNotes() {
        if (!this.sessionId) return;
        try {
            await this.persistHistoryTurn({ notes: this.noteText });
        } catch (error) {
            logger.error('Failed to save notes:', error);
        }
    }

    async persistHistoryTurn(turn) {
        if (!this.sessionId) return;
        if (!window.electron?.historyAddTurn) {
            throw new Error('historyAddTurn IPC bridge unavailable');
        }

        const result = await window.electron.historyAddTurn({
            sessionId: this.sessionId,
            turn,
        });

        if (!result?.success) {
            throw new Error(result?.error || 'Failed to persist history turn');
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
                            .structuredNotes=${this.notes}
                            .manualNotes=${this.manualNotes}
                            .transcripts=${this.transcripts}
                            .selectedProfile=${this.selectedProfile}
                            @notes-change=${e => this.handleNotesChange(e)}
                            @copy-transcript=${() => this.handleCopyTranscript()}
                            @clear-session-data=${() => this.handleClearSessionData()}
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
                        .connectionState=${this.connectionState}
                        .audioState=${this.audioState}
                        .screenState=${this.screenState}
                        .connectionMessage=${this.connectionMessage}
                        .audioMessage=${this.audioMessage}
                        .screenMessage=${this.screenMessage}
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

customElements.define('sales-wizard-app', SalesWizardApp);
