import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getFirestore, collection, addDoc, onSnapshot, updateDoc, doc } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { getStorage, ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-storage.js";

const firebaseConfig = {
    apiKey: "AIzaSyB7hNu1hPJ_Cqbjqm_6cUN9BW_s77xjphE",
    authDomain: "planning-c2fc1.firebaseapp.com",
    projectId: "planning-c2fc1",
    storageBucket: "planning-c2fc1.firebasestorage.app",
    messagingSenderId: "1098649670059",
    appId: "1:1098649670059:web:0bd00a157faff09b7242ee"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const storage = getStorage(app);

let allPieces = [], allSequences = [], allIssues = [];
let tempCoords = null;
let selectedPieceId = null;

// --- DESSIN ---
let stage = new Konva.Stage({ container: 'canvas-container', width: 1000, height: 700 });
let layer = new Konva.Layer();
stage.add(layer);

function addWorkDays(startDate, days) {
    let date = new Date(startDate);
    let added = 0;
    while (added < days) {
        date.setDate(date.getDate() + 1);
        if (date.getDay() !== 0) added++;
    }
    return date;
}

// --- FONCTIONS GLOBALES ---
window.addTaskRow = () => {
    const div = document.createElement('div');
    div.className = "flex gap-2 bg-slate-50 p-2 rounded items-end";
    div.innerHTML = `<div class="flex-1"><input type="text" class="w-full border p-1 rounded t-name"></div><div class="w-16"><input type="number" class="w-full border p-1 rounded t-days"></div><div class="w-20"><input type="text" class="w-full border p-1 rounded t-ent"></div><div class="w-24"><select class="w-full border p-1 rounded t-type"><option value="FS">Fin-Début</option><option value="SS">Début-Début</option></select></div><div class="w-16"><input type="number" value="0" class="w-full border p-1 rounded t-lag"></div><div class="flex flex-col items-center"><input type="checkbox" class="t-overlap"></div>`;
    document.getElementById('tasks-list').appendChild(div);
};

window.saveSequence = async () => {
    const name = document.getElementById('seq-name').value;
    const tasks = Array.from(document.querySelectorAll('#tasks-list > div')).map(row => ({
        name: row.querySelector('.t-name').value,
        days: parseInt(row.querySelector('.t-days').value) || 1,
        ent: row.querySelector('.t-ent').value,
        type: row.querySelector('.t-type').value,
        lag: parseInt(row.querySelector('.t-lag').value) || 0,
        overlap: row.querySelector('.t-overlap').checked
    }));
    if (name) await addDoc(collection(db, "sequences"), { name, tasks });
    alert("Séquence enregistrée !");
};

window.saveIssue = async () => {
    const desc = document.getElementById('issue-desc').value;
    if (desc) await addDoc(collection(db, "issues"), { desc, pieceId: null });
};

window.assignIssue = async (issueId) => {
    if (!selectedPieceId) return alert("Cliquez sur une pièce sur le plan d'abord !");
    await updateDoc(doc(db, "issues", issueId), { pieceId: selectedPieceId });
};

window.saveNewPiece = async () => {
    const nom = document.getElementById('new-piece-name').value;
    const seqId = document.getElementById('new-piece-seq').value;
    const date = document.getElementById('new-piece-date').value;
    if (nom && tempCoords && seqId && date) {
        await addDoc(collection(db, "pieces"), { nom, x: tempCoords.x, y: tempCoords.y, seqId, startDate: date });
        document.getElementById('piece-editor').classList.add('hidden');
    }
};

// --- LOGIQUE PLAN ---
const dropZone = document.getElementById('drag-drop-zone');
dropZone.ondrop = async (e) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) {
        const storageRef = ref(storage, 'plans/' + file.name);
        await uploadBytes(storageRef, file);
        const url = await getDownloadURL(storageRef);
        Konva.Image.fromURL(url, (img) => {
            layer.add(img); img.moveToBottom(); layer.draw();
            dropZone.classList.add('hidden');
            document.getElementById('canvas-container').classList.remove('hidden');
        });
    }
};
dropZone.ondragover = (e) => e.preventDefault();

stage.on('click', (e) => {
    if (e.target.className === 'Image') {
        tempCoords = stage.getPointerPosition();
        document.getElementById('piece-editor').classList.remove('hidden');
        selectedPieceId = null;
        renderPlan();
    } else if (e.target.name() === 'p-rect') {
        selectedPieceId = e.target.id();
        renderPlan();
    }
});

// --- SYNC ---
onSnapshot(collection(db, "pieces"), (s) => {
    allPieces = s.docs.map(d => ({ id: d.id, ...d.data() }));
    updateMenus(); renderPlan(); renderGantt();
});
onSnapshot(collection(db, "sequences"), (s) => {
    allSequences = s.docs.map(d => ({ id: d.id, ...d.data() }));
    updateMenus(); renderGantt();
    document.getElementById('list-sequences').innerHTML = allSequences.map(s => `<div class="p-2 bg-slate-50 rounded text-sm">${s.name}</div>`).join('');
});
onSnapshot(collection(db, "issues"), (s) => {
    allIssues = s.docs.map(d => ({ id: d.id, ...d.data() }));
    renderPlan(); renderGantt();
    document.getElementById('list-issues-full').innerHTML = allIssues.map(i => `<div class="p-2 bg-white border rounded text-xs">${i.desc} ${i.pieceId ? '✅' : ''}</div>`).join('');
    document.getElementById('sidebar-issues-list').innerHTML = allIssues.filter(i => !i.pieceId).map(i => `<button onclick="assignIssue('${i.id}')" class="w-full p-2 text-left bg-red-50 text-red-700 text-[10px] rounded border border-red-100 hover:bg-red-100 mb-1">⚠️ ${i.desc}</button>`).join('');
});

function updateMenus() {
    const sOptions = allSequences.map(s => `<option value="${s.id}">${s.name}</option>`).join('');
    document.querySelectorAll('.select-seq-list').forEach(sel => sel.innerHTML = '<option value="">Séquence...</option>' + sOptions);
}

function renderPlan() {
    layer.find('.p-rect').forEach(r => r.destroy());
    allPieces.forEach(p => {
        const isBlocked = allIssues.some(i => i.pieceId === p.id);
        const isSelected = selectedPieceId === p.id;
        layer.add(new Konva.Rect({ 
            x: p.x, y: p.y, width: 40, height: 30, 
            fill: isBlocked ? '#ef4444' : (isSelected ? '#3b82f6' : '#94a3b8'), 
            opacity: 0.6, stroke: isSelected ? 'white' : 'black', strokeWidth: isSelected ? 2 : 1,
            name: 'p-rect', id: p.id 
        }));
    });
    layer.draw();
}

function renderGantt() {
    const container = document.getElementById('gantt-render');
    container.innerHTML = "<h3 class='font-bold text-slate-800'>Planning Automatique 6j/7</h3>";
    let resourceBusyUntil = {};
    allPieces.sort((a,b) => new Date(a.startDate) - new Date(b.startDate)).forEach(piece => {
        const seq = allSequences.find(s => s.id === piece.seqId);
        if (!seq) return;
        let pHTML = `<div class='p-3 border rounded bg-slate-50 mb-2'><div class='font-bold text-sm'>${piece.nom}</div>`;
        let lastTaskStart = new Date(piece.startDate), lastTaskEnd = new Date(piece.startDate);
        seq.tasks.forEach((t, index) => {
            let taskStart = (index === 0) ? new Date(piece.startDate) : (t.type === "FS" ? addWorkDays(lastTaskEnd, t.lag) : addWorkDays(lastTaskStart, t.lag));
            if (!t.overlap && resourceBusyUntil[t.ent] && taskStart < resourceBusyUntil[t.ent]) taskStart = new Date(resourceBusyUntil[t.ent]);
            let taskEnd = addWorkDays(taskStart, t.days);
            pHTML += `<div class='text-[10px] flex justify-between border-t border-slate-200 mt-1 py-1'><span>${t.name} (${t.ent})</span><span class='font-mono'>${taskStart.toLocaleDateString()} - ${taskEnd.toLocaleDateString()}</span></div>`;
            if (!t.overlap) resourceBusyUntil[t.ent] = new Date(taskEnd);
            lastTaskStart = new Date(taskStart); lastTaskEnd = new Date(taskEnd);
        });
        container.innerHTML += pHTML + "</div>";
    });
}
