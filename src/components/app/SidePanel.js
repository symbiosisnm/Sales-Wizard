import { html, css, LitElement } from '../../assets/lit-core-2.7.4.min.js';

export class SidePanel extends LitElement {
    static styles = css`
        :host {
            display: flex;
            flex-direction: column;
            height: 100%;
            background: var(--main-content-background);
            border-left: 1px solid var(--border-color);
            color: var(--text-color);
        }

        .actions {
            display: flex;
            gap: 8px;
            padding: var(--main-content-padding);
            border-bottom: 1px solid var(--border-color);
        }

        .actions button {
            flex: 1;
            padding: 6px 8px;
            font-size: 12px;
            background: var(--input-background);
            color: var(--text-color);
            border: 1px solid var(--border-color);
            border-radius: var(--border-radius);
            cursor: pointer;
        }

        .actions button:hover {
            background: var(--input-focus-background);
        }

        .transcripts {
            flex: 1;
            overflow-y: auto;
            padding: var(--main-content-padding);
        }

        .transcript-item {
            padding-bottom: 12px;
            border-bottom: 1px solid var(--border-color);
        }

        .transcript-item:not(:last-child) {
            margin-bottom: 16px;
        }

        .transcript-item.speaking {
            background: rgba(255, 255, 0, 0.1);
        }

        .timestamp {
            font-size: 12px;
            color: var(--placeholder-color);
            margin-bottom: 4px;
        }

        .transcription,
        .ai-response {
            margin: 0 0 4px 0;
            font-size: 14px;
            line-height: 1.4;
        }

        .notes {
            flex: 0 0 auto;
            border-top: 1px solid var(--border-color);
            padding: var(--main-content-padding);
        }

        .notes-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 8px;
        }

        .notes-header button {
            font-size: 12px;
            padding: 2px 6px;
            background: var(--input-background);
            color: var(--text-color);
            border: 1px solid var(--border-color);
            border-radius: var(--border-radius);
            cursor: pointer;
        }

        .notes-header button:hover {
            background: var(--input-focus-background);
        }

        textarea {
            width: 100%;
            height: 100%;
            min-height: 120px;
            padding: 10px;
            background: var(--input-background);
            color: var(--text-color);
            border: 1px solid var(--border-color);
            border-radius: var(--border-radius);
            resize: vertical;
            font-family: inherit;
            font-size: 14px;
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
        activeTranscriptIndex: { type: Number },
        notesCollapsed: { type: Boolean },
    };

    constructor() {
        super();
        this.transcripts = [];
        this.notes = '';
        this.activeTranscriptIndex = -1;
        this.notesCollapsed = false;
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

    _toggleNotes() {
        this.notesCollapsed = !this.notesCollapsed;
    }

    async _copyTranscripts() {
        const text = this.transcripts
            .map(
                t =>
                    `[${new Date(t.timestamp).toLocaleTimeString()}] You: ${t.transcription}\nAI: ${t.ai_response}`
            )
            .join('\n\n');
        try {
            await navigator.clipboard?.writeText(text);
        } catch (_e) {
            /* empty */
        }
    }

    _clearNotes() {
        this.notes = '';
        this.dispatchEvent(
            new CustomEvent('notes-change', {
                detail: { value: this.notes },
                bubbles: true,
                composed: true,
            })
        );
    }

    render() {
        return html`
            <div class="actions">
                <button @click=${this._copyTranscripts}>Copy all transcripts</button>
                <button @click=${this._clearNotes}>Clear notes</button>
            </div>
            <div class="transcripts">
                ${this.transcripts.map(
                    (item, index) => html`
                        <div class="transcript-item ${
                                index === this.activeTranscriptIndex ? 'speaking' : ''
                            }">
                            <div class="timestamp">
                                ${new Date(item.timestamp).toLocaleTimeString()}
                            </div>
                            <div class="transcription">${item.transcription}</div>
                            <div class="ai-response">${item.ai_response}</div>
                        </div>
                    `
                )}
            </div>
            <div class="notes">
                <div class="notes-header">
                    <span>Notes</span>
                    <button @click=${this._toggleNotes}>
                        ${this.notesCollapsed ? 'Show' : 'Hide'}
                    </button>
                </div>
                ${this.notesCollapsed
                    ? ''
                    : html`<textarea
                          .value=${this.notes}
                          @input=${this._onNotesChange}
                          placeholder="Notes..."
                      ></textarea>`}
            </div>
        `;
    }
}

customElements.define('side-panel', SidePanel);
