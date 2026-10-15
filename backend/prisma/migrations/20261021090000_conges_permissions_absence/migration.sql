-- Congés et permissions d'absence (fusion de portailRHv2, 2026-10-15). Rejouable (IF NOT EXISTS, ON CONFLICT).
-- Voir docs/PLAN_FUSION_CONGES_V2.md. Horodatage strictement postérieur à la dernière migration de toutes les branches.
--
-- 1) Schéma (généré par `prisma migrate diff`, rendu rejouable).

DO $$ BEGIN
  CREATE TYPE "CategorieConge" AS ENUM ('CONGE_STANDARD', 'PERMISSION_EXCEPTIONNELLE');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "DecompteType" AS ENUM ('CALENDAIRE', 'OUVRABLE');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "StatutDemandeConge" AS ENUM ('EN_ATTENTE_RESPONSABLE', 'EN_ATTENTE_RH', 'VALIDEE', 'REJETEE', 'ANNULEE', 'MODIFICATION_DEMANDEE');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "StatutDemandePermission" AS ENUM ('EN_ATTENTE_RESPONSABLE', 'EN_ATTENTE_RH', 'APPROUVEE', 'REJETEE', 'ANNULEE', 'CONSOMMEE');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "PlageAbsenceAutorisee" ADD COLUMN IF NOT EXISTS "demandeCongeId" TEXT,
ADD COLUMN IF NOT EXISTS "demandePermissionId" TEXT;

ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "dateEmbauche" DATE;

CREATE TABLE IF NOT EXISTS "TypeConge" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "categorie" "CategorieConge" NOT NULL DEFAULT 'CONGE_STANDARD',
    "nbJoursDefaut" INTEGER NOT NULL,
    "decompteType" "DecompteType" NOT NULL DEFAULT 'OUVRABLE',
    "justificatifObligatoire" BOOLEAN NOT NULL DEFAULT false,
    "nonDeductibleSolde" BOOLEAN NOT NULL DEFAULT false,
    "ancienneteMinimumMois" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "TypeConge_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "SoldeConge" (
    "id" TEXT NOT NULL,
    "exercice" INTEGER NOT NULL,
    "soldeInitial" INTEGER NOT NULL,
    "soldeRestant" INTEGER NOT NULL,
    "dateDebutExercice" TIMESTAMP(3) NOT NULL,
    "dateFinExercice" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "userId" TEXT NOT NULL,
    "typeCongeId" TEXT NOT NULL,
    CONSTRAINT "SoldeConge_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "AjustementSolde" (
    "id" TEXT NOT NULL,
    "montant" INTEGER NOT NULL,
    "motif" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "soldeCongeId" TEXT NOT NULL,
    "effectueParId" TEXT NOT NULL,
    CONSTRAINT "AjustementSolde_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "DemandeConge" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "dateDebut" DATE NOT NULL,
    "dateFin" DATE NOT NULL,
    "nbJours" INTEGER NOT NULL,
    "motif" TEXT NOT NULL,
    "interimaire" TEXT,
    "statut" "StatutDemandeConge" NOT NULL DEFAULT 'EN_ATTENTE_RESPONSABLE',
    "motifRejet" TEXT,
    "motifAnnulation" TEXT,
    "motifModification" TEXT,
    "userId" TEXT NOT NULL,
    "typeCongeId" TEXT NOT NULL,
    "etapeResponsableRequise" BOOLEAN NOT NULL DEFAULT true,
    "joursDebites" INTEGER NOT NULL DEFAULT 0,
    "soldeCongeId" TEXT,
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

CREATE TABLE IF NOT EXISTS "PieceJointeConge" (
    "id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "nomFichier" TEXT,
    "demandeCongeId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PieceJointeConge_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "TypePermission" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "dureeMaxHeures" INTEGER NOT NULL,
    "plafondMensuel" INTEGER NOT NULL,
    "justificatifRecommande" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "TypePermission_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "DemandePermission" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "heureDepart" TEXT NOT NULL,
    "heureRetourPrevue" TEXT NOT NULL,
    "heureRetourReelle" TEXT,
    "dureeMinutes" INTEGER NOT NULL,
    "dureeReelleMinutes" INTEGER,
    "motif" TEXT NOT NULL,
    "statut" "StatutDemandePermission" NOT NULL DEFAULT 'EN_ATTENTE_RESPONSABLE',
    "motifRejet" TEXT,
    "motifAnnulation" TEXT,
    "motifExceptionPlafond" TEXT,
    "userId" TEXT NOT NULL,
    "typePermissionId" TEXT NOT NULL,
    "etapeResponsableRequise" BOOLEAN NOT NULL DEFAULT true,
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
    CONSTRAINT "DemandePermission_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "TypeConge_label_key" ON "TypeConge"("label");

CREATE UNIQUE INDEX IF NOT EXISTS "TypeConge_code_key" ON "TypeConge"("code");

CREATE INDEX IF NOT EXISTS "SoldeConge_userId_idx" ON "SoldeConge"("userId");

CREATE UNIQUE INDEX IF NOT EXISTS "SoldeConge_userId_typeCongeId_exercice_key" ON "SoldeConge"("userId", "typeCongeId", "exercice");

CREATE INDEX IF NOT EXISTS "AjustementSolde_soldeCongeId_idx" ON "AjustementSolde"("soldeCongeId");

CREATE UNIQUE INDEX IF NOT EXISTS "DemandeConge_reference_key" ON "DemandeConge"("reference");

CREATE INDEX IF NOT EXISTS "DemandeConge_userId_idx" ON "DemandeConge"("userId");

CREATE INDEX IF NOT EXISTS "DemandeConge_statut_idx" ON "DemandeConge"("statut");

CREATE INDEX IF NOT EXISTS "DemandeConge_dateDebut_dateFin_idx" ON "DemandeConge"("dateDebut", "dateFin");

CREATE INDEX IF NOT EXISTS "DemandeConge_soldeCongeId_idx" ON "DemandeConge"("soldeCongeId");

CREATE INDEX IF NOT EXISTS "PieceJointeConge_demandeCongeId_idx" ON "PieceJointeConge"("demandeCongeId");

CREATE UNIQUE INDEX IF NOT EXISTS "TypePermission_label_key" ON "TypePermission"("label");

CREATE UNIQUE INDEX IF NOT EXISTS "DemandePermission_reference_key" ON "DemandePermission"("reference");

CREATE INDEX IF NOT EXISTS "DemandePermission_userId_idx" ON "DemandePermission"("userId");

CREATE INDEX IF NOT EXISTS "DemandePermission_date_idx" ON "DemandePermission"("date");

CREATE INDEX IF NOT EXISTS "DemandePermission_statut_idx" ON "DemandePermission"("statut");

CREATE INDEX IF NOT EXISTS "PlageAbsenceAutorisee_demandeCongeId_idx" ON "PlageAbsenceAutorisee"("demandeCongeId");

CREATE INDEX IF NOT EXISTS "PlageAbsenceAutorisee_demandePermissionId_idx" ON "PlageAbsenceAutorisee"("demandePermissionId");

DO $$ BEGIN
  ALTER TABLE "PlageAbsenceAutorisee" ADD CONSTRAINT "PlageAbsenceAutorisee_demandeCongeId_fkey" FOREIGN KEY ("demandeCongeId") REFERENCES "DemandeConge"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "PlageAbsenceAutorisee" ADD CONSTRAINT "PlageAbsenceAutorisee_demandePermissionId_fkey" FOREIGN KEY ("demandePermissionId") REFERENCES "DemandePermission"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "SoldeConge" ADD CONSTRAINT "SoldeConge_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "SoldeConge" ADD CONSTRAINT "SoldeConge_typeCongeId_fkey" FOREIGN KEY ("typeCongeId") REFERENCES "TypeConge"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "AjustementSolde" ADD CONSTRAINT "AjustementSolde_soldeCongeId_fkey" FOREIGN KEY ("soldeCongeId") REFERENCES "SoldeConge"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "AjustementSolde" ADD CONSTRAINT "AjustementSolde_effectueParId_fkey" FOREIGN KEY ("effectueParId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "DemandeConge" ADD CONSTRAINT "DemandeConge_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "DemandeConge" ADD CONSTRAINT "DemandeConge_typeCongeId_fkey" FOREIGN KEY ("typeCongeId") REFERENCES "TypeConge"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "DemandeConge" ADD CONSTRAINT "DemandeConge_soldeCongeId_fkey" FOREIGN KEY ("soldeCongeId") REFERENCES "SoldeConge"("id") ON DELETE SET NULL ON UPDATE CASCADE;
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
  ALTER TABLE "PieceJointeConge" ADD CONSTRAINT "PieceJointeConge_demandeCongeId_fkey" FOREIGN KEY ("demandeCongeId") REFERENCES "DemandeConge"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "DemandePermission" ADD CONSTRAINT "DemandePermission_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "DemandePermission" ADD CONSTRAINT "DemandePermission_typePermissionId_fkey" FOREIGN KEY ("typePermissionId") REFERENCES "TypePermission"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "DemandePermission" ADD CONSTRAINT "DemandePermission_approuveParId_fkey" FOREIGN KEY ("approuveParId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "DemandePermission" ADD CONSTRAINT "DemandePermission_valideParId_fkey" FOREIGN KEY ("valideParId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "DemandePermission" ADD CONSTRAINT "DemandePermission_annuleParId_fkey" FOREIGN KEY ("annuleParId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2) Contraintes que Prisma ne modélise pas.
DO $$ BEGIN
  ALTER TABLE "SoldeConge" ADD CONSTRAINT "SoldeConge_soldeRestant_positif" CHECK ("soldeRestant" >= 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "DemandeConge" ADD CONSTRAINT "DemandeConge_nbJours_positif" CHECK ("nbJours" > 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "DemandeConge" ADD CONSTRAINT "DemandeConge_dates_ordonnees" CHECK ("dateFin" >= "dateDebut");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "DemandePermission" ADD CONSTRAINT "DemandePermission_duree_positive" CHECK ("dureeMinutes" > 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "PlageAbsenceAutorisee" ADD CONSTRAINT "PlageAbsenceAutorisee_une_seule_demande"
    CHECK (NOT ("demandeCongeId" IS NOT NULL AND "demandePermissionId" IS NOT NULL));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 3) Modules (sur une base neuve, le seed les crée aussi : ON CONFLICT sur la clé).
INSERT INTO "Module" ("id", "key", "label") VALUES
  ('module-conges', 'conges', 'Congés'),
  ('module-absences', 'absences', 'Permissions d''absence')
ON CONFLICT ("key") DO NOTHING;

-- 4) Permissions. La clé du module des permissions d'absence est « absences » (décision D7b).
INSERT INTO "Permission" ("id", "key", "label", "moduleId")
SELECT v.id, v.key, v.label, m."id"
FROM (VALUES
  ('perm-conges-soumettre', 'conges.soumettre', 'Demander un congé, consulter ses congés et son solde', 'conges'),
  ('perm-conges-valider-rh', 'conges.valider_rh', 'Valider définitivement un congé (étape RH, congé d''office)', 'conges'),
  ('perm-conges-annuler', 'conges.annuler', 'Annuler un congé validé', 'conges'),
  ('perm-conges-parametrer-types', 'conges.parametrer_types', 'Paramétrer les types de congé', 'conges'),
  ('perm-conges-gerer-soldes', 'conges.gerer_soldes', 'Gérer les soldes de congé et les dates d''embauche', 'conges'),
  ('perm-conges-consulter-tous', 'conges.consulter_tous', 'Consulter les congés de tous les employés', 'conges'),
  ('perm-conges-voir-dashboard', 'conges.voir_dashboard', 'Voir le tableau de bord des congés', 'conges'),
  ('perm-conges-voir-reporting', 'conges.voir_reporting', 'Voir le reporting des congés', 'conges'),
  ('perm-absences-soumettre', 'absences.soumettre', 'Demander une permission d''absence, consulter les siennes', 'absences'),
  ('perm-absences-valider-rh', 'absences.valider_rh', 'Valider une permission d''absence (étape RH)', 'absences'),
  ('perm-absences-annuler', 'absences.annuler', 'Annuler une permission d''absence approuvée', 'absences'),
  ('perm-absences-parametrer', 'absences.parametrer', 'Paramétrer les types et plafonds de permission', 'absences'),
  ('perm-absences-consulter-tous', 'absences.consulter_tous', 'Consulter les permissions d''absence de tous les employés', 'absences'),
  ('perm-absences-voir-dashboard', 'absences.voir_dashboard', 'Voir le tableau de bord des permissions d''absence', 'absences'),
  ('perm-absences-voir-reporting', 'absences.voir_reporting', 'Voir le reporting des permissions d''absence', 'absences')
) AS v(id, key, label, module)
JOIN "Module" m ON m."key" = v.module
ON CONFLICT ("key") DO NOTHING;

-- 5) Attribution PAR PERMISSION SŒUR (jamais par nom de rôle) : un rôle qui porte la sœur reçoit la nouvelle.
--    L'Admin n'est pas touché (il n'a que ce qu'il porte déjà).
INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT DISTINCT rp."roleId", np."id"
FROM (VALUES
  ('conges.soumettre', 'pointage.pointer'),
  ('conges.soumettre', 'treso.creer_demande'),
  ('conges.soumettre', 'treso.decider_dg'),
  ('conges.valider_rh', 'pointage.corriger_pointage'),
  ('conges.annuler', 'pointage.corriger_pointage'),
  ('conges.parametrer_types', 'pointage.corriger_pointage'),
  ('conges.gerer_soldes', 'pointage.corriger_pointage'),
  ('conges.consulter_tous', 'pointage.consulter_tous'),
  ('conges.voir_dashboard', 'pointage.voir_dashboard_rh'),
  ('conges.voir_dashboard', 'treso.decider_dg'),
  ('conges.voir_reporting', 'pointage.voir_reporting'),
  ('conges.voir_reporting', 'treso.decider_dg'),
  ('absences.soumettre', 'pointage.pointer'),
  ('absences.soumettre', 'treso.creer_demande'),
  ('absences.soumettre', 'treso.decider_dg'),
  ('absences.valider_rh', 'pointage.corriger_pointage'),
  ('absences.annuler', 'pointage.corriger_pointage'),
  ('absences.parametrer', 'pointage.corriger_pointage'),
  ('absences.consulter_tous', 'pointage.consulter_tous'),
  ('absences.voir_dashboard', 'pointage.voir_dashboard_rh'),
  ('absences.voir_dashboard', 'treso.decider_dg'),
  ('absences.voir_reporting', 'pointage.voir_reporting'),
  ('absences.voir_reporting', 'treso.decider_dg')
) AS m(nouvelle, soeur)
JOIN "Permission" np ON np."key" = m.nouvelle
JOIN "Permission" sp ON sp."key" = m.soeur
JOIN "RolePermission" rp ON rp."permissionId" = sp."id"
ON CONFLICT ("roleId", "permissionId") DO NOTHING;

-- 6) Types de congé de départ (identifiants aléatoires, comme les services de la migration 20261006110000).
INSERT INTO "TypeConge" ("id", "code", "label", "categorie", "nbJoursDefaut", "decompteType", "justificatifObligatoire", "nonDeductibleSolde", "ancienneteMinimumMois", "updatedAt")
SELECT gen_random_uuid()::text, v.code, v.label, v.categorie, v.nb, v.decompte, v.justif, v.nondeduct, v.anciennete, CURRENT_TIMESTAMP
FROM (VALUES
  ('ANNUEL', 'Congé annuel', 'CONGE_STANDARD'::"CategorieConge", 30, 'OUVRABLE'::"DecompteType", false, false, 0),
  ('MALADIE', 'Congé maladie', 'CONGE_STANDARD'::"CategorieConge", 0, 'CALENDAIRE'::"DecompteType", true, true, 0),
  ('MATERNITE', 'Congé maternité', 'CONGE_STANDARD'::"CategorieConge", 98, 'CALENDAIRE'::"DecompteType", true, false, 0),
  ('SANS_SOLDE', 'Congé sans solde', 'CONGE_STANDARD'::"CategorieConge", 0, 'CALENDAIRE'::"DecompteType", false, true, 0),
  ('MARIAGE_SALARIE', 'Mariage du salarié', 'PERMISSION_EXCEPTIONNELLE'::"CategorieConge", 4, 'OUVRABLE'::"DecompteType", true, true, 6),
  ('MARIAGE_FAMILLE', 'Mariage d''un enfant, d''un frère ou d''une sœur', 'PERMISSION_EXCEPTIONNELLE'::"CategorieConge", 2, 'OUVRABLE'::"DecompteType", true, true, 6),
  ('DECES_CONJOINT', 'Décès du conjoint', 'PERMISSION_EXCEPTIONNELLE'::"CategorieConge", 5, 'OUVRABLE'::"DecompteType", true, true, 6),
  ('DECES_ENFANT_PARENT', 'Décès d''un enfant, du père ou de la mère', 'PERMISSION_EXCEPTIONNELLE'::"CategorieConge", 5, 'OUVRABLE'::"DecompteType", true, true, 6),
  ('DECES_FRERE_SOEUR', 'Décès d''un frère ou d''une sœur', 'PERMISSION_EXCEPTIONNELLE'::"CategorieConge", 2, 'OUVRABLE'::"DecompteType", true, true, 6),
  ('DECES_BEAU_PARENT', 'Décès du beau-père ou de la belle-mère', 'PERMISSION_EXCEPTIONNELLE'::"CategorieConge", 2, 'OUVRABLE'::"DecompteType", true, true, 6),
  ('NAISSANCE', 'Naissance d''un enfant', 'PERMISSION_EXCEPTIONNELLE'::"CategorieConge", 2, 'OUVRABLE'::"DecompteType", true, true, 6),
  ('COMMUNION_BAPTEME', 'Première communion ou baptême d''un enfant', 'PERMISSION_EXCEPTIONNELLE'::"CategorieConge", 1, 'OUVRABLE'::"DecompteType", true, true, 6),
  ('DEMENAGEMENT', 'Déménagement', 'PERMISSION_EXCEPTIONNELLE'::"CategorieConge", 1, 'OUVRABLE'::"DecompteType", true, true, 6)
) AS v(code, label, categorie, nb, decompte, justif, nondeduct, anciennete)
ON CONFLICT ("code") DO NOTHING;

-- 7) Types de permission d'absence de départ.
INSERT INTO "TypePermission" ("id", "label", "dureeMaxHeures", "plafondMensuel", "justificatifRecommande", "updatedAt")
SELECT gen_random_uuid()::text, v.label, v.duree, v.plafond, v.justif, CURRENT_TIMESTAMP
FROM (VALUES
  ('Rendez-vous médical', 3, 2, true),
  ('Raison familiale urgente', 4, 1, false),
  ('Démarche administrative', 3, 1, false),
  ('Autre', 4, 2, false)
) AS v(label, duree, plafond, justif)
ON CONFLICT ("label") DO NOTHING;
