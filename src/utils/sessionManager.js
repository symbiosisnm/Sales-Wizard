const { GoogleGenAI } = require('@google/genai');
const { getSystemPrompt } = require('./prompts');
const conversationStore = require('./conversationStore');
const reconnection = require('./reconnection');
const { sendToRenderer } = require('./ipcUtils');

let isInitializingSession = false;
let currentTranscription = '';
let messageBuffer = '';

async function getStoredSetting(key, defaultValue) {
    try {
        const { BrowserWindow } = require('electron');
        const windows = BrowserWindow.getAllWindows();
        if (windows.length > 0) {
            await new Promise(resolve => setTimeout(resolve, 100));
            const value = await windows[0].webContents.executeJavaScript(`
                (function() {
                    try {
                        if (typeof localStorage === 'undefined') {
                            return '${defaultValue}';
                        }
                        const stored = localStorage.getItem('${key}');
                        return stored || '${defaultValue}';
                    } catch (e) {
                        return '${defaultValue}';
                    }
                })()`);
            return value;
        }
    } catch (error) {
        console.error('Error getting stored setting for', key, ':', error.message);
    }
    return defaultValue;
}

async function getEnabledTools() {
    const tools = [];
    const googleSearchEnabled = await module.exports.getStoredSetting(
        'googleSearchEnabled',
        'true'
    );
    if (googleSearchEnabled === 'true') {
        tools.push({ googleSearch: {} });
    }
    return tools;
}

async function initializeGeminiSession(
    geminiSessionRef,
    apiKey,
    customPrompt = '',
    profile = 'interview',
    language = 'en-US',
    isReconnection = false
) {
    if (isInitializingSession) {
        console.log('Session initialization already in progress');
        return false;
    }

    isInitializingSession = true;
    sendToRenderer('session-initializing', true);

    if (!isReconnection) {
        reconnection.storeSessionParams({ apiKey, customPrompt, profile, language });
    }

    const client = new GoogleGenAI({ vertexai: false, apiKey });
    const enabledTools = await getEnabledTools();
    const googleSearchEnabled = enabledTools.some(tool => tool.googleSearch);
    const systemPrompt = getSystemPrompt(profile, customPrompt, googleSearchEnabled);

    if (!isReconnection) {
        conversationStore.initializeNewSession();
    }

    try {
        const session = await client.live.connect({
            model: 'gemini-live-2.5-flash-preview',
            callbacks: {
                onopen: function () {
                    sendToRenderer('update-status', 'Live session connected');
                },
                onmessage: function (message) {
                    if (message.serverContent?.inputTranscription?.text) {
                        currentTranscription += message.serverContent.inputTranscription.text;
                    }
                    if (message.serverContent?.modelTurn?.parts) {
                        for (const part of message.serverContent.modelTurn.parts) {
                            if (part.text) {
                                messageBuffer += part.text;
                                sendToRenderer('update-response', messageBuffer);
                            }
                        }
                    }
                    if (message.serverContent?.generationComplete) {
                        sendToRenderer('update-response', messageBuffer);
                        if (currentTranscription && messageBuffer) {
                            conversationStore.saveConversationTurn(currentTranscription, messageBuffer);
                            currentTranscription = '';
                        }
                        messageBuffer = '';
                    }
                    if (message.serverContent?.turnComplete) {
                        sendToRenderer('update-status', 'Listening...');
                    }
                },
                onerror: function (e) {
                    const isApiKeyError =
                        e.message &&
                        (e.message.includes('API key not valid') ||
                            e.message.includes('invalid API key') ||
                            e.message.includes('authentication failed') ||
                            e.message.includes('unauthorized'));
                    if (isApiKeyError) {
                        reconnection.disableReconnection();
                        sendToRenderer('update-status', 'Error: Invalid API key');
                        return;
                    }
                    sendToRenderer('update-status', 'Error: ' + e.message);
                },
                onclose: function (e) {
                    const isApiKeyError =
                        e.reason &&
                        (e.reason.includes('API key not valid') ||
                            e.reason.includes('invalid API key') ||
                            e.reason.includes('authentication failed') ||
                            e.reason.includes('unauthorized'));
                    if (isApiKeyError) {
                        reconnection.disableReconnection();
                        sendToRenderer('update-status', 'Session closed: Invalid API key');
                        return;
                    }
                    reconnection.attemptReconnection(geminiSessionRef, initializeGeminiSession);
                },
            },
            config: {
                responseModalities: ['TEXT'],
                tools: enabledTools,
                inputAudioTranscription: {},
                contextWindowCompression: { slidingWindow: {} },
                speechConfig: { languageCode: language },
                systemInstruction: { parts: [{ text: systemPrompt }] },
            },
        });
        isInitializingSession = false;
        sendToRenderer('session-initializing', false);
        return session;
    } catch (error) {
        console.error('Failed to initialize Gemini session:', error);
        isInitializingSession = false;
        sendToRenderer('session-initializing', false);
        return null;
    }
}

async function sendTextMessage(geminiSessionRef, text) {
    if (!geminiSessionRef.current) return { success: false, error: 'No active Gemini session' };
    try {
        if (!text || typeof text !== 'string' || text.trim().length === 0) {
            return { success: false, error: 'Invalid text message' };
        }
        await geminiSessionRef.current.sendRealtimeInput({ text: text.trim() });
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

async function sendImage(geminiSessionRef, data) {
    if (!geminiSessionRef.current) return { success: false, error: 'No active Gemini session' };
    try {
        await geminiSessionRef.current.sendRealtimeInput({
            media: { data: data, mimeType: 'image/jpeg' },
        });
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

module.exports = {
    getStoredSetting,
    getEnabledTools,
    initializeGeminiSession,
    sendTextMessage,
    sendImage,
};
