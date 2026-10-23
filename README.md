# WA Bulk Custom Sender — Chrome Extension (Manifest V3)

A lightweight, zero-dependency Chrome Extension (Manifest V3) that automates sending personalized bulk WhatsApp messages on [WhatsApp Web](https://web.whatsapp.com/) directly from **Excel (`.xlsx`)** or **CSV (`.csv` / `.tsv`)** files using dynamic column placeholders.

## GitHub Repository "About" Description & Topics

* **Short Description (for GitHub "About" sidebar)**:

  > Chrome Extension (Manifest V3) to send personalized bulk WhatsApp Web messages from Excel (.xlsx) and CSV files using dynamic `{{column}}` placeholders, smart contact search, and anti-ban throttling.

* **Suggested GitHub Topics**:
  `chrome-extension` `manifest-v3` `whatsapp-web` `bulk-messaging` `xlsx-parser` `csv-parser` `javascript` `automation`

## Key Features

* **Zero-Dependency Excel & CSV Parsing**: Reads `.xlsx`, `.csv`, and `.tsv` files natively in the browser (`DecompressionStream` + `DOMParser`) without external CDN scripts, fully complying with Manifest V3 Content Security Policy.

* **Dynamic Column Placeholders**: Automatically extracts every column header from your spreadsheet (such as `{{Name}}`, `{{Phone}}`, `{{Company}}`, or any custom column) and provides one-click placeholder chips with a live message preview.

* **3-Stage Contact Navigation**:

  * Searches contacts in the WhatsApp Web search bar by your chosen primary column (e.g., Phone or Name).

  * Automatically falls back to a secondary column (e.g., Name) if the primary query is not found.

  * Supports direct phone number chat links (`web.whatsapp.com/send?phone=...`) with configurable **Default Country Code** formatting for unsaved numbers and Excel-stripped leading zeros.

* **Lexical Editor Synchronization**: Interacts cleanly with WhatsApp Web's Lexical composer (`data-lexical-editor="true"`), safely overwriting any existing chat drafts in-place and supporting multi-line messages without breaking internal editor state.

* **Single-Send Lock & Anti-Ban Throttling**: Uses a per-campaign `runId` lock, per-contact processed tracking, configurable randomized min/max delays between messages, and **Pause / Resume / Stop** controls.

* **Side Panel & Draggable In-Page Status Pill**: Pins to Chrome's Side Panel so campaigns continue uninterrupted, displays a mouse-draggable status bar directly inside WhatsApp Web, and exports a timestamped **CSV Delivery Report**.

## Project Structure

| File | Purpose | 
| ----- | ----- | 
| `manifest.json` | Chrome Extension Manifest V3 configuration, permissions, and content script declarations | 
| `popup.html` / `popup.css` | Extension Popup and Chrome Side Panel user interface | 
| `popup.js` | State management, column auto-detection, live template interpolation preview, and CSV report export | 
| `xlsx_csv_parser.js` | Native browser parser for `.xlsx` (ZIP Central Directory + XML) and `.csv`/`.tsv` files | 
| `content.js` | WhatsApp Web DOM automation engine, Lexical composer handler, and draggable floating status bar | 
| `background.js` | Manifest V3 Service Worker coordinating commands and tab lifecycle | 
| `sample_contacts.xlsx` / `.csv` | Sample contact spreadsheets for immediate testing | 

## Installation

1. Clone or download this repository (or extract `whatsapp_bulk_sender_extension.zip`) to a folder on your computer.

2. Open Google Chrome and navigate to `chrome://extensions/`.

3. Enable **Developer mode** using the toggle in the top-right corner.

4. Click **Load unpacked** in the top-left corner and select the extension folder.

5. Open [WhatsApp Web](https://web.whatsapp.com/) and log in.

## How to Use

1. **Upload Contacts**: Click the **WA Bulk Custom Sender** icon in your Chrome toolbar (click **Pin Panel** to dock it to the Chrome Side Panel) and upload an `.xlsx` or `.csv` file.

2. **Select Search Columns**: Choose your primary search column (e.g., `Phone` or `number`) and optional fallback column (e.g., `Name`).

3. **Compose Your Custom Message**: Click any generated `{{column}}` chip to insert placeholders into your template and verify the output in the **Live Preview** box.

4. **Configure Loop Options**: Choose your navigation mode, set your **Default Country Code** (e.g., `880`), and set the randomized **Min / Max Delay** (in seconds) between messages.

5. **Run & Monitor**: Click **Start Bulk Sending**. You can drag the green in-page status bar anywhere on WhatsApp Web with your mouse, pause/resume/stop at any time, and click **Download Report CSV** when complete.

## Disclaimer

This extension is built for legitimate, permission-based customer communication and personal productivity. Always respect [WhatsApp's Terms of Service](https://www.whatsapp.com/legal/terms-of-service) and use reasonable delay intervals between messages.
