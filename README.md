# Suno MP3 Downloader

A Chrome/Brave browser extension that lets you bulk-download your MP3s from [Suno.com](https://suno.com) in one click — no more right-clicking and saving songs one at a time.

## Why This Exists

If you use Suno to create music, you've probably run into this: you've generated dozens (or hundreds) of tracks, and there's no built-in way to download them all at once. You're stuck clicking through each song individually, waiting for the download, renaming the file, and repeating.

This extension fixes that. Open your Suno library, click **Scan**, and it finds every song on the page. Click **Download All** and they're saved to your computer with clean, numbered filenames. That's it.

## What It Does

- **Auto-discovers songs** by intercepting Suno's own API responses as you browse — no scraping, no guessing
- **Auto-scrolls your library** to load every song, not just what's visible on screen
- **Bulk downloads** all discovered MP3s with configurable concurrency (1–10 simultaneous downloads)
- **Custom naming** — set a template like `mysong-###` and get `mysong-001.mp3`, `mysong-002.mp3`, etc.
- **Subfolder support** — save directly into a named folder inside your Downloads directory
- **Remembers your settings** between sessions

## Install

This is an unpacked extension (not on the Chrome Web Store). It works in Chrome, Brave, Edge, and any Chromium-based browser.

1. **Download or clone** this repository:
   ```
   git clone https://github.com/cyburdine/suno-downloader.git
   ```

2. Open your browser and go to `chrome://extensions` (or `brave://extensions`)

3. Enable **Developer mode** (toggle in the top-right corner)

4. Click **Load unpacked**

5. Select the `suno-downloader/` folder inside this repo (the one containing `manifest.json`)

6. You'll see the extension icon in your toolbar — you're ready to go

## How to Use

1. Go to [suno.com](https://suno.com) and navigate to your library or any page with songs

2. Click the extension icon to open the popup

3. Click **Scan Page** — the extension will:
   - Clear any previously loaded data
   - Refresh the page
   - Wait for it to fully load
   - Scroll through the entire page to trigger lazy-loading
   - Capture every song it finds

4. Configure your download settings:
   - **Naming Template** — use `###` where you want the track number (e.g., `my-album-###` → `my-album-001.mp3`)
   - **Subfolder** — optional folder name inside your Downloads directory
   - **Concurrent Downloads** — how many files download at the same time (3–5 recommended)

5. Click **Download All**

### Tip: Skip Download Prompts

If Chrome asks you to confirm each file, go to `chrome://settings/downloads` and disable **"Ask where to save each file before downloading"**. The extension will remind you about this too.

## How It Works (Under the Hood)

The extension uses three components that talk to each other:

1. **API Interceptor** — runs in the page context and captures Suno's API responses (song metadata and audio URLs) as they happen naturally while you browse
2. **Content Script** — bridges data from the page to the extension and handles the auto-scroll logic
3. **Background Service Worker** — stores discovered songs, deduplicates them by ID, and manages the download queue with concurrency control

No data is sent anywhere. Everything stays local in your browser.

## Permissions

| Permission | Why |
|---|---|
| `downloads` | To save MP3 files to your computer |
| `activeTab` / `tabs` | To interact with the Suno tab (reload, scroll, detect page load) |
| `scripting` | To inject the API interceptor into Suno pages |
| `storage` | To remember your naming template and download settings |
| `host_permissions` (suno.com) | To run on Suno pages |

## License

MIT — see [LICENSE](LICENSE) for details.
