/**
 * Grand Studio Pro - Firebase Edition
 * Full Client Logic: Firebase Upload, Playlist Builder, Server Stream Control
 */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getFirestore, doc, setDoc, getDoc, onSnapshot } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// ============================================================
// FIREBASE CONFIG
// ============================================================
const firebaseConfig = {
    apiKey: "AIzaSyCdlninqPcUphfBu4lT7a2FopwOubptfN0",
    authDomain: "studio-pro-2cc0a.firebaseapp.com",
    projectId: "studio-pro-2cc0a",
    storageBucket: "studio-pro-2cc0a.firebasestorage.app",
    messagingSenderId: "633712652",
    appId: "1:633712652:web:0a2d606dc4a2d8ab24be29",
    measurementId: "G-M58HW6XL0E"
};

const firebaseApp = initializeApp(firebaseConfig);
const db = getFirestore(firebaseApp);

// ============================================================
// STATE
// ============================================================
const state = {
    library: [],    // { id, name, url, format, source: 'firebase'|'url' }
    playlist: [],   // items added to schedule
    isLive: false,
    statusInterval: null,
    timerInterval: null,
    startTime: null,
    layers: [],     // { id, type: 'text'|'image', content, x, y, size, w, visible }
    prepLiveHls: null, // Track Hls instance for Prep
    mainLiveHls: null  // Track Hls instance for Main
};

// Detect format from URL
function detectFormat(url) {
    const u = url.toLowerCase();
    if (u.includes('.m3u8')) return 'm3u8';
    if (u.startsWith('rtmp')) return 'rtmp';
    if (u.includes('.mp4')) return 'mp4';
    if (u.includes('.mkv')) return 'mkv';
    if (u.includes('.mov')) return 'mov';
    if (u.includes('.avi')) return 'avi';
    if (u.includes('.ts')) return 'ts';
    if (u.includes('.webm')) return 'webm';
    if (u.includes('.flv')) return 'flv';
    return 'video';
}

const isLiveFormat = (fmt) => ['m3u8', 'rtmp'].includes(fmt);

// ============================================================
// FIREBASE SYNC (Mute UI updates while syncing)
// ============================================================
async function saveStateToFirestore() {
    try {
        await setDoc(doc(db, "studio", "state"), {
            library: state.library,
            playlist: state.playlist,
            layers: state.layers
        });
    } catch (err) {
        console.error("Error saving state:", err);
    }
}

function listenToFirestore() {
    onSnapshot(doc(db, "studio", "state"), (snapshot) => {
        if (snapshot.exists()) {
            const data = snapshot.data();
            console.log("☁️ Firestore Sync:", data);

            state.library = data.library || [];
            state.playlist = data.playlist || [];

            // Only update layers if they exist in DB to prevent wiping local new unsaved layers
            if (data.layers) {
                state.layers = data.layers;
            }

            renderLibrary();
            renderPlaylist();
            renderLayers();
        }
    });
}

// ============================================================
// LIBRARY MANAGEMENT
// ============================================================
function addToLibrary(item) {
    if (state.library.find(i => i.url === item.url)) return;
    state.library.push({ ...item, id: Date.now() + Math.random() });
    renderLibrary();
    saveStateToFirestore();
}

function renderLibrary() {
    const list = document.getElementById('library-list');
    if (state.library.length === 0) {
        list.innerHTML = '<div class="empty-state">لا توجد ملفات بعد. ارفع ملفاً أو أضف رابطاً.</div>';
        return;
    }

    list.innerHTML = state.library.map(item => `
        <div class="library-item">
            <span class="lib-icon">${isLiveFormat(item.format) ? '📡' : '🎬'}</span>
            <div style="flex:1;min-width:0;">
                <div class="lib-name" title="${item.url}">${item.name}</div>
                <div class="lib-format">${item.format} • ${item.source}</div>
            </div>
            <button class="add-to-playlist-btn" data-id="${item.id}" title="Add to Schedule">+</button>
        </div>
    `).join('');

    list.querySelectorAll('.add-to-playlist-btn').forEach(btn => {
        btn.onclick = (e) => {
            e.stopPropagation(); // prevent triggering row click
            const item = state.library.find(i => String(i.id) === btn.dataset.id);
            if (item) addToPlaylist(item);
        };
    });

    // Handle row click for Preview
    list.querySelectorAll('.library-item').forEach(row => {
        row.onclick = () => {
            const btn = row.querySelector('.add-to-playlist-btn');
            if (btn) {
                const item = state.library.find(i => String(i.id) === btn.dataset.id);
                if (item) playInPreviewMonitor(item);
            }
        };
    });
}

// ============================================================
// PLAYLIST MANAGEMENT
// ============================================================
function addToPlaylist(item) {
    state.playlist.push({ ...item, pid: Date.now() + Math.random() });
    renderPlaylist();
    saveStateToFirestore();
}

function removeFromPlaylist(pid) {
    state.playlist = state.playlist.filter(i => String(i.pid) !== String(pid));
    renderPlaylist();
    saveStateToFirestore();
}

function renderPlaylist(currentIndex = -1) {
    const tbody = document.getElementById('playlist-body');
    const countBadge = document.getElementById('playlist-count');
    countBadge.textContent = `${state.playlist.length} عنصر`;

    if (state.playlist.length === 0) {
        tbody.innerHTML = `<tr class="empty-row"><td colspan="5">أضف عناصر من المكتبة لبناء جدول البث.</td></tr>`;
        return;
    }

    tbody.innerHTML = state.playlist.map((item, idx) => `
        <tr class="${idx === currentIndex ? 'playing-row' : ''}">
            <td class="row-num">${idx === currentIndex ? '▶' : idx + 1}</td>
            <td class="row-name">${item.name}</td>
            <td class="row-format">
                <span class="format-tag ${isLiveFormat(item.format) ? 'live' : ''}">${item.format}</span>
            </td>
            <td>
                <input type="time" class="schedule-input" data-pid="${item.pid}" value="${item.scheduledTime || ''}" style="background:var(--bg-card); color:white; border:1px solid #333; padding:5px; border-radius:4px;">
            </td>
            <td style="color:var(--muted);font-size:0.78rem;">${item.source === 'url' ? 'رابط خارجي' : item.source}</td>
            <td>
                <button class="remove-row-btn" data-pid="${item.pid}" title="Remove">🗑</button>
            </td>
        </tr>
    `).join('');

    tbody.querySelectorAll('.remove-row-btn').forEach(btn => {
        btn.onclick = (e) => {
            e.stopPropagation();
            removeFromPlaylist(btn.dataset.pid);
        };
    });

    tbody.querySelectorAll('.schedule-input').forEach(inp => {
        inp.onclick = (e) => e.stopPropagation();
        inp.onchange = (e) => {
            const item = state.playlist.find(i => String(i.pid) === e.target.dataset.pid);
            if (item) {
                item.scheduledTime = e.target.value;
                saveStateToFirestore();
            }
        };
    });

    // Row click for Preview
    tbody.querySelectorAll('tr').forEach(row => {
        if (!row.classList.contains('empty-row')) {
            row.style.cursor = 'pointer';
            row.onclick = () => {
                const pid = row.querySelector('.remove-row-btn').dataset.pid;
                const item = state.playlist.find(i => String(i.pid) === String(pid));
                if (item) playInPreviewMonitor(item);
            };
        }
    });
}

/**
 * Universal Media Loader (HLS & Standard)
 */
function playMedia(videoEl, url, hlsKey) {
    if (!videoEl || !url) return;

    // Cleanup previous Hls
    if (state[hlsKey]) {
        state[hlsKey].destroy();
        state[hlsKey] = null;
    }

    videoEl.pause();
    videoEl.removeAttribute('src');
    videoEl.load();

    const format = detectFormat(url);
    let finalUrl = url;

    // Force Proxy for cross-origin HLS
    if (format === 'm3u8' && (url.startsWith('http') && !url.includes(window.location.host))) {
        finalUrl = `/api/proxy?url=${encodeURIComponent(url)}`;
    }

    if (format === 'm3u8') {
        if (window.Hls && Hls.isSupported()) {
            const hls = new Hls({ 
                lowLatencyMode: true,
                xhrSetup: function(xhr, url) {
                    // Redirect individual segments through proxy if external
                    if (url.startsWith('http') && !url.includes(window.location.host) && !url.includes('/api/proxy')) {
                        xhr.open('GET', `/api/proxy?url=${encodeURIComponent(url)}`, true);
                    }
                }
            });
            state[hlsKey] = hls;
            hls.loadSource(finalUrl);
            hls.attachMedia(videoEl);
            hls.on(Hls.Events.MANIFEST_PARSED, () => videoEl.play().catch(e => {}));
            
            hls.on(Hls.Events.ERROR, (event, data) => {
                if (data.fatal) {
                    console.warn(`Hls Fatal Error [${hlsKey}]:`, data.type);
                    if (data.type === Hls.ErrorTypes.NETWORK_ERROR) hls.startLoad();
                    else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) hls.recoverMediaError();
                    else hls.destroy();
                }
            });
        } else if (videoEl.canPlayType('application/vnd.apple.mpegurl')) {
            videoEl.src = finalUrl;
            videoEl.play().catch(e => {});
        }
    } else {
        videoEl.src = finalUrl;
        videoEl.play().catch(e => {});
    }
}

/**
 * Preview Monitor Handler
 */
function playInPreviewMonitor(item) {
    const previewEl = document.getElementById('preview-player'); 
    if (!previewEl || !item) return;

    playMedia(previewEl, item.url, 'prepLiveHls');

    // Tally Feedback
    document.querySelectorAll('.tally-light.preview').forEach(t => t.classList.add('active'));
    setTimeout(() => {
        document.querySelectorAll('.tally-light.preview').forEach(t => t.classList.remove('active'));
    }, 2000);
}


// ============================================================
// LAYER & GRAPHICS MANAGEMENT
// ============================================================
function renderLayers() {
    console.log("🎨 Rendering Layers:", state.layers.length);
    const list = document.getElementById('layers-list');
    const container = document.getElementById('prep-layers-container');

    if (!list || !container) return;

    if (state.layers.length === 0) {
        list.innerHTML = '<div class="empty-state">لا توجد طبقات إضافية. أضف نصاً أو شعاراً.</div>';
        container.innerHTML = '';
        return;
    }

    // 1. Render Sidebar List
    list.innerHTML = state.layers.map(layer => `
        <div class="library-item layer-item" style="padding: 10px; border-bottom: 1px solid var(--border); ${!layer.visible ? 'opacity:0.5' : ''}">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
                <span class="lib-icon">${layer.type === 'text' ? '✍️' : '🖼️'} ${layer.type === 'text' ? 'نص' : 'صورة'}</span>
                <div style="display:flex; gap:5px;">
                    <button class="icon-btn toggle-layer-btn" data-id="${layer.id}" title="إخفاء/إظهار">${layer.visible ? '👁️' : '🙈'}</button>
                    <button class="icon-btn remove-layer-btn" data-id="${layer.id}" title="حذف">🗑</button>
                </div>
            </div>
            <div style="flex:1;min-width:0;">
                <input type="text" value="${layer.content}" class="layer-content-input" data-id="${layer.id}" style="width:100%; background:rgba(255,255,255,0.05); border:1px solid #333; color:white; font-size:0.85rem; padding:8px; border-radius:4px; margin-bottom:8px;" placeholder="المحتوى...">
                
                <div style="display:grid; grid-template-columns: 1fr 1fr; gap:10px;">
                    <div class="field">
                        <label style="font-size:0.6rem; color:var(--muted);">X / Y Position</label>
                        <div style="font-size:0.7rem; color:white;">${Math.round(layer.x * 100)}% | ${Math.round(layer.y * 100)}%</div>
                    </div>
                    <div class="field">
                        <label style="font-size:0.6rem; color:var(--muted);">الحجم</label>
                        <input type="number" class="layer-size-input" data-id="${layer.id}" value="${layer.type === 'text' ? (layer.size || 24) : Math.round((layer.w || 0.15) * 100)}" style="width:100%; background:rgba(0,0,0,0.3); border:1px solid #333; color:white; font-size:0.7rem; padding:2px; border-radius:4px;">
                    </div>
                </div>

                ${layer.type === 'text' ? `
                <div style="display:grid; grid-template-columns: 1fr 1fr 1fr; gap:8px; margin-top:8px; align-items:center;">
                    <div class="field">
                        <label style="font-size:0.6rem; color:var(--muted);">لون الخط</label>
                        <input type="color" class="layer-color-input" data-id="${layer.id}" value="${layer.color || '#ffffff'}" style="width:100%; height:20px; border:none; background:none; cursor:pointer;">
                    </div>
                    <div class="field">
                        <label style="font-size:0.6rem; color:var(--muted);">الخلفية</label>
                        <input type="color" class="layer-bgcolor-input" data-id="${layer.id}" value="${layer.bgColor || '#000000'}" style="width:100%; height:20px; border:none; background:none; cursor:pointer;">
                    </div>
                    <div class="field" style="text-align:center;">
                        <label style="font-size:0.6rem; color:var(--muted);">شريط متحرك</label>
                        <input type="checkbox" class="layer-ticker-input" data-id="${layer.id}" ${layer.ticker ? 'checked' : ''}>
                    </div>
                </div>
                ` : ''}
            </div>
        </div>
    `).join('');

    // 2. Render On-Screen Overlays (Draggable)
    container.innerHTML = state.layers.map(layer => {
        if (!layer.visible) return '';
        const style = `
            position: absolute; 
            left: ${layer.x * 100}%; 
            top: ${layer.y * 100}%; 
            pointer-events: auto; 
            cursor: move; 
            user-select: none;
            white-space: nowrap;
        `;

        if (layer.type === 'text') {
            const fontColor = layer.color || '#white';
            const bgColor = layer.bgColor || 'rgba(0,0,0,0.6)';

            return `<div class="draggable-layer ${layer.ticker ? 'ticker-anim' : ''}" data-id="${layer.id}" style="${style} background:${bgColor}; color:${fontColor}; padding:5px 10px; border:1px solid rgba(255,255,255,0.2); border-radius:4px; font-size:${layer.size || 18}px; z-index:100; font-family:'Tajawal', sans-serif;">
                ${layer.content || 'نص جديد'}
            </div>`;
        } else {
            return `<div class="draggable-layer" data-id="${layer.id}" style="${style} border:1px solid #4ade80; border-radius:4px; z-index:100;"><img src="${layer.content}" style="display:block; max-width:${(layer.w || 0.15) * 400}px; pointer-events:none;"></div>`;
        }
    }).join('');

    // Event Listeners for List
    list.querySelectorAll('.remove-layer-btn').forEach(btn => {
        btn.onclick = () => {
            state.layers = state.layers.filter(l => String(l.id) !== btn.dataset.id);
            renderLayers();
            saveStateToFirestore();
        };
    });

    list.querySelectorAll('.toggle-layer-btn').forEach(btn => {
        btn.onclick = () => {
            const layer = state.layers.find(l => String(l.id) === btn.dataset.id);
            if (layer) layer.visible = !layer.visible;
            renderLayers();
            saveStateToFirestore();
        };
    });

    list.querySelectorAll('.layer-content-input').forEach(inp => {
        inp.onchange = (e) => {
            const layer = state.layers.find(l => String(l.id) === inp.dataset.id);
            if (layer) layer.content = e.target.value;
            renderLayers();
            saveStateToFirestore();
        };
    });

    list.querySelectorAll('.layer-size-input').forEach(inp => {
        inp.onchange = (e) => {
            const layer = state.layers.find(l => String(l.id) === inp.dataset.id);
            if (layer) {
                const val = parseInt(e.target.value);
                if (layer.type === 'text') layer.size = val;
                else layer.w = val / 100;
            }
            renderLayers();
            saveStateToFirestore();
        };
    });

    list.querySelectorAll('.layer-color-input, .layer-bgcolor-input, .layer-ticker-input').forEach(inp => {
        inp.onchange = (e) => {
            const layer = state.layers.find(l => String(l.id) === inp.dataset.id);
            if (layer) {
                if (e.target.type === 'checkbox') {
                    layer.ticker = e.target.checked;
                } else if (e.target.classList.contains('layer-color-input')) {
                    layer.color = e.target.value;
                } else if (e.target.classList.contains('layer-bgcolor-input')) {
                    layer.bgColor = e.target.value;
                }
            }
            renderLayers();
            saveStateToFirestore();
        };
    });

    // Live Sync (Push Updates)
    const pushBtn = document.getElementById('push-to-live-btn');
    if (pushBtn) {
        pushBtn.onclick = async () => {
            if (!state.isLive) {
                alert('عذراً، يجب أن يكون البث مباشراً أولاً لكي تتمكن من تحديث الجرافيك.');
                return;
            }
            try {
                pushBtn.disabled = true;
                pushBtn.textContent = '🔄 جارٍ المزامنة...';

                const res = await fetch('/api/stream/push-updates', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ layers: state.layers })
                });

                if (!res.ok) throw new Error('فشل التحديث');

                // Success feedback
                pushBtn.textContent = '✅ تم التحديث';
                pushBtn.style.background = 'var(--green)';
                setTimeout(() => {
                    pushBtn.disabled = false;
                    pushBtn.textContent = '🔄 تحديث البث';
                    pushBtn.style.background = 'var(--accent2)';
                }, 3000);
            } catch (err) {
                console.error(err);
                alert('فشل في مزامنة الجرافيك مع البث المباشر.');
                pushBtn.disabled = false;
                pushBtn.textContent = '🔄 تحديث البث';
            }
        };
    }
}


let activeDraggingLayer = null;
function setupDraggableLayers() {
    const draggables = document.querySelectorAll('.draggable-layer');
    const container = document.getElementById('prep-screen-wrap');

    draggables.forEach(el => {
        el.onmousedown = (e) => {
            e.preventDefault();
            e.stopPropagation();

            const lid = el.dataset.id;
            const layerState = state.layers.find(l => String(l.id) === String(lid));
            if (!layerState) return;

            el.classList.add('is-dragging');

            const rect = container.getBoundingClientRect();
            const elRect = el.getBoundingClientRect();

            // Calculate mouse offset within the element
            const offsetX = e.clientX - elRect.left;
            const offsetY = e.clientY - elRect.top;

            const moveHandler = (moveEvent) => {
                // Determine new position relative to container
                let x = (moveEvent.clientX - rect.left - offsetX) / rect.width;
                let y = (moveEvent.clientY - rect.top - offsetY) / rect.height;

                // Bounds
                x = Math.max(0, Math.min(0.95, x));
                y = Math.max(0, Math.min(0.95, y));

                layerState.x = x;
                layerState.y = y;

                // Super fast visual update
                el.style.left = (x * 100) + '%';
                el.style.top = (y * 100) + '%';
            };

            const stopHandler = () => {
                window.removeEventListener('mousemove', moveHandler);
                window.removeEventListener('mouseup', stopHandler);
                el.classList.remove('is-dragging');
                renderLayers(); // Final sync for sidebar and persistence
                saveStateToFirestore();
            };

            window.addEventListener('mousemove', moveHandler);
            window.addEventListener('mouseup', stopHandler);
        };
    });
}


// ============================================================
// STREAM CONTROL
// ============================================================
async function startStream() {
    // Get all destinations
    const destinations = [];
    document.querySelectorAll('.dest-row').forEach(row => {
        const url = row.querySelector('.dest-url').value.trim();
        const key = row.querySelector('.dest-key').value.trim();
        if (url && key) {
            const rtmpDest = url.endsWith('/') ? `${url}${key}` : `${url}/${key}`;
            destinations.push(rtmpDest);
        }
    });

    const recordStream = document.getElementById('record-stream-chk').checked;
    const resolution = document.getElementById('resolution').value;
    const fps = document.getElementById('fps').value;
    const bitrate = document.getElementById('bitrate').value;

    if (destinations.length === 0) return alert('الرجاء إدخال رابط مفتاح بث واحد على الأقل.');
    if (state.playlist.length === 0) return alert('جدول البث فارغ. أضف عنصراً على الأقل.');

    try {
        const goBtn = document.getElementById('go-live-btn');
        goBtn.disabled = true;
        goBtn.querySelector('.btn-text').textContent = 'جارٍ الاتصال...';

        // Add timeout protection
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 15000);

        const res = await fetch('/api/stream/start', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal: controller.signal,
            body: JSON.stringify({
                playlist: state.playlist.map(i => ({ url: i.url, name: i.name, format: i.format, scheduledTime: i.scheduledTime })),
                destinations,
                layers: state.layers,
                recordStream,
                resolution,
                fps: parseInt(fps),
                bitrate: parseInt(bitrate)
            })
        });

        clearTimeout(timeoutId);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'فشل في بدء البث');

        setLiveState(true);
        startStatusPolling();
        startTimer();

    } catch (err) {
        alert(`خطأ: ${err.message}`);
        document.getElementById('go-live-btn').disabled = false;
        document.getElementById('go-live-btn').querySelector('.btn-text').textContent = 'ابدأ البث';
    }
}

async function stopStream() {
    try {
        await fetch('/api/stream/stop', { method: 'POST' });
        setLiveState(false);
        stopStatusPolling();
        stopTimer();
    } catch (err) {
        console.error('Stop error:', err);
    }
}

async function skipItem() {
    await fetch('/api/stream/skip', { method: 'POST' });
}

// ============================================================
// STATUS POLLING
// ============================================================
function startStatusPolling() {
    state.statusInterval = setInterval(fetchStatus, 3000);
    fetchStatus(); // immediate first call
}

function stopStatusPolling() {
    clearInterval(state.statusInterval);
}

async function fetchStatus() {
    try {
        const res = await fetch('/api/stream/status');
        if (!res.ok) return; // Silent skip if server is restarting

        const contentType = res.headers.get("content-type");
        if (!contentType || !contentType.includes("application/json")) return;

        const data = await res.json();

        if (!data.isLive && state.isLive) {
            // Stream ended on server side
            setLiveState(false);
            stopTimer();
            return;
        }

        // Update dashboard
        const cur = data.currentItem;
        document.getElementById('dash-current').textContent = cur ? cur.name : '—';
        document.getElementById('np-title').textContent = cur ? cur.name : '—';

        // Update live monitor
        const liveEl = document.getElementById('live-player');
        if (cur && cur.url && liveEl.dataset.currentSrc !== cur.url) {
            liveEl.dataset.currentSrc = cur.url;
            playMedia(liveEl, cur.url, 'mainLiveHls');
        } else if (!cur) {
            if (state.mainLiveHls) {
                state.mainLiveHls.destroy();
                state.mainLiveHls = null;
            }
            liveEl.removeAttribute('src');
            liveEl.load();
        }

        const nextIdx = (data.currentIndex + 1) % (data.totalItems || 1);
        const next = state.playlist[nextIdx];
        document.getElementById('dash-next').textContent = next ? next.name : '(restart)';
        document.getElementById('dash-items').textContent = `${data.currentIndex + 1} / ${data.totalItems}`;

        // Update log
        if (data.log && data.log.length) {
            const logEl = document.getElementById('stream-log');
            logEl.innerHTML = data.log.map(l => `<div>${l}</div>`).join('');
        }

        // Highlight current playlist row
        renderPlaylist(data.currentIndex);

        // Fetch Health Data
        const healthRes = await fetch('/api/system/health');
        if (healthRes.ok) {
            const hContentType = healthRes.headers.get("content-type");
            if (hContentType && hContentType.includes("application/json")) {
                const hData = await healthRes.json();
                document.getElementById('h-cpu').textContent = hData.cpuUsage + '%';
                document.getElementById('h-ram').textContent = (hData.memUsage || 0) + '%';

                const hours = Math.floor(hData.uptime / 3600);
                const minutes = Math.floor((hData.uptime % 3600) / 60);
                document.getElementById('h-uptime').textContent = `${hours}h ${minutes}m`;
            }
        }

    } catch (err) {
        console.warn('Status poll error:', err);
    }
}

// ============================================================
// UI STATE
// ============================================================
function setLiveState(live) {
    state.isLive = live;

    const pill = document.getElementById('status-pill');
    const statusText = document.getElementById('status-text');
    const liveDash = document.getElementById('live-dashboard');
    const goLiveBtn = document.getElementById('go-live-btn');
    const stopBtn = document.getElementById('stop-btn');

    if (live) {
        pill.className = 'status-pill live';
        statusText.textContent = 'مباشر الآن';
        liveDash.classList.remove('hidden');
        goLiveBtn.classList.add('hidden');
        stopBtn.classList.remove('hidden');
    } else {
        pill.className = 'status-pill offline';
        statusText.textContent = 'غير متصل';
        liveDash.classList.add('hidden');
        goLiveBtn.classList.remove('hidden');
        goLiveBtn.disabled = false;
        goLiveBtn.querySelector('.btn-text').textContent = 'ابدأ البث';
        stopBtn.classList.add('hidden');
        document.getElementById('np-title').textContent = '—';
    }
}

// ============================================================
// TIMER
// ============================================================
function startTimer() {
    state.startTime = Date.now();
    state.timerInterval = setInterval(() => {
        const diff = Date.now() - state.startTime;
        const h = Math.floor(diff / 3600000).toString().padStart(2, '0');
        const m = Math.floor((diff % 3600000) / 60000).toString().padStart(2, '0');
        const s = Math.floor((diff % 60000) / 1000).toString().padStart(2, '0');
        document.getElementById('timer').textContent = `${h}:${m}:${s}`;
    }, 1000);
}

function stopTimer() {
    clearInterval(state.timerInterval);
    document.getElementById('timer').textContent = '00:00:00';
}

// ============================================================
// EVENT LISTENERS & INIT
// ============================================================

function initStudio() {
    // ================== EVENT LISTENERS (Non-blocking) ==================

    // Add Text Layer
    document.getElementById('add-text-layer-btn').onclick = () => {
        state.layers.push({
            id: Date.now(),
            type: 'text',
            content: 'نص جديد',
            x: 0.1,
            y: 0.1,
            size: 24,
            visible: true
        });
        renderLayers();
        saveStateToFirestore();
    };

    // Add Image Layer
    document.getElementById('add-image-layer-btn').onclick = () => {
        const url = prompt("أدخل رابط الصورة (PNG/JPG):");
        if (url) {
            state.layers.push({
                id: Date.now(),
                type: 'image',
                content: url,
                x: 0.1,
                y: 0.1,
                w: 0.15,
                visible: true
            });
            renderLayers();
            saveStateToFirestore();
        }
    };

    // إضافة عبر رابط
    document.getElementById('add-url-btn').onclick = () => {
        try {
            const url = document.getElementById('url-input').value.trim();
            let name = document.getElementById('url-name').value.trim();
            if (!url) return alert('الرجاء إدخال رابط.');
            if (!name) name = url.split('/').pop() || 'ميديا خارجية';
            const format = detectFormat(url);
            addToLibrary({ name, url, format, source: 'url' });
            document.getElementById('url-input').value = '';
            document.getElementById('url-name').value = '';
        } catch (e) {
            console.error(e);
            alert("حدث خطأ أثناء الإضافة.");
        }
    };

    // RTMP Presets
    document.querySelectorAll('.preset-btn').forEach(btn => {
        btn.onclick = () => {
            const destCols = document.querySelectorAll('.dest-url');
            if (destCols.length > 0) {
                destCols[destCols.length - 1].value = btn.dataset.rtmp;
                const keyCols = document.querySelectorAll('.dest-key');
                if (keyCols.length > 0) keyCols[keyCols.length - 1].focus();
            }
        };
    });

    // Toggle stream key visibility
    const destContainer = document.getElementById('destinations-container');
    if (destContainer) {
        destContainer.addEventListener('click', (e) => {
            if (e.target.classList.contains('toggle-key-btn')) {
                const inp = e.target.previousElementSibling;
                inp.type = inp.type === 'password' ? 'text' : 'password';
            }
        });
    }

    // Add Destination Row
    const addDestBtn = document.getElementById('add-dest-btn');
    if (addDestBtn) {
        addDestBtn.onclick = () => {
            const cont = document.getElementById('destinations-container');
            const row = document.createElement('div');
            row.className = 'dest-row';
            row.style.marginTop = '10px';
            row.style.paddingTop = '10px';
            row.style.borderTop = '1px solid #333';
            row.innerHTML = `
                <div class="field">
                    <label>رابط منصة إضافية</label>
                    <input type="text" class="dest-url" placeholder="rtmp://...">
                </div>
                <div class="field">
                    <label>مفتاح البث</label>
                    <div class="key-wrap">
                        <input type="password" class="dest-key" placeholder="live_...">
                        <button type="button" class="icon-btn toggle-key-btn">👁</button>
                        <button type="button" class="danger-mini-btn remove-dest-btn" style="margin-right: 5px;">✖</button>
                    </div>
                </div>
            `;
            cont.appendChild(row);
            row.querySelector('.remove-dest-btn').onclick = () => row.remove();
        };
    }

    // Clear Library
    document.getElementById('clear-library-btn').onclick = () => {
        if (confirm('هل تريد مسح المكتبة بالكامل؟')) {
            state.library = [];
            renderLibrary();
            saveStateToFirestore();
        }
    };

    // Clear Playlist
    document.getElementById('clear-playlist-btn').onclick = () => {
        if (confirm('هل تريد مسح جدول البث بالكامل؟')) {
            state.playlist = [];
            renderPlaylist();
            saveStateToFirestore();
        }
    };

    document.getElementById('go-live-btn').onclick = startStream;
    document.getElementById('stop-btn').onclick = stopStream;
    document.getElementById('skip-btn').onclick = skipItem;

    // ================== FIREBASE INIT (Async) ==================
    (async () => {
        try {
            listenToFirestore();
        } catch (e) { console.warn("Firestore Listen Failed:", e); }

        try {
            const docSnap = await getDoc(doc(db, "studio", "settings"));
            if (docSnap.exists()) {
                const st = docSnap.data();
                const cont = document.getElementById('destinations-container');

                // If we have default settings from settings.html
                if (st.defaultRtmpUrl || st.defaultStreamKey) {
                    const urlInput = cont.querySelector('.dest-url');
                    const keyInput = cont.querySelector('.dest-key');
                    if (urlInput && !urlInput.value) urlInput.value = st.defaultRtmpUrl || '';
                    if (keyInput && !keyInput.value) keyInput.value = st.defaultStreamKey || '';
                }

                // If we have multiple destinations saved from a previous session
                if (st.destinations && st.destinations.length > 0) {
                    cont.innerHTML = '';
                    st.destinations.forEach(dest => {
                        const row = document.createElement('div');
                        row.className = 'dest-row';
                        row.style.marginTop = '10px';
                        row.style.paddingTop = '10px';
                        row.style.borderTop = '1px solid #333';
                        row.innerHTML = `
                            <div class="field">
                                <label>رابط منصة بث</label>
                                <input type="text" class="dest-url" value="${dest.url}">
                            </div>
                            <div class="field">
                                <label>مفتاح البث</label>
                                <div class="key-wrap">
                                    <input type="password" class="dest-key" value="${dest.key}">
                                    <button type="button" class="icon-btn toggle-key-btn">👁</button>
                                    <button type="button" class="danger-mini-btn remove-dest-btn" style="margin-right: 5px;">✖</button>
                                </div>
                            </div>
                        `;
                        cont.appendChild(row);
                        row.querySelector('.remove-dest-btn').onclick = () => row.remove();
                    });
                }
            }
        } catch (e) {
            console.warn("Could not load settings:", e);
        }

        // Check if stream is already running
        fetchStatus().then(() => {
            fetch('/api/stream/status')
                .then(r => r.json())
                .then(data => {
                    if (data.isLive) {
                        setLiveState(true);
                        startStatusPolling();
                        startTimer();
                    }
                }).catch(e => { });
        });
    })();
}

// Initialize based on readyStore (Modules are deferred, so DOM might be ready already)
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initStudio);
} else {
    initStudio();
}


