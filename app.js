// 1. IMPORT DES OUTILS (Via internet)
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getFirestore, collection, addDoc, onSnapshot } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { getStorage, ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-storage.js";

// 2. VOTRE CONFIGURATION FIREBASE
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

// 3. INITIALISATION DU DESSIN (KONVA)
let stage = new Konva.Stage({
    container: 'canvas-container',
    width: window.innerWidth - 300,
    height: 600
});
let layer = new Konva.Layer();
stage.add(layer);

// 4. GESTION DU GLISSER-DÉPOSER DU PLAN
const dropZone = document.getElementById('drag-drop-zone');

dropZone.ondragover = (e) => {
    e.preventDefault();
    dropZone.classList.add('drag-over');
};

dropZone.ondragleave = () => dropZone.classList.remove('drag-over');

dropZone.ondrop = async (e) => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    
    if (file) {
        // Upload vers Firebase Storage[cite: 1]
        const storageRef = ref(storage, 'plans/' + file.name);
        await uploadBytes(storageRef, file);
        const url = await getDownloadURL(storageRef);
        chargerImagePlan(url);
    }
};

// Afficher l'image sur le canvas
function chargerImagePlan(url) {
    Konva.Image.fromURL(url, (img) => {
        img.setAttrs({ x: 0, y: 0, draggable: true });
        layer.add(img);
        img.moveToBottom();
        layer.draw();
        dropZone.style.display = 'none'; // Cache la zone de drop une fois le plan chargé
    });
}

// 5. DESSINER UNE PIÈCE (Simplifié : un rectangle au clic)
stage.on('click', async (e) => {
    const pos = stage.getPointerPosition();
    const nom = prompt("Nom de la pièce ?");
    
    if (nom) {
        // Enregistrement dans Firestore[cite: 1]
        await addDoc(collection(db, "pieces"), {
            nom: nom,
            x: pos.x,
            y: pos.y,
            statut: "À faire"
        });
    }
});

// 6. ÉCOUTER LES PIÈCES ET LES AFFICHER
onSnapshot(collection(db, "pieces"), (snapshot) => {
    // On nettoie les anciens dessins avant de tout redessiner
    layer.destroyChildren(); 
    
    snapshot.forEach(doc => {
        const p = doc.data();
        const rect = new Konva.Rect({
            x: p.x, y: p.y, width: 100, height: 80,
            fill: 'rgba(59, 130, 246, 0.4)',
            stroke: '#1e3a8a', strokeWidth: 2,
            draggable: true
        });
        
        const label = new Konva.Text({
            x: p.x + 5, y: p.y + 5, text: p.nom, fontSize: 14, fontStyle: 'bold'
        });

        layer.add(rect);
        layer.add(label);
    });
    layer.draw();
});
