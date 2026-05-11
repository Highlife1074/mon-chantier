import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getFirestore, collection, addDoc, onSnapshot, updateDoc, deleteDoc, doc } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
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

let allPieces = [], allSequences = [], allIssues = [], allPlans = [];
let tempCoords = null, selectedPieceId = null, editingSeqId = null, currentPlanId = null;

// --- INITIALISATION DESSIN ---
let stage = new Konva.Stage({ container: 'canvas-container', width: 1200, height: 800 });
let layer = new Konva.Layer();
stage.add(layer);

function addWorkDays(startDate, days) {
    let date = new Date(startDate);
    let added = 0;
    while (added < Math.abs(days)) {
        date.setDate(date.getDate() + (days > 0 ? 1 : -1));
        if (date.getDay() !== 0) added++;
    }
    return date;
}

// --- GESTION MULTI-PLANS ---
const dropZone = document.getElementById('mini-drop-zone');
dropZone.ondrop = async (e) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (!file) return;

    document.getElementById('upload-progress').classList.remove('hidden');
    try {
        const storageRef = ref(storage, `plans/${Date.now()}_${file.name}`);
        await uploadBytes(storageRef, file);
        const url = await getDownloadURL(storageRef);
        
        // On enregistre le plan dans Firestore pour le lister plus tard
        await addDoc(collection(db, "plans"), {
            name: file.name,
            url: url,
            createdAt: Date.now()
        });
        alert("Plan ajouté à la bibliothèque !");
    } catch (err) { alert("Erreur upload"); }
    document.getElementById('upload-progress').classList.add('hidden');
};
dropZone.ondragover = (e) => e.preventDefault();

window.selectPlan = (id) => {
    const plan = allPlans.find(p => p.id === id);
    if (!plan) return;
    
    currentPlanId = id;
    document.getElementById('no-plan-message').classList.add('hidden');
    
    // On nettoie le canvas avant d'afficher le nouveau fond
    layer.destroyChildren();
    
    Konva.Image.fromURL(plan.url, (img) => {
        img.setAttrs({ x: 0, y: 0, name: 'plan-image' });
        layer.add(img);
        img.moveToBottom();
        renderPlan(); // On redessine les pièces par-dessus
    });
};

// --- LOGIQUE PIÈCES ---
window.processPiece = async () => {
    if (!currentPlanId) return alert("Sélectionnez un plan d'abord !");
    const nom = document.getElementById('p-edit-name').value;
    const seqId = document.getElementById('p-edit-seq').value;
    const startDate = document.getElementById('p-edit-date').value;
    
    if (selectedPieceId) {
        await updateDoc(doc(db, "pieces", selectedPieceId), { nom, seqId, startDate });
    } else {
        await addDoc(collection(db, "pieces"), { 
            nom, seqId, startDate, 
            x: tempCoords.x, y: tempCoords.y, 
            planId: currentPlanId 
        });
    }
    cancelPieceEdit();
};

window.cancelPieceEdit = () => {
    selectedPieceId = null; tempCoords = null;
    document.getElementById('piece-editor').classList.add('hidden');
    renderPlan();
};

stage.on('click', (e) => {
    if (!currentPlanId) return;
    if (e.target.hasName('plan-image')) {
        tempCoords = stage.getPointerPosition();
        selectedPieceId = null;
        document.getElementById('p-edit-name').value = "";
        document.getElementById('piece-editor').classList.remove('hidden');
        renderPlan();
    } else if (e.target.name() === 'p-rect') {
        selectedPieceId = e.target.id();
        const p = allPieces.find(piece => piece.id === selectedPieceId);
        document.getElementById('p-edit-name').value = p.nom;
        document.getElementById('p-edit-seq').value = p.seqId;
        document.getElementById('p-edit-date').value = p.startDate;
        document.getElementById('piece-editor').classList.remove('hidden');
        renderPlan();
    }
});

// --- SYNC TEMPS RÉEL ---
onSnapshot(collection(db, "plans"), (s) => {
    allPlans = s.docs.map(d => ({ id: d.id, ...d.data() }));
    document.getElementById('plans-list').innerHTML = allPlans.map(p => `
        <div onclick="selectPlan('${p.id}')" class="p-2 border rounded-lg text-[10px] bg-slate-50 cursor-pointer hover:bg-blue-50 transition-colors plan-item ${currentPlanId === p.id ? 'active' : ''}">
            📄 ${p.name}
        </div>`).join('');
});

onSnapshot(collection(db, "pieces"), (s) => {
    allPieces = s.docs.map(d => ({ id: d.id, ...d.data() }));
    updateMenus(); renderPlan(); renderGantt();
});

onSnapshot(collection(db, "sequences"), (s) => {
    allSequences = s.docs.map(d => ({ id: d.id, ...d.data() }));
    document.getElementById('list-sequences').innerHTML = allSequences.map(s => `
        <div class="p-2 bg-white border rounded shadow-sm text-[10px] flex justify-between">
            <strong>${s.name}</strong>
            <button onclick="editSequence('${s.id}')">✏️</button>
        </div>`).join('');
    updateMenus(); renderGantt();
});

onSnapshot(collection(db, "issues"), (s) => {
    allIssues = s.docs.map(d => ({ id: d.id, ...d.data() }));
    renderPlan(); renderGantt();
    const unassigned = allIssues.filter(i => !i.pieceId);
    document.getElementById('sidebar-issues-list').innerHTML = unassigned.map(i => `
        <button onclick="assignToSelected('${i.id}')" class="w-full p-2 text-left bg-red-50 text-red-700 text-[10px] rounded border border-red-100 mb-1">
            ⚠️ ${i.desc}
        </button>`).join('');
});

function renderPlan() {
    layer.find('.p-rect').forEach(r => r.destroy());
    // On ne dessine que les pièces qui appartiennent au plan sélectionné
    allPieces.filter(p => p.planId === currentPlanId).forEach(p => {
        const isBlocked = allIssues.some(i => i.pieceId === p.id);
        const isSelected = selectedPieceId === p.id;
        layer.add(new Konva.Rect({ 
            x: p.x, y: p.y, width: 40, height: 30, 
            fill: isBlocked ? '#ef4444' : (isSelected ? '#3b82f6' : '#94a3b8'), 
            opacity: 0.6, stroke: isSelected ? 'blue' : 'black', strokeWidth: isSelected ? 3 : 1,
            name: 'p-rect', id: p.id 
        }));
    });
    layer.draw();
}

// --- MOTEUR GANTT ---
function renderGantt() {
    const container = document.getElementById('gantt-render');
    container.innerHTML = "PLANNING GÉNÉRAL";
    let busy = {};
    allPieces.sort((a,b) => new Date(a.startDate) - new Date(b.startDate)).forEach(piece => {
        const seq = allSequences.find(s => s.id === piece.seqId);
        if (!seq) return;
        const plan = allPlans.find(pl => pl.id === piece.planId);
        let pHTML = `<div class='p-2 border rounded bg-white mb-2'>
                     <div class='font-bold uppercase text-[10px] text-blue-600'>${plan ? plan.name : 'Inconnu'} > ${piece.nom}</div>`;
        let calculatedTasks = {};
        seq.tasks.forEach((t) => {
            let s = (!t.prec) ? new Date(piece.startDate) : (t.type === "FS" ? addWorkDays(calculatedTasks[t.prec]?.end, t.lag) : addWorkDays(calculatedTasks[t.prec]?.start, t.lag));
            if (busy[t.ent] && s < busy[t.ent]) s = new Date(busy[t.ent]);
            let e = addWorkDays(s, t.days);
            calculatedTasks[t.id] = { start: s, end: e };
            pHTML += `<div class='flex justify-between border-t py-1 opacity-70'><span>#${t.id} ${t.name}</span><span>${s.toLocaleDateString()} - ${e.toLocaleDateString()}</span></div>`;
            busy[t.ent] = new Date(e);
        });
        container.innerHTML += pHTML + "</div>";
    });
}

// Fonctions Séquences (identiques à précédemment)
window.addTaskRow = (data = null) => {
    const div = document.createElement('div');
    div.className = "flex gap-2 task-row items-end bg-slate-50 p-1 rounded border";
    div.innerHTML = `<input type="text" class="w-1/3 border p-1 rounded text-[10px] t-name" value="${data?data.name:''}">
                     <input type="number" class="w-12 border p-1 rounded text-[10px] t-days" value="${data?data.days:''}">
                     <input type="text" class="w-20 border p-1 rounded text-[10px] t-ent" value="${data?data.ent:''}">
                     <select class="border p-1 rounded text-[8px] t-type"><option value="FS">FS</option><option value="SS">SS</option></select>
                     <input type="number" placeholder="Préc." class="w-12 border p-1 rounded text-[10px] t-prec" value="${data?data.prec:''}">
                     <input type="number" class="w-10 border p-1 rounded text-[10px] t-lag" value="${data?data.lag:0}">`;
    document.getElementById('tasks-list').appendChild(div);
};

window.saveSequence = async () => {
    const name = document.getElementById('seq-name').value;
    const tasks = Array.from(document.querySelectorAll('.task-row')).map((row, idx) => ({
        id: idx + 1,
        name: row.querySelector('.t-name').value,
        days: parseInt(row.querySelector('.t-days').value) || 1,
        ent: row.querySelector('.t-ent').value,
        type: row.querySelector('.t-type').value,
        prec: row.querySelector('.t-prec').value ? parseInt(row.querySelector('.t-prec').value) : (idx > 0 ? idx : null),
        lag: parseInt(row.querySelector('.t-lag').value) || 0
    }));
    if (name) await addDoc(collection(db, "sequences"), { name, tasks });
};

window.saveIssue = async () => {
    const desc = document.getElementById('issue-desc').value;
    if (desc) await addDoc(collection(db, "issues"), { desc, pieceId: null });
    document.getElementById('issue-desc').value = "";
};

window.assignToSelected = async (id) => {
    if (!selectedPieceId) return alert("Sélectionnez une pièce !");
    await updateDoc(doc(db, "issues", id), { pieceId: selectedPieceId });
};

function updateMenus() {
    const sOptions = allSequences.map(s => `<option value="${s.id}">${s.name}</option>`).join('');
    document.querySelectorAll('.select-seq-list').forEach(sel => sel.innerHTML = '<option value="">Séquence...</option>' + sOptions);
}

addTaskRow();
