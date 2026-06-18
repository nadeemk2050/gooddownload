# TubeSprint Local (Laptop Version)

A streamlined, private YouTube downloader designed to run purely on your local machine. This setup bypasses cloud blocks and ensures maximum privacy.

## How to Run

1. **Install dependencies** (first time only):
   ```bash
   npm install
   ```

2. **Start the application**:
   ```bash
   npm run dev
   ```

This will automatically start:
- **Backend Engine**: `http://localhost:4000` (Powered by yt-dlp)
- **Frontend UI**: `http://localhost:5173`

## Features

- **No Cloud Blocks**: Uses your own internet connection, avoiding bot detection.
- **Smart Save**: Allows you to pick a folder on your laptop once, and save videos there with one click (Chrome/Edge recommended).
- **Quality Selection**: Choose between multiple video and audio formats.
- **PWA Ready**: You can "Install" the app from the browser to have it on your taskbar like a real application.

## Troubleshooting

If the "Analyze" button isn't working:
- Ensure `npm run dev` is still running in your terminal.
- Check that your laptop has a stable internet connection.
- YouTube occasionally updates its layout; restarting the app usually picks up any needed updates for the `yt-dlp` engine.

## Usage Note

Use this tool only for personal content or where you have explicit permission to download.
