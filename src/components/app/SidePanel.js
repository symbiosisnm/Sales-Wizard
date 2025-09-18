import { html, css, LitElement } from '../../assets/lit-core-2.7.4.min.js';

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

        .transcripts {
            flex: 1;
            overflow-y: auto;
            padding: var(--main-content-padding);
            background: var(--panel-surface-background, rgba(255, 255, 255, 0.02));
            backdrop-filter: inherit;
        }

        .transcript-item:not(:last-child) {
            margin-bottom: 16px;
            padding-bottom: 12px;
            border-bottom: 1px solid var(--glass-border, var(--border-color));
        }

        .transcription,
        .ai-response {
            margin: 0 0 4px 0;
            font-size: 14px;
            line-height: 1.4;
        }

        .notes {
            flex: 0 0 auto;
            border-top: 1px solid var(--glass-border, var(--border-color));
            padding: var(--main-content-padding);
            background: var(--panel-footer-background, rgba(255, 255, 255, 0.04));
            backdrop-filter: inherit;
        }

        .notes-actions {
            display: flex;
            justify-content: flex-end;
            margin-top: 8px;
            gap: 8px;
        }

        .save-button {
            background: var(--button-background);
            color: var(--text-color);
            border: 1px solid var(--glass-border, var(--button-border));
            padding: 4px 8px;
            border-radius: 4px;
            font-size: 12px;
            cursor: pointer;
            backdrop-filter: var(--glass-backdrop-filter, blur(22px) saturate(150%));
            -webkit-backdrop-filter: var(--glass-backdrop-filter, blur(22px) saturate(150%));
        }

        .save-button:hover {
            background: var(--hover-background);
        }

        .format-select {
            background: var(--button-background);
            color: var(--text-color);
            border: 1px solid var(--glass-border, var(--button-border));
            padding: 4px 6px;
            border-radius: 4px;
            font-size: 12px;
            backdrop-filter: var(--glass-backdrop-filter, blur(22px) saturate(150%));
            -webkit-backdrop-filter: var(--glass-backdrop-filter, blur(22px) saturate(150%));
        }

        textarea {
            width: 100%;
            height: 100%;
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

        textarea::placeholder {
            color: var(--placeholder-color);
        }

        textarea:focus {
            outline: none;
            border-color: var(--focus-border-color);
            box-shadow: 0 0 0 2px var(--focus-box-shadow);
            background: var(--input-focus-background);
        }
    `;

    static properties = {
        transcripts: { type: Array },
        notes: { type: String },
        selectedProfile: { type: String },
        exportFormat: { type: String },
    };

    constructor() {
        super();
        this.transcripts = [];
        this.notes = '';
        this.selectedProfile = 'interview';
        this.exportFormat = 'json';
    }

    _onNotesChange(e) {
        this.notes = e.target.value;
        this.dispatchEvent(
            new CustomEvent('notes-change', {
                detail: { value: this.notes },
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
                notes: this.notes,
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

    render() {
        return html`
            <div class="transcripts">
                ${this.transcripts.map(
                    (item) => html`
                        <div class="transcript-item">
                            <div class="transcription">${item.transcription}</div>
                            <div class="ai-response">${item.ai_response}</div>
                        </div>
                    `
                )}
            </div>
            <div class="notes">
                <textarea
                    .value=${this.notes}
                    @input=${this._onNotesChange}
                    placeholder="Notes..."
                ></textarea>
                <div class="notes-actions">
                    <select class="format-select" .value=${this.exportFormat} @change=${this._onFormatChange}>
                        <option value="json">JSON</option>
                        <option value="markdown">Markdown</option>
                    </select>
                    <button class="save-button" @click=${this._onSaveSession}>Save session</button>
                </div>
            </div>
        `;
    }
}

customElements.define('side-panel', SidePanel);
