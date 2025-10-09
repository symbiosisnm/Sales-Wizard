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

        .content {
            flex: 1;
            overflow-y: auto;
            padding: var(--main-content-padding);
            display: flex;
            flex-direction: column;
            gap: 24px;
            background: var(--panel-surface-background, rgba(255, 255, 255, 0.02));
            backdrop-filter: inherit;
        }

        .section-title {
            font-size: 13px;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.08em;
            margin-bottom: 12px;
            color: var(--subtle-text-color, rgba(255, 255, 255, 0.7));
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

        .structured-notes-list {
            display: flex;
            flex-direction: column;
            gap: 12px;
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

        .note-button {
            background: var(--button-background, rgba(255, 255, 255, 0.08));
            color: inherit;
            border: 1px solid var(--glass-border, var(--border-color));
            padding: 4px 10px;
            border-radius: 4px;
            font-size: 12px;
            cursor: pointer;
            transition: background 0.15s ease;
        }

        .note-button:hover {
            background: var(--hover-background, rgba(255, 255, 255, 0.16));
        }

        .note-button.primary {
            background: var(--accent-color, rgba(66, 133, 244, 0.24));
            border-color: var(--accent-color, rgba(66, 133, 244, 0.4));
        }

        .note-button.destructive {
            color: var(--danger-color, #ff6b6b);
            border-color: rgba(255, 107, 107, 0.4);
        }

        .note-editor {
            width: 100%;
            min-height: 80px;
            padding: 8px;
            border-radius: 6px;
            border: 1px solid var(--glass-border, var(--border-color));
            background: var(--panel-input-background, var(--input-background));
            color: inherit;
            font-size: 14px;
            font-family: inherit;
            resize: vertical;
        }

        .note-editor:focus {
            outline: none;
            border-color: var(--focus-border-color);
            box-shadow: 0 0 0 2px var(--focus-box-shadow);
        }

        .note-type-select {
            background: var(--button-background, rgba(255, 255, 255, 0.08));
            color: inherit;
            border: 1px solid var(--glass-border, var(--border-color));
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

    _onManualNotesChange(e) {
        this.manualNotes = e.target.value;
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

    _formatTimestamp(timestamp) {
        if (typeof timestamp !== 'number') return '—';
        try {
            return new Date(timestamp).toLocaleString();
        } catch {
            return '—';
        }
    }

    _resolveNoteId(note, index) {
        if (note?.id) return note.id;
        const base = typeof note?.timestamp === 'number' ? note.timestamp : Date.now();
        return `${base}-${index}`;
    }

    _startEdit(note, index) {
        const id = this._resolveNoteId(note, index);
        this._editingNoteId = id;
        this._draftNote = {
            id,
            text: note?.text || '',
            type: note?.type || 'auto',
            timestamp: typeof note?.timestamp === 'number' ? note.timestamp : Date.now(),
        };
    }

    _cancelEdit() {
        this._editingNoteId = null;
        this._draftNote = null;
    }

    _onDraftTextChange(e) {
        if (!this._draftNote) return;
        this._draftNote = { ...this._draftNote, text: e.target.value };
    }

    _onDraftTypeChange(e) {
        if (!this._draftNote) return;
        this._draftNote = { ...this._draftNote, type: e.target.value };
    }

    _saveDraft(id) {
        if (!this._draftNote || id !== this._editingNoteId) return;
        const text = (this._draftNote.text || '').trim();
        if (!text) {
            this._deleteNote(id);
            return;
        }
        const updatedNotes = this.structuredNotes.map((note, index) => {
            const noteId = this._resolveNoteId(note, index);
            if (noteId !== id) return note;
            return {
                ...note,
                text,
                type: this._draftNote.type || 'auto',
                timestamp:
                    typeof this._draftNote.timestamp === 'number'
                        ? this._draftNote.timestamp
                        : note.timestamp || Date.now(),
            };
        });
        this.structuredNotes = updatedNotes;
        this._dispatchStructuredNotes(updatedNotes);
        this._cancelEdit();
    }

    _deleteNote(id) {
        const updatedNotes = this.structuredNotes.filter((note, index) => this._resolveNoteId(note, index) !== id);
        this.structuredNotes = updatedNotes;
        this._dispatchStructuredNotes(updatedNotes);
        if (this._editingNoteId === id) {
            this._cancelEdit();
        }
    }

    _renderStructuredNote(note, index) {
        const id = this._resolveNoteId(note, index);
        const isEditing = this._editingNoteId === id;
        const displayText = isEditing ? this._draftNote?.text || '' : note?.text || '';
        const displayType = (isEditing ? this._draftNote?.type : note?.type) || 'auto';
        const timestamp = typeof note?.timestamp === 'number' ? note.timestamp : Date.now();

        return html`
            <div class="structured-note">
                <div class="note-header">
                    <span class="note-type">${displayType}</span>
                    <span class="note-timestamp">${this._formatTimestamp(timestamp)}</span>
                </div>
                ${isEditing
                    ? html`
                          <textarea
                              class="note-editor"
                              .value=${displayText}
                              @input=${this._onDraftTextChange}
                          ></textarea>
                          <div class="note-edit-actions">
                              <select class="note-type-select" .value=${displayType} @change=${this._onDraftTypeChange}>
                                  <option value="auto">Auto</option>
                                  <option value="manual">Manual</option>
                              </select>
                              <div class="note-actions">
                                  <button class="note-button primary" @click=${() => this._saveDraft(id)}>Save</button>
                                  <button class="note-button" @click=${this._cancelEdit}>Cancel</button>
                              </div>
                          </div>
                      `
                    : html`
                          <div class="note-text">${displayText}</div>
                          <div class="note-actions">
                              <button class="note-button" @click=${() => this._startEdit(note, index)}>Edit</button>
                              <button class="note-button destructive" @click=${() => this._deleteNote(id)}>Delete</button>
                          </div>
                      `}
            </div>
        `;
    }

    render() {
        const notes = Array.isArray(this.structuredNotes) ? this.structuredNotes : [];
        return html`
            <div class="content">
                <div class="transcript-section">
                    <div class="section-title">Conversation</div>
                    ${this.transcripts.length
                        ? this.transcripts.map(
                              item => html`
                                  <div class="transcript-item">
                                      <div class="transcription">${item.transcription}</div>
                                      <div class="ai-response">${item.ai_response}</div>
                                  </div>
                              `
                          )
                        : html`<div class="empty-state">No conversation turns yet</div>`}
                </div>
                <div class="structured-notes-section">
                    <div class="section-title">Structured Notes</div>
                    <div class="structured-notes-list">
                        ${notes.length
                            ? notes.map((note, index) => this._renderStructuredNote(note, index))
                            : html`<div class="empty-state">No structured notes yet</div>`}
                    </div>
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
