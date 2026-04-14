/**
 * Live Studio Pro - Firebase Edition
 * Server-Side Streaming Engine
 * Streams 24/7 from Firebase/URL sources without requiring the browser
 */

const express = require('express');
const http = require('http');
const { spawn } = require('child_process');
const path = require('path');
const cors = require('cors');
const os = require('os');
const fs = require('fs');

let ffmpegPath = 'ffmpeg';
try {
    ffmpegPath = require('ffmpeg-static');
} catch (e) {
    console.warn("ffmpeg-static not found, falling back to global ffmpeg.");
}

if (!fs.existsSync(path.join(__dirname, 'public', 'records'))) {
    fs.mkdirSync(path.join(__dirname, 'public', 'records'), { recursive: true });
}
if (!fs.existsSync(path.join(__dirname, 'public', 'fonts'))) {
    fs.mkdirSync(path.join(__dirname, 'public', 'fonts'), { recursive: true });
}

/**
 * Get a valid font path for drawtext
 */
function getFontPath() {
    // 1. Check for bundled font in public/fonts
    const bundledPath = path.join(__dirname, 'public', 'fonts', 'Arial.ttf');
    if (fs.existsSync(bundledPath)) {
        // FFmpeg on Windows needs escaped colons and backslashes
        return bundledPath.replace(/\\/g, '/').replace(/:/g, '\\:');
    }
    
    // 2. Fallback to Windows default if exists
    const winPath = 'C:/Windows/Fonts/Arial.ttf';
    if (fs.existsSync(winPath)) {
        return winPath.replace(/:/g, '\\:');
    }
    
    // 3. Fallback for Linux (common paths)
    const linuxPath = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf';
    if (fs.existsSync(linuxPath)) return linuxPath;

    return 'Arial'; // Last resort: let FFmpeg try to find it in system path
}

const app = express();
const server = http.createServer(app);

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ============================================================
// STREAM STATE - Persists independently of browser connections
// ============================================================
// Let's use two processes for professional mixing
let ingestProcess = null; // Playlist manager
let mixerProcess = null;  // Graphics/Broadcast mixer

const streamState = {
    isLive: false,
    currentIndex: 0,
    playlist: [],
    destinations: [],
    overlayText: '',
    recordStream: false,
    recordFilename: null,
    isRecording: false,
    startTime: null,
    currentTime: 0,
    lastKnownTime: 0,
    restartRequested: false,
    currentItem: null,
    error: null,
    log: [],
    lastScheduledTime: null,
    layers: []
};

// ============================================================
// FFmpeg HELPERS
// ============================================================

/**
 * Detect optimal FFmpeg flags based on source format
 */
function getInputFlags(url) {
    const lowerUrl = url.toLowerCase();
    // HLS (.m3u8) or RTMP are already real-time streams
    if (lowerUrl.includes('.m3u8') || lowerUrl.startsWith('rtmp')) {
        return ['-i', url];
    }
    // Regular files (mp4, mkv, mov, avi, ts, webm) MUST be throttled to real-time
    return ['-re', '-i', url];
}

/**
 * Build Ingest (Source) FFmpeg args
 * Pushes raw content to local UDP
 */
function buildIngestArgs(url) {
    const inputFlags = getInputFlags(url);
    return [
        ...inputFlags,
        '-c', 'copy',
        '-f', 'mpegts',
        'udp://127.0.0.1:9999?pkt_size=1316'
    ];
}

/**
 * Build Mixer (Output) FFmpeg args
 * Reads from UDP, adds layers, and pushes to final destinations
 */
function buildMixerArgs(destinations, config) {
    const { bitrate = 2500, fps = 30, resolution = '1280x720', layers = [], recordStream = false, recordFilename = null, overlayText = "" } = config;
    const [w, h] = resolution.split('x');

    const activeLayers = layers.filter(l => l.visible !== false) || [];
    const imageLayers = activeLayers.filter(l => l.type === 'image' && l.content);
    const textLayers = activeLayers.filter(l => l.type === 'text' && l.content);

    const extraInputs = [];
    imageLayers.forEach(l => {
        extraInputs.push('-i', l.content);
    });

    let filterStr = `[0:v]scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2,setsar=1[v_base]`;
    let lastLabel = 'v_base';

    imageLayers.forEach((layer, idx) => {
        const inputIdx = idx + 1;
        const outLabel = `v_img_${idx}`;
        const xVal = Math.round(layer.x * w) || 0;
        const yVal = Math.round(layer.y * h) || 0;
        const scaleW = layer.w ? Math.round(layer.w * w) : -1;
        filterStr += `; [${inputIdx}:v]scale=${scaleW}:-1[img_${idx}] ; [${lastLabel}][img_${idx}]overlay=x=${xVal}:y=${yVal}[${outLabel}]`;
        lastLabel = outLabel;
    });

    textLayers.forEach((layer, idx) => {
        const outLabel = `v_txt_${idx}`;
        const cleanText = (layer.content || "").replace(/'/g, "").replace(/:/g, "\\:");
        const size = layer.size || 24;
        const color = layer.color || 'white';
        const bgColor = layer.bgColor || 'black';
        const bgAlpha = layer.bgOpacity !== undefined ? layer.bgOpacity : 0.6;
        let xVal = Math.round(layer.x * w) || 0;
        const yVal = Math.round(layer.y * h) || 0;
        if (layer.ticker) {
            const speed = layer.speed || 100;
            xVal = `w-mod(t*${speed},w+tw)`;
        }
        const fontPath = getFontPath();
        filterStr += `; [${lastLabel}]drawtext=text='${cleanText}':fontfile='${fontPath}':fontcolor=${color}:fontsize=${size}:box=1:boxcolor='${bgColor}@${bgAlpha}':boxborderw=10:x=${xVal}:y=${yVal}[${outLabel}]`;
        lastLabel = outLabel;
    });

    let destList = [...destinations];
    if (recordStream && recordFilename) {
        destList.push(`public/records/${recordFilename}`);
    }

    let outputParams = [];
    if (destList.length > 1) {
        const teeOutputs = destList.map(dest => `[f=flv]${dest}`).join('|');
        filterStr += `; [${lastLabel}]copy[v_final]`;
        outputParams = ['-f', 'tee', '-map', '[v_final]', '-map', '0:a:0', teeOutputs];
    } else {
        filterStr += `; [${lastLabel}]copy[v_final]`;
        outputParams = ['-map', '[v_final]', '-map', '0:a:0', '-f', 'flv', destList[0]];
    }

    return [
        '-i', 'udp://127.0.0.1:9999?listen=1&timeout=2000',
        ...extraInputs,
        '-c:v', 'libx264',
        '-preset', 'veryfast',
        '-tune', 'zerolatency',
        '-filter_complex', filterStr,
        '-b:v', `${bitrate}k`,
        '-maxrate', `${bitrate}k`,
        '-bufsize', `${bitrate * 2}k`,
        '-g', String(fps * 2),
        '-r', String(fps),
        '-c:a', 'aac',
        '-b:a', '128k',
        ...outputParams
    ];
}

setInterval(() => {
    if (!streamState.isLive || streamState.playlist.length === 0) return;
    const now = new Date();
    const currH = now.getHours().toString().padStart(2, '0');
    const currM = now.getMinutes().toString().padStart(2, '0');
    const timeStr = `${currH}:${currM}`;

    const scheduledIndex = streamState.playlist.findIndex(item => item.scheduledTime === timeStr);
    
    if (scheduledIndex !== -1 && streamState.currentIndex !== scheduledIndex) {
        if (streamState.lastScheduledTime !== timeStr) {
            logStream(`⏰ Scheduled time reached for: ${streamState.playlist[scheduledIndex].name}`);
            streamState.lastScheduledTime = timeStr;
            
            if (ffmpegProcess) {
                ffmpegProcess.removeAllListeners('close');
                ffmpegProcess.kill('SIGINT');
            }
            runItem(scheduledIndex);
        }
    }
}, 10000);

/**
 * Log a message to the stream state log
 */
function logStream(msg) {
    const entry = `[${new Date().toLocaleTimeString()}] ${msg}`;
    console.log(entry);
    streamState.log.unshift(entry);
    if (streamState.log.length > 50) streamState.log.pop(); // Keep last 50 entries
}

/**
 * Run Grand Mixer Architecture
 */
function runIngest(index) {
    if (!streamState.isLive || streamState.playlist.length === 0) return;

    try {
        const safeIndex = index % streamState.playlist.length;
        const item = streamState.playlist[safeIndex];
        if (!item) return;

        streamState.currentIndex = safeIndex;
        streamState.currentItem = { ...item, index: safeIndex };
        
        logStream(`🔥 [Source] Playing: ${item.name}`);

        const args = buildIngestArgs(item.url);
        ingestProcess = spawn(ffmpegPath, args);

        ingestProcess.stderr.on('data', (data) => {
            const line = data.toString();
            if (line.includes('Error')) logStream(`❌ Ingest Error: ${line.substring(0, 80)}`);
        });

        ingestProcess.on('close', (code) => {
            logStream(`✓ [Source] Item finished (exit: ${code})`);
            if (streamState.isLive) {
                runIngest(safeIndex + 1);
            }
        });
        
        if (!mixerProcess) runMixer();
    } catch (err) {
        logStream(`❌ Fatal Ingest Error: ${err.message}`);
    }
}

function runMixer() {
    if (!streamState.isLive) return;

    try {
        logStream('🏗️ [Mixer] Starting Broadcast Mixer...');

        const args = buildMixerArgs(streamState.destinations, {
            bitrate: streamState.bitrate,
            fps: streamState.fps,
            resolution: streamState.resolution,
            layers: streamState.layers,
            recordStream: streamState.recordStream,
            recordFilename: streamState.recordFilename
        });

        mixerProcess = spawn(ffmpegPath, args);

        mixerProcess.on('error', (err) => {
            logStream(`❌ Mixer Failed: ${err.message}`);
        });

        mixerProcess.on('close', (code) => {
            logStream(`✓ [Mixer] Broadcast stopped (exit: ${code})`);
        });
    } catch (err) {
        logStream(`❌ Fatal Mixer Error: ${err.message}`);
    }
}

// ============================================================
// REST API ROUTES
// ============================================================

/**
 * POST /api/stream/start
 * Body: { playlist, destinations, bitrate, fps, resolution, overlayText, recordStream }
 */
app.post('/api/stream/start', (req, res) => {
    try {
        if (streamState.isLive) {
            return res.status(400).json({ error: 'Stream is already live. Stop it first.' });
        }

        const { playlist, destinations = [], bitrate = 2500, fps = 30, resolution = '1280x720', overlayText = '', recordStream = false, layers = [] } = req.body;

        if (!playlist || playlist.length === 0) {
            return res.status(400).json({ error: 'Playlist cannot be empty.' });
        }
        if (destinations.length === 0 && !recordStream) {
            if (req.body.rtmpUrl && req.body.streamKey) {
                const url = req.body.rtmpUrl.endsWith('/') ? `${req.body.rtmpUrl}${req.body.streamKey}` : `${req.body.rtmpUrl}/${req.body.streamKey}`;
                destinations.push(url);
            } else {
                return res.status(400).json({ error: 'At least one RTMP destination (or local recording) is required.' });
            }
        }

        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const recFile = recordStream ? `VOD_${timestamp}.flv` : null;

        streamState.isLive = true;
        streamState.playlist = playlist;
        streamState.destinations = destinations;
        streamState.overlayText = overlayText;
        streamState.layers = layers;
        streamState.recordStream = recordStream;
        streamState.recordFilename = recFile;
        streamState.startTime = Date.now();
        streamState.currentIndex = 0;
        streamState.error = null;
        streamState.log = [];
        streamState.lastScheduledTime = null;
        streamState.bitrate = bitrate;
        streamState.fps = fps;
        streamState.resolution = resolution;

        logStream(`🚀 Grand Mixer started → ${destinations.length} destination(s)`);
        runIngest(0);

        res.json({ success: true, message: 'Stream started successfully.', destinations });
    } catch (err) {
        console.error("Critical Start Error:", err);
        res.status(500).json({ error: 'INTERNAL_SERVER_ERROR', details: err.message });
    }
});

app.post('/api/stream/stop', (req, res) => {
    try {
        logStream('⏹ Stream stopped by user.');
        streamState.isLive = false;
        if (ingestProcess) ingestProcess.kill('SIGKILL');
        if (mixerProcess) mixerProcess.kill('SIGKILL');
        res.json({ success: true, message: 'Stream stopped.' });
    } catch (err) {
        res.status(500).json({ error: 'INTERNAL_SERVER_ERROR', details: err.message });
    }
});

/**
 * POST /api/stream/push-updates
 * Hot-update layers with seamless resumption
 */
app.post('/api/stream/push-updates', async (req, res) => {
    try {
        if (!streamState.isLive) return res.status(400).json({ error: 'Stream is not live.' });
        streamState.layers = req.body.layers || [];
        logStream('✨ Pushing SEAMLESS graphic updates to Broadcast Mixer...');

        if (mixerProcess) {
            mixerProcess.kill('SIGKILL');
            setTimeout(() => { if (streamState.isLive) runMixer(); }, 500);
        } else {
            runMixer();
        }
        res.json({ success: true, message: 'Graphics updated seamlessly.' });
    } catch (err) {
        res.status(500).json({ error: 'PUSH_ERROR', details: err.message });
    }
});

/**
 * POST /api/stream/skip
 * Skip to next item in playlist
 */
app.post('/api/stream/skip', (req, res) => {
    if (!streamState.isLive) return res.status(400).json({ error: 'No active stream.' });
    logStream('⏭ Skipped to next item.');
    if (ingestProcess) ingestProcess.kill('SIGKILL');
    res.json({ success: true, message: 'Skipping to next item.' });
});

/**
 * GET /api/stream/status
 */
app.get('/api/stream/status', (req, res) => {
    const elapsed = streamState.startTime
        ? Math.floor((Date.now() - streamState.startTime) / 1000)
        : 0;

    const h = Math.floor(elapsed / 3600).toString().padStart(2, '0');
    const m = Math.floor((elapsed % 3600) / 60).toString().padStart(2, '0');
    const s = (elapsed % 60).toString().padStart(2, '0');

    res.json({
        isLive: streamState.isLive,
        currentItem: streamState.currentItem,
        currentIndex: streamState.currentIndex,
        totalItems: streamState.playlist.length,
        elapsedFormatted: `${h}:${m}:${s}`,
        error: streamState.error,
        log: streamState.log.slice(0, 10),
        destinations: streamState.destinations,
        overlayText: streamState.overlayText,
        isRecording: streamState.recordStream
    });
});

/**
 * GET /api/records
 */
app.get('/api/records', (req, res) => {
    const recordsDir = path.join(__dirname, 'public', 'records');
    fs.readdir(recordsDir, (err, files) => {
        if (err) return res.status(500).json({ error: 'Failed to read records directory' });
        
        const fileData = files.filter(f => f.endsWith('.flv')).map(f => {
            const stats = fs.statSync(path.join(recordsDir, f));
            return {
                name: f,
                size: (stats.size / (1024 * 1024)).toFixed(2) + ' MB',
                date: stats.mtime,
                url: `/records/${f}`
            };
        }).sort((a,b) => b.date - a.date);

        res.json(fileData);
    });
});

/**
 * DELETE /api/records/:name
 */
app.delete('/api/records/:name', (req, res) => {
    const filename = req.params.name;
    // VERY BASIC SANITIZATION
    if (filename.includes('..') || filename.includes('/')) return res.status(400).json({error: 'Invalid filename'});
    
    const fp = path.join(__dirname, 'public', 'records', filename);
    if (fs.existsSync(fp)) {
        fs.unlinkSync(fp);
        res.json({ success: true });
    } else {
        res.status(404).json({ error: 'File not found' });
    }
});

/**
 * GET /api/system/health
 */
app.get('/api/system/health', (req, res) => {
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;
    const memUsage = ((usedMem / totalMem) * 100).toFixed(1);

    const cpus = os.cpus();
    let cpuUsage = 0;
    if (cpus && cpus.length > 0) {
        // Very basic CPU rough load
        const load = os.loadavg()[0];
        cpuUsage = ((load / cpus.length) * 100).toFixed(1);
    }

    res.json({
        cpuUsage,
        memUsage,
        uptime: os.uptime(),
        ffmpegRunning: ffmpegProcess !== null
    });
});

/**
 * GET /api/proxy
 * Professional CORS Proxy for HLS feeds
 */
app.get('/api/proxy', async (req, res) => {
    const targetUrl = req.query.url;
    if (!targetUrl) return res.status(400).send('URL is required');

    try {
        const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
        const response = await fetch(targetUrl, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0' }
        });
        
        // Forward headers
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', '*');
        res.setHeader('Content-Type', response.headers.get('content-type') || 'application/octet-stream');
        
        if (response.status >= 400) {
            return res.status(response.status).send(`Target returned error: ${response.status}`);
        }

        response.body.pipe(res);
    } catch (err) {
        console.error("Proxy Error:", err);
        res.status(500).send('Proxy Error: ' + err.message);
    }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`\n🎬 Grand Studio Server running at http://localhost:${PORT}\n`);
});
