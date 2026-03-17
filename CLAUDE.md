# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**SF Peek** is a Chrome Extension (Manifest V3) for Salesforce administrators and developers. It provides quick access to metadata, SOQL query execution, ER diagram visualization, and file management — all running locally in the browser with zero external server communication.

## Build Commands

```bash
# Rebuild Tailwind CSS after modifying src/input.css or adding new Tailwind classes
npx tailwindcss -i ./src/input.css -o ./assets/output.css

# Watch mode during development
npx tailwindcss -i ./src/input.css -o ./assets/output.css --watch
```

There is no bundler or transpilation step — the extension runs vanilla JavaScript directly. To test, load the extension in Chrome via `chrome://extensions` → "Load unpacked" and point to the repo root.

## Architecture

### Entry Points

| File | Role |
|------|------|
| `popup.html` / `popup.js` | Main 700×600px popup UI with 6 tabs |
| `er.html` / `er.js` | Full-page ER diagram viewer (opened in new tab) |
| `files.html` / `files.js` | Full-page file search & batch download UI |
| `api.js` | Shared session management and Salesforce REST API layer |

### Shared API Layer (`api.js`)

All Salesforce communication flows through `api.js`:
- `getSalesforceSession()` — extracts Bearer token from browser cookies (`sid` cookie on `*.salesforce.com` / `*.force.com`)
- `sfApiGet(domain, path, sessionId)` — authenticated REST API wrapper (`/services/data/v60.0/*`)
- `testSalesforceApi()` — validates connectivity; called on popup open
- `fetchBackgroundLogic()` — Tooling API queries for Apex Triggers, Validation Rules, Workflows, Flows
- `localizeUI()` — applies `_locales/` i18n strings to the DOM

### Popup Tabs (`popup.js`)

Six tabs initialized via dedicated `init*` functions:
1. **Objects & Fields** (`initObjectReference`) — browse objects, describe fields, CSV export
2. **Field Viewer** (`initCurrentRecordViewer`) — fields of the currently open Salesforce record
3. **SOQL Runner** (`initSoqlRunner`) — execute queries; history persisted in `chrome.storage.local`
4. **Mini ER Diagram** (`initErGenerator`) — inline relationship preview, opens `er.html` for full view
5. **Background Logic** (`initBackgroundLogicViewer`) — triggers/validation rules/workflows/flows
6. **File Search** (`initAdminShortcuts` / files tab) — search ContentDocument; opens `files.html`

Auto-detection of the current Lightning object runs on popup load by inspecting the active tab URL.

### ER Diagram (`er.js`)

Uses absolute-positioned DOM nodes on a canvas with a world coordinate system. SVG lines connect related objects. Supports drag-and-drop node repositioning, zoom/pan (mouse wheel + drag), and distinguishes master-detail vs. lookup relationships.

### Styling

Tailwind CSS compiled from `src/input.css` → `assets/output.css`. Custom ER diagram styles are also in `output.css`. When adding new Tailwind classes, rebuild CSS.

### Localization

Bilingual (English / Japanese). Locale files: `_locales/en/messages.json`, `_locales/ja/messages.json`. The `localizeUI()` function in `api.js` replaces DOM elements marked with `data-i18n` attributes.

### Permissions

`manifest.json` declares: `cookies`, `storage`, `activeTab`. Host permissions are restricted to `*.force.com` and `*.salesforce.com`.
