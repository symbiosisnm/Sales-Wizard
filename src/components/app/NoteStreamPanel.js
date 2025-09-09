import { html, css, LitElement } from '../../assets/lit-core-2.7.4.min.js';

export class NoteStreamPanel extends LitElement {
    static styles = css`
        :host {
            display: block;
            width: 250px;
            max-height: 100%;
            overflow-y: auto;
            background: var(--main-content-background);
            border-left: 1px solid var(--border-color);
            padding: var(--main-content-padding);
            box-sizing: border-box;
        }

        .note {
            margin-bottom: 8px;
            font-size: 14px;
            line-height: 1.4;
            color: var(--text-color);
        }
    `;

    static properties = {
        notes: { type: Array },
    };

    constructor() {
        super();
        this.notes = [];
    }

    render() {
        return html`
            ${this.notes.map(
                (note) => html`<div class="note">${note}</div>`
            )}
        `;
    }
}

customElements.define('note-stream-panel', NoteStreamPanel);
