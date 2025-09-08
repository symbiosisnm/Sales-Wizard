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
            background: var(--main-content-background);
            color: var(--text-color);
            border-left: 1px solid var(--border-color);
        }

        .notes {
            flex: 1;
            overflow-y: auto;
            padding: var(--main-content-padding);
        }

        .note-item {
            padding: 4px 0;
            border-bottom: 1px solid var(--border-color);
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
