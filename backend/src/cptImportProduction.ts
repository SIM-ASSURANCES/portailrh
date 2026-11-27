// Gestion Compta, lot GC-3c : application en base d'un bordereau de production déjà LU (cptImportLecture) et CONTRÔLÉ (cptProduction).
//
// Tout se passe dans la transaction de l'appelant (`tx`) : un échec annule l'import entier, sans contrat ni audit orphelin. Règles :
//  - un même fichier ne s'importe qu'une fois (empreinte SHA-256 unique, T9) ;
//  - un verrou par numéro de police (`pg_advisory_xact_lock`, pris une seule fois pour toutes les polices, triées pour éviter
//    tout interblocage) protège contre deux imports simultanés d'une même police ;
//  - une ligne à signalement BLOQUANT n'écrit rien : elle devient une anomalie « ligne rejetée » ;
//  - une police inconnue crée le contrat, son acte d'origine et son échéancier ; une police connue n'est JAMAIS réécrite : un
//    écart de montants ou de dates devient une anomalie « contrat différent du fichier », un acte nouveau (renouvellement,
//    tranche, retrait, ristourne…) est signalé pour le lot des actes (GC-3d) ;
//  - la commission et les frais de gestion du bordereau sont enregistrés avec un contrat NOUVEAU (C-39), puis comparés aux
//    conventions pour chaque contrat du fichier (alertes sur /compta/controle, jamais en double) ;
//  - les écritures sont ajoutées en lots (anomalies, audit) pour tenir 10 000 lignes ; les mesures sont l'objet de GC-3g.
// Aucun import d'`enc*` ou de `treso*` (règle d'indépendance du module).

import type { Prisma } from "./generated/prisma/client";
import { preparerAudit, type CptAuditEntree } from "./cptAudit";
import { alerterEcartsRemunerationCpt } from "./cptEcartRemunerationDb";
import { construireEcheancier, dateValideEcheancier, enCentimesEcheancier, texteDepuisCentimes } from "./cptEcheancier";
import type { ResultatLectureCpt } from "./cptImportLecture";
import {
  comparerAvecImportPrecedent,
  controlerLotProduction,
  indexerProduitsProduction,
  ligneImportable,
  ligneProductionDepuisValeurs,
  normaliserLibelleProduction,
  type ContratConnuProduction,
  type LigneProduction,
  type SignalementProduction,
  type TypeActeProduction,
} from "./cptProduction";
import { indexerMotsCpt, textesIndexClientCpt, textesIndexContratCpt } from "./cptRecherche";

export class CptImportProductionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CptImportProductionError";
  }
}

export type CptImportProductionDb = Prisma.TransactionClient;

/** Nom donné au client d'une ligne qui n'en indique aucun : le contrat existe, la correction se fait ensuite (anomalie). */
export const NOM_CLIENT_NON_RENSEIGNE_CPT = "Client non renseigné";

const TAILLE_LOT = 1000;
const CHIFFRE_ZERO = BigInt(0);

export interface ParametresImportProduction {
  lecture: Pick<ResultatLectureCpt, "lignes" | "anomalies" | "nbAnomalies" | "nbLignesVidesIgnorees" | "typeTableur">;
  formatId: string | null;
  /** `CptPieceJointe` du fichier déposé. */
  fichierId: string;
  /** SHA-256 hexadécimal du CONTENU du fichier. */
  empreinte: string;
  userId: string;
  ip?: string | null;
  maintenant?: Date;
  toleranceCentimes?: bigint;
}

export interface BilanImportProduction {
  typeTableur: string;
  lignesLues: number;
  lignesVidesIgnorees: number;
  contratsCrees: number;
  actesCrees: number;
  echeancesCreees: number;
  clientsCrees: number;
  /** Lignes dont le contrat et l'acte existaient déjà à l'identique. */
  lignesInchangees: number;
  /** Polices connues dont le fichier diffère du contrat (jamais réécrites : une anomalie). */
  contratsDifferents: number;
  /** Actes sur une police connue, laissés au lot des actes. */
  actesATraiter: number;
  lignesRejetees: number;
  anomaliesCreees: number;
  anomaliesLecture: number;
  signalements: { bloquants: number; alertes: number; infos: number };
}

export interface ResultatImportProduction {
  importId: string;
  bilan: BilanImportProduction;
}

interface ContratEnBase {
  id: string;
  connu: ContratConnuProduction;
  /** `TYPE|AAAA-MM-JJ` des actes déjà enregistrés. */
  actes: Set<string>;
}

interface AnomaliePrevue {
  type: string;
  objetEntite: string;
  objetId: string;
  detail: Prisma.InputJsonValue;
}

const jour = (texte: string) => new Date(`${texte}T00:00:00.000Z`);
const centimesDepuisDecimal = (d: { toString(): string } | null | undefined) => (d == null ? null : enCentimesEcheancier(d.toString()));
const dateIso = (d: Date) => d.toISOString().slice(0, 10);

function parLots<T>(elements: readonly T[], taille = TAILLE_LOT): T[][] {
  const lots: T[][] = [];
  for (let i = 0; i < elements.length; i += taille) lots.push(elements.slice(i, i + taille));
  return lots;
}

export async function appliquerImportProductionCpt(tx: CptImportProductionDb, p: ParametresImportProduction): Promise<ResultatImportProduction> {
  const maintenant = p.maintenant ?? new Date();
  const aujourdhui = dateIso(maintenant);

  const dejaImporte = await tx.cptImport.findUnique({ where: { empreinte: p.empreinte }, select: { creeAt: true } });
  if (dejaImporte) {
    throw new CptImportProductionError(`Ce fichier a déjà été importé le ${dateIso(dejaImporte.creeAt)} : un même fichier ne s'importe qu'une fois.`);
  }

  const lignes: LigneProduction[] = p.lecture.lignes.map((l) => ligneProductionDepuisValeurs(l.numeroLigne, l.valeurs));

  // ---------- Contexte des contrôles ----------
  const produitsBase = await tx.cptProduit.findMany({ where: { actif: true }, select: { id: true, code: true, libelle: true, tarifReference: true } });
  const idProduitParCode = new Map(produitsBase.map((x) => [normaliserLibelleProduction(x.code), x.id]));
  const produits = indexerProduitsProduction(
    produitsBase.map((x) => ({ code: x.code, libelle: x.libelle, tarifReference: centimesDepuisDecimal(x.tarifReference) }))
  );
  const partenairesBase = await tx.cptPartenaire.findMany({ select: { id: true, nom: true } });
  const partenaireParNom = new Map(partenairesBase.map((x) => [normaliserLibelleProduction(x.nom), x]));

  const references = [...new Set(lignes.flatMap((l) => (l.referencePaiement ? [l.referencePaiement] : [])))];
  const referencesUtilisees = new Map<string, string[]>();
  for (const lot of parLots(references)) {
    const trouves = await tx.cptContrat.findMany({ where: { referencePaiementDeclaree: { in: lot } }, select: { numPolice: true, referencePaiementDeclaree: true } });
    for (const t of trouves) {
      if (!t.referencePaiementDeclaree) continue;
      referencesUtilisees.set(t.referencePaiementDeclaree, [...(referencesUtilisees.get(t.referencePaiementDeclaree) ?? []), t.numPolice]);
    }
  }
  const periodeCloturee = await tx.cptPeriode.findFirst({ where: { statut: "CLOTUREE" }, orderBy: { mois: "desc" }, select: { mois: true } });

  const controle = controlerLotProduction(lignes, {
    produits,
    partenaires: new Set(partenaireParNom.keys()),
    referencesUtilisees,
    aujourdhui,
    enSaisie: false,
    toleranceCentimes: p.toleranceCentimes,
    dernierMoisCloture: periodeCloturee ? dateIso(periodeCloturee.mois) : null,
  });

  // ---------- L'import, puis le verrou des polices ----------
  const importCree = await tx.cptImport.create({
    data: { type: "PRODUCTION", formatId: p.formatId, fichierId: p.fichierId, empreinte: p.empreinte, statut: "VALIDE", creeParId: p.userId },
    select: { id: true },
  });
  const importId = importCree.id;

  const polices = [...new Set(lignes.flatMap((l) => (l.numPolice ? [l.numPolice] : [])))].sort();
  if (polices.length > 0) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('cpt:police:' || p)) FROM unnest(${polices}::text[]) AS p`;
  }

  const existants = new Map<string, ContratEnBase>();
  for (const lot of parLots(polices)) {
    const trouves = await tx.cptContrat.findMany({
      where: { numPolice: { in: lot } },
      include: {
        produit: { select: { code: true } },
        partenaireApporteur: { select: { nom: true } },
        client: { select: { nom: true } },
        actes: { select: { type: true, date: true } },
      },
    });
    for (const c of trouves) {
      existants.set(c.numPolice, {
        id: c.id,
        connu: {
          numPolice: c.numPolice,
          produit: c.produit.code,
          partenaire: c.partenaireApporteur?.nom ?? null,
          client: c.client.nom,
          dateEffet: dateIso(c.dateEffet),
          dateEcheance: dateIso(c.dateEcheance),
          primeTtc: centimesDepuisDecimal(c.primeTtc),
          primeHt: centimesDepuisDecimal(c.primeNetteHt),
          accessoires: centimesDepuisDecimal(c.accessoiresHt),
          taxe: centimesDepuisDecimal(c.taxe),
        },
        actes: new Set(c.actes.map((a) => `${a.type}|${dateIso(a.date)}`)),
      });
    }
  }

  // ---------- Les lignes ----------
  const bilan: BilanImportProduction = {
    typeTableur: p.lecture.typeTableur,
    lignesLues: lignes.length,
    lignesVidesIgnorees: p.lecture.nbLignesVidesIgnorees,
    contratsCrees: 0,
    actesCrees: 0,
    echeancesCreees: 0,
    clientsCrees: 0,
    lignesInchangees: 0,
    contratsDifferents: 0,
    actesATraiter: 0,
    lignesRejetees: 0,
    anomaliesCreees: 0,
    anomaliesLecture: p.lecture.nbAnomalies,
    signalements: { bloquants: controle.nbBloquants, alertes: controle.nbAlertes, infos: controle.nbInfos },
  };
  const anomalies: AnomaliePrevue[] = [];
  const audits: CptAuditEntree[] = [];
  const clientParCle = new Map<string, string>();
  const contratsAControler = new Set<string>();

  const objetLigne = (numeroLigne: number) => ({ objetEntite: "LIGNE_IMPORT", objetId: `${importId}:${numeroLigne}` });
  const detailSignalement = (ligne: LigneProduction, s: SignalementProduction): Prisma.InputJsonValue => ({
    numeroLigne: ligne.numeroLigne,
    numPolice: ligne.numPolice,
    champ: s.champ ?? null,
    gravite: s.gravite,
    message: s.message,
  });
  const signalerLigne = (ligne: LigneProduction, type: string, message: string) =>
    anomalies.push({ type, ...objetLigne(ligne.numeroLigne), detail: { numeroLigne: ligne.numeroLigne, numPolice: ligne.numPolice, gravite: "BLOQUANT", message } });

  async function resoudreClient(ligne: LigneProduction): Promise<string> {
    const nom = ligne.client ?? NOM_CLIENT_NON_RENSEIGNE_CPT;
    const cle = `${normaliserLibelleProduction(nom)}|${ligne.telephone ?? ""}`;
    const enMemoire = clientParCle.get(cle);
    if (enMemoire) return enMemoire;
    const trouve = await tx.cptClient.findFirst({ where: { nom: { equals: nom, mode: "insensitive" }, telephone: ligne.telephone }, select: { id: true } });
    if (trouve) {
      clientParCle.set(cle, trouve.id);
      return trouve.id;
    }
    const cree = await tx.cptClient.create({ data: { nom, telephone: ligne.telephone }, select: { id: true } });
    await indexerMotsCpt(tx, "CLIENT", cree.id, textesIndexClientCpt({ nom, telephone: ligne.telephone, pieceIdentite: null, tiersOdoo: null }), true);
    audits.push({ entite: "CptClient", entiteId: cree.id, action: "creation", apres: { nom, telephone: ligne.telephone, importId }, userId: p.userId, ip: p.ip });
    clientParCle.set(cle, cree.id);
    bilan.clientsCrees += 1;
    return cree.id;
  }

  for (const ligne of lignes) {
    const signalements = controle.parLigne.get(ligne.numeroLigne) ?? [];

    if (!ligneImportable(signalements)) {
      bilan.lignesRejetees += 1;
      for (const s of signalements.filter((x) => x.gravite !== "INFO")) anomalies.push({ type: s.code, ...objetLigne(ligne.numeroLigne), detail: detailSignalement(ligne, s) });
      continue;
    }
    // Un signalement non bloquant garantit : police, produit connu, deux dates valides et prime TTC lisible.
    const numPolice = ligne.numPolice as string;
    const produit = produits.get(normaliserLibelleProduction(ligne.produit));
    const produitId = produit ? idProduitParCode.get(normaliserLibelleProduction(produit.code)) : undefined;
    const primeTtc = ligne.primeTtc as bigint;
    const dateEffet = ligne.dateEffet as string;
    const dateEcheance = ligne.dateEcheance as string;
    if (!produit || !produitId) {
      bilan.lignesRejetees += 1;
      signalerLigne(ligne, "PRODUIT_INCONNU", `Produit inconnu : « ${ligne.produit} ».`);
      continue;
    }
    const typeActe: TypeActeProduction = ligne.typeActe ?? "AFFAIRE_NOUVELLE";
    const existant = existants.get(numPolice);
    const alertes = signalements.filter((x) => x.gravite === "ALERTE");
    const objetEntite = "CONTRAT";
    let objetId = existant?.id ?? "";

    if (existant) {
      contratsAControler.add(existant.id);
      const cleActe = `${typeActe}|${dateEffet}`;
      if (existant.actes.has(cleActe)) {
        const comparaison = comparerAvecImportPrecedent([{ ...ligne, produit: produit.code }], new Map([[numPolice, existant.connu]]));
        const champs = comparaison.modifiees[0]?.champs ?? [];
        if (champs.length > 0) {
          bilan.contratsDifferents += 1;
          anomalies.push({
            type: "CONTRAT_DIFFERENT_DU_FICHIER",
            objetEntite,
            objetId,
            detail: { numeroLigne: ligne.numeroLigne, numPolice, champs, message: `Le contrat existe déjà et diffère du fichier : ${champs.join(", ")}. Il n'est pas modifié.` },
          });
        } else {
          bilan.lignesInchangees += 1;
        }
      } else {
        bilan.actesATraiter += 1;
        anomalies.push({
          type: "ACTE_A_TRAITER",
          objetEntite,
          objetId,
          detail: { numeroLigne: ligne.numeroLigne, numPolice, typeActe, dateEffet, message: `Acte « ${typeActe} » daté du ${dateEffet} sur une police déjà enregistrée : il sera traité avec les actes.` },
        });
      }
    } else {
      if (typeActe !== "AFFAIRE_NOUVELLE" && typeActe !== "RENOUVELLEMENT") {
        bilan.lignesRejetees += 1;
        signalerLigne(ligne, "ACTE_SANS_CONTRAT", `Acte « ${typeActe} » sur une police inconnue : aucun contrat à modifier.`);
        continue;
      }
      const accessoires = ligne.accessoires ?? CHIFFRE_ZERO;
      const taxe = ligne.taxe ?? CHIFFRE_ZERO;
      const primeHt = ligne.primeHt ?? primeTtc - accessoires - taxe;
      if (primeTtc < CHIFFRE_ZERO || accessoires < CHIFFRE_ZERO || taxe < CHIFFRE_ZERO || primeHt < CHIFFRE_ZERO) {
        bilan.lignesRejetees += 1;
        signalerLigne(ligne, "MONTANTS_NON_ENREGISTRABLES", "Un contrat nouveau ne peut pas porter de montant négatif (prime, accessoires, taxe ou prime hors taxe).");
        continue;
      }

      const clientId = await resoudreClient(ligne);
      const partenaire = ligne.partenaire ? partenaireParNom.get(normaliserLibelleProduction(ligne.partenaire)) : undefined;
      const declarePaye = (ligne.montantPaye !== null && ligne.montantPaye > CHIFFRE_ZERO) || ligne.datePaiement !== null || ligne.modePaiement !== null;
      const datePaiement = ligne.datePaiement !== null && dateValideEcheancier(ligne.datePaiement) ? jour(ligne.datePaiement) : null;
      const contrat = await tx.cptContrat.create({
        data: {
          numPolice,
          produitId,
          natureContrat: ligne.natureContrat ?? "INDIVIDUEL",
          clientId,
          partenaireApporteurId: partenaire?.id ?? null,
          dateEffet: jour(dateEffet),
          dateEcheance: jour(dateEcheance),
          fractionnement: ligne.fractionnement ?? "COMPTANT",
          primeNetteHt: texteDepuisCentimes(primeHt),
          accessoiresHt: texteDepuisCentimes(accessoires),
          taxe: texteDepuisCentimes(taxe),
          primeTtc: texteDepuisCentimes(primeTtc),
          declarePaye,
          modePaiementDeclare: ligne.modePaiement,
          referencePaiementDeclaree: ligne.referencePaiement,
          datePaiementDeclaree: datePaiement,
          commissionDeclaree: ligne.commission === null ? null : texteDepuisCentimes(ligne.commission),
          gestionDeclaree: ligne.gestion === null ? null : texteDepuisCentimes(ligne.gestion),
          importId,
          creeParId: p.userId,
        },
        select: { id: true },
      });
      objetId = contrat.id;
      contratsAControler.add(contrat.id);
      bilan.contratsCrees += 1;

      await tx.cptActe.create({
        data: {
          contratId: contrat.id,
          type: typeActe,
          date: jour(dateEffet),
          primeNetteHt: texteDepuisCentimes(primeHt),
          accessoiresHt: texteDepuisCentimes(accessoires),
          taxe: texteDepuisCentimes(taxe),
          primeTtc: texteDepuisCentimes(primeTtc),
          importId,
          creeParId: p.userId,
        },
      });
      bilan.actesCrees += 1;

      if (primeTtc > CHIFFRE_ZERO) {
        const echeancier = construireEcheancier({
          fractionnement: ligne.fractionnement ?? "COMPTANT",
          dateEffet,
          dateEcheance,
          primeTtc: texteDepuisCentimes(primeTtc),
          accessoires: texteDepuisCentimes(accessoires),
          taxe: texteDepuisCentimes(taxe),
        });
        if (echeancier.ok) {
          await tx.cptEcheance.createMany({
            data: echeancier.echeances.map((e) => ({
              contratId: contrat.id,
              rang: e.rang,
              periodeDebut: jour(e.periodeDebut),
              periodeFin: jour(e.periodeFin),
              datePrevue: jour(e.datePrevue),
              primeTtc: e.primeTtc,
              primeHt: e.primeHt,
              accessoires: e.accessoires,
              taxe: e.taxe,
              montantDu: e.montantDu,
            })),
          });
          bilan.echeancesCreees += echeancier.echeances.length;
        } else {
          anomalies.push({
            type: "ECHEANCIER_NON_GENERE",
            objetEntite,
            objetId,
            detail: { numeroLigne: ligne.numeroLigne, numPolice, message: `Échéancier non généré : ${echeancier.erreur}` },
          });
        }
      }

      await indexerMotsCpt(
        tx,
        "CONTRAT",
        contrat.id,
        textesIndexContratCpt({
          numPolice,
          client: ligne.client,
          partenaire: ligne.partenaire,
          produitCode: produit.code,
          produitLibelle: produit.libelle,
          referencePaiement: ligne.referencePaiement,
        }),
        true
      );
      audits.push({
        entite: "CptContrat",
        entiteId: contrat.id,
        action: "creation",
        apres: { numPolice, produit: produit.code, primeTtc: texteDepuisCentimes(primeTtc), typeActe, importId },
        mois: jour(dateEffet),
        userId: p.userId,
        ip: p.ip,
      });
      existants.set(numPolice, {
        id: contrat.id,
        connu: {
          numPolice,
          produit: produit.code,
          partenaire: partenaire?.nom ?? null,
          client: ligne.client,
          dateEffet,
          dateEcheance,
          primeTtc,
          primeHt,
          accessoires,
          taxe,
        },
        actes: new Set([`${typeActe}|${dateEffet}`]),
      });
    }

    for (const s of alertes) anomalies.push({ type: s.code, objetEntite, objetId, detail: detailSignalement(ligne, s) });
  }

  for (const a of p.lecture.anomalies) {
    anomalies.push({
      type: "CELLULE_ILLISIBLE",
      ...objetLigne(a.numeroLigne),
      detail: { numeroLigne: a.numeroLigne, champ: a.champ, entete: a.entete, valeurBrute: a.valeurBrute, message: a.motif },
    });
  }

  // Écarts avec les conventions : après la création des échéances. Rien n'en va au bilan (montants réservés, C-36).
  await alerterEcartsRemunerationCpt(tx, [...contratsAControler], importId);

  // ---------- Écritures en lots, bilan, audit de l'import ----------
  for (const lot of parLots(anomalies)) {
    await tx.cptAnomalie.createMany({ data: lot.map((a) => ({ type: a.type, objetEntite: a.objetEntite, objetId: a.objetId, detail: a.detail, importId })) });
  }
  bilan.anomaliesCreees = anomalies.length;

  audits.push({
    entite: "CptImport",
    entiteId: importId,
    action: "import_production",
    apres: bilan,
    userId: p.userId,
    ip: p.ip,
  });
  for (const lot of parLots(audits)) await tx.cptAudit.createMany({ data: lot.map((a) => preparerAudit(a)) });

  await tx.cptImport.update({ where: { id: importId }, data: { bilan: bilan as unknown as Prisma.InputJsonValue } });
  return { importId, bilan };
}
