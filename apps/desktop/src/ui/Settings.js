import { html, css, LitElement } from '../assets/lit-core-2.7.4.min.js';

export class SettingsPage extends LitElement {
  static properties = {
    serverUrl: { type: String },
    apiKey: { type: String },
    mode: { type: String },
    autoOcr: { type: Boolean },
    useLocalTranscription: { type: Boolean },
    reconnect: { type: Boolean },
    ocrLang: { type: String },
    ocrInterval: { type: Number },
    micDevice: { type: String },
  };

  constructor() {
    super();
    this.serverUrl = localStorage.getItem('serverUrl') || 'http://localhost:8787';
    this.apiKey = localStorage.getItem('apiKey') || '';
    this.mode = localStorage.getItem('mode') || 'TEXT';
    this.autoOcr = localStorage.getItem('autoOcr') === 'true';
    this.useLocalTranscription = localStorage.getItem('useLocalTranscription') === 'true';
    this.reconnect = localStorage.getItem('reconnect') === 'true';
    this.ocrLang = localStorage.getItem('ocrLang') || 'eng';
    this.ocrInterval = Number(localStorage.getItem('ocrInterval') || 800);
    this.micDevice = localStorage.getItem('micDevice') || '';
  }

  save() {
    localStorage.setItem('serverUrl', this.serverUrl);
    localStorage.setItem('apiKey', this.apiKey);
    localStorage.setItem('mode', this.mode);
    localStorage.setItem('autoOcr', this.autoOcr);
    localStorage.setItem('useLocalTranscription', this.useLocalTranscription);
    localStorage.setItem('reconnect', this.reconnect);
    localStorage.setItem('ocrLang', this.ocrLang);
    localStorage.setItem('ocrInterval', String(this.ocrInterval));
    localStorage.setItem('micDevice', this.micDevice);
  }

  render() {
    return html`
      <div class="settings">
        <label>Server URL <input .value=${this.serverUrl} @input=${e => (this.serverUrl = e.target.value)} /></label>
        <label>API Key <input type="password" .value=${this.apiKey} @input=${e => (this.apiKey = e.target.value)} /></label>
        <label>Mode
          <select .value=${this.mode} @change=${e => (this.mode = e.target.value)}>
            <option value="TEXT">TEXT</option>
            <option value="AUDIO">AUDIO</option>
          </select>
        </label>
        <label><input type="checkbox" .checked=${this.autoOcr} @change=${e => (this.autoOcr = e.target.checked)} /> Auto-OCR to model</label>
        <label><input type="checkbox" .checked=${this.useLocalTranscription} @change=${e => (this.useLocalTranscription = e.target.checked)} /> Use local transcription</label>
        <label><input type="checkbox" .checked=${this.reconnect} @change=${e => (this.reconnect = e.target.checked)} /> Reconnect on drop</label>
        <label>OCR language <input .value=${this.ocrLang} @input=${e => (this.ocrLang = e.target.value)} /></label>
        <label>OCR interval <input type="number" .value=${this.ocrInterval} @input=${e => (this.ocrInterval = e.target.value)} /></label>
        <label>Mic device <input .value=${this.micDevice} @input=${e => (this.micDevice = e.target.value)} /></label>
        <button @click=${() => this.save()}>Save</button>
      </div>
    `;
  }
}

customElements.define('settings-page', SettingsPage);
