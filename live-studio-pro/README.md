# 🎬 Live Studio Pro - Cloud Edition

A professional-grade, browser-based streaming studio with server-side processing, real-time graphics, and seamless layer management.

## ✨ Key Features
- **Grand Mixer Architecture**: Dual-process engine (Ingest + Mixer) that allows updating graphics without restarting or resetting the video content.
- **Smart Resumption**: Automatically continues video from the exact last timestamp if a restart is needed.
- **Arabic Text Support**: Fully integrated Arabic font rendering with support for news tickers and overlays.
- **Real-time Layers**: Add, move, and scale images and text overlays live on air.
- **Multi-Destination Streaming**: Push to YouTube, Facebook, and local recording simultaneously using FFmpeg Tee.
- **Cloud-Ready**: Portable code structure designed for VPS or Node.js hosting environments.

## 🚀 Getting Started

### 1. Prerequisites
- **Node.js** (v18 or higher)
- **FFmpeg** (Included via `ffmpeg-static` for simple setups, or pre-installed on your server)

### 2. Installation
```bash
git clone https://github.com/YOUR_USERNAME/live-studio-pro.git
cd live-studio-pro
npm install
```

### 3. Font Setup (Recommended)
For best results across all operating systems, place your preferred `.ttf` font file (e.g., `Arial.ttf`) in the `public/fonts/` directory. The server will automatically detect and use it.

### 4. Running the Studio
```bash
npm start
```
The studio will be available at `http://localhost:3000`.

## 📂 Project Structure
- `server.js`: The core streaming engine and API.
- `public/`: Frontend dashboard and assets.
- `public/records/`: Local recordings are saved here.
- `public/fonts/`: Cross-platform font storage.

## 🌐 Deployment
To host this on a VPS (like Ubuntu):
1. Install Node.js and FFmpeg: `sudo apt install ffmpeg nodejs`.
2. Upload the files.
3. Run with a process manager like PM2: `pm2 start server.js --name studio`.

## ⚖️ License
ISC License - Open to all.

---
Developed with ❤️ for professional broadcasters.
