-- Services : responsable et liste des 8 services (2026-10-06, commit 2 du circuit de validation).
--
-- Complète le modèle `Service` existant (module de Thierry : pointage, reporting) sans rien casser : les deux
-- renommages gardent les MÊMES identifiants, donc les rattachements des utilisateurs et les filtres par service
-- restent valides. Le responsable reste facultatif en base (les comptes n'existent pas encore au moment de la
-- migration) ; l'écran d'administration l'exige et la création d'une demande est refusée tant que le service du
-- demandeur n'en a pas.

-- AlterTable
ALTER TABLE "Service" ADD COLUMN "responsableId" TEXT;

-- CreateIndex
CREATE INDEX "Service_responsableId_idx" ON "Service"("responsableId");

-- AddForeignKey : RESTRICT — un compte responsable d'un service ne peut pas être supprimé (l'écran demande d'abord
-- de désigner un autre responsable).
ALTER TABLE "Service" ADD CONSTRAINT "Service_responsableId_fkey" FOREIGN KEY ("responsableId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Renommages (mêmes identifiants) ; sans effet si le nom cible existe déjà ou si l'ancien nom est absent.
UPDATE "Service" SET "name" = 'Direction DG', "updatedAt" = now()
WHERE "name" = 'Direction' AND NOT EXISTS (SELECT 1 FROM "Service" WHERE "name" = 'Direction DG');
UPDATE "Service" SET "name" = 'RH', "updatedAt" = now()
WHERE "name" = 'Ressources Humaines' AND NOT EXISTS (SELECT 1 FROM "Service" WHERE "name" = 'RH');

-- Les 8 services : crée seulement ceux qui manquent (idempotent).
INSERT INTO "Service" ("id", "name", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, v.nom, now(), now()
FROM (VALUES ('Commercial'), ('Informatique'), ('Direction DG'), ('Finance'), ('RH'), ('Technique'), ('Comptabilité'), ('Marketing')) AS v(nom)
ON CONFLICT ("name") DO NOTHING;
