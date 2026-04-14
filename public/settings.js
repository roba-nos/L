import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getFirestore, doc, setDoc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

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

function createRow(url = '', key = '') {
    const cont = document.getElementById('integrations-list');
    const row = document.createElement('div');
    row.style.display = 'flex';
    row.style.gap = '15px';
    row.style.alignItems = 'flex-end';
    row.className = 'dest-row-set';
    
    row.innerHTML = `
        <div class="field" style="flex:2;">
            <label>رابط المنصة (RTMP)</label>
            <input type="text" class="set-url" value="${url}" placeholder="rtmp://...">
        </div>
        <div class="field" style="flex:2;">
            <label>مفتاح البث (Key)</label>
            <input type="password" class="set-key" value="${key}" placeholder="live_...">
        </div>
        <button type="button" class="danger-mini-btn remove-row-btn" style="height: 40px; margin-bottom: 2px;">حذف</button>
    `;
    cont.appendChild(row);

    row.querySelector('.remove-row-btn').onclick = () => row.remove();
}

async function loadSettings() {
    try {
        const docSnap = await getDoc(doc(db, "studio", "settings"));
        if (docSnap.exists()) {
            const data = docSnap.data();
            if (data.destinations && data.destinations.length > 0) {
                data.destinations.forEach(d => createRow(d.url, d.key));
                return;
            }
        }
        // Fallback default
        createRow();
    } catch (e) {
        console.warn("Load error", e);
        createRow();
    }
}

document.addEventListener('DOMContentLoaded', () => {
    loadSettings();

    document.getElementById('add-dest-btn').onclick = () => createRow();

    document.getElementById('save-settings-btn').onclick = async () => {
        const destinations = [];
        document.querySelectorAll('.dest-row-set').forEach(row => {
            const url = row.querySelector('.set-url').value.trim();
            const key = row.querySelector('.set-key').value.trim();
            if (url && key) destinations.push({ url, key });
        });

        document.getElementById('save-settings-btn').textContent = 'جارٍ الحفظ...';

        try {
            await setDoc(doc(db, "studio", "settings"), { destinations });
            document.getElementById('save-settings-btn').textContent = 'تم الحفظ بنجاح! ✓';
            setTimeout(() => {
                document.getElementById('save-settings-btn').textContent = 'حفظ التغييرات';
            }, 3000);
        } catch (err) {
            alert('Error saving: ' + err.message);
            document.getElementById('save-settings-btn').textContent = 'حفظ التغييرات';
        }
    };
});
