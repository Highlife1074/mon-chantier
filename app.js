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
let tempCoords = null, selectedPieceId = null, currentPlanId = null;
let isDrawingPiece = false, startDrawPos = null, currentDrawRect = null, lastCapturedCoords = null;

// --- INITIALISATION KONVA ---
const container = document.getElementById('canvas-container');
let stage = new Konva.Stage({ 
    container: 'canvas-container', 
    width: container.offsetWidth, 
    height: container.offsetHeight,
    draggable: false // On gère le drag manuellement pour ne pas interférer avec le dessin
});
let layer = new Konva.Layer();
stage.add(layer);

// Désactiver le menu contextuel pour libérer le clic droit pour le PAN
container.addEventListener('contextmenu', (e) => e.preventDefault());

// --- MOTEUR DE ZOOM (Molette) ---
stage.on('wheel', (e) => {
    e.evt.preventDefault();
    const oldScale = stage.scaleX();
    const pointer = stage.getPointerPosition();

    // Position relative du curseur avant le zoom
    const mousePointTo = {
        x: (pointer.x - stage.x()) / oldScale,
        y: (pointer.y - stage.y()) / oldScale,
    };

    // Calcul du nouveau scale
    const newScale = e.evt.deltaY > 0 ? oldScale / 1.1 : oldScale * 1.1;
    stage.scale({ x: newScale, y: newScale });

    // Ajustement de la position pour rester centré sur la souris
    const newPos = {
        x: pointer.x - mousePointTo.x * newScale,
        y: pointer.y - mousePointTo.y * newScale,
    };
    stage.position(newPos);
    stage.batchDraw();
});

// --- MOTEUR DE DÉPLACEMENT (Pan via Clic Droit ou Molette) ---
stage.on('mousedown touchstart', (e) => {
    // Si clic droit (bouton 2) ou clic molette (bouton 1), on active le déplacement du plan
    if (e.evt.button === 2 || e.evt.button === 1) {
        stage.startDrag();
    }
});

// --- LOGIQUE DE DESSIN (Clic Gauche uniquement) ---
stage.on('mousedown touchstart', (e) => {
    // On ne dessine que si c'est le clic gauche (bouton 0)
    if (e.evt.button !== 0 || !currentPlanId || selectedPieceId) return;

    const isBg = e.target.hasName('plan-image') || e.target === stage;
    if (!isBg) return;

    isDrawingPiece = true;
    const transform = stage.getAbsoluteTransform().copy().invert();
    const pos = transform.point(stage.getPointerPosition());
    startDrawPos = pos;

    currentDrawRect = new Konva.Rect({
        x: pos.x, y: pos.y, width: 0, height: 0,
        fill: 'rgba(37, 99, 235, 0.2)', stroke: '#2563eb', strokeWidth: 2, dash: [5, 5], 
        name: 'temp-draw', listening: false 
    });
    layer.add(currentDrawRect);
});

stage.on('mousemove touchmove', () => {
    if (!isDrawingPiece || !currentDrawRect) return;
    const transform = stage.getAbsoluteTransform().copy().invert();
    const pos = transform.point(stage.getPointerPosition());
    
    currentDrawRect.setAttrs({
        x: Math.min(pos.x, startDrawPos.x),
        y: Math.min(pos.y, startDrawPos.y),
        width: Math.abs(pos.x - startDrawPos.x),
        height: Math.abs(pos.y - startDrawPos.y)
    });
    layer.batchDraw();
});

stage.on('mouseup touchend', (e) => {
    if (isDrawingPiece && currentDrawRect) {
        if (currentDrawRect.width() > 5 && currentDrawRect.height() > 5) {
            lastCapturedCoords = { x: currentDrawRect.x(), y: currentDrawRect.y(), width: currentDrawRect.width(), height: currentDrawRect.height() };
            openEditor();
        }
        currentDrawRect.destroy();
        currentDrawRect = null;
        isDrawingPiece = false;
        layer.draw();
    }
});

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
        stage.position({ x: 0, y: 0 }); // Centrage initial
        layer.add(img);
        renderPlan();
    }, { crossOrigin: 'anonymous' });
};

// --- RENDU DES PIÈCES AVEC TEXTE ---
function renderPlan() {
    layer.find('.p-group').forEach(g => g.destroy());
    allPieces.filter(p => p.planId === currentPlanId).forEach(p => {
        const isBlocked = allIssues.some(i => i.pieceId === p.id);
        const isSelected = selectedPieceId === p.id;
        
        const group = new Konva.Group({ x: p.x, y: p.y, id: p.id, name: 'p-group' });
        const rect = new Konva.Rect({
            width: p.width, height: p.height,
            fill: isBlocked ? '#ef4444' : (isSelected ? '#3b82f6' : '#94a3b8'),
            opacity: 0.6, stroke: isSelected ? 'blue' : 'black', strokeWidth: isSelected ? 2 : 1
        });
        const text = new Konva.Text({
            text: p.nom, fontSize: 10, width: p.width, height: p.height,
            align: 'center', verticalAlign: 'middle', fill: 'black', listening: false
        });

        group.add(rect).add(text);
        group.on('click tap', () => selectExistingPiece(p.id));
        layer.add(group);
    });
    layer.draw();
}

function selectExistingPiece(id) {
    selectedPieceId = id;
    const p = allPieces.find(piece => piece.id === id);
    openEditor(p);
    renderPlan();
}

function openEditor(data = null) {
    document.getElementById('piece-editor').classList.remove('hidden');
    document.getElementById('p-edit-name').value = data ? data.nom : "";
    document.getElementById('p-edit-date').value = data ? data.startDate : "";
    document.getElementById('p-edit-seq').value = data ? data.seqId : "";
}

window.processPiece = async () => {
    const nom = document.getElementById('p-edit-name').value;
    const seqId = document.getElementById('p-edit-seq').value;
    const startDate = document.getElementById('p-edit-date').value;
    if (selectedPieceId) {
        await updateDoc(doc(db, "pieces", selectedPieceId), { nom, seqId, startDate });
    } else {
        await addDoc(collection(db, "pieces"), { 
            nom, seqId, startDate, planId: currentPlanId,
            x: lastCapturedCoords.x, y: lastCapturedCoords.y, width: lastCapturedCoords.width, height: lastCapturedCoords.height 
        });
    }
    window.cancelPieceEdit();
};

window.cancelPieceEdit = () => {
    selectedPieceId = null;
    document.getElementById('piece-editor').classList.add('hidden');
    renderPlan();
};

// --- SYNCHRONISATION ---
onSnapshot(collection(db, "plans"), (s) => {
    allPlans = s.docs.map(d => ({ id: d.id, ...d.data() }));
    document.getElementById('plans-list').innerHTML = allPlans.map(p => `
        <div class="flex items-center justify-between group p-2 border rounded-lg bg-white mb-1">
            <div onclick="selectPlan('${p.id}')" class="flex-1 cursor-pointer text-[10px] truncate">📄 ${p.name}</div>
            <button onclick="deletePlan('${p.id}', event)" class="text-red-400 opacity-0 group-hover:opacity-100">🗑️</button>
        </div>`).join('');
});

onSnapshot(collection(db, "pieces"), (s) => {
    allPieces = s.docs.map(d => ({ id: d.id, ...d.data() }));
    renderPlan();
});

// Initialisation au chargement
window.addTaskRow = () => { /* Même fonction que précédemment */ };
window.saveSequence = async () => { /* Même fonction que précédemment */ };
// ... ajoutez ici vos fonctions de gestion de séquences et bloquants restantes ...
