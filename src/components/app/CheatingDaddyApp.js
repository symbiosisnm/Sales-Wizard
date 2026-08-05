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

// Live streaming helper integrates with the local OpenAI Realtime bridge.
import { startLiveStreaming } from '../../utils/liveStreamer.mjs';
import { inferProfileFromFocus, normalizeProfile } from '../../utils/profileUtils.js';

// Use global logger if available, falling back to the imported logger or console
const logger = globalThis.logger || console;

const DEFAULT_LAUNCH_FOCUS_CONFIG = {
    jobTitle: 'HP sales and support representative',
    objective:
        'Listen immediately, answer customer questions with current HP product information, and surface concise next-step guidance for sales, support, troubleshooting, demos, and recommendations.',
    priorityTopics:
        'HP laptops, workstations, desktops, printers, monitors, accessories, specs, compatibility, pricing, availability, warranty, support troubleshooting, and competitive positioning',
    guidelineText:
        'Act like a prepared HP sales/support rep. Be concise, factual, and useful. Use web results for current specs, pricing, availability, and support facts. If a model, SKU, or customer need is ambiguous, give the best current answer and ask one targeted clarifying question.',
    webSearchEnabled: true,
    webSearchHint:
        'Use current HP.com product pages, HP support documentation, HP store availability, and official vendor sources first. Use other reputable sources only when they add current context.',
};

function isBlank(value) {
    return !String(value || '').trim();
}

function isStaleOrEmptyLaunchFocus(config = {}) {
    const coreText = [
        config.jobTitle,
        config.objective,
        config.priorityTopics,
        config.guidelineText,
        config.webSearchHint,
    ]
        .filter(Boolean)
        .join(' ')
        .trim();
    const roleText = String(config.jobTitle || '').trim().toLowerCase();

    if (!coreText) {
        return true;
    }

    return (
        /\b(job\s+)?interview\b/i.test(coreText) ||
        /please paste the exact hp\.com/i.test(coreText) ||
        roleText === 'hp.com' ||
        /^https?:\/\//i.test(roleText)
    );
}

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
            background:
                radial-gradient(circle at top left, rgba(96, 165, 250, 0.2), transparent 28%),
                radial-gradient(circle at bottom right, rgba(56, 189, 248, 0.14), transparent 24%),
                var(--background-transparent);
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
            background:
                linear-gradient(180deg, rgba(255, 255, 255, 0.06), rgba(255, 255, 255, 0.02)),
                var(--main-content-background);
            backdrop-filter: blur(34px) saturate(170%);
            -webkit-backdrop-filter: blur(34px) saturate(170%);
            box-shadow:
                inset 0 1px 0 rgba(255, 255, 255, 0.06),
                0 22px 60px rgba(15, 23, 42, 0.22);
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
            gap: 12px;
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
        notes: { type: Array },
        noteText: { type: String },
        helpCards: { type: Array },
        primaryHelpAnswer: { type: String },
        helpResources: { type: Array },
        visualMatches: { type: Array },
        matchedKnowledge: { type: Array },
        latestScreenPreview: { type: Object },
        importedVisualContext: { type: Object },
        focusConfig: { type: Object },
        focusRetrieval: { type: Object },
        knowledgeItems: { type: Array },
        ffmpegAvailable: { type: Boolean },
        sessionOptions: { type: Object },
        webIntel: { type: Object },
        assistantPanelTab: { type: String },
        _viewInstances: { type: Object, state: true },
        _isClickThrough: { state: true },
        _awaitingNewResponse: { state: true },
        shouldAnimateResponse: { type: Boolean },
        audioLevel: { type: Number },
    };

    constructor() {
        super();
        this.currentView =
            localStorage.getItem('onboardingCompleted') || localStorage.getItem('apiKey') ? 'main' : 'onboarding';
        this.statusText = '';
        this.startTime = null;
        this.isRecording = false;
        this.sessionActive = false;
        const storedProfile = normalizeProfile(localStorage.getItem('selectedProfile') || 'general');
        const profileWasCustomized = localStorage.getItem('selectedProfileCustomized') === 'true';
        this.selectedProfile = storedProfile === 'interview' && !profileWasCustomized ? 'general' : storedProfile;
        if (this.selectedProfile !== storedProfile) {
            localStorage.setItem('selectedProfile', this.selectedProfile);
        }
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
        this.noteText = '';
        this.helpCards = [];
        this.primaryHelpAnswer = '';
        this.helpResources = [];
        this.visualMatches = [];
        this.matchedKnowledge = [];
        this.latestScreenPreview = null;
        this.importedVisualContext = null;
        this.focusConfig = this.getLaunchReadyFocusConfig(this.getStoredFocusConfig());
        this.focusRetrieval = {
            jobTitle: this.focusConfig.jobTitle || '',
            objective: this.focusConfig.objective || '',
            priorityTopics: this.focusConfig.priorityTopics || '',
            guidelineText: this.focusConfig.guidelineText || '',
            strictFocus: Boolean(this.focusConfig.strictFocus),
            webSearchEnabled: Boolean(this.focusConfig.webSearchEnabled),
            selectedKnowledgeIds: this.focusConfig.selectedKnowledgeIds || [],
            snippets: [],
            matchedKnowledgeItems: [],
            resources: [],
            visualMatches: [],
            visualSummary: '',
        };
        this.knowledgeItems = [];
        this.ffmpegAvailable = false;
        this.sessionOptions = this.getStoredSessionOptions();
        this.webIntel = null;
        this.assistantPanelTab = 'help';
        this.audioLevel = 0;
        this._focusSyncTimer = null;
        this._autoStartAttempted = false;
        this._autoStartRetryCount = 0;

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

        void this.loadKnowledgeItems();
        window.setTimeout(() => {
            void this.autoStartIfReady();
        }, 250);
    }

    disconnectedCallback() {
        // Stop live streaming if it's active
        if (this._stopLiveStreaming) {
            this._stopLiveStreaming();
            this._stopLiveStreaming = null;
        }
        this.clearPendingFocusSync();

        super.disconnectedCallback();
        if (window.electron) {
            window.electron.removeUpdateResponseListener?.(this._updateResponseHandler);
            window.electron.removeUpdateStatusListener?.(this._updateStatusHandler);
            window.electron.removeClickThroughToggledListener?.(this._clickThroughHandler);
        }
    }

    getCurrentView() {
        return this.currentView;
    }

    getLayoutMode() {
        return this.layoutMode;
    }

    getContentProtection() {
        const contentProtection = localStorage.getItem('contentProtection');
        return contentProtection !== null ? contentProtection === 'true' : false;
    }

    getCurrentContextParams() {
        return {
            allowedSources: localStorage.getItem('contextAllowedSources') || '',
            toneLength: localStorage.getItem('contextToneLength') || '',
            disallowedTopics: localStorage.getItem('contextDisallowedTopics') || '',
        };
    }

    getCurrentCustomPrompt() {
        return localStorage.getItem('customPrompt') || '';
    }

    getStoredFocusConfig() {
        let selectedKnowledgeIds = [];
        try {
            selectedKnowledgeIds = JSON.parse(localStorage.getItem('focusSelectedKnowledgeIds') || '[]');
        } catch (_error) {
            selectedKnowledgeIds = [];
        }
        return {
            jobTitle: localStorage.getItem('focusJobTitle') || '',
            objective: localStorage.getItem('focusObjective') || '',
            priorityTopics: localStorage.getItem('focusPriorityTopics') || '',
            guidelineText: localStorage.getItem('focusGuidelineText') || '',
            referenceText: localStorage.getItem('focusReferenceText') || '',
            selectedKnowledgeIds: Array.isArray(selectedKnowledgeIds) ? selectedKnowledgeIds : [],
            strictFocus: localStorage.getItem('focusStrictFocus') === 'true',
            webSearchEnabled: localStorage.getItem('focusWebSearchEnabled') === 'true',
            webSearchHint: localStorage.getItem('focusWebSearchHint') || '',
        };
    }

    getLaunchReadyFocusConfig(config = {}) {
        const selectedKnowledgeIds = Array.isArray(config.selectedKnowledgeIds) ? config.selectedKnowledgeIds : [];
        const shouldUseDefault = isStaleOrEmptyLaunchFocus(config);

        if (shouldUseDefault) {
            return {
                ...config,
                ...DEFAULT_LAUNCH_FOCUS_CONFIG,
                referenceText: config.referenceText || '',
                selectedKnowledgeIds,
                strictFocus: false,
                webSearchEnabled: true,
            };
        }

        return {
            ...config,
            selectedKnowledgeIds,
            webSearchEnabled: true,
            webSearchHint: isBlank(config.webSearchHint)
                ? 'Use current official product pages, support documentation, pricing/availability pages, and task-relevant reputable sources.'
                : config.webSearchHint,
        };
    }

    persistFocusConfig(config = {}) {
        localStorage.setItem('focusJobTitle', config.jobTitle || '');
        localStorage.setItem('focusObjective', config.objective || '');
        localStorage.setItem('focusPriorityTopics', config.priorityTopics || '');
        localStorage.setItem('focusGuidelineText', config.guidelineText || '');
        localStorage.setItem('focusReferenceText', config.referenceText || '');
        localStorage.setItem('focusSelectedKnowledgeIds', JSON.stringify(config.selectedKnowledgeIds || []));
        localStorage.setItem('focusStrictFocus', config.strictFocus ? 'true' : 'false');
        localStorage.setItem('focusWebSearchEnabled', config.webSearchEnabled ? 'true' : 'false');
        localStorage.setItem('focusWebSearchHint', config.webSearchHint || '');
    }

    getStoredSessionOptions() {
        return {
            captureSystemAudio: localStorage.getItem('sessionCaptureSystemAudio') === 'true',
            rememberImports: localStorage.getItem('sessionRememberImports') === 'true',
            videoAssistMode: localStorage.getItem('sessionVideoAssistMode') || 'rolling-clip',
            clipWindowSeconds: Number.parseInt(localStorage.getItem('sessionClipWindowSeconds') || '8', 10) || 8,
        };
    }

    persistSessionOptions(options = {}) {
        localStorage.setItem('sessionCaptureSystemAudio', options.captureSystemAudio ? 'true' : 'false');
        localStorage.setItem('sessionRememberImports', options.rememberImports ? 'true' : 'false');
        localStorage.setItem('sessionVideoAssistMode', options.videoAssistMode || 'rolling-clip');
        localStorage.setItem('sessionClipWindowSeconds', String(options.clipWindowSeconds || 8));
    }

    getCurrentFocusConfig() {
        return {
            ...(this.focusConfig || {}),
        };
    }

    async autoStartIfReady() {
        if (this._autoStartAttempted || this.sessionActive || this._stopLiveStreaming) {
            return;
        }

        const apiKey = await this.resolveApiKey();
        const hasBackendApiKey = apiKey ? true : await this.backendHasApiKey();
        const launchFocusConfig = this.getLaunchReadyFocusConfig(this.getStoredFocusConfig());
        this.focusConfig = launchFocusConfig;
        this.persistFocusConfig(launchFocusConfig);

        if (!hasBackendApiKey) {
            this._autoStartRetryCount += 1;
            if (this._autoStartRetryCount < 12) {
                this.setStatus('Looking for saved OpenAI API key...');
                window.setTimeout(() => {
                    void this.autoStartIfReady();
                }, 500);
                return;
            }
            this.setStatus('Enter an OpenAI API key to start live mode');
            return;
        }

        this._autoStartAttempted = true;
        localStorage.setItem('onboardingCompleted', 'true');
        if (this.currentView !== 'main') {
            this.currentView = 'main';
            await this.updateComplete;
        }
        this.setStatus('OpenAI key found. Starting live assistant...');
        await this.handleStart();
    }

    async loadKnowledgeItems() {
        if (!window.electron?.knowledgeList) {
            return;
        }
        try {
            const res = await window.electron.knowledgeList({
                sessionId: this.sessionId || '',
                scope: this.sessionId ? undefined : 'library',
            });
            if (res?.success) {
                this.knowledgeItems = Array.isArray(res.items) ? res.items : [];
                this.ffmpegAvailable = Boolean(res.ffmpegAvailable);
                this.requestUpdate();
            }
        } catch (error) {
            logger.error('Failed to load knowledge items:', error);
        }
    }

    resolveActiveProfile(focusConfig = this.focusConfig) {
        const fallbackProfile = this.selectedProfile === 'interview' ? 'general' : this.selectedProfile || 'general';
        return inferProfileFromFocus(focusConfig, fallbackProfile);
    }

    getLatestTurnText() {
        const latestTurn = this.transcripts.at(-1);
        return latestTurn?.transcription || '';
    }

    getActiveVisualPreview() {
        return this.importedVisualContext?.previewDataUrl || this.latestScreenPreview?.dataUrl || '';
    }

    clearPendingFocusSync() {
        if (this._focusSyncTimer) {
            clearTimeout(this._focusSyncTimer);
            this._focusSyncTimer = null;
        }
    }

    scheduleLiveFocusSync(config, profile) {
        if (!this._stopLiveStreaming?.updateFocusConfig) {
            return;
        }

        this.clearPendingFocusSync();
        this._focusSyncTimer = setTimeout(() => {
            this._focusSyncTimer = null;
            this._stopLiveStreaming?.updateFocusConfig?.(config, profile);
        }, 320);
    }

    async stopCapture() {
        this.clearPendingFocusSync();
        if (this._stopLiveStreaming) {
            this._stopLiveStreaming();
            this._stopLiveStreaming = null;
        }
        this.sessionActive = false;
        this.audioLevel = 0;
        this.currentView = 'main';
        this.setStatus('Session closed');
    }

    async handleShortcut(shortcutKey) {
        if (shortcutKey !== 'ctrl+enter' && shortcutKey !== 'cmd+enter') {
            return;
        }

        if (this.currentView === 'main') {
            await this.handleStart();
            return;
        }

        if (this.currentView === 'assistant') {
            await this.refreshHelpFromCurrentTurn();
        }
    }

    async refreshHelpFromCurrentTurn() {
        if (!this._stopLiveStreaming?.refreshResponse) {
            this.setStatus('No active OpenAI session to refresh');
            return;
        }

        const turnText = this.getLatestTurnText();
        if (!turnText) {
            this.setStatus('No current turn available to refresh');
            return;
        }

        this.setStatus('Refreshing answer and help...');
        await this._stopLiveStreaming.refreshResponse(turnText, true);
    }

    async applyVisualContext(context, { stage = 'final' } = {}) {
        this.importedVisualContext = context;
        this.assistantPanelTab = 'visuals';
        this.requestUpdate();

        if (stage === 'final' && this.sessionOptions?.rememberImports) {
            void this.rememberVisualImport(context);
        }

        if (!this._stopLiveStreaming?.setVisualContext) {
            return;
        }

        this._stopLiveStreaming.setVisualContext(context);
        const latestTurn = this.getLatestTurnText();
        if (!latestTurn) {
            if (context?.processing) {
                this.setStatus('Visual preview ready. Sampling the rest of the video...');
            } else {
                this.setStatus(context?.kind === 'video' ? 'Video context loaded' : 'Image context loaded');
            }
            return;
        }

        if (stage === 'preview') {
            this.setStatus('Visual preview ready. Refreshing the live answer...');
            await this._stopLiveStreaming.refreshResponse(latestTurn, true);
            return;
        }

        if (context?.kind === 'video') {
            this.setStatus('Video context enriched. Refreshing visual help...');
            await this._stopLiveStreaming.refreshHelp(latestTurn);
            return;
        }

        await this.refreshHelpFromCurrentTurn();
    }

    clearVisualContext() {
        this.importedVisualContext = null;
        this.requestUpdate();
        if (this._stopLiveStreaming?.clearVisualContext) {
            this._stopLiveStreaming.clearVisualContext();
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

    async resolveApiKey() {
        const localApiKey = localStorage.getItem('apiKey')?.trim() || '';

        if (window.electron?.secureGetApiKey) {
            try {
                const secureApiKey = await this.getSecureApiKeyWithTimeout(localApiKey ? 350 : 1800);
                if (secureApiKey) {
                    localStorage.setItem('apiKey', secureApiKey);
                    return secureApiKey;
                }
            } catch (_error) {
                /* empty */
            }
        }

        return localApiKey;
    }

    async backendHasApiKey() {
        try {
            const response = await fetch('http://localhost:3001/api-key-status');
            const payload = await response.json().catch(() => ({}));
            return Boolean(response.ok && payload?.hasEnvKey);
        } catch (_error) {
            return false;
        }
    }

    async rememberVisualImport(context) {
        if (!context?.filePath || !window.electron?.knowledgeImportFile) {
            return;
        }
        const apiKey = await this.resolveApiKey();
        if (!apiKey) {
            return;
        }
        try {
            const res = await window.electron.knowledgeImportFile({
                apiKey,
                kindHint: context.kind,
                path: context.filePath,
                scope: 'library',
                sessionId: this.sessionId || '',
                title: context.label || context.fileName || '',
            });
            if (res?.success && res.item) {
                const selectedKnowledgeIds = [
                    ...new Set([...(this.focusConfig.selectedKnowledgeIds || []), res.item.id]),
                ];
                this.focusConfig = {
                    ...this.focusConfig,
                    selectedKnowledgeIds,
                };
                this.persistFocusConfig(this.focusConfig);
                await this.loadKnowledgeItems();
                if (this._stopLiveStreaming?.updateFocusConfig) {
                    this.scheduleLiveFocusSync(this.focusConfig, this.resolveActiveProfile(this.focusConfig));
                }
            }
        } catch (error) {
            logger.error('Failed to remember imported visual:', error);
        }
    }

    handleToggleMicrophone() {
        return this._stopLiveStreaming?.toggleMicrophone?.() ?? false;
    }

    setStatus(text) {
        this.statusText = text;

        // Mark response as complete when we get certain status messages
        if (text.includes('Ready') || text.includes('Listening') || text.includes('Error')) {
            this._currentResponseIsComplete = true;
            logger.info('[setStatus] Marked current response as complete');
            const last = this.responses?.length ? this.responses[this.responses.length - 1] : null;
            const transcriptIndex = this.transcripts.findLastIndex(item => !item.ai_response);
            if (last && transcriptIndex !== -1) {
                const nextTranscripts = [...this.transcripts];
                const pairedTurn = {
                    ...nextTranscripts[transcriptIndex],
                    ai_response: last,
                };
                nextTranscripts[transcriptIndex] = pairedTurn;
                this.transcripts = nextTranscripts;
                if (this.sessionId) {
                    fetch(`http://localhost:3001/history/${this.sessionId}/turn`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            transcription: pairedTurn.transcription,
                            ai_response: pairedTurn.ai_response,
                            notes: this.noteText,
                        }),
                    }).catch(err => {
                        logger.error('Failed to post turn:', err);
                    });
                }
            }
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
            await this.stopCapture();
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
        const liveFocusConfig = this.getLaunchReadyFocusConfig(this.getStoredFocusConfig());
        this.focusConfig = liveFocusConfig;
        this.persistFocusConfig(liveFocusConfig);
        const activeProfile = this.resolveActiveProfile(liveFocusConfig);
        const apiKey = await this.resolveApiKey();
        const hasBackendApiKey = apiKey ? true : await this.backendHasApiKey();

        if (!hasBackendApiKey) {
            // Trigger the red blink animation on the API key input
            const mainView = this.shadowRoot.querySelector('main-view');
            if (mainView && mainView.triggerApiKeyError) {
                mainView.triggerApiKeyError();
            }
            return;
        }

        if (this._stopLiveStreaming) {
            this._stopLiveStreaming();
            this._stopLiveStreaming = null;
        }
        this.responses = [];
        this.currentResponseIndex = -1;
        this.startTime = Date.now();
        this.sessionId = self.crypto?.randomUUID?.() ?? Date.now().toString();
        this.transcripts = [];
        this.notes = [];
        this.noteText = '';
        this.helpCards = [];
        this.primaryHelpAnswer = '';
        this.helpResources = [];
        this.visualMatches = [];
        this.matchedKnowledge = [];
        this.latestScreenPreview = null;
        this.focusRetrieval = {
            jobTitle: liveFocusConfig.jobTitle || '',
            objective: liveFocusConfig.objective || '',
            priorityTopics: liveFocusConfig.priorityTopics || '',
            guidelineText: liveFocusConfig.guidelineText || '',
            strictFocus: Boolean(liveFocusConfig.strictFocus),
            webSearchEnabled: Boolean(liveFocusConfig.webSearchEnabled),
            selectedKnowledgeIds: liveFocusConfig.selectedKnowledgeIds || [],
            snippets: [],
            matchedKnowledgeItems: [],
            resources: [],
            visualMatches: [],
            visualSummary: '',
        };
        this.webIntel = null;
        this.assistantPanelTab = 'help';
        this.sessionActive = true;
        this.currentView = 'assistant';
        this.setStatus('Connecting to OpenAI Realtime...');
        try {
            await fetch(`http://localhost:3001/history/${this.sessionId}/turn`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sessionStart: true, notes: '' }),
            });
        } catch (error) {
            logger.error('Failed to start session history:', error);
        }

        try {
            this._stopLiveStreaming = await startLiveStreaming({
                apiKey,
                contextParams: this.getCurrentContextParams(),
                customPrompt: this.getCurrentCustomPrompt(),
                focusConfig: liveFocusConfig,
                imageQuality: this.selectedImageQuality,
                language: this.selectedLanguage,
                sessionId: this.sessionId,
                sessionOptions: this.sessionOptions,
                onResponse: response => {
                    if (response) this.setResponse(response);
                },
                onStatus: status => this.setStatus(status),
                onError: err => {
                    logger.error('Live streaming error:', err);
                    this.setStatus(`Error: ${err}`);
                },
                onAudioLevel: level => {
                    this.audioLevel = level;
                    this.requestUpdate();
                },
                onNote: note => {
                    if (note) {
                        this.notes = [...this.notes, note];
                        this.requestUpdate();
                    }
                },
                onTranscript: transcript => {
                    if (!transcript) return;
                    this.transcripts = [
                        ...this.transcripts,
                        { transcription: transcript, ai_response: '' },
                    ];
                    this.requestUpdate();
                },
                onHelpCards: payload => {
                    this.helpCards = Array.isArray(payload?.cards) ? payload.cards.slice(0, 5) : [];
                    this.primaryHelpAnswer = payload?.primary_answer || '';
                    this.helpResources = Array.isArray(payload?.resources) ? payload.resources : [];
                    this.visualMatches = Array.isArray(payload?.visual_matches) ? payload.visual_matches : [];
                    this.matchedKnowledge = Array.isArray(payload?.matched_knowledge) ? payload.matched_knowledge : [];
                    if (payload?.retrieval) {
                        this.focusRetrieval = payload.retrieval;
                    }
                    if (payload?.web_intel) {
                        this.webIntel = payload.web_intel;
                    }
                    if (payload?.should_surface) {
                        this.assistantPanelTab = 'help';
                    }
                    this.requestUpdate();
                },
                onScreenPreview: preview => {
                    this.latestScreenPreview = preview;
                    this.requestUpdate();
                },
                onVisualContext: context => {
                    if (!context) {
                        this.importedVisualContext = null;
                    } else {
                        this.importedVisualContext = {
                            ...(this.importedVisualContext || {}),
                            ...context,
                            images: this.importedVisualContext?.images || context.images || [],
                        };
                    }
                    this.requestUpdate();
                },
                onFocusContext: focus => {
                    if (focus) {
                        this.focusRetrieval = focus;
                        this.requestUpdate();
                    }
                },
                profile: activeProfile,
                screenshotIntervalSeconds: this.selectedScreenshotInterval,
            });
            await this.loadKnowledgeItems();
            if (this.importedVisualContext) {
                this._stopLiveStreaming.setVisualContext(this.importedVisualContext);
            }
            if (liveFocusConfig) {
                this._stopLiveStreaming.updateFocusConfig?.(liveFocusConfig, activeProfile);
            }
        } catch (error) {
            logger.error('Failed to start live streaming:', error);
            this.sessionActive = false;
            this.currentView = 'main';
            this.setStatus(`Error: ${error.message || error}`);
            return;
        }
    }

    async handleAPIKeyHelp() {
        if (window.electron?.openExternal) {
            await window.electron.openExternal('https://platform.openai.com/api-keys');
        }
    }

    // Customize view event handlers
    handleProfileChange(profile) {
        this.selectedProfile = normalizeProfile(profile);
        localStorage.setItem('selectedProfileCustomized', 'true');
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
        if (!this._stopLiveStreaming?.sendText) {
            this.setStatus('Error sending message: no active OpenAI Realtime session');
            return;
        }

        this.transcripts = [
            ...this.transcripts,
            { transcription: message, ai_response: '' },
        ];
        this._stopLiveStreaming.sendText(message);
        this.setStatus('Message sent...');
        this._awaitingNewResponse = true;
    }

    async handleNotesChange(e) {
        const newNotes = e?.detail?.value ?? e?.target?.value ?? '';
        this.noteText = newNotes;
        if (!this.sessionId) return;
        try {
            await fetch(`http://localhost:3001/history/${this.sessionId}/turn`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ notes: this.noteText }),
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

    handleAssistantPanelTabChange(e) {
        this.assistantPanelTab = e.detail?.tab || 'help';
    }

    async handleVisualContextChange(e) {
        const context = e.detail?.context || null;
        if (!context) return;
        await this.applyVisualContext(context, {
            stage: e.detail?.stage || 'final',
        });
    }

    handleVisualContextClear() {
        this.clearVisualContext();
    }

    async handleFocusConfigChange(e) {
        const nextConfig = {
            ...this.getCurrentFocusConfig(),
            ...(e.detail?.config || {}),
        };
        const activeProfile = this.resolveActiveProfile(nextConfig);
        this.focusConfig = nextConfig;
        this.persistFocusConfig(nextConfig);
        this.focusRetrieval = {
            ...this.focusRetrieval,
            jobTitle: nextConfig.jobTitle || '',
            objective: nextConfig.objective || '',
            priorityTopics: nextConfig.priorityTopics || '',
            guidelineText: nextConfig.guidelineText || '',
            strictFocus: Boolean(nextConfig.strictFocus),
            webSearchEnabled: Boolean(nextConfig.webSearchEnabled),
            selectedKnowledgeIds: nextConfig.selectedKnowledgeIds || [],
        };
        this.requestUpdate();

        if (this._stopLiveStreaming?.updateFocusConfig) {
            this.scheduleLiveFocusSync(nextConfig, activeProfile);
        }
    }

    handleSessionOptionsChange(e) {
        const nextOptions = {
            ...this.sessionOptions,
            ...(e.detail?.options || {}),
        };
        this.sessionOptions = nextOptions;
        this.persistSessionOptions(nextOptions);
        this.requestUpdate();
        if (this._stopLiveStreaming?.updateSessionOptions) {
            this._stopLiveStreaming.updateSessionOptions(nextOptions);
        }
    }

    async handleKnowledgeImportUrl(e) {
        if (!window.electron?.knowledgeImportUrl) {
            return;
        }
        const url = e.detail?.url || '';
        if (!url) {
            return;
        }
        const apiKey = await this.resolveApiKey();
        if (!apiKey) {
            this.setStatus('Add an OpenAI API key before importing knowledge');
            return;
        }
        const res = await window.electron.knowledgeImportUrl({
            apiKey,
            url,
            scope: e.detail?.scope || 'library',
            sessionId: this.sessionId || '',
            title: e.detail?.title || '',
        });
        if (res?.success) {
            await this.loadKnowledgeItems();
            this.setStatus('Saved link to knowledge library');
        } else if (!res?.canceled) {
            this.setStatus(`Knowledge import failed: ${res?.error || 'unknown error'}`);
        }
    }

    async handleKnowledgeImportGuideline(e) {
        if (!window.electron?.knowledgeImportGuideline) {
            return;
        }
        const text = e.detail?.text || this.focusConfig.guidelineText || '';
        if (!text.trim()) {
            return;
        }
        const apiKey = await this.resolveApiKey();
        if (!apiKey) {
            this.setStatus('Add an OpenAI API key before saving guidelines');
            return;
        }
        const res = await window.electron.knowledgeImportGuideline({
            apiKey,
            text,
            title: e.detail?.title || this.focusConfig.jobTitle || 'Guidelines',
            scope: e.detail?.scope || 'library',
            sessionId: this.sessionId || '',
        });
        if (res?.success) {
            await this.loadKnowledgeItems();
            const selectedKnowledgeIds = [
                ...new Set([...(this.focusConfig.selectedKnowledgeIds || []), res.item.id]),
            ];
            this.focusConfig = {
                ...this.focusConfig,
                selectedKnowledgeIds,
            };
            this.persistFocusConfig(this.focusConfig);
            this.requestUpdate();
            if (this._stopLiveStreaming?.updateFocusConfig) {
                this.scheduleLiveFocusSync(this.focusConfig, this.resolveActiveProfile(this.focusConfig));
            }
            this.setStatus('Saved guidelines to knowledge library');
        } else {
            this.setStatus(`Guideline save failed: ${res?.error || 'unknown error'}`);
        }
    }

    async handleKnowledgeImportFile(e) {
        if (!window.electron?.knowledgeImportFile) {
            return;
        }
        const apiKey = await this.resolveApiKey();
        if (!apiKey) {
            this.setStatus('Add an OpenAI API key before importing files');
            return;
        }
        const res = await window.electron.knowledgeImportFile({
            apiKey,
            scope: e.detail?.scope || 'library',
            sessionId: this.sessionId || '',
            kindHint: e.detail?.kindHint || '',
        });
        if (res?.success) {
            await this.loadKnowledgeItems();
            this.setStatus('Imported file into knowledge library');
        } else if (!res?.canceled) {
            this.setStatus(`File import failed: ${res?.error || 'unknown error'}`);
        }
    }

    handleKnowledgeSelectionChange(e) {
        const itemId = e.detail?.id || '';
        const selected = Boolean(e.detail?.selected);
        if (!itemId) {
            return;
        }
        const selectedSet = new Set(this.focusConfig.selectedKnowledgeIds || []);
        if (selected) {
            selectedSet.add(itemId);
        } else {
            selectedSet.delete(itemId);
        }
        this.handleFocusConfigChange({
            detail: {
                config: {
                    selectedKnowledgeIds: [...selectedSet],
                },
            },
        });
    }

    async handleKnowledgeDelete(e) {
        if (!window.electron?.knowledgeDelete) {
            return;
        }
        const id = e.detail?.id || '';
        if (!id) {
            return;
        }
        const res = await window.electron.knowledgeDelete({ id });
        if (res?.success) {
            const selectedKnowledgeIds = (this.focusConfig.selectedKnowledgeIds || []).filter(itemId => itemId !== id);
            this.focusConfig = {
                ...this.focusConfig,
                selectedKnowledgeIds,
            };
            this.persistFocusConfig(this.focusConfig);
            await this.loadKnowledgeItems();
            if (this._stopLiveStreaming?.updateFocusConfig) {
                this.scheduleLiveFocusSync(this.focusConfig, this.resolveActiveProfile(this.focusConfig));
            }
        } else {
            this.setStatus(`Knowledge delete failed: ${res?.error || 'unknown error'}`);
        }
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
            if (window.electron?.updateSizes) {
                window.electron.updateSizes().catch(error => {
                    logger.error('Failed to update sizes in main process:', error);
                });
            }

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
        const activeProfile = this.resolveActiveProfile();
        // Only re-render the view if it hasn't been cached or if critical properties changed
        switch (this.currentView) {
            case 'onboarding':
                return html`
                    <onboarding-view .onComplete=${() => this.handleOnboardingComplete()} .onClose=${() => this.handleClose()}></onboarding-view>
                `;

            case 'main':
                return html`
                    <main-view
                        .focusConfig=${this.focusConfig}
                        .knowledgeItems=${this.knowledgeItems}
                        .sessionOptions=${this.sessionOptions}
                        .ffmpegAvailable=${this.ffmpegAvailable}
                        .onStart=${() => this.handleStart()}
                        .onAPIKeyHelp=${() => this.handleAPIKeyHelp()}
                        .onLayoutModeChange=${layoutMode => this.handleLayoutModeChange(layoutMode)}
                        @focus-config-change=${e => this.handleFocusConfigChange(e)}
                        @session-options-change=${e => this.handleSessionOptionsChange(e)}
                        @knowledge-selection-change=${e => this.handleKnowledgeSelectionChange(e)}
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
                        .focusConfig=${this.focusConfig}
                        .onProfileChange=${profile => this.handleProfileChange(profile)}
                        .onLanguageChange=${language => this.handleLanguageChange(language)}
                        .onScreenshotIntervalChange=${interval => this.handleScreenshotIntervalChange(interval)}
                        .onImageQualityChange=${quality => this.handleImageQualityChange(quality)}
                        .onLayoutModeChange=${layoutMode => this.handleLayoutModeChange(layoutMode)}
                        .onAdvancedModeChange=${advancedMode => this.handleAdvancedModeChange(advancedMode)}
                        .onFocusConfigChange=${config =>
                            this.handleFocusConfigChange({
                                detail: { config },
                            })}
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
                            .selectedProfile=${activeProfile}
                            .focusConfig=${this.focusConfig}
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
                            .assistantPanelTab=${this.assistantPanelTab}
                            .helpCards=${this.helpCards}
                            .primaryAnswer=${this.primaryHelpAnswer}
                            .helpResources=${this.helpResources}
                            .visualMatches=${this.visualMatches}
                            .matchedKnowledge=${this.matchedKnowledge}
                            .focusConfig=${this.focusConfig}
                            .focusRetrieval=${this.focusRetrieval}
                            .knowledgeItems=${this.knowledgeItems}
                            .sessionOptions=${this.sessionOptions}
                            .ffmpegAvailable=${this.ffmpegAvailable}
                            .webIntel=${this.webIntel}
                            .importedVisualContext=${this.importedVisualContext}
                            .latestScreenPreview=${this.latestScreenPreview}
                            .notes=${this.noteText}
                            .transcripts=${this.transcripts}
                            .selectedProfile=${activeProfile}
                            @assistant-panel-tab-change=${e => this.handleAssistantPanelTabChange(e)}
                            @notes-change=${e => this.handleNotesChange(e)}
                            @visual-context-change=${e => this.handleVisualContextChange(e)}
                            @visual-context-clear=${() => this.handleVisualContextClear()}
                            @focus-config-change=${e => this.handleFocusConfigChange(e)}
                            @session-options-change=${e => this.handleSessionOptionsChange(e)}
                            @knowledge-import-url=${e => this.handleKnowledgeImportUrl(e)}
                            @knowledge-import-guideline=${e => this.handleKnowledgeImportGuideline(e)}
                            @knowledge-import-file=${e => this.handleKnowledgeImportFile(e)}
                            @knowledge-selection-change=${e => this.handleKnowledgeSelectionChange(e)}
                            @knowledge-delete=${e => this.handleKnowledgeDelete(e)}
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
