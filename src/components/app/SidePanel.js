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

        .transcripts {
            flex: 1;
            overflow-y: auto;
            padding: var(--main-content-padding);
        }

        .transcript-item:not(:last-child) {
            margin-bottom: 16px;
            padding-bottom: 12px;
            border-bottom: 1px solid var(--border-color);
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
    };

    constructor() {
        super();
        this.transcripts = [];
        this.notes = '';
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
            </div>
        `;
    }
}

customElements.define('side-panel', SidePanel);
