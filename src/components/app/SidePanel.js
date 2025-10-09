import { html, css, LitElement } from '../../assets/lit-core-2.7.4.min.js';
import defaultLogger from '../../utils/logger.js';

const logger = globalThis.logger || defaultLogger || console;

export class SidePanel extends LitElement {
    static styles = css`
        :host {
            display: flex;
            flex-direction: column;
            height: 100%;
            width: var(--side-panel-width, 320px);
            flex: 0 0 var(--side-panel-width, 320px);
            max-width: var(--side-panel-max-width, 360px);
            background: var(--panel-background, var(--main-content-background));
            border-left: 1px solid var(--glass-border-strong, var(--border-color));
            color: var(--text-color);
            backdrop-filter: var(--glass-backdrop-filter, blur(22px) saturate(150%));
            -webkit-backdrop-filter: var(--glass-backdrop-filter, blur(22px) saturate(150%));
            box-shadow: var(--glass-panel-shadow, -12px 0 28px rgba(8, 12, 24, 0.35));
            position: relative;
            overflow: hidden;
        }

        :host::before {
            content: '';
            position: absolute;
            inset: 0;
            pointer-events: none;
            border-radius: 0;
            box-shadow: var(--glass-edge-highlight, inset 0 1px 0 rgba(255, 255, 255, 0.35));
        }

        .content {
            flex: 1;
            overflow-y: auto;
            padding: var(--main-content-padding);
            display: flex;
            flex-direction: column;
            gap: 24px;
            background: var(--panel-surface-background, rgba(255, 255, 255, 0.02));
            backdrop-filter: inherit;
            display: flex;
            flex-direction: column;
            gap: 16px;
        }

        .transcripts-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 12px;
        }

        .transcripts-title {
            font-size: 16px;
            font-weight: 600;
        }

        .transcripts-actions {
            display: flex;
            gap: 8px;
            flex-wrap: wrap;
            justify-content: flex-end;
        }

        .transcript-list {
            flex: 1;
            overflow-y: auto;
            display: flex;
            flex-direction: column;
            gap: 16px;
        }

        .transcript-item {
            padding-bottom: 12px;
            border-bottom: 1px solid var(--glass-border, var(--border-color));
        }

        .transcript-item:last-child {
            border-bottom: none;
            padding-bottom: 0;
        }

        .timestamp {
            font-size: 12px;
            color: var(--muted-text-color, rgba(255, 255, 255, 0.6));
            margin-bottom: 6px;
        }

        .transcription,
        .ai-response {
            margin: 0 0 4px 0;
            font-size: 14px;
            line-height: 1.4;
        }

        .empty-transcript {
            font-size: 14px;
            color: var(--muted-text-color, rgba(255, 255, 255, 0.6));
        }

        .notes {
            flex: 0 0 auto;
            border-top: 1px solid var(--glass-border, var(--border-color));
            padding: var(--main-content-padding);
            background: var(--panel-footer-background, rgba(255, 255, 255, 0.04));
            backdrop-filter: inherit;
        }

        .structured-note {
            border: 1px solid var(--glass-border, var(--border-color));
            border-radius: 8px;
            padding: 10px;
            background: var(--panel-card-background, rgba(8, 12, 24, 0.25));
            backdrop-filter: var(--glass-backdrop-filter, blur(22px) saturate(150%));
            -webkit-backdrop-filter: var(--glass-backdrop-filter, blur(22px) saturate(150%));
            display: flex;
            flex-direction: column;
            gap: 8px;
        }

        .structured-note .note-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            font-size: 12px;
            color: var(--subtle-text-color, rgba(255, 255, 255, 0.65));
        }

        .note-type {
            text-transform: capitalize;
            font-weight: 600;
            padding: 2px 6px;
            border-radius: 999px;
            background: var(--chip-background, rgba(255, 255, 255, 0.08));
        }

        .note-text {
            font-size: 14px;
            line-height: 1.5;
            white-space: pre-wrap;
        }

        .note-actions,
        .note-edit-actions {
            display: flex;
            justify-content: flex-end;
            gap: 8px;
        }

        .action-button,
        .save-button {
            background: var(--button-background);
            color: var(--text-color);
            border: 1px solid var(--glass-border, var(--button-border));
            padding: 4px 8px;
            border-radius: 4px;
            font-size: 12px;
            cursor: pointer;
            transition: background 0.15s ease;
        }

        .action-button:hover,
        .save-button:hover {
            background: var(--hover-background);
        }

        .action-button.danger {
            color: var(--destructive-text-color, #ff6b6b);
            border-color: var(--destructive-border-color, rgba(255, 107, 107, 0.6));
        }

        .format-select {
            background: var(--button-background);
            color: var(--text-color);
            border: 1px solid var(--glass-border, var(--button-border));
            padding: 4px 6px;
            border-radius: 4px;
            font-size: 12px;
            padding: 4px 6px;
        }

        .manual-notes {
            border-top: 1px solid var(--glass-border, var(--border-color));
            padding: var(--main-content-padding);
            background: var(--panel-footer-background, rgba(255, 255, 255, 0.04));
            backdrop-filter: inherit;
            display: flex;
            flex-direction: column;
            gap: 12px;
        }

        .manual-notes textarea {
            width: 100%;
            min-height: 120px;
            padding: 10px;
            background: var(--panel-input-background, var(--input-background));
            color: var(--text-color);
            border: 1px solid var(--glass-border, var(--border-color));
            border-radius: var(--border-radius);
            resize: vertical;
            font-family: inherit;
            font-size: 14px;
            backdrop-filter: var(--glass-backdrop-filter, blur(22px) saturate(150%));
            -webkit-backdrop-filter: var(--glass-backdrop-filter, blur(22px) saturate(150%));
        }

        .manual-notes textarea:focus {
            outline: none;
            border-color: var(--focus-border-color);
            box-shadow: 0 0 0 2px var(--focus-box-shadow);
            background: var(--input-focus-background);
        }

        .notes-actions {
            display: flex;
            justify-content: space-between;
            align-items: center;
            gap: 12px;
        }

        .notes-actions select {
            flex: 1;
            background: var(--button-background, rgba(255, 255, 255, 0.08));
            color: var(--text-color);
            border: 1px solid var(--glass-border, var(--button-border));
            padding: 6px 8px;
            border-radius: 4px;
            font-size: 12px;
        }

        .save-button {
            background: var(--button-background);
            color: var(--text-color);
            border: 1px solid var(--glass-border, var(--button-border));
            padding: 6px 12px;
            border-radius: 4px;
            font-size: 12px;
            cursor: pointer;
            white-space: nowrap;
        }

        .save-button:hover {
            background: var(--hover-background);
        }

        .empty-state {
            font-size: 13px;
            color: var(--subtle-text-color, rgba(255, 255, 255, 0.6));
            border: 1px dashed var(--glass-border, rgba(255, 255, 255, 0.1));
            border-radius: 8px;
            padding: 12px;
            text-align: center;
        }
    `;

    static properties = {
        transcripts: { type: Array },
        structuredNotes: { type: Array },
        manualNotes: { type: String },
        selectedProfile: { type: String },
        exportFormat: { type: String },
        _editingNoteId: { state: true },
        _draftNote: { state: true },
    };

    constructor() {
        super();
        this.transcripts = [];
        this.structuredNotes = [];
        this.manualNotes = '';
        this.selectedProfile = 'interview';
        this.exportFormat = 'json';
        this._editingNoteId = null;
        this._draftNote = null;
    }

    _dispatchStructuredNotes(notes) {
        this.dispatchEvent(
            new CustomEvent('structured-notes-change', {
                detail: { notes },
                bubbles: true,
                composed: true,
            })
        );
    }

    formatTimestamp(timestamp) {
        if (!timestamp) return 'Unknown time';
        const date = new Date(timestamp);
        if (Number.isNaN(date.getTime())) return 'Unknown time';
        return date.toLocaleString(undefined, {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            month: 'short',
            day: 'numeric',
        });
    }

    _onNotesChange(e) {
        this.notes = e.target.value;
        this.dispatchEvent(
            new CustomEvent('manual-notes-change', {
                detail: { value: this.manualNotes },
                bubbles: true,
                composed: true,
            })
        );
    }

    _onFormatChange(e) {
        this.exportFormat = e.target.value;
    }

    async _onSaveSession() {
        if (!window.electron?.exportSession) return;
        try {
            const res = await window.electron.exportSession({
                format: this.exportFormat,
                structuredNotes: this.structuredNotes,
                manualNotes: this.manualNotes,
                profile: this.selectedProfile,
            });
            if (res?.success) {
                const bytes = Uint8Array.from(atob(res.data), c => c.charCodeAt(0));
                const blob = new Blob([bytes], { type: res.mimeType });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = res.filename;
                a.click();
                URL.revokeObjectURL(url);
            }
        } catch (e) {
            logger.error('Failed to save session:', e);
        }
    }

    _onCopyTranscript() {
        this.dispatchEvent(
            new CustomEvent('copy-transcript', {
                bubbles: true,
                composed: true,
            })
        );
    }

    _onClearSessionData() {
        this.dispatchEvent(
            new CustomEvent('clear-session-data', {
                bubbles: true,
                composed: true,
            })
        );
    }

    render() {
        const notes = Array.isArray(this.structuredNotes) ? this.structuredNotes : [];
        return html`
            <div class="transcripts">
                <div class="transcripts-header">
                    <div class="transcripts-title">Transcript</div>
                    <div class="transcripts-actions">
                        <button class="action-button" type="button" @click=${() => this._onCopyTranscript()}>
                            Copy transcript
                        </button>
                        <button
                            class="action-button danger"
                            type="button"
                            @click=${() => this._onClearSessionData()}
                        >
                            Clear notes & transcript
                        </button>
                    </div>
                </div>
                <div class="transcript-list">
                    ${this.transcripts.length
                        ? this.transcripts.map(
                              item => html`
                                  <div class="transcript-item">
                                      <div class="timestamp">${this.formatTimestamp(item.timestamp)}</div>
                                      ${item.transcription
                                          ? html`<div class="transcription">${item.transcription}</div>`
                                          : null}
                                      ${item.ai_response
                                          ? html`<div class="ai-response">${item.ai_response}</div>`
                                          : null}
                                  </div>
                              `
                          )
                        : html`<div class="empty-transcript">No transcript captured yet.</div>`}
                </div>
            </div>
            <div class="manual-notes">
                <div class="section-title">Manual Notes</div>
                <textarea
                    .value=${this.manualNotes}
                    @input=${this._onManualNotesChange}
                    placeholder="Jot down anything you'd like to remember..."
                ></textarea>
                <div class="notes-actions">
                    <select class="format-select" .value=${this.exportFormat} @change=${this._onFormatChange}>
                        <option value="json">JSON</option>
                        <option value="markdown">Markdown</option>
                    </select>
                    <button class="save-button" @click=${this._onSaveSession}>Export session</button>
                </div>
            </div>
        `;
    }
}

customElements.define('side-panel', SidePanel);
