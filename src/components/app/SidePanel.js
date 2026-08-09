import { html, css, LitElement } from '../../assets/lit-core-2.7.4.min.js';
import { buildVisualContextFromFile } from '../../utils/visualContext.mjs';

const logger = globalThis.logger || console;

export class SidePanel extends LitElement {
    static styles = css`
        :host {
            display: flex;
            flex-direction: column;
            width: 390px;
            min-width: 340px;
            height: 100%;
            color: var(--text-color);
            background:
                radial-gradient(circle at top right, rgba(115, 188, 255, 0.18), transparent 32%),
                linear-gradient(180deg, rgba(9, 14, 24, 0.54) 0%, rgba(9, 14, 24, 0.34) 100%);
            border-left: 1px solid rgba(255, 255, 255, 0.12);
            backdrop-filter: blur(30px) saturate(160%);
            -webkit-backdrop-filter: blur(30px) saturate(160%);
        }

        .panel-shell {
            display: flex;
            flex-direction: column;
            min-height: 0;
            height: 100%;
        }

        .topbar {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 10px;
            padding: 14px 14px 0 14px;
        }

        .source-chip {
            display: inline-flex;
            align-items: center;
            gap: 8px;
            padding: 7px 12px;
            border-radius: 999px;
            font-size: 11px;
            font-weight: 700;
            letter-spacing: 0.08em;
            text-transform: uppercase;
            color: rgba(255, 255, 255, 0.8);
            background: rgba(255, 255, 255, 0.06);
            border: 1px solid rgba(255, 255, 255, 0.12);
        }

        .source-chip[data-kind='video'] {
            color: #fef3c7;
            border-color: rgba(245, 158, 11, 0.34);
            background: rgba(120, 74, 11, 0.2);
        }

        .source-chip[data-kind='image'] {
            color: #dcfce7;
            border-color: rgba(52, 211, 153, 0.34);
            background: rgba(16, 84, 61, 0.2);
        }

        .source-chip[data-kind='screen'] {
            color: #dbeafe;
            border-color: rgba(96, 165, 250, 0.34);
            background: rgba(18, 74, 144, 0.2);
        }

        .visual-actions {
            display: flex;
            gap: 8px;
        }

        .ghost-button,
        .clear-button,
        .save-button,
        .tab-button {
            appearance: none;
            border: 1px solid rgba(255, 255, 255, 0.12);
            border-radius: 12px;
            background: rgba(255, 255, 255, 0.05);
            color: #f8fafc;
            cursor: pointer;
            transition: all 0.18s ease;
        }

        .ghost-button,
        .clear-button {
            padding: 8px 12px;
            font-size: 12px;
            font-weight: 600;
        }

        .save-button {
            padding: 8px 12px;
            font-size: 12px;
            font-weight: 600;
        }

        .ghost-button:hover,
        .clear-button:hover,
        .save-button:hover,
        .tab-button:hover {
            background: rgba(255, 255, 255, 0.1);
            border-color: rgba(255, 255, 255, 0.18);
        }

        .clear-button {
            color: rgba(255, 255, 255, 0.72);
        }

        .clear-button:disabled {
            opacity: 0.45;
            cursor: default;
        }

        .tabs {
            display: grid;
            grid-template-columns: repeat(5, minmax(0, 1fr));
            gap: 8px;
            padding: 12px 14px 0 14px;
        }

        .tab-button {
            padding: 10px 12px;
            font-size: 12px;
            font-weight: 700;
            letter-spacing: 0.02em;
            color: rgba(255, 255, 255, 0.72);
        }

        .tab-button.active {
            color: #ffffff;
            border-color: rgba(147, 197, 253, 0.5);
            background: linear-gradient(135deg, rgba(33, 90, 165, 0.48), rgba(66, 153, 225, 0.22));
            box-shadow:
                inset 0 1px 0 rgba(255, 255, 255, 0.08),
                0 10px 24px rgba(9, 14, 24, 0.22);
        }

        .panel-body {
            flex: 1;
            min-height: 0;
            overflow-y: auto;
            padding: 12px 14px;
        }

        .empty-state,
        .visual-card,
        .help-card,
        .transcript-item,
        .resource-link {
            border-radius: 18px;
            border: 1px solid rgba(255, 255, 255, 0.1);
            background: rgba(255, 255, 255, 0.045);
            box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.04);
            backdrop-filter: blur(22px) saturate(150%);
            -webkit-backdrop-filter: blur(22px) saturate(150%);
        }

        .empty-state {
            padding: 18px;
            color: rgba(255, 255, 255, 0.62);
            font-size: 13px;
            line-height: 1.55;
        }

        .help-list,
        .transcripts {
            display: flex;
            flex-direction: column;
            gap: 12px;
        }

        .help-card,
        .transcript-item {
            padding: 16px;
        }

        .primary-answer-card {
            margin-bottom: 12px;
            background: linear-gradient(180deg, rgba(16, 50, 87, 0.44), rgba(255, 255, 255, 0.05));
            border-color: rgba(125, 211, 252, 0.24);
        }

        .help-card[data-confidence='high'] {
            border-color: rgba(74, 222, 128, 0.24);
            background: linear-gradient(180deg, rgba(17, 58, 45, 0.38), rgba(255, 255, 255, 0.04));
        }

        .help-card[data-confidence='medium'] {
            border-color: rgba(96, 165, 250, 0.24);
            background: linear-gradient(180deg, rgba(17, 53, 94, 0.38), rgba(255, 255, 255, 0.04));
        }

        .help-card[data-confidence='low'] {
            border-color: rgba(251, 191, 36, 0.24);
            background: linear-gradient(180deg, rgba(83, 50, 15, 0.38), rgba(255, 255, 255, 0.04));
        }

        .card-header,
        .visual-header {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            gap: 12px;
            margin-bottom: 10px;
        }

        .card-title,
        .visual-title {
            font-size: 14px;
            font-weight: 700;
            letter-spacing: 0.01em;
            color: #f8fafc;
        }

        .card-meta,
        .visual-meta,
        .mini-label {
            font-size: 10px;
            font-weight: 700;
            letter-spacing: 0.08em;
            text-transform: uppercase;
            color: rgba(255, 255, 255, 0.58);
        }

        .speak-now-label {
            font-size: 10px;
            font-weight: 700;
            letter-spacing: 0.08em;
            text-transform: uppercase;
            color: rgba(255, 255, 255, 0.48);
            margin-bottom: 6px;
        }

        .speak-now,
        .transcription,
        .ai-response,
        .visual-summary {
            font-size: 14px;
            line-height: 1.55;
            color: rgba(255, 255, 255, 0.9);
            user-select: text;
        }

        .supporting-points {
            display: flex;
            flex-direction: column;
            gap: 6px;
            margin: 10px 0;
        }

        .resource-grid {
            display: grid;
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 10px;
            margin-bottom: 12px;
        }

        .resource-link {
            display: flex;
            flex-direction: column;
            gap: 8px;
            padding: 14px;
            color: inherit;
            text-decoration: none;
            cursor: pointer;
            transition: transform 0.16s ease, border-color 0.16s ease, background 0.16s ease;
        }

        .resource-link:hover {
            transform: translateY(-1px);
            border-color: rgba(125, 211, 252, 0.28);
            background: rgba(255, 255, 255, 0.08);
        }

        .resource-link-title {
            font-size: 13px;
            font-weight: 700;
            line-height: 1.35;
            color: #f8fafc;
        }

        .resource-link-meta {
            font-size: 10px;
            font-weight: 700;
            letter-spacing: 0.08em;
            text-transform: uppercase;
            color: rgba(125, 211, 252, 0.78);
        }

        .resource-link-host {
            font-size: 11px;
            color: rgba(255, 255, 255, 0.56);
            word-break: break-word;
        }

        .supporting-point {
            font-size: 12px;
            line-height: 1.45;
            color: rgba(255, 255, 255, 0.72);
        }

        .preview-frame,
        .visual-preview {
            margin-top: 12px;
            border-radius: 14px;
            overflow: hidden;
            border: 1px solid rgba(255, 255, 255, 0.12);
            background: rgba(255, 255, 255, 0.03);
        }

        .preview-frame img,
        .visual-preview img {
            display: block;
            width: 100%;
            height: auto;
        }

        .visual-card {
            padding: 16px;
        }

        .context-overview {
            display: grid;
            grid-template-columns: 112px minmax(0, 1fr);
            gap: 14px;
            margin-bottom: 12px;
        }

        .context-overview img {
            width: 112px;
            height: 92px;
            object-fit: cover;
            border-radius: 14px;
            border: 1px solid rgba(255, 255, 255, 0.12);
            display: block;
        }

        .context-overview-meta {
            display: flex;
            flex-direction: column;
            gap: 8px;
            min-width: 0;
        }

        .context-pill-row {
            display: flex;
            flex-wrap: wrap;
            gap: 6px;
        }

        .context-pill {
            padding: 5px 9px;
            border-radius: 999px;
            font-size: 10px;
            font-weight: 700;
            letter-spacing: 0.08em;
            text-transform: uppercase;
            color: rgba(255, 255, 255, 0.72);
            background: rgba(255, 255, 255, 0.06);
            border: 1px solid rgba(255, 255, 255, 0.12);
        }

        .context-pill.processing {
            color: #e0f2fe;
            border-color: rgba(125, 211, 252, 0.3);
            background: rgba(8, 47, 73, 0.3);
        }

        .focus-form {
            display: flex;
            flex-direction: column;
            gap: 12px;
        }

        .focus-field {
            display: flex;
            flex-direction: column;
            gap: 6px;
        }

        .focus-label {
            font-size: 11px;
            font-weight: 700;
            letter-spacing: 0.08em;
            text-transform: uppercase;
            color: rgba(255, 255, 255, 0.62);
        }

        .focus-input,
        .focus-textarea {
            width: 100%;
            background: rgba(255, 255, 255, 0.04);
            color: var(--text-color);
            border: 1px solid rgba(255, 255, 255, 0.12);
            border-radius: 14px;
            padding: 10px 12px;
            font-size: 13px;
        }

        .focus-input:focus,
        .focus-textarea:focus {
            outline: none;
            border-color: rgba(125, 211, 252, 0.44);
            box-shadow: 0 0 0 3px rgba(56, 189, 248, 0.14);
            background: rgba(255, 255, 255, 0.06);
        }

        .focus-textarea {
            min-height: 120px;
            resize: vertical;
            font-family: inherit;
        }

        .focus-toggle {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 12px;
            padding: 12px 14px;
            border-radius: 16px;
            border: 1px solid rgba(255, 255, 255, 0.1);
            background: rgba(255, 255, 255, 0.04);
        }

        .focus-toggle input {
            accent-color: #7dd3fc;
        }

        .retrieval-list {
            display: flex;
            flex-direction: column;
            gap: 10px;
            margin-top: 4px;
        }

        .retrieval-item {
            padding: 14px;
            border-radius: 16px;
            border: 1px solid rgba(255, 255, 255, 0.1);
            background: rgba(255, 255, 255, 0.04);
            color: rgba(255, 255, 255, 0.82);
            font-size: 13px;
            line-height: 1.5;
            user-select: text;
        }

        .knowledge-list {
            display: flex;
            flex-direction: column;
            gap: 10px;
        }

        .knowledge-item {
            display: flex;
            flex-direction: column;
            gap: 10px;
            padding: 14px;
            border-radius: 16px;
            border: 1px solid rgba(255, 255, 255, 0.1);
            background: rgba(255, 255, 255, 0.04);
        }

        .knowledge-item-header,
        .knowledge-item-actions {
            display: flex;
            align-items: flex-start;
            justify-content: space-between;
            gap: 10px;
        }

        .knowledge-title {
            font-size: 13px;
            font-weight: 700;
            color: #f8fafc;
        }

        .knowledge-summary {
            font-size: 12px;
            line-height: 1.5;
            color: rgba(255, 255, 255, 0.7);
            user-select: text;
        }

        .focus-summary {
            font-size: 12px;
            line-height: 1.5;
            color: rgba(255, 255, 255, 0.68);
        }

        .frame-grid {
            display: grid;
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 8px;
            margin-top: 12px;
        }

        .frame-grid img {
            width: 100%;
            border-radius: 12px;
            border: 1px solid rgba(255, 255, 255, 0.1);
            display: block;
        }

        .context-frame-strip {
            display: grid;
            grid-template-columns: repeat(4, minmax(0, 1fr));
            gap: 6px;
            margin-top: 12px;
        }

        .context-frame-strip img {
            width: 100%;
            height: 62px;
            object-fit: cover;
            border-radius: 12px;
            border: 1px solid rgba(255, 255, 255, 0.1);
            display: block;
        }

        .transcription-title,
        .ai-title {
            font-size: 10px;
            font-weight: 700;
            letter-spacing: 0.08em;
            text-transform: uppercase;
            color: rgba(255, 255, 255, 0.5);
            margin-bottom: 6px;
        }

        .ai-title {
            margin-top: 12px;
        }

        .notes {
            flex: 0 0 auto;
            border-top: 1px solid rgba(255, 255, 255, 0.08);
            padding: 14px;
            background: linear-gradient(180deg, rgba(255, 255, 255, 0.03), rgba(0, 0, 0, 0.14));
        }

        textarea {
            width: 100%;
            min-height: 126px;
            padding: 12px 14px;
            background: rgba(255, 255, 255, 0.04);
            color: var(--text-color);
            border: 1px solid rgba(255, 255, 255, 0.12);
            border-radius: 16px;
            resize: vertical;
            font-family: inherit;
            font-size: 14px;
            backdrop-filter: blur(18px) saturate(130%);
            -webkit-backdrop-filter: blur(18px) saturate(130%);
        }

        textarea::placeholder {
            color: rgba(255, 255, 255, 0.36);
        }

        textarea:focus {
            outline: none;
            border-color: rgba(125, 211, 252, 0.44);
            box-shadow: 0 0 0 3px rgba(56, 189, 248, 0.14);
            background: rgba(255, 255, 255, 0.06);
        }

        .notes-actions {
            display: flex;
            justify-content: flex-end;
            margin-top: 10px;
            gap: 8px;
        }

        .format-select {
            background: rgba(255, 255, 255, 0.05);
            color: var(--text-color);
            border: 1px solid rgba(255, 255, 255, 0.12);
            padding: 8px 10px;
            border-radius: 12px;
            font-size: 12px;
        }

        .hidden-input {
            display: none;
        }

        :host-context(.side-dock-layout) {
            width: 100%;
            min-width: 0;
            background: transparent;
            border-left: 0;
            backdrop-filter: none;
            -webkit-backdrop-filter: none;
        }

        :host-context(.side-dock-layout) .panel-shell {
            overflow: hidden;
            border: 1px solid rgba(255, 255, 255, 0.1);
            border-radius: 18px;
            background:
                radial-gradient(circle at top right, rgba(56, 189, 248, 0.1), transparent 34%),
                rgba(5, 12, 22, 0.3);
            box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.05);
            backdrop-filter: blur(18px) saturate(140%);
            -webkit-backdrop-filter: blur(18px) saturate(140%);
        }

        :host-context(.side-dock-layout) .topbar {
            display: grid;
            grid-template-columns: minmax(0, 1fr);
            gap: 7px;
            padding: 9px 10px 0;
        }

        :host-context(.side-dock-layout) .source-chip {
            width: fit-content;
            padding: 5px 9px;
            font-size: 9px;
            letter-spacing: 0.1em;
        }

        :host-context(.side-dock-layout) .visual-actions {
            display: grid;
            grid-template-columns: minmax(0, 1fr) auto;
            gap: 6px;
        }

        :host-context(.side-dock-layout) .ghost-button,
        :host-context(.side-dock-layout) .clear-button,
        :host-context(.side-dock-layout) .save-button {
            padding: 7px 10px;
            border-radius: 999px;
            font-size: 11px;
        }

        :host-context(.side-dock-layout) .tabs {
            display: flex;
            gap: 6px;
            overflow-x: auto;
            padding: 8px 10px 0;
            scrollbar-width: none;
        }

        :host-context(.side-dock-layout) .tabs::-webkit-scrollbar {
            display: none;
        }

        :host-context(.side-dock-layout) .tab-button {
            flex: 0 0 auto;
            padding: 7px 10px;
            border-radius: 999px;
            font-size: 11px;
            letter-spacing: 0.01em;
        }

        :host-context(.side-dock-layout) .panel-body {
            padding: 9px 10px 10px;
        }

        :host-context(.side-dock-layout) .help-list,
        :host-context(.side-dock-layout) .transcripts,
        :host-context(.side-dock-layout) .focus-form,
        :host-context(.side-dock-layout) .knowledge-list,
        :host-context(.side-dock-layout) .retrieval-list {
            gap: 8px;
        }

        :host-context(.side-dock-layout) .empty-state,
        :host-context(.side-dock-layout) .visual-card,
        :host-context(.side-dock-layout) .help-card,
        :host-context(.side-dock-layout) .transcript-item,
        :host-context(.side-dock-layout) .resource-link,
        :host-context(.side-dock-layout) .knowledge-item,
        :host-context(.side-dock-layout) .retrieval-item,
        :host-context(.side-dock-layout) .focus-toggle {
            border-radius: 14px;
            background: rgba(255, 255, 255, 0.04);
        }

        :host-context(.side-dock-layout) .empty-state,
        :host-context(.side-dock-layout) .help-card,
        :host-context(.side-dock-layout) .visual-card,
        :host-context(.side-dock-layout) .transcript-item {
            padding: 12px;
        }

        :host-context(.side-dock-layout) .primary-answer-card {
            margin-bottom: 8px;
            background: linear-gradient(180deg, rgba(14, 45, 78, 0.34), rgba(255, 255, 255, 0.035));
        }

        :host-context(.side-dock-layout) .card-header,
        :host-context(.side-dock-layout) .visual-header {
            gap: 8px;
            margin-bottom: 7px;
        }

        :host-context(.side-dock-layout) .card-title,
        :host-context(.side-dock-layout) .visual-title {
            font-size: 13px;
            line-height: 1.25;
        }

        :host-context(.side-dock-layout) .card-meta,
        :host-context(.side-dock-layout) .visual-meta,
        :host-context(.side-dock-layout) .mini-label,
        :host-context(.side-dock-layout) .focus-label,
        :host-context(.side-dock-layout) .speak-now-label {
            font-size: 9px;
        }

        :host-context(.side-dock-layout) .speak-now,
        :host-context(.side-dock-layout) .transcription,
        :host-context(.side-dock-layout) .ai-response,
        :host-context(.side-dock-layout) .visual-summary,
        :host-context(.side-dock-layout) .focus-summary,
        :host-context(.side-dock-layout) .knowledge-summary {
            font-size: 12px;
            line-height: 1.45;
        }

        :host-context(.side-dock-layout) .supporting-points {
            gap: 4px;
            margin: 8px 0;
        }

        :host-context(.side-dock-layout) .supporting-point {
            font-size: 11px;
            line-height: 1.38;
        }

        :host-context(.side-dock-layout) .resource-grid {
            grid-template-columns: 1fr;
            gap: 7px;
            margin-bottom: 8px;
        }

        :host-context(.side-dock-layout) .resource-link {
            gap: 5px;
            padding: 10px;
        }

        :host-context(.side-dock-layout) .resource-link-title {
            font-size: 12px;
        }

        :host-context(.side-dock-layout) .resource-link-host {
            font-size: 10px;
        }

        :host-context(.side-dock-layout) .context-overview {
            grid-template-columns: 86px minmax(0, 1fr);
            gap: 10px;
            margin-bottom: 8px;
        }

        :host-context(.side-dock-layout) .context-overview img {
            width: 86px;
            height: 70px;
            border-radius: 12px;
        }

        :host-context(.side-dock-layout) .context-pill {
            padding: 4px 7px;
            font-size: 9px;
        }

        :host-context(.side-dock-layout) .preview-frame,
        :host-context(.side-dock-layout) .visual-preview,
        :host-context(.side-dock-layout) .frame-grid,
        :host-context(.side-dock-layout) .context-frame-strip {
            margin-top: 8px;
        }

        :host-context(.side-dock-layout) .frame-grid {
            gap: 6px;
        }

        :host-context(.side-dock-layout) .context-frame-strip img {
            height: 50px;
            border-radius: 10px;
        }

        :host-context(.side-dock-layout) .focus-field {
            gap: 5px;
        }

        :host-context(.side-dock-layout) .focus-input,
        :host-context(.side-dock-layout) .focus-textarea {
            border-radius: 12px;
            padding: 8px 10px;
            font-size: 12px;
        }

        :host-context(.side-dock-layout) .focus-textarea {
            min-height: 86px;
        }

        :host-context(.side-dock-layout) .focus-toggle {
            padding: 10px;
        }

        :host-context(.side-dock-layout) .notes {
            padding: 8px 10px 9px;
            background: rgba(3, 9, 16, 0.3);
        }

        :host-context(.side-dock-layout) textarea {
            height: 48px;
            min-height: 48px;
            max-height: 68px;
            padding: 8px 10px;
            border-radius: 14px;
            resize: vertical;
            font-size: 12px;
            line-height: 1.4;
            background: rgba(255, 255, 255, 0.035);
        }

        :host-context(.side-dock-layout) .notes-actions {
            margin-top: 7px;
            gap: 6px;
        }

        :host-context(.side-dock-layout) .format-select {
            padding: 7px 9px;
            border-radius: 999px;
            font-size: 11px;
        }

        :host-context(.glass-frame-layout) {
            width: 100%;
            min-width: 0;
            background: transparent;
            border-left: 0;
            backdrop-filter: none;
            -webkit-backdrop-filter: none;
        }

        :host-context(.glass-frame-layout) .panel-shell {
            overflow: hidden;
            border: 1px solid rgba(255, 255, 255, 0.12);
            border-radius: 28px;
            background:
                radial-gradient(circle at top right, rgba(56, 189, 248, 0.16), transparent 30%),
                radial-gradient(circle at bottom left, rgba(20, 184, 166, 0.1), transparent 34%),
                linear-gradient(160deg, rgba(5, 12, 22, 0.58), rgba(5, 12, 22, 0.24));
            box-shadow:
                0 24px 80px rgba(0, 0, 0, 0.28),
                inset 0 1px 0 rgba(255, 255, 255, 0.08);
            backdrop-filter: blur(26px) saturate(160%);
            -webkit-backdrop-filter: blur(26px) saturate(160%);
        }

        :host-context(.glass-frame-layout) .topbar {
            display: grid;
            grid-template-columns: minmax(0, 1fr);
            gap: 8px;
            padding: 12px 12px 0;
        }

        :host-context(.glass-frame-layout) .source-chip {
            width: fit-content;
            padding: 6px 10px;
            font-size: 9px;
            letter-spacing: 0.12em;
            box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.06);
        }

        :host-context(.glass-frame-layout) .visual-actions {
            display: grid;
            grid-template-columns: minmax(0, 1fr) auto;
            gap: 7px;
        }

        :host-context(.glass-frame-layout) .ghost-button,
        :host-context(.glass-frame-layout) .clear-button,
        :host-context(.glass-frame-layout) .save-button {
            padding: 8px 11px;
            border-radius: 999px;
            font-size: 11px;
            background: rgba(255, 255, 255, 0.055);
        }

        :host-context(.glass-frame-layout) .tabs {
            display: flex;
            gap: 7px;
            overflow-x: auto;
            padding: 9px 12px 0;
            scrollbar-width: none;
        }

        :host-context(.glass-frame-layout) .tabs::-webkit-scrollbar {
            display: none;
        }

        :host-context(.glass-frame-layout) .tab-button {
            flex: 0 0 auto;
            padding: 8px 11px;
            border-radius: 999px;
            font-size: 11px;
            letter-spacing: 0.01em;
            background: rgba(255, 255, 255, 0.045);
        }

        :host-context(.glass-frame-layout) .tab-button.active {
            background: linear-gradient(135deg, rgba(14, 116, 144, 0.54), rgba(37, 99, 235, 0.24));
            border-color: rgba(125, 211, 252, 0.45);
        }

        :host-context(.glass-frame-layout) .panel-body {
            padding: 11px 12px 12px;
        }

        :host-context(.glass-frame-layout) .help-list,
        :host-context(.glass-frame-layout) .transcripts,
        :host-context(.glass-frame-layout) .focus-form,
        :host-context(.glass-frame-layout) .knowledge-list,
        :host-context(.glass-frame-layout) .retrieval-list {
            gap: 9px;
        }

        :host-context(.glass-frame-layout) .empty-state,
        :host-context(.glass-frame-layout) .visual-card,
        :host-context(.glass-frame-layout) .help-card,
        :host-context(.glass-frame-layout) .transcript-item,
        :host-context(.glass-frame-layout) .resource-link,
        :host-context(.glass-frame-layout) .knowledge-item,
        :host-context(.glass-frame-layout) .retrieval-item,
        :host-context(.glass-frame-layout) .focus-toggle {
            border-radius: 18px;
            border-color: rgba(255, 255, 255, 0.1);
            background:
                linear-gradient(145deg, rgba(255, 255, 255, 0.06), rgba(255, 255, 255, 0.025)),
                rgba(2, 6, 23, 0.16);
            box-shadow:
                0 14px 38px rgba(0, 0, 0, 0.14),
                inset 0 1px 0 rgba(255, 255, 255, 0.05);
        }

        :host-context(.glass-frame-layout) .empty-state,
        :host-context(.glass-frame-layout) .help-card,
        :host-context(.glass-frame-layout) .visual-card,
        :host-context(.glass-frame-layout) .transcript-item {
            padding: 13px;
        }

        :host-context(.glass-frame-layout) .primary-answer-card {
            margin-bottom: 9px;
            border-color: rgba(125, 211, 252, 0.22);
            background: linear-gradient(180deg, rgba(14, 45, 78, 0.38), rgba(255, 255, 255, 0.035));
        }

        :host-context(.glass-frame-layout) .card-header,
        :host-context(.glass-frame-layout) .visual-header {
            gap: 9px;
            margin-bottom: 8px;
        }

        :host-context(.glass-frame-layout) .card-title,
        :host-context(.glass-frame-layout) .visual-title {
            font-size: 13px;
            line-height: 1.25;
        }

        :host-context(.glass-frame-layout) .card-meta,
        :host-context(.glass-frame-layout) .visual-meta,
        :host-context(.glass-frame-layout) .mini-label,
        :host-context(.glass-frame-layout) .focus-label,
        :host-context(.glass-frame-layout) .speak-now-label {
            font-size: 9px;
        }

        :host-context(.glass-frame-layout) .speak-now,
        :host-context(.glass-frame-layout) .transcription,
        :host-context(.glass-frame-layout) .ai-response,
        :host-context(.glass-frame-layout) .visual-summary,
        :host-context(.glass-frame-layout) .focus-summary,
        :host-context(.glass-frame-layout) .knowledge-summary {
            font-size: 12px;
            line-height: 1.45;
        }

        :host-context(.glass-frame-layout) .supporting-points {
            gap: 4px;
            margin: 8px 0;
        }

        :host-context(.glass-frame-layout) .supporting-point {
            font-size: 11px;
            line-height: 1.38;
        }

        :host-context(.glass-frame-layout) .resource-grid {
            grid-template-columns: 1fr;
            gap: 8px;
            margin: 9px 0 0;
        }

        :host-context(.glass-frame-layout) .resource-link {
            gap: 5px;
            padding: 11px;
        }

        :host-context(.glass-frame-layout) .resource-link-title {
            font-size: 12px;
        }

        :host-context(.glass-frame-layout) .resource-link-host {
            font-size: 10px;
        }

        :host-context(.glass-frame-layout) .context-overview {
            grid-template-columns: 92px minmax(0, 1fr);
            gap: 11px;
            margin-bottom: 9px;
        }

        :host-context(.glass-frame-layout) .context-overview img {
            width: 92px;
            height: 76px;
            border-radius: 14px;
            box-shadow: 0 10px 28px rgba(0, 0, 0, 0.18);
        }

        :host-context(.glass-frame-layout) .context-pill {
            padding: 4px 8px;
            font-size: 9px;
        }

        :host-context(.glass-frame-layout) .preview-frame,
        :host-context(.glass-frame-layout) .visual-preview,
        :host-context(.glass-frame-layout) .frame-grid,
        :host-context(.glass-frame-layout) .context-frame-strip {
            margin-top: 9px;
        }

        :host-context(.glass-frame-layout) .frame-grid {
            gap: 7px;
        }

        :host-context(.glass-frame-layout) .frame-grid img,
        :host-context(.glass-frame-layout) .visual-preview img,
        :host-context(.glass-frame-layout) .preview-frame img {
            box-shadow: 0 12px 34px rgba(0, 0, 0, 0.18);
        }

        :host-context(.glass-frame-layout) .context-frame-strip img {
            height: 54px;
            border-radius: 11px;
        }

        :host-context(.glass-frame-layout) .focus-field {
            gap: 5px;
        }

        :host-context(.glass-frame-layout) .focus-input,
        :host-context(.glass-frame-layout) .focus-textarea {
            border-radius: 14px;
            padding: 9px 10px;
            font-size: 12px;
        }

        :host-context(.glass-frame-layout) .focus-textarea {
            min-height: 90px;
        }

        :host-context(.glass-frame-layout) .focus-toggle {
            padding: 10px;
        }

        :host-context(.glass-frame-layout) .notes {
            padding: 9px 12px 12px;
            background: linear-gradient(180deg, rgba(255, 255, 255, 0.025), rgba(3, 9, 16, 0.22));
        }

        :host-context(.glass-frame-layout) textarea {
            height: 52px;
            min-height: 52px;
            max-height: 80px;
            padding: 8px 10px;
            border-radius: 16px;
            resize: vertical;
            font-size: 12px;
            line-height: 1.4;
            background: rgba(255, 255, 255, 0.04);
        }

        :host-context(.glass-frame-layout) .notes-actions {
            margin-top: 8px;
            gap: 7px;
        }

        :host-context(.glass-frame-layout) .format-select {
            padding: 7px 9px;
            border-radius: 999px;
            font-size: 11px;
        }
    `;

    static properties = {
        assistantPanelTab: { type: String },
        helpCards: { type: Array },
        primaryAnswer: { type: String },
        helpResources: { type: Array },
        visualMatches: { type: Array },
        matchedKnowledge: { type: Array },
        focusConfig: { type: Object },
        focusRetrieval: { type: Object },
        knowledgeItems: { type: Array },
        sessionOptions: { type: Object },
        ffmpegAvailable: { type: Boolean },
        webIntel: { type: Object },
        importedVisualContext: { type: Object },
        latestScreenPreview: { type: Object },
        notes: { type: String },
        selectedProfile: { type: String },
        transcripts: { type: Array },
        exportFormat: { type: String },
    };

    constructor() {
        super();
        this.assistantPanelTab = 'help';
        this.helpCards = [];
        this.primaryAnswer = '';
        this.helpResources = [];
        this.visualMatches = [];
        this.matchedKnowledge = [];
        this.focusConfig = {
            jobTitle: '',
            objective: '',
            priorityTopics: '',
            guidelineText: '',
            referenceText: '',
            selectedKnowledgeIds: [],
            strictFocus: false,
            webSearchEnabled: false,
            webSearchHint: '',
        };
        this.focusRetrieval = {
            jobTitle: '',
            objective: '',
            priorityTopics: '',
            guidelineText: '',
            strictFocus: false,
            selectedKnowledgeIds: [],
            snippets: [],
            matchedKnowledgeItems: [],
            resources: [],
            visualMatches: [],
            visualSummary: '',
        };
        this.knowledgeItems = [];
        this.sessionOptions = {
            captureSystemAudio: false,
            rememberImports: false,
            videoAssistMode: 'rolling-clip',
            clipWindowSeconds: 8,
        };
        this.ffmpegAvailable = false;
        this.webIntel = null;
        this.importedVisualContext = null;
        this.latestScreenPreview = null;
        this.notes = '';
        this.selectedProfile = 'general';
        this.transcripts = [];
        this.exportFormat = 'json';
        this._importBusy = false;
        this._knowledgeUrl = '';
    }

    async _openExternalLink(url) {
        if (!url) {
            return;
        }
        if (window.electron?.openExternal) {
            await window.electron.openExternal(url);
            return;
        }
        window.open(url, '_blank', 'noopener,noreferrer');
    }

    _isHpOfficialSourcePolicy(sourcePolicy) {
        return sourcePolicy?.id === 'hp_official';
    }

    _isHpOfficialUrl(url = '') {
        try {
            const hostname = new URL(String(url || '')).hostname.toLowerCase().replace(/^www\./, '');
            return hostname === 'hp.com' || hostname.endsWith('.hp.com');
        } catch (_error) {
            return false;
        }
    }

    _isAllowedBySourcePolicy(url = '', sourcePolicy = null) {
        if (!this._isHpOfficialSourcePolicy(sourcePolicy)) {
            return true;
        }
        return this._isHpOfficialUrl(url);
    }

    _getActiveSourcePolicy() {
        return this.webIntel?.source_policy || null;
    }

    _filterLinksBySourcePolicy(items = [], sourcePolicy = this._getActiveSourcePolicy()) {
        return (Array.isArray(items) ? items : []).filter(item => this._isAllowedBySourcePolicy(item?.url || item?.sourceUrl || '', sourcePolicy));
    }

    formatResourceHost(url) {
        try {
            return new URL(url).hostname.replace(/^www\./, '');
        } catch (_error) {
            return url;
        }
    }

    getActivePreview() {
        return this.importedVisualContext?.previewDataUrl
            ? this.importedVisualContext.previewDataUrl
            : this.latestScreenPreview?.dataUrl || '';
    }

    getSourceChip() {
        if (this.importedVisualContext?.kind === 'video') {
            return { kind: 'video', label: 'Video Context' };
        }
        if (this.importedVisualContext?.kind === 'image') {
            return { kind: 'image', label: 'Image Context' };
        }
        if (this.latestScreenPreview?.dataUrl) {
            return { kind: 'screen', label: 'Live Screen' };
        }
        return { kind: 'screen', label: 'No Visual' };
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

    _setTab(tab) {
        this.assistantPanelTab = tab;
        this.dispatchEvent(
            new CustomEvent('assistant-panel-tab-change', {
                detail: { tab },
                bubbles: true,
                composed: true,
            })
        );
    }

    _openImportPicker() {
        this.renderRoot?.querySelector('#visualImportInput')?.click();
    }

    _emitVisualContextChange(context, stage = 'final') {
        this.dispatchEvent(
            new CustomEvent('visual-context-change', {
                detail: { context, stage },
                bubbles: true,
                composed: true,
            })
        );
    }

    async _onVisualImportChange(e) {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (!file || this._importBusy) {
            return;
        }

        this._importBusy = true;
        try {
            const context = await buildVisualContextFromFile(file, {
                onPreview: previewContext => {
                    this.assistantPanelTab = 'visuals';
                    this._emitVisualContextChange(previewContext, 'preview');
                },
            });
            this._emitVisualContextChange(context, 'final');
            this.assistantPanelTab = 'visuals';
        } catch (error) {
            logger.error('Failed to import visual context:', error);
        } finally {
            this._importBusy = false;
        }
    }

    _clearVisualContext() {
        this.dispatchEvent(
            new CustomEvent('visual-context-clear', {
                bubbles: true,
                composed: true,
            })
        );
    }

    _updateFocusConfig(patch) {
        this.focusConfig = {
            ...(this.focusConfig || {}),
            ...patch,
        };
        this.dispatchEvent(
            new CustomEvent('focus-config-change', {
                detail: { config: this.focusConfig },
                bubbles: true,
                composed: true,
            })
        );
    }

    _onFocusInput(key, e) {
        this._updateFocusConfig({ [key]: e.target.value });
    }

    _onStrictFocusChange(e) {
        this._updateFocusConfig({ strictFocus: e.target.checked });
    }

    _updateSessionOptions(patch) {
        this.sessionOptions = {
            ...(this.sessionOptions || {}),
            ...patch,
        };
        this.dispatchEvent(
            new CustomEvent('session-options-change', {
                detail: { options: this.sessionOptions },
                bubbles: true,
                composed: true,
            })
        );
    }

    _emitKnowledgeImportUrl() {
        if (!this._knowledgeUrl.trim()) {
            return;
        }
        this.dispatchEvent(
            new CustomEvent('knowledge-import-url', {
                detail: { url: this._knowledgeUrl.trim(), scope: 'library' },
                bubbles: true,
                composed: true,
            })
        );
        this._knowledgeUrl = '';
        this.requestUpdate();
    }

    _emitKnowledgeImportGuideline() {
        if (!this.focusConfig?.guidelineText?.trim()) {
            return;
        }
        this.dispatchEvent(
            new CustomEvent('knowledge-import-guideline', {
                detail: {
                    text: this.focusConfig.guidelineText,
                    title: this.focusConfig.jobTitle || 'Guidelines',
                    scope: 'library',
                },
                bubbles: true,
                composed: true,
            })
        );
    }

    _emitKnowledgeImportFile(kindHint = '') {
        this.dispatchEvent(
            new CustomEvent('knowledge-import-file', {
                detail: { kindHint, scope: 'library' },
                bubbles: true,
                composed: true,
            })
        );
    }

    _emitKnowledgeSelection(id, selected) {
        this.dispatchEvent(
            new CustomEvent('knowledge-selection-change', {
                detail: { id, selected },
                bubbles: true,
                composed: true,
            })
        );
    }

    _emitKnowledgeDelete(id) {
        this.dispatchEvent(
            new CustomEvent('knowledge-delete', {
                detail: { id },
                bubbles: true,
                composed: true,
            })
        );
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

    renderContextOverview() {
        const previewDataUrl = this.getActivePreview();
        const pills = [
            this.focusConfig?.jobTitle ? `FOCUS: ${this.focusConfig.jobTitle}` : '',
            this.importedVisualContext?.kind ? `${this.importedVisualContext.kind.toUpperCase()} READY` : this.latestScreenPreview?.dataUrl ? 'LIVE SCREEN' : '',
            this.focusConfig?.webSearchEnabled ? 'WEB SEARCH' : '',
        ].filter(Boolean);
        const videoFrames = this.importedVisualContext?.kind === 'video' ? this.importedVisualContext.images?.slice(0, 4) || [] : [];

        if (!previewDataUrl && !pills.length && !this.focusConfig?.objective) {
            return null;
        }

        return html`
            <div>
                <article class="visual-card context-overview">
                    ${previewDataUrl
                        ? html`<img src=${previewDataUrl} alt="Current context preview" />`
                        : html`<div class="visual-preview" style="margin-top:0;"><div style="padding:16px;" class="focus-summary">No visual preview yet</div></div>`}
                    <div class="context-overview-meta">
                        <div class="visual-title">${this.focusConfig?.objective || 'Live context ready'}</div>
                        <div class="focus-summary">
                            ${this.focusRetrieval?.visualSummary || 'The assistant will blend live turns, imported visuals, and focused references here.'}
                        </div>
                        ${this.importedVisualContext?.processing
                            ? html`<div class="context-pill processing">Processing video frames</div>`
                            : ''}
                        ${pills.length
                            ? html`<div class="context-pill-row">${pills.map(label => html`<div class="context-pill">${label}</div>`)}</div>`
                            : ''}
                    </div>
                </article>
                ${videoFrames.length > 1
                    ? html`
                          <div class="context-frame-strip">
                              ${videoFrames.map(frame => html`<img src=${frame} alt="Context frame preview" />`)}
                          </div>
                      `
                    : ''}
            </div>
        `;
    }

    renderWebIntel() {
        if (!this.webIntel?.summary) {
            return null;
        }
        const sources = this._filterLinksBySourcePolicy(this.webIntel.sources || [], this.webIntel.source_policy);

        return html`
            <article class="visual-card" style="margin-bottom: 12px;">
                <div class="visual-header">
                    <div class="visual-title">Web Intel</div>
                    <div class="visual-meta">${sources.length} source${sources.length === 1 ? '' : 's'}</div>
                </div>
                <div class="visual-summary">${this.webIntel.summary}</div>
                ${sources.length
                    ? html`
                          <div class="resource-grid">
                              ${sources.map(
                                  source => html`
                                      <a
                                          class="resource-link"
                                          href=${source.url}
                                          @click=${e => {
                                              e.preventDefault();
                                              this._openExternalLink(source.url);
                                          }}
                                      >
                                          <div class="resource-link-meta">${source.source || 'Source page'}</div>
                                          <div class="resource-link-title">${source.title}</div>
                                          <div class="resource-link-host">${this.formatResourceHost(source.url)}</div>
                                      </a>
                                  `
                              )}
                          </div>
                      `
                    : ''}
            </article>
        `;
    }

    renderResourceTiles() {
        const resources = this._filterLinksBySourcePolicy(this.helpResources);
        if (!resources.length) {
            return null;
        }

        return html`
            <article class="visual-card" style="margin-bottom: 12px;">
                <div class="visual-header">
                    <div class="visual-title">Helpful Links</div>
                    <div class="visual-meta">${resources.length}</div>
                </div>
                <div class="resource-grid">
                    ${resources.map(
                        resource => html`
                            <a
                                class="resource-link"
                                href=${resource.url}
                                @click=${e => {
                                    e.preventDefault();
                                    this._openExternalLink(resource.url);
                                }}
                            >
                                <div class="resource-link-meta">${resource.reason || resource.kind || 'resource'}</div>
                                <div class="resource-link-title">${resource.title}</div>
                                <div class="resource-link-host">${this.formatResourceHost(resource.url)}</div>
                            </a>
                        `
                    )}
                </div>
            </article>
        `;
    }

    renderVisualMatches() {
        const matches = Array.isArray(this.visualMatches) ? this.visualMatches : [];
        if (!matches.length) {
            return null;
        }

        return html`
            <article class="visual-card" style="margin-bottom: 12px;">
                <div class="visual-header">
                    <div class="visual-title">Visual Matches</div>
                    <div class="visual-meta">${matches.length}</div>
                </div>
                <div class="frame-grid">
                    ${matches.map(
                        match => html`
                            <div>
                                <img src=${match.url} alt=${match.title || 'Visual match'} />
                                <div class="mini-label" style="margin-top: 6px;">${match.title}</div>
                            </div>
                        `
                    )}
                </div>
            </article>
        `;
    }

    renderMatchedKnowledge() {
        const items = Array.isArray(this.matchedKnowledge) ? this.matchedKnowledge : [];
        if (!items.length) {
            return null;
        }

        return html`
            <article class="visual-card" style="margin-bottom: 12px;">
                <div class="visual-header">
                    <div class="visual-title">Matched Knowledge</div>
                    <div class="visual-meta">${items.length}</div>
                </div>
                <div class="retrieval-list">
                    ${items.map(
                        item => html`
                            <div class="retrieval-item">
                                <div class="card-title" style="font-size: 13px; margin-bottom: 6px;">${item.title}</div>
                                <div class="focus-summary">${item.summary || item.kind}</div>
                                ${item.reason ? html`<div class="mini-label" style="margin-top: 8px;">${item.reason}</div>` : ''}
                            </div>
                        `
                    )}
                </div>
            </article>
        `;
    }

    renderPrimaryAnswer() {
        if (!this.primaryAnswer) {
            return null;
        }

        return html`
            <article class="help-card primary-answer-card">
                <div class="card-header">
                    <div class="card-title">Instant Answer</div>
                    <div class="card-meta">Live brief</div>
                </div>
                <div class="speak-now">${this.primaryAnswer}</div>
            </article>
        `;
    }

    renderHelpCards() {
        if (!this.helpCards.length && !this.primaryAnswer && !this.webIntel?.summary) {
            return html`
                <div class="empty-state">
                    Ask a question or import an image/video to generate live help. Manual refresh still uses <strong>Cmd/Ctrl+Enter</strong>.
                </div>
            `;
        }

        const previewDataUrl = this.getActivePreview();
        return html`
            <div class="help-list">
                ${this.renderPrimaryAnswer()}
                ${this.renderContextOverview()}
                ${this.renderWebIntel()}
                ${this.renderResourceTiles()}
                ${this.renderVisualMatches()}
                ${this.renderMatchedKnowledge()}
                ${this.helpCards.slice(0, 5).map(
                    card => html`
                        <article class="help-card" data-confidence=${card.confidence || 'medium'}>
                            <div class="card-header">
                                <div class="card-title">${card.title}</div>
                                <div class="card-meta">${card.confidence || 'medium'} confidence</div>
                            </div>
                            <div class="speak-now-label">Speak Now</div>
                            <div class="speak-now">${card.speak_now}</div>
                            ${card.supporting_points?.length
                                ? html`
                                          <div class="supporting-points">
                                              ${card.supporting_points.map(
                                              point => html`<div class="supporting-point">- ${point}</div>`
                                          )}
                                      </div>
                                  `
                                : ''}
                            <div class="card-meta">${card.source_context || 'context'}</div>
                            ${card.show_visual && previewDataUrl
                                ? html`
                                      <div class="preview-frame">
                                          <img src=${previewDataUrl} alt="Visual context preview" />
                                      </div>
                                  `
                                : ''}
                        </article>
                    `
                )}
            </div>
        `;
    }

    renderTranscripts() {
        if (!this.transcripts.length) {
            return html`
                <div class="empty-state">
                    Transcript turns will appear here once the live session starts receiving speech or typed questions.
                </div>
            `;
        }

        return html`
            <div class="transcripts">
                ${this.transcripts.map(
                    item => html`
                        <article class="transcript-item">
                            <div class="transcription-title">User</div>
                            <div class="transcription">${item.transcription}</div>
                            ${item.ai_response
                                ? html`
                                      <div class="ai-title">Assistant</div>
                                      <div class="ai-response">${item.ai_response}</div>
                                  `
                                : ''}
                        </article>
                    `
                )}
            </div>
        `;
    }

    renderVisuals() {
        const visual = this.importedVisualContext;
        if (!visual) {
            if (this.latestScreenPreview?.dataUrl) {
                return html`
                    <article class="visual-card">
                        <div class="visual-header">
                            <div class="visual-title">Live Screen Context</div>
                            <div class="visual-meta">screen</div>
                        </div>
                        <div class="visual-summary">Realtime screen frames are active. Import an image or video if you want help tied to local media.</div>
                        <div class="visual-preview">
                            <img src=${this.latestScreenPreview.dataUrl} alt="Live screen preview" />
                        </div>
                    </article>
                `;
            }
            return html`
                <div class="empty-state">
                    Import a product photo, schematic screenshot, interview slide, repair image, or a short local video. Video files are sampled into
                    multiple frames and sent to OpenAI as visual context.
                </div>
            `;
        }

        return html`
            <article class="visual-card">
                <div class="visual-header">
                    <div class="visual-title">${visual.label || visual.fileName || 'Visual context'}</div>
                    <div class="visual-meta">${visual.kind} - ${visual.frameCount || visual.images?.length || 0} frame${(visual.frameCount || 0) === 1 ? '' : 's'}</div>
                </div>
                ${visual.processing ? html`<div class="context-pill processing">Processing video frames</div>` : ''}
                <div class="visual-summary">${visual.summary || 'Visual context ready for OpenAI help cards.'}</div>
                ${visual.previewDataUrl
                    ? html`
                          <div class="visual-preview">
                              <img src=${visual.previewDataUrl} alt="Imported visual preview" />
                          </div>
                      `
                    : ''}
                ${visual.kind === 'video' && visual.images?.length > 1
                    ? html`
                          <div class="mini-label" style="margin-top: 12px;">Sampled Frames</div>
                          <div class="frame-grid">
                              ${visual.images.slice(0, 4).map(frame => html`<img src=${frame} alt="Sampled video frame" />`)}
                          </div>
                      `
                    : ''}
            </article>
        `;
    }

    renderFocusTab() {
        const retrievalSnippets = Array.isArray(this.focusRetrieval?.snippets) ? this.focusRetrieval.snippets : [];
        return html`
            <div class="focus-form">
                <div class="focus-field">
                    <div class="focus-label">Role / Purpose</div>
                    <input
                        class="focus-input"
                        .value=${this.focusConfig?.jobTitle || ''}
                        @input=${e => this._onFocusInput('jobTitle', e)}
                        placeholder="Hardware design review, repair walkthrough, product demo, customer support escalation"
                    />
                </div>
                <div class="focus-field">
                    <div class="focus-label">Target Outcome</div>
                    <input
                        class="focus-input"
                        .value=${this.focusConfig?.objective || ''}
                        @input=${e => this._onFocusInput('objective', e)}
                        placeholder="Explain the issue clearly, diagnose the fault, close the call, explain the design"
                    />
                </div>
                <div class="focus-field">
                    <div class="focus-label">Priority Topics</div>
                    <input
                        class="focus-input"
                        .value=${this.focusConfig?.priorityTopics || ''}
                        @input=${e => this._onFocusInput('priorityTopics', e)}
                        placeholder="PCIe bring-up, DDR timing, CAN bus, objections"
                    />
                </div>
                <div class="focus-field">
                    <div class="focus-label">Guidelines</div>
                    <textarea
                        class="focus-textarea"
                        .value=${this.focusConfig?.guidelineText || ''}
                        @input=${e => this._onFocusInput('guidelineText', e)}
                        placeholder="Preferred wording, do/don't say rules, escalation rules, tone constraints."
                    ></textarea>
                </div>
                <div class="focus-field">
                    <div class="focus-label">Reference Pack</div>
                    <textarea
                        class="focus-textarea"
                        .value=${this.focusConfig?.referenceText || ''}
                        @input=${e => this._onFocusInput('referenceText', e)}
                        placeholder="Paste job descriptions, resume bullets, repair notes, product facts, SOPs, or architecture guidance."
                    ></textarea>
                </div>
                <div class="focus-toggle">
                    <div>
                        <div class="focus-label">Strict Focus</div>
                        <div class="focus-summary">Keep answers anchored to the retrieved references and current visuals.</div>
                    </div>
                    <input type="checkbox" .checked=${Boolean(this.focusConfig?.strictFocus)} @change=${this._onStrictFocusChange} />
                </div>
                <div class="focus-toggle">
                    <div>
                        <div class="focus-label">Web Search</div>
                        <div class="focus-summary">Pull in current external info when the turn needs freshness or verification.</div>
                    </div>
                    <input
                        type="checkbox"
                        .checked=${Boolean(this.focusConfig?.webSearchEnabled)}
                        @change=${e => this._updateFocusConfig({ webSearchEnabled: e.target.checked })}
                    />
                </div>
                <div class="focus-field">
                    <div class="focus-label">Search Hint</div>
                    <input
                        class="focus-input"
                        .value=${this.focusConfig?.webSearchHint || ''}
                        @input=${e => this._onFocusInput('webSearchHint', e)}
                        placeholder="company name, hardware standard, competitor set, product category"
                    />
                </div>
                <div class="focus-toggle">
                    <div>
                        <div class="focus-label">System Audio</div>
                        <div class="focus-summary">Mix shared-screen audio with the microphone when the platform allows it.</div>
                    </div>
                    <input
                        type="checkbox"
                        .checked=${Boolean(this.sessionOptions?.captureSystemAudio)}
                        @change=${e => this._updateSessionOptions({ captureSystemAudio: e.target.checked })}
                    />
                </div>
                <div class="focus-toggle">
                    <div>
                        <div class="focus-label">Remember Imports</div>
                        <div class="focus-summary">Persist imported visuals into the local knowledge library automatically.</div>
                    </div>
                    <input
                        type="checkbox"
                        .checked=${Boolean(this.sessionOptions?.rememberImports)}
                        @change=${e => this._updateSessionOptions({ rememberImports: e.target.checked })}
                    />
                </div>
                <div class="focus-field">
                    <div class="focus-label">Video Assist</div>
                    <select
                        class="focus-input"
                        .value=${this.sessionOptions?.videoAssistMode || 'rolling-clip'}
                        @change=${e => this._updateSessionOptions({ videoAssistMode: e.target.value })}
                    >
                        <option value="rolling-clip">Rolling clip assist</option>
                        <option value="imported">Imported visuals only</option>
                        <option value="off">Off</option>
                    </select>
                    <div class="focus-summary">
                        ${this.ffmpegAvailable
                            ? 'FFmpeg clip analysis is available in this build.'
                            : 'FFmpeg clip analysis is not currently available in this build.'}
                    </div>
                </div>
                <div class="focus-summary">
                    ${Array.isArray(this.focusConfig?.selectedKnowledgeIds) && this.focusConfig.selectedKnowledgeIds.length
                        ? `${this.focusConfig.selectedKnowledgeIds.length} remembered knowledge item(s) are attached to this task.`
                        : 'No remembered knowledge items are attached yet.'}
                </div>

                <div class="visual-card">
                    <div class="visual-header">
                        <div class="visual-title">Live Retrieval</div>
                        <div class="visual-meta">${retrievalSnippets.length} snippet${retrievalSnippets.length === 1 ? '' : 's'}</div>
                    </div>
                    <div class="focus-summary">
                        ${this.focusRetrieval?.visualSummary
                            ? `Visual summary: ${this.focusRetrieval.visualSummary}`
                            : 'Retrieved snippets from the reference pack will appear here after a turn is processed.'}
                    </div>
                    ${retrievalSnippets.length
                        ? html`
                              <div class="retrieval-list">
                                  ${retrievalSnippets.map(
                                      snippet => html`<div class="retrieval-item">${snippet.text}</div>`
                                  )}
                              </div>
                          `
                        : html`<div class="empty-state" style="margin-top: 12px;">No reference snippets have been pulled into the current turn yet.</div>`}
                </div>
            </div>
        `;
    }

    renderKnowledgeTab() {
        const knowledgeItems = Array.isArray(this.knowledgeItems) ? this.knowledgeItems : [];
        const selectedIds = new Set(this.focusConfig?.selectedKnowledgeIds || []);

        return html`
            <div class="focus-form">
                <div class="focus-field">
                    <div class="focus-label">Import Web Page</div>
                    <input
                        class="focus-input"
                        .value=${this._knowledgeUrl}
                        @input=${e => {
                            this._knowledgeUrl = e.target.value;
                            this.requestUpdate();
                        }}
                        placeholder="https://example.com/product-page"
                    />
                    <div class="notes-actions" style="justify-content:flex-start;margin-top:0;">
                        <button class="ghost-button" @click=${() => this._emitKnowledgeImportUrl()}>Save Link</button>
                        <button class="ghost-button" @click=${() => this._emitKnowledgeImportFile()}>Import File</button>
                        <button class="ghost-button" @click=${() => this._emitKnowledgeImportGuideline()}>Save Guidelines</button>
                    </div>
                </div>
                ${knowledgeItems.length
                    ? html`
                          <div class="knowledge-list">
                              ${knowledgeItems.map(
                                  item => html`
                                      <article class="knowledge-item">
                                          <div class="knowledge-item-header">
                                              <div>
                                                  <div class="knowledge-title">${item.title}</div>
                                                  <div class="mini-label">${item.kind} ${item.sourceUrl ? '• linked source' : ''}</div>
                                              </div>
                                              <label class="mini-label" style="display:flex;gap:8px;align-items:center;">
                                                  <input
                                                      type="checkbox"
                                                      .checked=${selectedIds.has(item.id)}
                                                      @change=${e => this._emitKnowledgeSelection(item.id, e.target.checked)}
                                                  />
                                                  Attach
                                              </label>
                                          </div>
                                          <div class="knowledge-summary">${item.summary || 'No summary yet.'}</div>
                                          <div class="knowledge-item-actions">
                                              <button
                                                  class="ghost-button"
                                                  ?disabled=${!(item.sourceUrl || item.assetUrl)}
                                                  @click=${() => (item.sourceUrl || item.assetUrl) && this._openExternalLink(item.sourceUrl || item.assetUrl)}
                                              >
                                                  Open
                                              </button>
                                              <button class="clear-button" @click=${() => this._emitKnowledgeDelete(item.id)}>Delete</button>
                                          </div>
                                      </article>
                                  `
                              )}
                          </div>
                      `
                    : html`<div class="empty-state">Save links, visuals, or guidelines here to make them retrievable across sessions.</div>`}
            </div>
        `;
    }

    render() {
        const source = this.getSourceChip();

        return html`
            <div class="panel-shell">
                <div class="topbar">
                    <div class="source-chip" data-kind=${source.kind}>${source.label}</div>
                    <div class="visual-actions">
                        <button class="ghost-button" @click=${this._openImportPicker}>Import media</button>
                        <button class="clear-button" @click=${this._clearVisualContext} ?disabled=${!this.importedVisualContext}>
                            Clear
                        </button>
                    </div>
                    <input
                        id="visualImportInput"
                        class="hidden-input"
                        type="file"
                        accept="image/*,video/*"
                        @change=${this._onVisualImportChange}
                    />
                </div>

                <div class="tabs">
                    <button class="tab-button ${this.assistantPanelTab === 'help' ? 'active' : ''}" @click=${() => this._setTab('help')}>
                        Help
                    </button>
                    <button
                        class="tab-button ${this.assistantPanelTab === 'transcript' ? 'active' : ''}"
                        @click=${() => this._setTab('transcript')}
                    >
                        Transcript
                    </button>
                    <button class="tab-button ${this.assistantPanelTab === 'visuals' ? 'active' : ''}" @click=${() => this._setTab('visuals')}>
                        Visuals
                    </button>
                    <button class="tab-button ${this.assistantPanelTab === 'knowledge' ? 'active' : ''}" @click=${() => this._setTab('knowledge')}>
                        Knowledge
                    </button>
                    <button class="tab-button ${this.assistantPanelTab === 'task' ? 'active' : ''}" @click=${() => this._setTab('task')}>
                        Task
                    </button>
                </div>

                <div class="panel-body">
                    ${this.assistantPanelTab === 'help'
                        ? this.renderHelpCards()
                        : this.assistantPanelTab === 'transcript'
                          ? this.renderTranscripts()
                          : this.assistantPanelTab === 'visuals'
                            ? this.renderVisuals()
                            : this.assistantPanelTab === 'knowledge'
                              ? this.renderKnowledgeTab()
                              : this.renderFocusTab()}
                </div>

                <div class="notes">
                    <textarea .value=${this.notes} @input=${this._onNotesChange} placeholder="Notes..."></textarea>
                    <div class="notes-actions">
                        <select class="format-select" .value=${this.exportFormat} @change=${this._onFormatChange}>
                            <option value="json">JSON</option>
                            <option value="markdown">Markdown</option>
                        </select>
                        <button class="save-button" @click=${this._onSaveSession}>Save session</button>
                    </div>
                </div>
            </div>
        `;
    }
}

customElements.define('side-panel', SidePanel);
