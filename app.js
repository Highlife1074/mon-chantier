// SUPPRESSION PLAN
window.deletePlan = async (id) => {
    if (!confirm("⚠️ Supprimer ce plan et TOUTES les zones dessinées dessus ?")) return;
    
    try {
        // 1. Supprimer les zones (pièces) liées au plan
        const piecesToDel = allPieces.filter(p => p.planId === id);
        for (const p of piecesToDel) {
            await deleteDoc(doc(db, "pieces", p.id));
        }
        
        // 2. Supprimer le plan
        await deleteDoc(doc(db, "plans", id));
        
        if (currentPlanId === id) {
            currentPlanId = null;
            layer.destroyChildren();
            document.getElementById('no-plan-message').classList.remove('hidden');
        }
        alert("Plan et zones supprimés avec succès.");
    } catch (error) {
        console.error(error);
        alert("Erreur Firebase : Vérifiez vos règles de sécurité (Delete).");
    }
};

// SUPPRESSION SÉQUENCE
window.deleteSequence = async (id) => {
    if (!confirm("Supprimer ce modèle de travaux ?")) return;
    try {
        await deleteDoc(doc(db, "sequences", id));
        alert("Séquence supprimée.");
    } catch (error) {
        alert("Erreur lors de la suppression.");
    }
};
