-- Congés (module simplifié, 2026-10-19). Rejouable (IF NOT EXISTS, ON CONFLICT). Migration NON déployée : réécrite en place, les
-- bases locales qui portaient l'ancienne version (soldes, types, permissions d'absence) sont à recréer.
-- Voir PLAN_AGENTS_CONGES_SIMPLIFIE_code.md. Horodatage strictement postérieur à la dernière migration de toutes les branches.
--
-- 1) Schéma.

DO $$ BEGIN
  CREATE TYPE "NatureConge" AS ENUM ('CONGE', 'PERMISSION_EXCEPTIONNELLE');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "StatutDemandeConge" AS ENUM ('EN_ATTENTE_RESPONSABLE', 'EN_ATTENTE_RH', 'VALIDEE', 'REJETEE', 'ANNULEE', 'MODIFICATION_DEMANDEE');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "PlageAbsenceAutorisee" ADD COLUMN IF NOT EXISTS "demandeCongeId" TEXT,
ADD COLUMN IF NOT EXISTS "provisoire" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS "DemandeConge" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "nature" "NatureConge" NOT NULL,
    "motif" TEXT NOT NULL,
    "dateDebut" DATE NOT NULL,
    "dateFin" DATE NOT NULL,
    "nbJoursOuvres" INTEGER NOT NULL,
    "statut" "StatutDemandeConge" NOT NULL DEFAULT 'EN_ATTENTE_RESPONSABLE',
    "etapeResponsableRequise" BOOLEAN NOT NULL DEFAULT true,
    "saisieParRH" BOOLEAN NOT NULL DEFAULT false,
    "motifRejet" TEXT,
    "motifModification" TEXT,
    "motifAnnulation" TEXT,
    "observationRH" TEXT,
    "joursPassesComptesAbsents" BOOLEAN,
    "userId" TEXT NOT NULL,
    "creeParId" TEXT NOT NULL,
    "approuveParId" TEXT,
    "approuveAt" TIMESTAMP(3),
    "valideParId" TEXT,
    "valideAt" TIMESTAMP(3),
    "annuleParId" TEXT,
    "annuleAt" TIMESTAMP(3),
    "etapeDepuis" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dernierRappelAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "DemandeConge_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "DemandeConge_reference_key" ON "DemandeConge"("reference");
CREATE INDEX IF NOT EXISTS "DemandeConge_userId_idx" ON "DemandeConge"("userId");
CREATE INDEX IF NOT EXISTS "DemandeConge_statut_idx" ON "DemandeConge"("statut");
CREATE INDEX IF NOT EXISTS "DemandeConge_dateDebut_dateFin_idx" ON "DemandeConge"("dateDebut", "dateFin");
CREATE INDEX IF NOT EXISTS "PlageAbsenceAutorisee_demandeCongeId_idx" ON "PlageAbsenceAutorisee"("demandeCongeId");

DO $$ BEGIN
  ALTER TABLE "DemandeConge" ADD CONSTRAINT "DemandeConge_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "DemandeConge" ADD CONSTRAINT "DemandeConge_creeParId_fkey" FOREIGN KEY ("creeParId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "DemandeConge" ADD CONSTRAINT "DemandeConge_approuveParId_fkey" FOREIGN KEY ("approuveParId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "DemandeConge" ADD CONSTRAINT "DemandeConge_valideParId_fkey" FOREIGN KEY ("valideParId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "DemandeConge" ADD CONSTRAINT "DemandeConge_annuleParId_fkey" FOREIGN KEY ("annuleParId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "PlageAbsenceAutorisee" ADD CONSTRAINT "PlageAbsenceAutorisee_demandeCongeId_fkey" FOREIGN KEY ("demandeCongeId") REFERENCES "DemandeConge"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2) Contraintes que Prisma ne modélise pas.
DO $$ BEGIN
  ALTER TABLE "DemandeConge" ADD CONSTRAINT "DemandeConge_nbJoursOuvres_positif" CHECK ("nbJoursOuvres" > 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "DemandeConge" ADD CONSTRAINT "DemandeConge_dates_ordonnees" CHECK ("dateFin" >= "dateDebut");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 3) Module (sur une base neuve, le seed le crée aussi : ON CONFLICT sur la clé).
INSERT INTO "Module" ("id", "key", "label") VALUES
  ('module-conges', 'conges', 'Congés')
ON CONFLICT ("key") DO NOTHING;

-- 4) Permissions : quatre, toutes du module « conges ».
INSERT INTO "Permission" ("id", "key", "label", "moduleId")
SELECT v.id, v.key, v.label, m."id"
FROM (VALUES
  ('perm-conges-soumettre', 'conges.soumettre', 'Demander un congé, consulter les siens', 'conges'),
  ('perm-conges-valider-rh', 'conges.valider_rh', 'Valider un congé (étape RH), enregistrer un congé pour un salarié', 'conges'),
  ('perm-conges-annuler', 'conges.annuler', 'Annuler un congé, même commencé', 'conges'),
  ('perm-conges-consulter-tous', 'conges.consulter_tous', 'Consulter les congés de tous les employés et les exporter', 'conges')
) AS v(id, key, label, module)
JOIN "Module" m ON m."key" = v.module
ON CONFLICT ("key") DO NOTHING;

-- 5) Attribution PAR PERMISSION SŒUR (jamais par nom de rôle) : un rôle qui porte la sœur reçoit la nouvelle.
--    Les rôles `estAdmin` sont exclus des droits de DÉCISION et de CONSULTATION : en base de dev, l'Admin porte les permissions sœurs
--    (anomalie des 23 permissions) et serait devenu décideur RH — il compterait dans les comptes RH et supprimerait le repli DG. Ils
--    gardent `conges.soumettre` : c'est le pouvoir de décider qui posait problème, pas le droit de demander (un rôle combiné
--    « Admin / Collaborateur » porte un vrai employé). Droits RH à cocher à la main dans /admin/roles si voulu. Aucun nom de rôle :
--    seule condition, le champ `estAdmin`. Le DG reçoit `soumettre` et `consulter_tous`, jamais `valider_rh`.
INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT DISTINCT rp."roleId", np."id"
FROM (VALUES
  ('conges.soumettre', 'pointage.pointer'),
  ('conges.soumettre', 'treso.creer_demande'),
  ('conges.soumettre', 'treso.decider_dg'),
  ('conges.valider_rh', 'pointage.corriger_pointage'),
  ('conges.annuler', 'pointage.corriger_pointage'),
  ('conges.consulter_tous', 'pointage.corriger_pointage'),
  ('conges.consulter_tous', 'pointage.consulter_tous'),
  ('conges.consulter_tous', 'treso.decider_dg')
) AS m(nouvelle, soeur)
JOIN "Permission" np ON np."key" = m.nouvelle
JOIN "Permission" sp ON sp."key" = m.soeur
JOIN "RolePermission" rp ON rp."permissionId" = sp."id"
JOIN "Role" r ON r."id" = rp."roleId" AND (r."estAdmin" = false OR m.nouvelle = 'conges.soumettre')
ON CONFLICT ("roleId", "permissionId") DO NOTHING;
