import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getFirestore, collection, addDoc, onSnapshot } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
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

// Variables globales pour le moteur de calcul[cite: 1]
let allPieces = [], allSequences = [], allIssues = [];
let tempCoords = null;

// --- DESSIN ---
let stage = new Konva.Stage({ container: 'canvas-container', width: 1200, height: 800 });
let layer = new Konva.Layer();
stage.add(layer);

// --- FONCTIONS GLOBALES (Accessibles par les boutons HTML) ---
window.addTaskRow = () => {
    const div = document.createElement('div');
    div.className = "flex gap-2 bg-slate-50 p-2 rounded";
    div.innerHTML = '<input type="text" placeholder="Tâche" class="w-1/3 border p-1 rounded t-name"><input type="number" placeholder="Jours" class="w-16 border p-1 rounded t-days"><input type="text" placeholder="Ent." class="w-1/4 border p-1 rounded t-ent"><label class="text-[10px]"><input type="checkbox" class="t-overlap"> Overlap</label>';
    document.getElementById('tasks-list').appendChild(div);
};

window.saveSequence = async () => {
    const name = document.getElementById('seq-name').value;
    const tasks = Array.from(document.querySelectorAll('#tasks-list > div')).map(row => ({
        name: row.querySelector('.t-name').value,
        days: row.querySelector('.t-days').value,
        ent: row.querySelector('.t-ent').value,
        overlap: row.querySelector('.t-overlap').checked
    }));
    if (!name) return alert("Nom manquant");
    await addDoc(collection(db, "sequences"), { name, tasks });
    alert("Séquence enregistrée ![cite: 1]");
    document.getElementById('seq-name').value = "";
};

window.saveSD = async () => {
    const ref = document.getElementById('sd-ref').value;
    const pieceId = document.getElementById('sd-piece').value;
    if (!ref || !pieceId) return alert("Manque info");
    await addDoc(collection(db, "sd"), { ref, pieceId, status: "En cours" });
    alert("SD Lié ![cite: 1]");
};

window.saveIssue = async () => {
    const desc = document.getElementById('issue-desc').value;
    const pieceId = document.getElementById('issue-piece').value;
    if (!desc || !pieceId) return alert("Manque info");
    await addDoc(collection(db, "issues"), { desc, pieceId });
    alert("Blocage enregistré ![cite: 1]");
};

window.saveNewPiece = async () => {
    const nom = document.getElementById('new-piece-name').value;
    const seqId = document.getElementById('new-piece-seq').value;
    const date = document.getElementById('new-piece-date').value;
    if (nom && tempCoords && seqId && date) {
        await addDoc(collection(db, "pieces"), { nom, x: tempCoords.x, y: tempCoords.y, seqId, startDate: date });
        document.getElementById('piece-editor').classList.add('hidden');
        alert("Pièce créée ![cite: 1]");
    } else { alert("Veuillez remplir tous les champs"); }
};

// --- GESTION DU PLAN ---
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
    }
});

// --- ÉCOUTE TEMPS RÉEL ---
onSnapshot(collection(db, "pieces"), (s) => {
    allPieces = s.docs.map(d => ({ id: d.id, ...d.data() }));
    updateMenus(); renderPlan(); renderGantt();
});
onSnapshot(collection(db, "sequences"), (s) => {
    allSequences = s.docs.map(d => ({ id: d.id, ...d.data() }));
    updateMenus(); renderGantt();
    document.getElementById('list-sequences').innerHTML = allSequences.map(s => `<div class="p-2 bg-slate-100 rounded">${s.name}</div>`).join('');
});
onSnapshot(collection(db, "issues"), (s) => {
    allIssues = s.docs.map(d => ({ id: d.id, ...d.data() }));
    renderPlan(); renderGantt();
    document.getElementById('list-issues').innerHTML = allIssues.map(i => `<div class="p-2 bg-red-50 text-red-700 rounded">⚠️ ${i.desc}</div>`).join('');
});
onSnapshot(collection(db, "sd"), (s) => {
    document.getElementById('list-sd').innerHTML = s.docs.map(d => `<div class="p-2 border-b">${d.data().ref}</div>`).join('');
});

function updateMenus() {
    const pOptions = allPieces.map(p => `<option value="${p.id}">${p.nom}</option>`).join('');
    document.querySelectorAll('.select-pieces-list').forEach(sel => sel.innerHTML = '<option value="">Choisir pièce...</option>' + pOptions);
    const sOptions = allSequences.map(s => `<option value="${s.id}">${s.name}</option>`).join('');
    document.querySelectorAll('.select-seq-list').forEach(sel => sel.innerHTML = '<option value="">Séquence...</option>' + sOptions);
}

function renderPlan() {
    layer.find('.p-rect').forEach(r => r.destroy());
    allPieces.forEach(p => {
        const isBlocked = allIssues.some(i => i.pieceId === p.id);
        layer.add(new Konva.Rect({ x: p.x, y: p.y, width: 50, height: 40, fill: isBlocked ? 'red' : 'blue', opacity: 0.4, name: 'p-rect' }));
    });
    layer.draw();
}

function renderGantt() {
    const container = document.getElementById('gantt-render');
    container.innerHTML = "<h3>Planning Automatique[cite: 1]</h3>";
    let resourceBusyUntil = {};

    allPieces.sort((a,b) => new Date(a.startDate) - new Date(b.startDate)).forEach(piece => {
        const seq = allSequences.find(s => s.id === piece.seqId);
        if (!seq) return;
        let pHTML = `<div class="p-3 border rounded bg-white shadow-sm"><strong>${piece.nom}</strong>`;
        let curStart = new Date(piece.startDate);

        seq.tasks.forEach(t => {
            if (!t.overlap && resourceBusyUntil[t.ent] && curStart < resourceBusyUntil[t.ent]) {
                curStart = new Date(resourceBusyUntil[t.ent]);
            }
            let end = new Date(curStart);
            end.setDate(end.getDate() + parseInt(t.days));
            pHTML += `<div class="text-[10px] flex justify-between"><span>${t.name} (${t.ent})</span> <span>${curStart.toLocaleDateString()} - ${end.toLocaleDateString()}</span></div>`;
            if (!t.overlap) resourceBusyUntil[t.ent] = new Date(end);
            curStart = new Date(end);
        });
        container.innerHTML += pHTML + `</div>`;
    });
}
