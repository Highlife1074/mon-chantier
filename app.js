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

let allPieces = [], allSequences = [], allIssues = [];
let tempCoords = null, selectedPieceId = null, editingSeqId = null;

let stage = new Konva.Stage({ container: 'canvas-container', width: 1000, height: 700 });
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

// --- LOGIQUE DES SÉQUENCES ---
window.addTaskRow = (data = null) => {
    const list = document.getElementById('tasks-list');
    const index = list.children.length + 1;
    const div = document.createElement('div');
    div.className = "grid grid-cols-12 gap-2 bg-white p-2 rounded border border-slate-200 items-center task-row shadow-sm";
    div.innerHTML = `
        <div class="col-span-1 text-center font-bold text-slate-400 text-xs t-id">${index}</div>
        <div class="col-span-3"><input type="text" class="w-full border p-1 rounded text-xs t-name" value="${data ? data.name : ''}"></div>
        <div class="col-span-1"><input type="number" class="w-full border p-1 rounded text-xs t-days" value="${data ? data.days : ''}"></div>
        <div class="col-span-2"><input type="text" class="w-full border p-1 rounded text-xs t-ent" value="${data ? data.ent : ''}"></div>
        <div class="col-span-2">
            <select class="w-full border p-1 rounded text-[10px] t-type">
                <option value="FS" ${data?.type === 'FS' ? 'selected' : ''}>FS (Fin-Début)</option>
                <option value="SS" ${data?.type === 'SS' ? 'selected' : ''}>SS (Début-Début)</option>
            </select>
        </div>
        <div class="col-span-1"><input type="number" placeholder="ID" class="w-full border p-1 rounded text-xs t-prec" value="${data ? data.prec : ''}"></div>
        <div class="col-span-1"><input type="number" class="w-full border p-1 rounded text-xs t-lag" value="${data ? data.lag : 0}"></div>
        <div class="col-span-1 text-right"><button onclick="this.parentElement.parentElement.remove()" class="text-red-400 hover:text-red-600 font-bold">×</button></div>
    `;
    list.appendChild(div);
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

    if (!name) return alert("Nom de séquence requis");
    if (editingSeqId) await updateDoc(doc(db, "sequences", editingSeqId), { name, tasks });
    else await addDoc(collection(db, "sequences"), { name, tasks });
    
    alert("Séquence enregistrée");
    resetSeqForm();
};

window.editSequence = (id) => {
    const seq = allSequences.find(s => s.id === id);
    editingSeqId = id;
    document.getElementById('seq-form-title').innerText = "Modification : " + seq.name;
    document.getElementById('seq-name').value = seq.name;
    document.getElementById('tasks-list').innerHTML = "";
    seq.tasks.forEach(t => addTaskRow(t));
    document.getElementById('btn-cancel-seq').classList.remove('hidden');
    switchTab('sequences');
};

window.deleteSequence = async (id) => {
    if (confirm("Supprimer cette séquence ?")) await deleteDoc(doc(db, "sequences", id));
};

window.resetSeqForm = () => {
    editingSeqId = null;
    document.getElementById('seq-form-title').innerText = "Nouvelle Séquence Type";
    document.getElementById('seq-name').value = "";
    document.getElementById('tasks-list').innerHTML = "";
    document.getElementById('btn-cancel-seq').classList.add('hidden');
    addTaskRow();
};

// --- LOGIQUE PIÈCES ---
window.processPiece = async () => {
    const name = document.getElementById('p-edit-name').value;
    const seqId = document.getElementById('p-edit-seq').value;
    const startDate = document.getElementById('p-edit-date').value;
    if (!name || !seqId || !startDate) return alert("Champs obligatoires");

    if (selectedPieceId) await updateDoc(doc(db, "pieces", selectedPieceId), { nom: name, seqId, startDate });
    else await addDoc(collection(db, "pieces"), { nom: name, x: tempCoords.x, y: tempCoords.y, seqId, startDate });
    cancelPieceEdit();
};

window.cancelPieceEdit = () => {
    selectedPieceId = null; tempCoords = null;
    document.getElementById('piece-editor').classList.add('hidden');
    renderPlan();
};

// --- PLAN ---
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

// --- SYNC ---
onSnapshot(collection(db, "sequences"), (s) => {
    allSequences = s.docs.map(d => ({ id: d.id, ...d.data() }));
    document.getElementById('list-sequences').innerHTML = allSequences.map(s => `
        <div class="p-2 bg-white border rounded shadow-sm flex justify-between items-center group">
            <span class="font-bold text-xs">${s.name}</span>
            <div class="flex gap-2">
                <button onclick="editSequence('${s.id}')" class="text-blue-500 text-xs">✏️</button>
                <button onclick="deleteSequence('${s.id}')" class="text-red-400 text-xs">🗑️</button>
            </div>
        </div>`).join('');
    updateMenus(); renderGantt();
});

onSnapshot(collection(db, "pieces"), (s) => {
    allPieces = s.docs.map(d => ({ id: d.id, ...d.data() }));
    updateMenus(); renderPlan(); renderGantt();
});

onSnapshot(collection(db, "issues"), (s) => {
    allIssues = s.docs.map(d => ({ id: d.id, ...d.data() }));
    renderPlan(); renderGantt();
    const unassigned = allIssues.filter(i => !i.pieceId);
    document.getElementById('count-unassigned').innerText = unassigned.length;
    document.getElementById('sidebar-issues-list').innerHTML = unassigned.map(i => `<button onclick="assignToSelected('${i.id}')" class="w-full p-2 text-left bg-red-50 text-red-700 text-[10px] rounded border border-red-100 mb-1 hover:bg-red-100">⚠️ ${i.desc}</button>`).join('');
    document.getElementById('list-issues-full').innerHTML = allIssues.map(i => `<div class="p-2 bg-white border rounded text-[10px]">${i.desc}</div>`).join('');
});

window.assignToSelected = async (id) => {
    if (!selectedPieceId) return alert("Sélectionnez une pièce sur le plan");
    await updateDoc(doc(db, "issues", id), { pieceId: selectedPieceId });
};

window.saveIssue = async () => {
    const desc = document.getElementById('issue-desc').value;
    if (desc) await addDoc(collection(db, "issues"), { desc, pieceId: null });
    document.getElementById('issue-desc').value = "";
};

function updateMenus() {
    const sOptions = allSequences.map(s => `<option value="${s.id}">${s.name}</option>`).join('');
    document.querySelectorAll('.select-seq-list').forEach(sel => sel.innerHTML = '<option value="">Choisir...</option>' + sOptions);
}

function renderPlan() {
    layer.find('.p-rect').forEach(r => r.destroy());
    allPieces.forEach(p => {
        const isBlocked = allIssues.some(i => i.pieceId === p.id);
        const isSelected = selectedPieceId === p.id;
        layer.add(new Konva.Rect({ x: p.x, y: p.y, width: 40, height: 30, fill: isBlocked ? '#ef4444' : (isSelected ? '#3b82f6' : '#94a3b8'), opacity: 0.7, stroke: isSelected ? 'blue' : 'black', strokeWidth: isSelected ? 3 : 1, name: 'p-rect', id: p.id }));
    });
    layer.draw();
}

// --- MOTEUR DE PLANNING EXPERT (RESEAU DE TACHES) ---
function renderGantt() {
    const container = document.getElementById('gantt-render');
    container.innerHTML = "<h3 class='font-bold text-slate-800 border-b pb-2 mb-4 uppercase text-[10px] tracking-widest'>Planning Automatique (Réseau PERT)</h3>";
    
    let resourceBusyUntil = {}; // Libération des entreprises

    allPieces.sort((a,b) => new Date(a.startDate) - new Date(b.startDate)).forEach(piece => {
        const seq = allSequences.find(s => s.id === piece.seqId);
        if (!seq) return;
        
        let pHTML = `<div class='p-4 border rounded-xl bg-slate-50 shadow-sm mb-4 border-l-4 border-blue-600'><div class='font-bold text-sm mb-2'>${piece.nom}</div>`;
        
        // Stockage des dates calculées pour chaque tâche de cette pièce
        let calculatedTasks = {};

        seq.tasks.forEach((t) => {
            let taskStart;
            
            // 1. Détermination de la date de base selon le prédécesseur
            if (!t.prec) {
                // Pas de prédécesseur -> On commence à la date de la pièce
                taskStart = new Date(piece.startDate);
            } else {
                const predecessor = calculatedTasks[t.prec];
                if (predecessor) {
                    if (t.type === "FS") {
                        // Fin de la précédente + Lag
                        taskStart = addWorkDays(predecessor.end, t.lag);
                    } else {
                        // Début de la précédente + Lag
                        taskStart = addWorkDays(predecessor.start, t.lag);
                    }
                } else {
                    taskStart = new Date(piece.startDate);
                }
            }

            // 2. Anti-collision par entreprise (Ressource)
            if (resourceBusyUntil[t.ent] && taskStart < resourceBusyUntil[t.ent]) {
                taskStart = new Date(resourceBusyUntil[t.ent]);
            }

            let taskEnd = addWorkDays(taskStart, t.days);

            // Enregistrement pour les successeurs
            calculatedTasks[t.id] = { start: new Date(taskStart), end: new Date(taskEnd) };

            pHTML += `<div class='text-[10px] flex justify-between border-t py-1 hover:bg-white transition-colors'>
                        <span class='w-8 text-slate-400 font-mono'>#${t.id}</span>
                        <span class='w-1/3 font-medium'>${t.name}</span>
                        <span class='w-1/4 italic text-slate-500'>${t.ent}</span>
                        <span class='text-right font-bold text-blue-600 font-mono'>${taskStart.toLocaleDateString()} - ${taskEnd.toLocaleDateString()}</span>
                      </div>`;
            
            // On réserve l'entreprise
            resourceBusyUntil[t.ent] = new Date(taskEnd);
        });
        container.innerHTML += pHTML + "</div>";
    });
}
addTaskRow();
