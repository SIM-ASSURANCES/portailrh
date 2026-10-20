-- Lot L : signatures manuscrites (enrôlement unique dans le profil) et actions signées. Migration additive.

CREATE TABLE "SignatureUtilisateur" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "image" BYTEA NOT NULL,
    "largeur" INTEGER NOT NULL,
    "hauteur" INTEGER NOT NULL,
    "empreinte" TEXT NOT NULL,
    "creeAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SignatureUtilisateur_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ActionSignee" (
    "id" TEXT NOT NULL,
    "signatureId" TEXT NOT NULL,
    "signataireId" TEXT NOT NULL,
    "auNomDeId" TEXT,
    "action" TEXT NOT NULL,
    "demandeId" TEXT,
    "ligneDemandeId" TEXT,
    "entite" TEXT,
    "entiteId" TEXT,
    "ip" TEXT NOT NULL,
    "creeAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ActionSignee_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SignatureUtilisateur_userId_version_key" ON "SignatureUtilisateur"("userId", "version");
CREATE INDEX "SignatureUtilisateur_userId_idx" ON "SignatureUtilisateur"("userId");
CREATE INDEX "ActionSignee_demandeId_creeAt_idx" ON "ActionSignee"("demandeId", "creeAt");
CREATE INDEX "ActionSignee_signataireId_creeAt_idx" ON "ActionSignee"("signataireId", "creeAt");
CREATE INDEX "ActionSignee_signatureId_idx" ON "ActionSignee"("signatureId");
CREATE INDEX "ActionSignee_auNomDeId_idx" ON "ActionSignee"("auNomDeId");

ALTER TABLE "SignatureUtilisateur" ADD CONSTRAINT "SignatureUtilisateur_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ActionSignee" ADD CONSTRAINT "ActionSignee_signatureId_fkey" FOREIGN KEY ("signatureId") REFERENCES "SignatureUtilisateur"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ActionSignee" ADD CONSTRAINT "ActionSignee_signataireId_fkey" FOREIGN KEY ("signataireId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ActionSignee" ADD CONSTRAINT "ActionSignee_auNomDeId_fkey" FOREIGN KEY ("auNomDeId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Repère de mise en service : tout ce qui précède est « Antérieur à la signature » (jamais signalé comme anormal).
-- Idempotent : une seconde exécution ne déplace pas le repère.
INSERT INTO "MarqueurUnique" ("cle", "creeAt")
VALUES ('signatures.mise_en_service', CURRENT_TIMESTAMP)
ON CONFLICT ("cle") DO NOTHING;
