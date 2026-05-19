const conversationStore = require('./conversationStore');

function exportSession({ format = 'json', notes = '', profile = '', session } = {}) {
    const exportedAt = new Date().toISOString();

    let sessionId;
    let history;
    if (session && typeof session === 'object') {
        sessionId = session.sessionId || session.id || Date.now().toString();
        history = session.history || session.conversationHistory || [];
    } else {
        const current = conversationStore.getCurrentSessionData();
        sessionId = current.sessionId;
        history = current.history;
    }

    const metadata = {
        sessionId,
        exportedAt,
        profile,
    };

    let content = '';
    let mimeType = 'application/json';
    let extension = 'json';

    if (format === 'markdown' || format === 'md') {
        const lines = [`# Session ${sessionId}`, '', `- Profile: ${profile}`, `- Exported: ${exportedAt}`, ''];
        if (notes) {
            lines.push('## Notes', notes, '');
        }
        lines.push('## Conversation');
        history.forEach(turn => {
            const ts = new Date(turn.timestamp).toISOString();
            if (turn.transcription) {
                lines.push(`**User (${ts})**: ${turn.transcription}`);
            }
            if (turn.ai_response) {
                lines.push(`**AI (${ts})**: ${turn.ai_response}`);
            }
            lines.push('');
        });
        content = lines.join('\n');
        mimeType = 'text/markdown';
        extension = 'md';
    } else {
        const data = { metadata, notes, conversation: history };
        content = JSON.stringify(data, null, 2);
    }

    const blob = new Blob([content], { type: mimeType });
    return { blob, filename: `session-${sessionId}.${extension}` };
}

module.exports = {
    exportSession,
};
