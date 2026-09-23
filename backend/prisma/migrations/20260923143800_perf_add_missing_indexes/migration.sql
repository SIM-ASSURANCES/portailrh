-- CreateIndex
CREATE INDEX "HistoriqueEntry_entity_entityId_idx" ON "HistoriqueEntry"("entity", "entityId");

-- CreateIndex
CREATE INDEX "HistoriqueEntry_createdAt_idx" ON "HistoriqueEntry"("createdAt");

-- CreateIndex
CREATE INDEX "HistoriqueEntry_userId_idx" ON "HistoriqueEntry"("userId");

-- CreateIndex
CREATE INDEX "Demande_categorieId_idx" ON "Demande"("categorieId");

-- CreateIndex
CREATE INDEX "Demande_validationCompleteParDG_statut_idx" ON "Demande"("validationCompleteParDG", "statut");

-- CreateIndex
CREATE INDEX "Reglement_demandeId_idx" ON "Reglement"("demandeId");

-- CreateIndex
CREATE INDEX "Reglement_demandeId_estConfirme_estAnnule_idx" ON "Reglement"("demandeId", "estConfirme", "estAnnule");

-- CreateIndex
CREATE INDEX "RetourCaisse_reglementId_idx" ON "RetourCaisse"("reglementId");

-- CreateIndex
CREATE INDEX "RetourCaisse_declarantId_idx" ON "RetourCaisse"("declarantId");

-- CreateIndex
CREATE INDEX "RetourCaisse_estReceptionne_idx" ON "RetourCaisse"("estReceptionne");
