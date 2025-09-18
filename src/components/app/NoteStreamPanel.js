import { html, css, LitElement } from '../../assets/lit-core-2.7.4.min.js';

export class NoteStreamPanel extends LitElement {
    static properties = {
        notes: { type: Array },
    };

    constructor() {
        super();
        this.notes = [];
    }

    static styles = css`
        :host {
            display: flex;
            flex-direction: column;
            height: 100%;
            width: var(--side-panel-width, 320px);
            flex: 0 0 var(--side-panel-width, 320px);
            max-width: var(--side-panel-max-width, 360px);
            background: var(--panel-background, var(--main-content-background));
            color: var(--text-color);
            border-left: 1px solid var(--glass-border-strong, var(--border-color));
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

        .notes {
            flex: 1;
            overflow-y: auto;
            padding: var(--main-content-padding);
            background: var(--panel-surface-background, rgba(255, 255, 255, 0.02));
            backdrop-filter: inherit;
        }

        .note-item {
            padding: 4px 0;
            border-bottom: 1px solid var(--glass-border, var(--border-color));
        }

        .note-item:last-child {
            border-bottom: none;
        }
    `;

    addNote(note) {
        this.notes = [...this.notes, note];
    }

    clear() {
        this.notes = [];
    }

    render() {
        /* prettier-ignore */
        return html`
            <div class="notes">
                ${this.notes.map(note => html`<div class="note-item">${note}</div>`)}
            </div>
        `;
    }
}

customElements.define('note-stream-panel', NoteStreamPanel);
