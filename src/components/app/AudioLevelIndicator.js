import { html, css, LitElement } from '../../assets/lit-core-2.7.4.min.js';

export class AudioLevelIndicator extends LitElement {
    static properties = {
        level: { type: Number }
    };

    constructor() {
        super();
        this.level = 0;
    }

    static styles = css`
        :host {
            display: block;
        }
        .meter {
            width: 40px;
            height: 8px;
            background: var(--input-background);
            border-radius: 4px;
            overflow: hidden;
        }
        .level {
            height: 100%;
            background: var(--focus-border-color);
            width: 0%;
            transition: width 0.1s linear;
        }
    `;

    render() {
        const pct = Math.min(1, Math.max(0, this.level)) * 100;
        return html`<div class="meter"><div class="level" style="width:${pct}%"></div></div>`;
    }
}

customElements.define('audio-level-indicator', AudioLevelIndicator);
