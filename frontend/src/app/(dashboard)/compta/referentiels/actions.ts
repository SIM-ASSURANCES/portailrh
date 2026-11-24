"use server";

// Server Actions des référentiels de Gestion Compta (lot GC-2c ; docs/compta-conception.md §5.3 et registre C-16).
//
// Droits (C-16, provisoires) : partenaires, produits, comptes et taux de TCA = `cpt.parametrer` ; conventions =
// `cpt.gerer_conventions` ; clients = `cpt.saisir_contrat` OU `cpt.identifier_encaissement`. La permission est revérifiée ici
// dans CHAQUE action (jamais seulement via le layout `/compta`, qui ne garde que `cpt.consulter`).
//
// Règles communes : validation par les moteurs purs de `cptReferentiels.ts` (les mêmes messages que l'écran), écriture et audit
// (`CptAudit`, avant/après) dans UNE transaction, verrou consultatif avant de lire pour décider (taux, conventions : deux
// saisies simultanées ne peuvent pas créer un doublon ou un chevauchement), jamais de suppression — on désactive. Un taux
// de TCA ne se modifie jamais (nouvelle ligne datée) ; une convention n'a que sa date de fin qui change (clôture).

import { revalidatePath } from "next/cache";

import { getClientIp } from "@/lib/auditLog";
import { getSession, hasPermission } from "@/lib/auth";
import { publishDataChanged } from "@/lib/eventBus";
import {
  estEntiteOdooCpt,
  validerCorrespondanceOdooCpt,
  controlerChevauchementConventionCpt,
  controlerCoherenceTauxTca,
  controlerDoublonTauxTca,
  controlerNouvelleFinConventionCpt,
  ecrireAuditCpt,
  indexerMotsCpt,
  LIBELLE_BRANCHE_CPT,
  prisma,
  textesIndexClientCpt,
  textesIndexPartenaireCpt,
  textesIndexProduitCpt,
  validerClientCpt,
  validerCompteCpt,
  validerConventionCpt,
  validerPartenaireCpt,
  validerProduitCpt,
  validerTauxTcaCpt,
  type ConventionLigne,
  type TauxTcaLigne,
} from "backend";

export type ResultatReferentielCpt =
  | { status: "success"; message: string }
  | { status: "error"; message: string; fieldErrors?: Record<string, string> };

/** Saisie d'un formulaire : texte pour tout, « true » pour une case cochée. */
export type SaisieReferentielCpt = Record<string, string>;

type SessionCpt = NonNullable<Awaited<ReturnType<typeof getSession>>>;

const NON_AUTORISE: ResultatReferentielCpt = { status: "error", message: "Action non autorisée." };

async function exiger(...permissions: string[]): Promise<SessionCpt | null> {
  const session = await getSession();
  if (!session || !permissions.some((p) => hasPermission(session, p))) return null;
  return session;
}

function rafraichir() {
  revalidatePath("/compta", "layout");
  publishDataChanged();
}

function erreurChamps(erreurs: Record<string, string>): ResultatReferentielCpt {
  return { status: "error", message: Object.values(erreurs)[0] ?? "Formulaire invalide.", fieldErrors: erreurs };
}

function estViolationUnicite(e: unknown): boolean {
  return typeof e === "object" && e !== null && "code" in e && (e as { code?: string }).code === "P2002";
}

function versDateUtc(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}

function versIso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

/** Verrou consultatif de la transaction (relâché à son terme) : sérialise les décisions fondées sur une lecture. */
async function verrouiller(tx: Tx, cle: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${cle})::bigint)`;
}

// ---------------------------------------------------------------------------------------------------------------
// Partenaires
// ---------------------------------------------------------------------------------------------------------------

export async function creerPartenaireAction(saisie: SaisieReferentielCpt): Promise<ResultatReferentielCpt> {
  const session = await exiger("cpt.parametrer");
  if (!session) return NON_AUTORISE;
  const lu = validerPartenaireCpt(saisie);
  if (!lu.ok) return erreurChamps(lu.erreurs);

  const doublon = await prisma.cptPartenaire.findFirst({ where: { nom: { equals: lu.valeur.nom, mode: "insensitive" } } });
  if (doublon) return erreurChamps({ nom: `Un partenaire « ${doublon.nom} » existe déjà.` });

  const ip = await getClientIp();
  try {
    await prisma.$transaction(async (tx) => {
      const cree = await tx.cptPartenaire.create({ data: lu.valeur });
      await indexerMotsCpt(tx, "PARTENAIRE", cree.id, textesIndexPartenaireCpt(cree), true);
      await ecrireAuditCpt(tx, { entite: "CptPartenaire", entiteId: cree.id, action: "creation", apres: cree, userId: session.user.id, ip });
    });
  } catch (e) {
    if (estViolationUnicite(e)) return erreurChamps({ nom: "Un partenaire de ce nom existe déjà." });
    throw e;
  }
  rafraichir();
  return { status: "success", message: `Partenaire « ${lu.valeur.nom} » créé.` };
}

export async function modifierPartenaireAction(id: string, saisie: SaisieReferentielCpt): Promise<ResultatReferentielCpt> {
  const session = await exiger("cpt.parametrer");
  if (!session) return NON_AUTORISE;
  const lu = validerPartenaireCpt(saisie);
  if (!lu.ok) return erreurChamps(lu.erreurs);

  const avant = await prisma.cptPartenaire.findUnique({ where: { id } });
  if (!avant) return { status: "error", message: "Partenaire introuvable." };
  const doublon = await prisma.cptPartenaire.findFirst({ where: { id: { not: id }, nom: { equals: lu.valeur.nom, mode: "insensitive" } } });
  if (doublon) return erreurChamps({ nom: `Un partenaire « ${doublon.nom} » existe déjà.` });

  const ip = await getClientIp();
  try {
    await prisma.$transaction(async (tx) => {
      const apres = await tx.cptPartenaire.update({ where: { id }, data: lu.valeur });
      await indexerMotsCpt(tx, "PARTENAIRE", id, textesIndexPartenaireCpt(apres));
      if (apres.nom !== avant.nom) {
        // Le nom du partenaire d'origine fait partie des mots d'un client : ses clients sont réindexés avec le nouveau nom.
        const clients = await tx.cptClient.findMany({ where: { partenaireOrigineId: id } });
        for (const c of clients) await indexerMotsCpt(tx, "CLIENT", c.id, textesIndexClientCpt({ ...c, partenaireOrigineNom: apres.nom }));
      }
      await ecrireAuditCpt(tx, { entite: "CptPartenaire", entiteId: id, action: "modification", avant, apres, userId: session.user.id, ip });
    });
  } catch (e) {
    if (estViolationUnicite(e)) return erreurChamps({ nom: "Un partenaire de ce nom existe déjà." });
    throw e;
  }
  rafraichir();
  return { status: "success", message: `Partenaire « ${lu.valeur.nom} » modifié.` };
}

export async function basculerPartenaireAction(id: string, actif: boolean): Promise<ResultatReferentielCpt> {
  const session = await exiger("cpt.parametrer");
  if (!session) return NON_AUTORISE;
  const avant = await prisma.cptPartenaire.findUnique({ where: { id } });
  if (!avant) return { status: "error", message: "Partenaire introuvable." };
  const ip = await getClientIp();
  await prisma.$transaction(async (tx) => {
    const apres = await tx.cptPartenaire.update({ where: { id }, data: { actif } });
    await ecrireAuditCpt(tx, { entite: "CptPartenaire", entiteId: id, action: actif ? "activation" : "desactivation", avant, apres, userId: session.user.id, ip });
  });
  rafraichir();
  return { status: "success", message: actif ? "Partenaire réactivé." : "Partenaire désactivé." };
}

// ---------------------------------------------------------------------------------------------------------------
// Clients
// ---------------------------------------------------------------------------------------------------------------

const DROITS_CLIENTS = ["cpt.saisir_contrat", "cpt.identifier_encaissement"] as const;

/** Nom du partenaire d'origine d'un client (l'un des mots de sa fiche), `null` s'il n'en a pas. */
async function nomPartenaire(tx: Tx, id: string | null): Promise<string | null> {
  if (!id) return null;
  return (await tx.cptPartenaire.findUnique({ where: { id }, select: { nom: true } }))?.nom ?? null;
}

async function controlerPartenaireOrigine(id: string | null): Promise<Record<string, string> | null> {
  if (!id) return null;
  const existe = await prisma.cptPartenaire.findUnique({ where: { id }, select: { id: true } });
  return existe ? null : { partenaireOrigineId: "Partenaire d'origine : introuvable." };
}

export async function creerClientAction(saisie: SaisieReferentielCpt): Promise<ResultatReferentielCpt> {
  const session = await exiger(...DROITS_CLIENTS);
  if (!session) return NON_AUTORISE;
  const lu = validerClientCpt(saisie);
  if (!lu.ok) return erreurChamps(lu.erreurs);
  const incoherence = await controlerPartenaireOrigine(lu.valeur.partenaireOrigineId);
  if (incoherence) return erreurChamps(incoherence);

  const ip = await getClientIp();
  await prisma.$transaction(async (tx) => {
    const cree = await tx.cptClient.create({ data: lu.valeur });
    await indexerMotsCpt(tx, "CLIENT", cree.id, textesIndexClientCpt({ ...cree, partenaireOrigineNom: await nomPartenaire(tx, cree.partenaireOrigineId) }), true);
    await ecrireAuditCpt(tx, { entite: "CptClient", entiteId: cree.id, action: "creation", apres: cree, userId: session.user.id, ip });
  });
  rafraichir();
  return { status: "success", message: `Client « ${lu.valeur.nom} » créé.` };
}

export async function modifierClientAction(id: string, saisie: SaisieReferentielCpt): Promise<ResultatReferentielCpt> {
  const session = await exiger(...DROITS_CLIENTS);
  if (!session) return NON_AUTORISE;
  const lu = validerClientCpt(saisie);
  if (!lu.ok) return erreurChamps(lu.erreurs);
  const avant = await prisma.cptClient.findUnique({ where: { id } });
  if (!avant) return { status: "error", message: "Client introuvable." };
  const incoherence = await controlerPartenaireOrigine(lu.valeur.partenaireOrigineId);
  if (incoherence) return erreurChamps(incoherence);

  const ip = await getClientIp();
  await prisma.$transaction(async (tx) => {
    const apres = await tx.cptClient.update({ where: { id }, data: lu.valeur });
    await indexerMotsCpt(tx, "CLIENT", id, textesIndexClientCpt({ ...apres, partenaireOrigineNom: await nomPartenaire(tx, apres.partenaireOrigineId) }));
    await ecrireAuditCpt(tx, { entite: "CptClient", entiteId: id, action: "modification", avant, apres, userId: session.user.id, ip });
  });
  rafraichir();
  return { status: "success", message: `Client « ${lu.valeur.nom} » modifié.` };
}

// ---------------------------------------------------------------------------------------------------------------
// Produits (le code est la clé métier : il ne change jamais)
// ---------------------------------------------------------------------------------------------------------------

export async function creerProduitAction(saisie: SaisieReferentielCpt): Promise<ResultatReferentielCpt> {
  const session = await exiger("cpt.parametrer");
  if (!session) return NON_AUTORISE;
  const lu = validerProduitCpt(saisie);
  if (!lu.ok) return erreurChamps(lu.erreurs);
  if (await prisma.cptProduit.findUnique({ where: { code: lu.valeur.code } })) {
    return erreurChamps({ code: `Le code « ${lu.valeur.code} » existe déjà.` });
  }

  const ip = await getClientIp();
  try {
    await prisma.$transaction(async (tx) => {
      const cree = await tx.cptProduit.create({ data: lu.valeur });
      await indexerMotsCpt(tx, "PRODUIT", cree.id, textesIndexProduitCpt({ ...cree, libelleBranche: LIBELLE_BRANCHE_CPT[cree.branche] }), true);
      await ecrireAuditCpt(tx, { entite: "CptProduit", entiteId: cree.id, action: "creation", apres: cree, userId: session.user.id, ip });
    });
  } catch (e) {
    if (estViolationUnicite(e)) return erreurChamps({ code: "Ce code existe déjà." });
    throw e;
  }
  rafraichir();
  return { status: "success", message: `Produit « ${lu.valeur.code} » créé.` };
}

export async function modifierProduitAction(id: string, saisie: SaisieReferentielCpt): Promise<ResultatReferentielCpt> {
  const session = await exiger("cpt.parametrer");
  if (!session) return NON_AUTORISE;
  const avant = await prisma.cptProduit.findUnique({ where: { id } });
  if (!avant) return { status: "error", message: "Produit introuvable." };
  // Le code référencé par les taux et les conventions reste celui d'origine, quoi que contienne la saisie.
  const lu = validerProduitCpt({ ...saisie, code: avant.code });
  if (!lu.ok) return erreurChamps(lu.erreurs);

  if (lu.valeur.branche !== avant.branche) {
    const taux = await prisma.cptTauxTca.count({ where: { produitCode: avant.code } });
    if (taux > 0) {
      return erreurChamps({ branche: `Branche : ${taux} taux de TCA sont rattachés à ce produit, sa branche ne peut plus changer.` });
    }
  }

  const { code: _code, ...donnees } = lu.valeur;
  void _code;
  const ip = await getClientIp();
  await prisma.$transaction(async (tx) => {
    const apres = await tx.cptProduit.update({ where: { id }, data: donnees });
    await indexerMotsCpt(tx, "PRODUIT", id, textesIndexProduitCpt({ ...apres, libelleBranche: LIBELLE_BRANCHE_CPT[apres.branche] }));
    await ecrireAuditCpt(tx, { entite: "CptProduit", entiteId: id, action: "modification", avant, apres, userId: session.user.id, ip });
  });
  rafraichir();
  return { status: "success", message: `Produit « ${avant.code} » modifié.` };
}

export async function basculerProduitAction(id: string, actif: boolean): Promise<ResultatReferentielCpt> {
  const session = await exiger("cpt.parametrer");
  if (!session) return NON_AUTORISE;
  const avant = await prisma.cptProduit.findUnique({ where: { id } });
  if (!avant) return { status: "error", message: "Produit introuvable." };
  const ip = await getClientIp();
  await prisma.$transaction(async (tx) => {
    const apres = await tx.cptProduit.update({ where: { id }, data: { actif } });
    await ecrireAuditCpt(tx, { entite: "CptProduit", entiteId: id, action: actif ? "activation" : "desactivation", avant, apres, userId: session.user.id, ip });
  });
  rafraichir();
  return { status: "success", message: actif ? "Produit réactivé." : "Produit désactivé." };
}

// ---------------------------------------------------------------------------------------------------------------
// Comptes d'encaissement
// ---------------------------------------------------------------------------------------------------------------

export async function creerCompteAction(saisie: SaisieReferentielCpt): Promise<ResultatReferentielCpt> {
  const session = await exiger("cpt.parametrer");
  if (!session) return NON_AUTORISE;
  const lu = validerCompteCpt(saisie);
  if (!lu.ok) return erreurChamps(lu.erreurs);
  const ip = await getClientIp();
  await prisma.$transaction(async (tx) => {
    const cree = await tx.cptCompte.create({ data: lu.valeur });
    await ecrireAuditCpt(tx, { entite: "CptCompte", entiteId: cree.id, action: "creation", apres: cree, userId: session.user.id, ip });
  });
  rafraichir();
  return { status: "success", message: `Compte « ${lu.valeur.libelle} » créé.` };
}

export async function modifierCompteAction(id: string, saisie: SaisieReferentielCpt): Promise<ResultatReferentielCpt> {
  const session = await exiger("cpt.parametrer");
  if (!session) return NON_AUTORISE;
  const lu = validerCompteCpt(saisie);
  if (!lu.ok) return erreurChamps(lu.erreurs);
  const avant = await prisma.cptCompte.findUnique({ where: { id } });
  if (!avant) return { status: "error", message: "Compte introuvable." };
  const ip = await getClientIp();
  await prisma.$transaction(async (tx) => {
    const apres = await tx.cptCompte.update({ where: { id }, data: lu.valeur });
    await ecrireAuditCpt(tx, { entite: "CptCompte", entiteId: id, action: "modification", avant, apres, userId: session.user.id, ip });
  });
  rafraichir();
  return { status: "success", message: `Compte « ${lu.valeur.libelle} » modifié.` };
}

export async function basculerCompteAction(id: string, actif: boolean): Promise<ResultatReferentielCpt> {
  const session = await exiger("cpt.parametrer");
  if (!session) return NON_AUTORISE;
  const avant = await prisma.cptCompte.findUnique({ where: { id } });
  if (!avant) return { status: "error", message: "Compte introuvable." };
  const ip = await getClientIp();
  await prisma.$transaction(async (tx) => {
    const apres = await tx.cptCompte.update({ where: { id }, data: { actif } });
    await ecrireAuditCpt(tx, { entite: "CptCompte", entiteId: id, action: actif ? "activation" : "desactivation", avant, apres, userId: session.user.id, ip });
  });
  rafraichir();
  return { status: "success", message: actif ? "Compte réactivé." : "Compte désactivé." };
}

// ---------------------------------------------------------------------------------------------------------------
// Taux de TCA datés : création seule, jamais de modification
// ---------------------------------------------------------------------------------------------------------------

export async function creerTauxTcaAction(saisie: SaisieReferentielCpt): Promise<ResultatReferentielCpt> {
  const session = await exiger("cpt.parametrer");
  if (!session) return NON_AUTORISE;
  const lu = validerTauxTcaCpt(saisie);
  if (!lu.ok) return erreurChamps(lu.erreurs);

  const ip = await getClientIp();
  try {
    const resultat = await prisma.$transaction(async (tx): Promise<ResultatReferentielCpt> => {
      await verrouiller(tx, "cpt:taux-tca");
      const produits = await tx.cptProduit.findMany({ select: { code: true, branche: true } });
      const incoherence = controlerCoherenceTauxTca(lu.valeur, produits);
      if (incoherence) return erreurChamps(incoherence);

      const lignes = await tx.cptTauxTca.findMany();
      const existants: TauxTcaLigne[] = lignes.map((l) => ({
        id: l.id,
        branche: l.branche,
        produitCode: l.produitCode,
        natureContrat: l.natureContrat,
        taux: l.taux.toString(),
        dateEffet: versIso(l.dateEffet),
      }));
      const doublon = controlerDoublonTauxTca(existants, lu.valeur);
      if (doublon) return erreurChamps({ dateEffet: doublon });

      const cree = await tx.cptTauxTca.create({
        data: {
          branche: lu.valeur.branche,
          produitCode: lu.valeur.produitCode,
          natureContrat: lu.valeur.natureContrat,
          taux: lu.valeur.taux,
          dateEffet: versDateUtc(lu.valeur.dateEffet),
          creeParId: session.user.id,
        },
      });
      await ecrireAuditCpt(tx, { entite: "CptTauxTca", entiteId: cree.id, action: "creation", apres: cree, userId: session.user.id, ip });
      return { status: "success", message: `Taux enregistré à compter du ${lu.valeur.dateEffet}.` };
    });
    if (resultat.status === "success") rafraichir();
    return resultat;
  } catch (e) {
    if (estViolationUnicite(e)) return erreurChamps({ dateEffet: "Un taux existe déjà pour cette portée à cette date d'effet." });
    throw e;
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Conventions de rémunération : création, puis clôture (date de fin seule)
// ---------------------------------------------------------------------------------------------------------------

function ligneConvention(c: {
  id: string;
  partenaireId: string;
  produitCode: string | null;
  nature: ConventionLigne["nature"];
  apporteurId: string | null;
  dateEffet: Date;
  dateFin: Date | null;
}): ConventionLigne {
  return {
    id: c.id,
    partenaireId: c.partenaireId,
    produitCode: c.produitCode,
    nature: c.nature,
    apporteurId: c.apporteurId,
    dateEffet: versIso(c.dateEffet),
    dateFin: c.dateFin ? versIso(c.dateFin) : null,
  };
}

export async function creerConventionAction(saisie: SaisieReferentielCpt): Promise<ResultatReferentielCpt> {
  const session = await exiger("cpt.gerer_conventions");
  if (!session) return NON_AUTORISE;
  const lu = validerConventionCpt(saisie);
  if (!lu.ok) return erreurChamps(lu.erreurs);
  const v = lu.valeur;

  const ip = await getClientIp();
  const resultat = await prisma.$transaction(async (tx): Promise<ResultatReferentielCpt> => {
    // Un verrou par partenaire : deux conventions saisies en même temps pour lui se suivent, la seconde voit la première.
    await verrouiller(tx, `cpt:convention:${v.partenaireId}`);

    const erreurs: Record<string, string> = {};
    const [partenaire, apporteur, beneficiaire, produit] = await Promise.all([
      tx.cptPartenaire.findUnique({ where: { id: v.partenaireId }, select: { id: true } }),
      v.apporteurId ? tx.cptPartenaire.findUnique({ where: { id: v.apporteurId }, select: { id: true } }) : Promise.resolve(true),
      v.beneficiaireId ? tx.cptPartenaire.findUnique({ where: { id: v.beneficiaireId }, select: { id: true } }) : Promise.resolve(true),
      v.produitCode ? tx.cptProduit.findUnique({ where: { code: v.produitCode }, select: { code: true } }) : Promise.resolve(true),
    ]);
    if (!partenaire) erreurs.partenaireId = "Partenaire : introuvable.";
    if (!apporteur) erreurs.apporteurId = "Apporteur : introuvable.";
    if (!beneficiaire) erreurs.beneficiaireId = "Bénéficiaire : introuvable.";
    if (!produit) erreurs.produitCode = `Produit : « ${v.produitCode} » n'existe pas.`;
    if (Object.keys(erreurs).length > 0) return erreurChamps(erreurs);

    const existantes = (await tx.cptConvention.findMany({ where: { partenaireId: v.partenaireId } })).map(ligneConvention);
    const chevauchement = controlerChevauchementConventionCpt(existantes, v);
    if (chevauchement) return erreurChamps({ dateEffet: chevauchement });

    const cree = await tx.cptConvention.create({
      data: {
        partenaireId: v.partenaireId,
        produitCode: v.produitCode,
        nature: v.nature,
        taux: v.taux,
        base: v.base,
        faitGenerateur: v.faitGenerateur,
        apporteurId: v.apporteurId,
        beneficiaireId: v.beneficiaireId,
        modeReglement: v.modeReglement,
        dateEffet: versDateUtc(v.dateEffet),
        dateFin: v.dateFin ? versDateUtc(v.dateFin) : null,
        creeParId: session.user.id,
      },
    });
    await ecrireAuditCpt(tx, { entite: "CptConvention", entiteId: cree.id, action: "creation", apres: cree, userId: session.user.id, ip });
    return { status: "success", message: "Convention enregistrée." };
  });
  if (resultat.status === "success") rafraichir();
  return resultat;
}

/** Clôture une convention : seule sa date de fin change (le trigger SQL refuse tout autre champ). */
export async function cloturerConventionAction(id: string, dateFin: string): Promise<ResultatReferentielCpt> {
  const session = await exiger("cpt.gerer_conventions");
  if (!session) return NON_AUTORISE;
  const fin = typeof dateFin === "string" ? dateFin.trim() : "";
  if (!fin) return erreurChamps({ dateFin: "Date de fin : champ obligatoire." });

  const ip = await getClientIp();
  const resultat = await prisma.$transaction(async (tx): Promise<ResultatReferentielCpt> => {
    const avant = await tx.cptConvention.findUnique({ where: { id } });
    if (!avant) return { status: "error", message: "Convention introuvable." };
    await verrouiller(tx, `cpt:convention:${avant.partenaireId}`);

    const autres = (await tx.cptConvention.findMany({ where: { partenaireId: avant.partenaireId } })).map(ligneConvention);
    const message = controlerNouvelleFinConventionCpt(ligneConvention(avant), fin, autres);
    if (message) return erreurChamps({ dateFin: message });

    const apres = await tx.cptConvention.update({ where: { id }, data: { dateFin: versDateUtc(fin) } });
    await ecrireAuditCpt(tx, { entite: "CptConvention", entiteId: id, action: "cloture", avant, apres, userId: session.user.id, ip });
    return { status: "success", message: `Convention close au ${fin}.` };
  });
  if (resultat.status === "success") rafraichir();
  return resultat;
}

// ---------------------------------------------------------------------------------------------------------------
// Correspondances Odoo (GC-2e) : tiers, compte, journal d'une fiche, depuis l'écran dédié
// ---------------------------------------------------------------------------------------------------------------

/**
 * Met à jour les seuls champs Odoo d'une fiche (partenaire, client, produit ou compte d'encaissement). Droit : `cpt.parametrer`
 * (la correspondance comptable est de la configuration, y compris pour un client que le commercial peut par ailleurs créer).
 * Rien d'autre de la fiche n'est lu ni écrit ; l'audit (`correspondance_odoo`, avant/après) et la réindexation de la recherche
 * (les valeurs Odoo font partie des mots d'un partenaire, d'un client et d'un produit) sont dans la même transaction.
 */
export async function modifierCorrespondanceOdooAction(entite: string, id: string, saisie: SaisieReferentielCpt): Promise<ResultatReferentielCpt> {
  const session = await exiger("cpt.parametrer");
  if (!session) return NON_AUTORISE;
  if (!estEntiteOdooCpt(entite)) return { status: "error", message: "Type de fiche inconnu." };
  const lu = validerCorrespondanceOdooCpt(entite, saisie ?? {});
  if (!lu.ok) return erreurChamps(lu.erreurs);

  const ip = await getClientIp();
  const resultat = await prisma.$transaction(async (tx): Promise<ResultatReferentielCpt> => {
    const audit = (entiteAudit: string, avant: unknown, apres: unknown) =>
      ecrireAuditCpt(tx, { entite: entiteAudit, entiteId: id, action: "correspondance_odoo", avant, apres, userId: session.user.id, ip });

    if (entite === "PARTENAIRE") {
      const avant = await tx.cptPartenaire.findUnique({ where: { id } });
      if (!avant) return { status: "error", message: "Partenaire introuvable." };
      const apres = await tx.cptPartenaire.update({ where: { id }, data: { tiersOdoo: lu.valeur.tiersOdoo } });
      await indexerMotsCpt(tx, "PARTENAIRE", id, textesIndexPartenaireCpt(apres));
      await audit("CptPartenaire", avant, apres);
      return { status: "success", message: `Correspondance Odoo de « ${apres.nom} » enregistrée.` };
    }
    if (entite === "CLIENT") {
      const avant = await tx.cptClient.findUnique({ where: { id }, include: { partenaireOrigine: { select: { nom: true } } } });
      if (!avant) return { status: "error", message: "Client introuvable." };
      const { partenaireOrigine, ...avantClient } = avant;
      const apres = await tx.cptClient.update({ where: { id }, data: { tiersOdoo: lu.valeur.tiersOdoo } });
      await indexerMotsCpt(tx, "CLIENT", id, textesIndexClientCpt({ ...apres, partenaireOrigineNom: partenaireOrigine?.nom ?? null }));
      await audit("CptClient", avantClient, apres);
      return { status: "success", message: `Correspondance Odoo de « ${apres.nom} » enregistrée.` };
    }
    if (entite === "PRODUIT") {
      const avant = await tx.cptProduit.findUnique({ where: { id } });
      if (!avant) return { status: "error", message: "Produit introuvable." };
      const apres = await tx.cptProduit.update({ where: { id }, data: { compteOdoo: lu.valeur.compteOdoo } });
      await indexerMotsCpt(tx, "PRODUIT", id, textesIndexProduitCpt({ ...apres, libelleBranche: LIBELLE_BRANCHE_CPT[apres.branche] }));
      await audit("CptProduit", avant, apres);
      return { status: "success", message: `Correspondance Odoo du produit « ${apres.code} » enregistrée.` };
    }
    const avant = await tx.cptCompte.findUnique({ where: { id } });
    if (!avant) return { status: "error", message: "Compte d'encaissement introuvable." };
    const apres = await tx.cptCompte.update({ where: { id }, data: { journalOdoo: lu.valeur.journalOdoo, compteOdoo: lu.valeur.compteOdoo } });
    await audit("CptCompte", avant, apres);
    return { status: "success", message: `Correspondance Odoo du compte « ${apres.libelle} » enregistrée.` };
  });
  if (resultat.status === "success") rafraichir();
  return resultat;
}
