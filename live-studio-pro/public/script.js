/**
 * Live Studio Pro - Grand Edition Logic
 */

class PlaylistManager {
    constructor(studio) {
        this.studio = studio;
        this.queue = [];
        this.currentIndex = -1;
        this.loop = true;
    }

    add(fileOrUrl, type = 'file') {
        const item = {
            id: Date.now(),
            name: type === 'file' ? fileOrUrl.name : fileOrUrl.split('/').pop(),
            source: fileOrUrl,
            type: type
        };
        this.queue.push(item);
        this.studio.updatePlaylistUI();
    }

    next() {
        if (this.queue.length === 0) return null;
        this.currentIndex++;
        if (this.currentIndex >= this.queue.length) {
            if (this.loop) this.currentIndex = 0;
            else return null;
        }
        return this.queue[this.currentIndex];
    }
}

class LiveStudio {
    constructor() {
        this.canvas = document.getElementById('studio-canvas');
        this.ctx = this.canvas.getContext('2d');
        this.layers = [];
        this.streams = { camera: null, screen: null, audio: null };
        this.playlist = new PlaylistManager(this);
        
        this.isStreaming = false;
        this.isRecording = false;
        this.selectedLayerId = null;
        this.isDragging = false;
        this.isResizing = false;
        this.resizeDir = null;
        
        this.init();
    }

    init() {
        this.setupEventListeners();
        this.renderLoop();
        console.log('Grand Studio initialized');
    }

    setupEventListeners() {
        console.log('Setting up event listeners...');
        
        const safeAddListener = (id, event, callback) => {
            const el = document.getElementById(id);
            if (el) {
                el[event] = callback;
            } else {
                console.warn(`Element with ID "${id}" not found.`);
            }
        };

        // UI Navigation
        safeAddListener('add-url-btn', 'onclick', () => {
            console.log('Add by URL clicked');
            document.getElementById('url-modal').classList.remove('hidden');
        });
        
        safeAddListener('close-modal', 'onclick', () => {
            document.getElementById('url-modal').classList.add('hidden');
        });
        
        // Sources
        safeAddListener('cam-btn', 'onclick', () => this.toggleSource('camera'));
        safeAddListener('screen-btn', 'onclick', () => this.toggleSource('screen'));
        safeAddListener('add-text-btn', 'onclick', () => this.addTextLayer());
        safeAddListener('add-image-btn', 'onclick', () => document.getElementById('image-upload').click());
        safeAddListener('add-video-btn', 'onclick', () => document.getElementById('video-upload').click());
        
        // URL Uploads
        safeAddListener('url-add-img', 'onclick', () => this.addAssetByUrl('image'));
        safeAddListener('url-add-vid', 'onclick', () => this.addAssetByUrl('video'));

        // File/Video
        const imgUpload = document.getElementById('image-upload');
        if (imgUpload) imgUpload.onchange = (e) => this.handleImageUpload(e);
        
        const vidUpload = document.getElementById('video-upload');
        if (vidUpload) vidUpload.onchange = (e) => this.handleVideoUpload(e);
        
        // Playlist
        safeAddListener('add-to-playlist-btn', 'onclick', () => document.getElementById('video-upload').click());

        // Streaming
        safeAddListener('start-stream-btn', 'onclick', () => this.toggleStream());
        safeAddListener('record-btn', 'onclick', () => this.toggleRecording());
        
        // Interaction
        this.canvas.onmousedown = (e) => this.handleMouseDown(e);
        window.onmousemove = (e) => this.handleMouseMove(e);
        window.onmouseup = () => this.handleMouseUp();
        
        // Volume
        safeAddListener('mic-btn', 'onclick', () => this.toggleMic());
    }

    async addAssetByUrl(type) {
        const url = document.getElementById('asset-url-input').value;
        if (!url) return;
        
        if (type === 'image') {
            const img = new Image();
            img.crossOrigin = "anonymous";
            img.onload = () => {
                this.addLayer({
                    id: Date.now(),
                    type: 'image',
                    content: img,
                    x: 200, y: 200,
                    width: img.width / 2, height: img.height / 2,
                    zIndex: this.layers.length
                });
            };
            img.src = url;
        } else {
            const video = document.createElement('video');
            video.crossOrigin = "anonymous";
            video.src = url;
            video.loop = true;
            video.muted = true;
            video.play();
            video.onloadedmetadata = () => {
                this.addLayer({
                    id: Date.now(),
                    type: 'video_file',
                    content: video,
                    x: 100, y: 100,
                    width: video.videoWidth / 2, height: video.videoHeight / 2,
                    zIndex: this.layers.length
                });
            };
        }
        document.getElementById('url-modal').classList.add('hidden');
        document.getElementById('asset-url-input').value = '';
    }

    addTextLayer() {
        this.addLayer({
            id: Date.now(),
            type: 'text',
            content: "Grand Text",
            x: 100, y: 100,
            width: 300, height: 60,
            fontSize: 48,
            fontFamily: 'Outfit',
            color: '#ffffff',
            stroke: null,
            shadow: { color: 'rgba(0,0,0,0.5)', blur: 10 },
            zIndex: this.layers.length
        });
    }

    handleVideoUpload(e) {
        const file = e.target.files[0];
        if (!file) return;
        
        // If we are adding to playlist
        if (e.target.id === 'video-upload') {
            this.playlist.add(file, 'file');
            // If nothing is playing, start the playlist
            if (!this.layers.some(l => l.isPlaylistHost)) {
                this.startPlaylistLayer();
            }
        }
    }

    startPlaylistLayer() {
        const next = this.playlist.next();
        if (!next) return;

        const video = document.createElement('video');
        video.src = next.type === 'file' ? URL.createObjectURL(next.source) : next.source;
        video.play();
        
        const layer = {
            id: Date.now(),
            type: 'video_file',
            isPlaylistHost: true,
            content: video,
            x: 0, y: 0,
            width: this.canvas.width,
            height: this.canvas.height,
            zIndex: 0 // Base layer
        };

        video.onended = () => {
            console.log("Video ended, playing next...");
            const vNext = this.playlist.next();
            if (vNext) {
                video.src = vNext.type === 'file' ? URL.createObjectURL(vNext.source) : vNext.source;
                video.play();
                this.updatePlaylistUI();
            }
        };

        this.addLayer(layer);
    }

    addLayer(layer) {
        this.layers.push(layer);
        this.selectedLayerId = layer.id;
        this.updateLayersUI();
        this.updatePropertyEditor();
    }

    // --- PROPERTY EDITOR ---
    updatePropertyEditor() {
        const editor = document.getElementById('property-editor');
        const content = document.getElementById('editor-content');
        const layer = this.layers.find(l => l.id === this.selectedLayerId);

        if (!layer) {
            editor.classList.add('hidden');
            return;
        }

        editor.classList.remove('hidden');
        content.innerHTML = '';

        if (layer.type === 'text') {
            this.addEditorControl(content, 'Text Content', 'text', layer.content, (val) => { layer.content = val; });
            this.addEditorControl(content, 'Font Family', 'select', layer.fontFamily, (val) => { layer.fontFamily = val; }, ['Inter', 'Outfit', 'Montserrat', 'Playfair Display']);
            this.addEditorControl(content, 'Color', 'color', layer.color, (val) => { layer.color = val; });
            this.addEditorControl(content, 'Size', 'number', layer.fontSize, (val) => { layer.fontSize = val; });
        } else {
            this.addEditorControl(content, 'Opacity', 'range', (layer.opacity || 1) * 100, (val) => { layer.opacity = val / 100; });
        }
        
        this.addEditorControl(content, 'Z-Index', 'number', layer.zIndex, (val) => { layer.zIndex = parseInt(val); this.updateLayersUI(); });
    }

    addEditorControl(parent, label, type, value, onChange, options = []) {
        const group = document.createElement('div');
        group.className = 'prop-group';
        group.innerHTML = `<label>${label}</label>`;
        
        let input;
        if (type === 'select') {
            input = document.createElement('select');
            options.forEach(opt => {
                const o = document.createElement('option');
                o.value = opt;
                o.textContent = opt;
                if (opt === value) o.selected = true;
                input.appendChild(o);
            });
        } else {
            input = document.createElement('input');
            input.type = type;
            input.value = value;
        }

        input.oninput = (e) => onChange(e.target.value);
        group.appendChild(input);
        parent.appendChild(group);
    }

    // --- RENDERING ---
    renderLoop() {
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        
        // Background
        this.ctx.fillStyle = "#000";
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

        // Sort and Draw
        [...this.layers].sort((a,b) => a.zIndex - b.zIndex).forEach(layer => {
            this.ctx.save();
            this.ctx.globalAlpha = layer.opacity || 1;

            if (layer.type === 'video' || layer.type === 'video_file' || layer.type === 'video_url') {
                this.ctx.drawImage(layer.content, layer.x, layer.y, layer.width, layer.height);
            } else if (layer.type === 'image') {
                this.ctx.drawImage(layer.content, layer.x, layer.y, layer.width, layer.height);
            } else if (layer.type === 'text') {
                this.ctx.font = `${layer.fontSize}px ${layer.fontFamily}`;
                this.ctx.fillStyle = layer.color;
                
                if (layer.shadow) {
                    this.ctx.shadowColor = layer.shadow.color;
                    this.ctx.shadowBlur = layer.shadow.blur;
                }
                
                this.ctx.textBaseline = 'top';
                this.ctx.fillText(layer.content, layer.x, layer.y);
            }
            
            // Interaction Handles
            if (layer.id === this.selectedLayerId) {
                this.ctx.strokeStyle = '#3d5afe';
                this.ctx.lineWidth = 3;
                this.ctx.setLineDash([5, 5]);
                this.ctx.strokeRect(layer.x, layer.y, layer.width, layer.height);
                this.ctx.setLineDash([]);
                
                // Fancy Handles
                this.ctx.fillStyle = "#fff";
                const corners = [
                    [layer.x, layer.y],
                    [layer.x + layer.width, layer.y],
                    [layer.x, layer.y + layer.height],
                    [layer.x + layer.width, layer.y + layer.height]
                ];
                corners.forEach(([cx, cy]) => {
                    this.ctx.beginPath();
                    this.ctx.arc(cx, cy, 6, 0, Math.PI * 2);
                    this.ctx.fill();
                    this.ctx.stroke();
                });
            }
            this.ctx.restore();
        });

        requestAnimationFrame(() => this.renderLoop());
    }

    // --- INTERACTION ---
    handleMouseDown(e) {
        const rect = this.canvas.getBoundingClientRect();
        const scaleX = this.canvas.width / rect.width;
        const scaleY = this.canvas.height / rect.height;
        const mouseX = (e.clientX - rect.left) * scaleX;
        const mouseY = (e.clientY - rect.top) * scaleY;

        const layer = this.layers.find(l => l.id === this.selectedLayerId);
        if (layer) {
            // Check bottom-right handle specifically
            const handleSize = 20;
            if (mouseX >= layer.x + layer.width - handleSize && mouseX <= layer.x + layer.width &&
                mouseY >= layer.y + layer.height - handleSize && mouseY <= layer.y + layer.height) {
                this.isResizing = true;
                this.lastMousePos = { x: mouseX, y: mouseY };
                return;
            }
        }

        const clickedLayer = [...this.layers].sort((a,b) => b.zIndex - a.zIndex)
                                .find(l => mouseX >= l.x && mouseX <= l.x+l.width && mouseY >= l.y && mouseY <= l.y+l.height);

        if (clickedLayer) {
            this.selectedLayerId = clickedLayer.id;
            this.isDragging = true;
            this.lastMousePos = { x: mouseX, y: mouseY };
        } else {
            this.selectedLayerId = null;
        }
        this.updateLayersUI();
        this.updatePropertyEditor();
    }

    handleMouseMove(e) {
        if ((!this.isDragging && !this.isResizing) || !this.selectedLayerId) return;
        const layer = this.layers.find(l => l.id === this.selectedLayerId);
        const rect = this.canvas.getBoundingClientRect();
        const scaleX = this.canvas.width / rect.width;
        const scaleY = this.canvas.height / rect.height;
        const mouseX = (e.clientX - rect.left) * scaleX;
        const mouseY = (e.clientY - rect.top) * scaleY;
        const dx = mouseX - this.lastMousePos.x;
        const dy = mouseY - this.lastMousePos.y;

        if (this.isResizing) { layer.width += dx; layer.height += dy; }
        else { layer.x += dx; layer.y += dy; }
        this.lastMousePos = { x: mouseX, y: mouseY };
    }

    handleMouseUp() { this.isDragging = false; this.isResizing = false; }

    updateLayersUI() {
        const list = document.getElementById('layers-list');
        list.innerHTML = '';
        this.layers.forEach(l => {
            const div = document.createElement('div');
            div.className = `playlist-item ${l.id === this.selectedLayerId ? 'active' : ''}`;
            div.innerHTML = `<span>Layer</span> <span style="flex:1">${l.type}</span> <button onclick="studio.removeLayer(${l.id})">🗑️</button>`;
            div.onclick = (e) => { if(e.target.tagName !== 'BUTTON') { this.selectedLayerId = l.id; this.updateLayersUI(); this.updatePropertyEditor(); } };
            list.appendChild(div);
        });
    }

    updatePlaylistUI() {
        const list = document.getElementById('playlist-list');
        list.innerHTML = '';
        this.playlist.queue.forEach((item, idx) => {
            const div = document.createElement('div');
            div.className = `playlist-item ${idx === this.playlist.currentIndex ? 'active' : ''}`;
            div.innerHTML = `<span>${idx+1}.</span> <span>${item.name}</span>`;
            list.appendChild(div);
        });
        if (this.playlist.queue.length === 0) list.innerHTML = '<div class="empty-state">No videos scheduled</div>';
    }

    removeLayer(id) {
        this.layers = this.layers.filter(l => l.id !== id);
        if (this.selectedLayerId === id) this.selectedLayerId = null;
        this.updateLayersUI();
        this.updatePropertyEditor();
    }
}

// Inherit stream logic from V2 script or integrate fully
// (I will integrate the stream logic into this file for a complete V3 script)
LiveStudio.prototype.toggleStream = async function() {
    if (this.isStreaming) {
        this.stopStream();
    } else {
        const rtmpUrl = document.getElementById('rtmp-url').value;
        const streamKey = document.getElementById('stream-key').value;
        if (!rtmpUrl || !streamKey) return alert("Enter RTMP details");

        const bitrate = 2500;
        const fps = parseInt(document.getElementById('fps-select').value);
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        this.ws = new WebSocket(`${protocol}//${window.location.host}`);
        
        this.ws.onopen = () => {
            this.ws.send(JSON.stringify({ type: 'start', rtmpUrl, streamKey, bitrate, fps, resolution: '1280x720' }));
            const canvasStream = this.canvas.captureStream(fps);
            this.mediaRecorder = new MediaRecorder(canvasStream, { mimeType: 'video/webm;codecs=h264' });
            this.mediaRecorder.ondataavailable = (e) => this.ws.send(e.data);
            this.mediaRecorder.start(100);
            this.isStreaming = true;
            this.updateStatus('live');
        };
    }
}

LiveStudio.prototype.updateStatus = function(status) {
    document.getElementById('status-indicator').className = `status-dot ${status}`;
    document.getElementById('status-text').textContent = status.toUpperCase();
}

window.studio = new LiveStudio();
