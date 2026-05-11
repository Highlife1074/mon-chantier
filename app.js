import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getFirestore, collection, addDoc, onSnapshot, updateDoc, deleteDoc, doc } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { getStorage, ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-storage.js";

// --- CONFIGURATION FIREBASE ---
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

// --- VARIABLES GLOBALES ---
let allPieces = [], allSequences = [], allIssues = [], allPlans = [];
let tempCoords = null, selectedPieceId = null, currentPlanId = null;
let isDrawingPiece = false, startDrawPos = null, currentDrawRect = null, lastCapturedCoords = null;

// --- INITIALISATION KONVA ---
const container = document.getElementById('canvas-container');
let stage = new Konva.Stage({ 
    container: 'canvas-container', 
    width: container.offsetWidth, 
    height: container.offsetHeight 
});
let layer = new Konva.Layer();
stage.add(layer);

// Désactiver le menu contextuel pour le clic droit
container.addEventListener('contextmenu', (e) => e.preventDefault());

// --- MOTEUR DE ZOOM (Molette) ---
container.addEventListener('wheel', (e) => {
    if (!currentPlanId || isDrawingPiece) return;
    e.preventDefault();
    const oldScale = stage.scaleX();
    const pointer = stage.getPointerPosition();
    const mousePointTo = { x: (pointer.x - stage.x()) / oldScale, y: (pointer.y - stage.y()) / oldScale };
    const newScale = e.deltaY > 0 ? oldScale / 1.1 : oldScale * 1.1;
    stage.scale({ x: newScale, y: newScale });
    stage.position({ x: pointer.x - mousePointTo.x * newScale, y: pointer.y - mousePointTo.y * newScale });
    stage.batchDraw();
}, { passive: false });

// --- GESTION DU CALENDRIER (6j/7) ---
function addWorkDays(startDate, days) {
    let date = new Date(startDate);
    let added = 0;
    const absDays = Math.abs(days);
    while (added < absDays) {
        date.setDate(date.getDate() + (days > 0 ? 1 : -1));
        if (date.getDay() !== 0) added++; // On saute le dimanche
    }
    return date;
}

// --- GESTION DES PLANS ---
window.selectPlan = (id) => {
    const plan = allPlans.find(p => p.id === id);
    if (!plan) return;
    currentPlanId = id;
    
    document.getElementById('no-plan-message')?.classList.add('hidden');
    layer.destroyChildren();
    
    Konva.Image.fromURL(plan.url, (img) => {
        const scale = Math.min(stage.width() / img.width(), stage.height() / img.height());
        img.setAttrs({ x: 0, y: 0, name: 'plan-image' });
        stage.scale({ x: scale, y: scale });
        stage.position({ x: 0, y: 0 });
        layer.add(img);
        renderPlan();
    }, { crossOrigin: 'anonymous' });
};

window.deletePlan = async (id, event) => {
    if (event) event.stopPropagation();
    if (!confirm("⚠️ Supprimer ce plan et TOUTES les zones associées ?")) return;
    try {
        const piecesToDel = allPieces.filter(p => p.planId === id);
        for (const p of piecesToDel) await deleteDoc(doc(db, "pieces", p.id));
        await deleteDoc(doc(db, "plans", id));
        if (currentPlanId === id) {
            currentPlanId = null;
            layer.destroyChildren();
            document.getElementById('no-plan-message')?.classList.remove('hidden');
        }
    } catch (err) { alert("Erreur : Vérifiez vos règles de suppression Firebase."); }
};

// --- LOGIQUE DE DESSIN (Cliquer-Glisser) ---
stage.on('mousedown touchstart', (e) => {
    if (!currentPlanId || selectedPieceId) return;
    const isBg = e.target.hasName('plan-image') || e.target === stage;
    if (!isBg) return;

    isDrawingPiece = true;
    const transform = stage.getAbsoluteTransform().copy().invert();
    const pos = transform.point(stage.getPointerPosition());
    startDrawPos = pos;

    currentDrawRect = new Konva.Rect({
        x: pos.x, y: pos.y, width: 0, height: 0,
        fill: 'rgba(37, 99, 235, 0.2)', stroke: '#2563eb', strokeWidth: 2, dash: [5, 5], name: 'temp-draw'
    });
    layer.add(currentDrawRect);
});

stage.on('mousemove touchmove', () => {
    if (!isDrawingPiece || !currentDrawRect) return;
    const transform = stage.getAbsoluteTransform().copy().invert();
    const pos = transform.point(stage.getPointerPosition());
    const newX = Math.min(pos.x, startDrawPos.x);
    const newY = Math.min(pos.y, startDrawPos.y);
    const newW = Math.abs(pos.x - startDrawPos.x);
    const newH = Math.abs(pos.y - startDrawPos.y);
    currentDrawRect.setAttrs({ x: newX, y: newY, width: newW, height: newH });
    layer.batchDraw();
});

stage.on('mouseup touchend', (e) => {
    if (!isDrawingPiece || !currentDrawRect) return;
    if (currentDrawRect.width() < 5 || currentDrawRect.height() < 5) {
        currentDrawRect.destroy();
        isDrawingPiece = false;
        if (e.target.name() === 'p-rect') selectPiece(e.target.id());
        return;
    }
    lastCapturedCoords = { x: currentDrawRect.x(), y: currentDrawRect.y(), width: currentDrawRect.width(), height: currentDrawRect.height() };
    currentDrawRect.destroy();
    isDrawingPiece = false;
    selectedPieceId = null;
    openEditor();
});

function selectPiece(id) {
    selectedPieceId = id;
    const p = allPieces.find(piece => piece.id === id);
    openEditor(p);
    renderPlan();
}

function openEditor(data = null) {
    const editor = document.getElementById('piece-editor');
    editor.classList.remove('hidden');
    document.getElementById('p-edit-name').value = data ? data.nom : "";
    document.getElementById('p-edit-seq').value = data ? data.seqId : "";
    document.getElementById('p-edit-date').value = data ? data.startDate : "";
}

window.cancelPieceEdit = () => {
    selectedPieceId = null;
    document.getElementById('piece-editor').classList.add('hidden');
    renderPlan();
};

// --- PERSISTENCE FIREBASE ---
window.processPiece = async () => {
    const nom = document.getElementById('p-edit-name').value;
    const seqId = document.getElementById('p-edit-seq').value;
    const startDate = document.getElementById('p-edit-date').value;
    if (!nom || !seqId || !startDate) return alert("Champs manquants !");

    if (selectedPieceId) {
        await updateDoc(doc(db, "pieces", selectedPieceId), { nom, seqId, startDate });
    } else {
        await addDoc(collection(db, "pieces"), { 
            nom, seqId, startDate, planId: currentPlanId,
            x: lastCapturedCoords.x, y: lastCapturedCoords.y, 
            width: lastCapturedCoords.width, height: lastCapturedCoords.height 
        });
    }
    cancelPieceEdit();
};

// --- SYNCHRONISATION TEMPS RÉEL ---
onSnapshot(collection(db, "plans"), (s) => {
    allPlans = s.docs.map(d => ({ id: d.id, ...d.data() }));
    document.getElementById('plans-list').innerHTML = allPlans.map(p => `
        <div class="flex items-center justify-between group p-2 border rounded-lg bg-white hover:bg-slate-50 transition-all">
            <div onclick="selectPlan('${p.id}')" class="flex-1 cursor-pointer text-[11px] truncate ${currentPlanId === p.id ? 'text-blue-600 font-bold' : ''}">📄 ${p.name}</div>
            <button onclick="deletePlan('${p.id}', event)" class="text-red-400 hover:text-red-600 opacity-0 group-hover:opacity-100 transition-opacity">🗑️</button>
        </div>
    `).join('');
});

onSnapshot(collection(db, "pieces"), (s) => {
    allPieces = s.docs.map(d => ({ id: d.id, ...d.data() }));
    renderPlan(); renderGantt();
});

onSnapshot(collection(db, "sequences"), (s) => {
    allSequences = s.docs.map(d => ({ id: d.id, ...d.data() }));
    updateMenus(); renderGantt();
    document.getElementById('list-sequences').innerHTML = allSequences.map(s => `
        <div class="p-2 bg-white border rounded text-[10px] flex justify-between group shadow-sm">
            <strong>${s.name}</strong>
            <button onclick="deleteSequence('${s.id}')" class="text-red-400 opacity-0 group-hover:opacity-100">🗑️</button>
        </div>`).join('');
});

onSnapshot(collection(db, "issues"), (s) => {
    allIssues = s.docs.map(d => ({ id: d.id, ...d.data() }));
    renderPlan();
    const unassigned = allIssues.filter(i => !i.pieceId);
    document.getElementById('count-unassigned').innerText = unassigned.length;
    document.getElementById('sidebar-issues-list').innerHTML = unassigned.map(i => `
        <button onclick="assignToSelected('${i.id}')" class="w-full p-2 text-left bg-red-50 text-red-700 text-[10px] rounded border border-red-100 mb-1 hover:bg-red-100 transition-all">⚠️ ${i.desc}</button>
    `).join('');
});

// --- DESSIN DES PIÈCES ---
function renderPlan() {
    layer.find('.p-rect').forEach(r => r.destroy());
    allPieces.filter(p => p.planId === currentPlanId).forEach(p => {
        const isBlocked = allIssues.some(i => i.pieceId === p.id);
        const isSelected = selectedPieceId === p.id;
        layer.add(new Konva.Rect({ 
            x: p.x, y: p.y, width: p.width || 40, height: p.height || 30, 
            fill: isBlocked ? '#ef4444' : (isSelected ? '#3b82f6' : '#94a3b8'), 
            opacity: 0.6, stroke: isSelected ? 'blue' : 'black', strokeWidth: isSelected ? 3 : 1,
            name: 'p-rect', id: p.id 
        }));
    });
    layer.draw();
}

// --- MOTEUR DE PLANNING (PERT + RESSOURCES) ---
function renderGantt() {
    const container = document.getElementById('gantt-render');
    container.innerHTML = "<h3 class='font-bold text-xs uppercase mb-4 tracking-widest'>Planning de Production PERT</h3>";
    let busy = {};
    allPieces.sort((a,b) => new Date(a.startDate) - new Date(b.startDate)).forEach(piece => {
        const seq = allSequences.find(s => s.id === piece.seqId);
        if (!seq) return;
        let pHTML = `<div class='p-3 border rounded-xl bg-white shadow-sm mb-4 border-l-4 border-blue-600'><div class='font-bold text-xs'>${piece.nom}</div>`;
        let calculatedTasks = {};
        seq.tasks.forEach((t) => {
            let s = (!t.prec) ? new Date(piece.startDate) : (t.type === "FS" ? addWorkDays(calculatedTasks[t.prec]?.end, t.lag) : addWorkDays(calculatedTasks[t.prec]?.start, t.lag));
            if (busy[t.ent] && s < busy[t.ent]) s = new Date(busy[t.ent]);
            let e = addWorkDays(s, t.days);
            calculatedTasks[t.id] = { start: s, end: e };
            pHTML += `<div class='text-[9px] flex justify-between border-t py-1 opacity-80'><span>#${t.id} ${t.name} (${t.ent})</span><span class='font-bold'>${s.toLocaleDateString()} - ${e.toLocaleDateString()}</span></div>`;
            busy[t.ent] = new Date(e);
        });
        container.innerHTML += pHTML + "</div>";
    });
}

// --- GESTION SÉQUENCES & BLOQUANTS ---
window.addTaskRow = (data = null) => {
    const div = document.createElement('div');
    div.className = "flex gap-2 task-row items-end bg-slate-50 p-1 rounded border border-slate-200";
    div.innerHTML = `
        <input type="text" class="w-1/3 border p-1 rounded text-[10px] t-name" placeholder="Tâche" value="${data?data.name:''}">
        <input type="number" class="w-12 border p-1 rounded text-[10px] t-days" placeholder="Jours" value="${data?data.days:''}">
        <input type="text" class="w-20 border p-1 rounded text-[10px] t-ent" placeholder="Ent." value="${data?data.ent:''}">
        <select class="border p-1 rounded text-[8px] t-type"><option value="FS">FS</option><option value="SS">SS</option></select>
        <input type="number" placeholder="Préc." class="w-12 border p-1 rounded text-[10px] t-prec" value="${data?data.prec:''}">
        <input type="number" class="w-10 border p-1 rounded text-[10px] t-lag" value="${data?data.lag:0}">
        <button onclick="this.parentElement.remove()" class="text-red-500 font-bold px-1">×</button>`;
    document.getElementById('tasks-list').appendChild(div);
};

window.saveSequence = async () => {
    const name = document.getElementById('seq-name').value;
    const tasks = Array.from(document.querySelectorAll('.task-row')).map((row, idx) => ({
        id: idx + 1, name: row.querySelector('.t-name').value, days: parseInt(row.querySelector('.t-days').value) || 1, 
        ent: row.querySelector('.t-ent').value, type: row.querySelector('.t-type').value, 
        prec: row.querySelector('.t-prec').value ? parseInt(row.querySelector('.t-prec').value) : (idx > 0 ? idx : null), 
        lag: parseInt(row.querySelector('.t-lag').value) || 0
    }));
    if (name) await addDoc(collection(db, "sequences"), { name, tasks });
    document.getElementById('seq-name').value = ""; document.getElementById('tasks-list').innerHTML = ""; addTaskRow();
};

window.deleteSequence = async (id) => { if (confirm("Supprimer ce modèle ?")) await deleteDoc(doc(db, "sequences", id)); };

window.saveIssue = async () => {
    const desc = document.getElementById('issue-desc').value;
    if (desc) await addDoc(collection(db, "issues"), { desc, pieceId: null });
    document.getElementById('issue-desc').value = "";
};

window.assignToSelected = async (id) => { if (selectedPieceId) await updateDoc(doc(db, "issues", id), { pieceId: selectedPieceId }); };

const miniDrop = document.getElementById('mini-drop-zone');
miniDrop.ondrop = async (e) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) {
        document.getElementById('upload-progress').classList.remove('hidden');
        const storageRef = ref(storage, `plans/${Date.now()}_${file.name}`);
        await uploadBytes(storageRef, file);
        const url = await getDownloadURL(storageRef);
        await addDoc(collection(db, "plans"), { name: file.name, url: url, createdAt: Date.now() });
        document.getElementById('upload-progress').classList.add('hidden');
    }
};
miniDrop.ondragover = (e) => e.preventDefault();

function updateMenus() {
    const sOptions = allSequences.map(s => `<option value="${s.id}">${s.name}</option>`).join('');
    document.querySelectorAll('.select-seq-list').forEach(sel => sel.innerHTML = '<option value="">Choisir...</option>' + sOptions);
}

// Initialisation
addTaskRow();
