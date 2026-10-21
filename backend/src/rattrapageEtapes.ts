import { readFile } from "node:fs/promises";

import type { PrismaClient } from "./generated/prisma/client";
import { Prisma } from "./generated/prisma/client";
import { detailClotureForcee, instantaneClotureForcee } from "./clotureDemande";
import { chargerEvaluationCloture } from "./clotureDemandeDb";
import { montantValideArticle } from "./reglementArticle";
import { corrigerDemande, type DemandeARecalculer } from "./repriseArticles";
import { classerDemande, refusRattachement, type DemandeARattacher } from "./repriseReglements";
import { ACTIONS_HISTORIQUE_SIGNEES } from "./signatureConstantes";
import { rattacherEntrees, type ActionPourReprise, type EntreeAReprendre, type VerdictReprise } from "./signatureReprise";

/**
 * Étapes de rattrapage des données existantes (lots B, C, D, L bis), EXTRAITES des scripts de `prisma/` pour qu'une seule
 * définition serve à la fois à chaque script (`recalculer-statuts-articles.ts`, `recalculer-reglements-articles.ts`,
 * `simuler-cloture-articles.ts`, `rattacher-signatures.ts`) et au script chaîné `rattrapage-production.ts` (lot O, 2026-10-30).
 *
 * Contrat commun : chaque étape est une SIMULATION tant que `appliquer` est faux (aucune écriture) ; elle ne devine jamais un
 * cas ambigu (il est listé et laissé) ; elle ne touche jamais une écriture de caisse ; elle est IDEMPOTENTE (un second passage
 * ne trouve plus rien à faire). `log` reçoit les lignes de détail dans l'ordre.
 */
export interface ResultatEtape {
  /** Éléments examinés (demandes, lignes d'historique…). */
  examinees: number;
  /** Éléments à traiter trouvés (avant écriture). */
  aTraiter: number;
  /** Éléments effectivement écrits (0 en simulation). */
  traitees: number;
  /** Cas ambigus ou à traiter à la main, jamais devinés. */
  ambigus: number;
  /** Phrase de synthèse (identique à celle du script autonome). */
  resume: string;
}

export interface OptionsEtape {
  appliquer: boolean;
  log: (ligne: string) => void;
}

// ---------- Lot B : statut, étape, montant validé des demandes à articles ----------

export async function etapeStatutsArticles(prisma: PrismaClient, { appliquer, log }: OptionsEtape): Promise<ResultatEtape> {
  const demandes = await prisma.demande.findMany({
    where: { typeDemande: "STANDARD", lignes: { some: {} } },
    select: {
      id: true,
      reference: true,
      typeDemande: true,
      statut: true,
      etapeCircuit: true,
      modeEtapeDG: true,
      montant: true,
      montantValide: true,
      lignes: { select: { quantite: true, prixUnitaire: true, statutValidation: true, soumiseAuDG: true, decisionDG: true } },
    },
    orderBy: { createdAt: "asc" },
  });
  const sommes = await prisma.reglement.groupBy({
    by: ["demandeId"],
    where: { estConfirme: true, estAnnule: false },
    _sum: { montant: true },
  });
  const totalRegle = new Map(sommes.map((s) => [s.demandeId, Number(s._sum.montant ?? 0)]));

  let nombre = 0;
  for (const d of demandes) {
    const entree: DemandeARecalculer = {
      id: d.id,
      reference: d.reference,
      typeDemande: d.typeDemande,
      statut: d.statut,
      etapeCircuit: d.etapeCircuit,
      modeEtapeDG: d.modeEtapeDG,
      montant: Number(d.montant),
      montantValide: Number(d.montantValide ?? 0),
      totalRegle: totalRegle.get(d.id) ?? 0,
      lignes: d.lignes.map((l) => ({
        quantite: l.quantite,
        prixUnitaire: l.prixUnitaire.toString(),
        statutValidation: l.statutValidation,
        soumiseAuDG: l.soumiseAuDG,
        decisionDG: l.decisionDG,
      })),
    };
    const correction = corrigerDemande(entree);
    if (!correction) continue;
    nombre += 1;
    log(`${correction.reference} — ${correction.resume.join(" ; ")}`);
    if (!appliquer) continue;
    await prisma.$transaction(async (tx) => {
      await tx.demande.update({ where: { id: d.id }, data: correction.changements });
      // Compte système : l'entrée d'historique exige un auteur, on prend le créateur de la demande comme porteur
      // technique et on le dit dans le détail.
      const demande = await tx.demande.findUniqueOrThrow({ where: { id: d.id }, select: { createurId: true } });
      await tx.historiqueEntry.create({
        data: {
          entity: "Demande",
          entityId: d.id,
          action: "reprise_statut_articles",
          detail: `Reprise du lot B (script manuel) : ${correction.resume.join(" ; ")}`,
          userId: demande.createurId,
        },
      });
    });
  }
  return {
    examinees: demandes.length,
    aTraiter: nombre,
    traitees: appliquer ? nombre : 0,
    ambigus: 0,
    resume: `${demandes.length} demande(s) à articles examinée(s), ${nombre} ${appliquer ? "corrigée(s)" : "à corriger (simulation : relancer avec --appliquer pour écrire)"}.`,
  };
}

// ---------- Lot D : règlements → article ----------

export interface OptionsReglements extends OptionsEtape {
  /** Rattache aussi les cas à UN SEUL article validé (jamais un cas ambigu). */
  automatique: boolean;
  affectations?: { reglementId: string; ligneId: string }[];
}

export async function etapeReglementsArticles(prisma: PrismaClient, { appliquer, log, automatique, affectations = [] }: OptionsReglements): Promise<ResultatEtape> {
  const demandes = await prisma.demande.findMany({
    where: { lignes: { some: {} }, reglements: { some: {} } },
    select: {
      id: true,
      reference: true,
      createurId: true,
      lignes: {
        select: { id: true, libelle: true, quantite: true, prixUnitaire: true, statutValidation: true, categorieId: true },
        orderBy: { createdAt: "asc" },
      },
      reglements: {
        select: { id: true, ligneDemandeId: true, montant: true, mode: true, estConfirme: true, estAnnule: true, confirmeAt: true, createdAt: true },
        orderBy: { createdAt: "asc" },
      },
    },
    orderBy: { createdAt: "asc" },
  });
  const vue = (d: (typeof demandes)[number]): DemandeARattacher => ({
    id: d.id,
    reference: d.reference,
    articles: d.lignes.map((l) => ({ ...l, prixUnitaire: Number(l.prixUnitaire) })),
    reglements: d.reglements.map((r) => ({ id: r.id, ligneDemandeId: r.ligneDemandeId, montant: Number(r.montant), mode: r.mode, estConfirme: r.estConfirme, estAnnule: r.estAnnule })),
  });
  const eur = (n: number) => `${n.toLocaleString("fr-FR")} FCFA`;

  let ambigus = 0;
  let rattaches = 0;
  let automatiquesTrouves = 0;
  for (const d of demandes) {
    const v = vue(d);
    const c = classerDemande(v);
    if (c.classe === "AMBIGU") {
      ambigus += 1;
      log(`\n[AMBIGU] ${d.reference} — règlements sans article à rattacher à la main :`);
      for (const r of d.reglements.filter((x) => c.reglementIds.includes(x.id))) {
        log(`  règlement ${r.id} : ${eur(Number(r.montant))} ${r.mode} ${r.estConfirme ? "confirmé" : "brouillon"} (${(r.confirmeAt ?? r.createdAt).toISOString().slice(0, 10)})`);
      }
      log("  articles validés :");
      for (const a of v.articles.filter((x) => x.statutValidation === "VALIDEE")) {
        log(`  article ${a.id} : « ${a.libelle} » validé ${eur(montantValideArticle(a))}`);
      }
    }
    if (c.classe === "AUTOMATIQUE") {
      automatiquesTrouves += c.reglementIds.length;
      log(`\n[AUTOMATIQUE] ${d.reference} — ${c.reglementIds.length} règlement(s) → article ${c.ligneId}`);
      if (automatique) {
        rattaches += c.reglementIds.length;
        if (appliquer) {
          await prisma.$transaction(async (tx) => {
            await tx.reglement.updateMany({ where: { id: { in: c.reglementIds }, ligneDemandeId: null }, data: { ligneDemandeId: c.ligneId } });
            await tx.historiqueEntry.create({
              data: {
                entity: "Demande",
                entityId: d.id,
                action: "rattachement_reglement_article",
                detail: `Reprise du lot D (script manuel) : ${c.reglementIds.length} règlement(s) rattaché(s) à l'unique article validé.`,
                userId: d.createurId,
              },
            });
          });
        }
      }
    }
  }

  for (const a of affectations) {
    const d = demandes.find((x) => x.reglements.some((r) => r.id === a.reglementId));
    if (!d) {
      log(`\n[AFFECTER] règlement ${a.reglementId} : introuvable.`);
      continue;
    }
    const refus = refusRattachement(vue(d), a.reglementId, a.ligneId);
    if (refus) {
      log(`\n[AFFECTER] ${d.reference} règlement ${a.reglementId} → article ${a.ligneId} : IMPOSSIBLE — ${refus}`);
      continue;
    }
    log(`\n[AFFECTER] ${d.reference} règlement ${a.reglementId} → article ${a.ligneId} : ${appliquer ? "appliqué" : "permis (simulation)"}`);
    rattaches += 1;
    if (appliquer) {
      await prisma.$transaction(async (tx) => {
        const n = await tx.reglement.updateMany({ where: { id: a.reglementId, ligneDemandeId: null }, data: { ligneDemandeId: a.ligneId } });
        if (n.count !== 1) throw new Error("Règlement déjà rattaché entre-temps.");
        await tx.historiqueEntry.create({
          data: {
            entity: "Demande",
            entityId: d.id,
            action: "rattachement_reglement_article",
            detail: `Reprise du lot D (script manuel) : règlement ${a.reglementId} rattaché à l'article ${a.ligneId}.`,
            userId: d.createurId,
          },
        });
      });
    }
  }

  return {
    examinees: demandes.length,
    aTraiter: automatiquesTrouves,
    traitees: appliquer ? rattaches : 0,
    ambigus,
    resume: `\n${demandes.length} demande(s) à articles avec règlements examinée(s) ; ${ambigus} ambiguë(s) (avant ce passage) ; ${rattaches} règlement(s) ${appliquer ? "rattaché(s)" : "rattachable(s) (simulation : relancer avec --appliquer pour écrire)"}.`,
  };
}

// ---------- Lot C : clôtures antérieures à la règle « tous les articles terminés » ----------

export async function etapeClotureArticles(prisma: PrismaClient, { appliquer, log }: OptionsEtape): Promise<ResultatEtape> {
  const demandes = await prisma.demande.findMany({
    where: { statut: "CLOTUREE", clotureForcee: false, typeDemande: "STANDARD", lignes: { some: {} } },
    select: { id: true, reference: true, createurId: true },
    orderBy: { createdAt: "asc" },
  });
  let incoherentes = 0;
  for (const d of demandes) {
    const { evaluation } = await chargerEvaluationCloture(d.id);
    // Un article encore « à décider » sur une demande clôturée (ancien circuit) n'est pas du ressort de ce lot.
    if (!evaluation.decidee || evaluation.bloquants.length === 0) continue;
    incoherentes += 1;
    const instantane = instantaneClotureForcee(evaluation.bloquants);
    log(`${d.reference} — ${evaluation.bloquants.length} article(s) non régularisé(s) : ${detailClotureForcee(instantane)}`);
    if (!appliquer) continue;
    await prisma.$transaction(async (tx) => {
      await tx.demande.update({
        where: { id: d.id },
        data: {
          clotureForcee: true,
          clotureForceeAt: new Date(),
          clotureForceeParId: null,
          clotureForceeArticles: instantane as unknown as Prisma.InputJsonValue,
        },
      });
      await tx.historiqueEntry.create({
        data: {
          entity: "Demande",
          entityId: d.id,
          action: "reprise_cloture_articles",
          detail: `Reprise du lot C (script manuel) : demande clôturée avant la règle « tous les articles terminés », marquée « clôturée sans régularisation » — articles non régularisés : ${detailClotureForcee(instantane)}`,
          userId: d.createurId,
        },
      });
    });
  }
  return {
    examinees: demandes.length,
    aTraiter: incoherentes,
    traitees: appliquer ? incoherentes : 0,
    ambigus: 0,
    resume: `${demandes.length} demande(s) à articles clôturée(s) examinée(s), ${incoherentes} incohérente(s) avec la règle du lot C ${
      appliquer ? "marquée(s) « clôturée sans régularisation »" : "(simulation : relancer avec --appliquer pour les marquer)"
    }.`,
  };
}

// ---------- Lot L bis : lignes d'historique → action signée ----------

export async function etapeSignatures(prisma: PrismaClient, { appliquer, log }: OptionsEtape): Promise<ResultatEtape> {
  const marqueur = await prisma.marqueurUnique.findUnique({ where: { cle: "signatures.mise_en_service" }, select: { creeAt: true } });
  if (!marqueur) {
    return {
      examinees: 0,
      aTraiter: 0,
      traitees: 0,
      ambigus: 0,
      resume: "Les signatures ne sont pas encore en service (aucun repère de mise en service) : rien à rattacher.",
    };
  }
  const miseEnService = marqueur.creeAt;
  const actionsSignables = [...ACTIONS_HISTORIQUE_SIGNEES];

  const lignes = await prisma.historiqueEntry.findMany({
    where: { action: { in: actionsSignables }, actionSigneeId: null, createdAt: { gte: miseEnService } },
    select: { id: true, userId: true, createdAt: true, action: true, entity: true, entityId: true, actionSigneeId: true },
  });
  const idsLignes = [...new Set(lignes.filter((l) => l.entity === "LigneDemande").map((l) => l.entityId))];
  const demandeParLigne = new Map(
    (await prisma.ligneDemande.findMany({ where: { id: { in: idsLignes } }, select: { id: true, demandeId: true } })).map((l) => [l.id, l.demandeId])
  );
  const entrees: EntreeAReprendre[] = lignes.map((l) => ({
    id: l.id,
    userId: l.userId,
    createdAt: l.createdAt,
    action: l.action,
    demandeId: l.entity === "Demande" ? l.entityId : l.entity === "LigneDemande" ? (demandeParLigne.get(l.entityId) ?? null) : null,
    actionSigneeId: l.actionSigneeId,
  }));
  const actions: ActionPourReprise[] = (
    await prisma.actionSignee.findMany({ select: { id: true, signataireId: true, creeAt: true, demandeId: true, signatureId: true, auNomDeId: true } })
  ).map((a) => ({ ...a }));

  const verdicts = rattacherEntrees(entrees, actions, miseEnService, new Set(actionsSignables));

  const comptes = new Map<string, Record<VerdictReprise["etat"], number>>();
  const rattachables: Array<{ id: string; actionId: string }> = [];
  for (const e of entrees) {
    const v = verdicts.get(e.id);
    if (!v) continue;
    const c = comptes.get(e.action) ?? { DEJA_LIEE: 0, ANTERIEURE: 0, RATTACHABLE: 0, AMBIGUE: 0, SANS_CANDIDATE: 0 };
    c[v.etat] += 1;
    comptes.set(e.action, c);
    if (v.etat === "RATTACHABLE") rattachables.push({ id: e.id, actionId: v.actionId });
  }

  const total = { RATTACHABLE: 0, AMBIGUE: 0, SANS_CANDIDATE: 0 };
  log(`Mise en service des signatures : ${miseEnService.toISOString()}`);
  log("Lignes d'historique d'actions signables, postérieures à la mise en service et SANS lien :");
  for (const [action, c] of [...comptes.entries()].sort()) {
    log(`  ${action.padEnd(36)} rattachables ${String(c.RATTACHABLE).padStart(4)} · ambiguës ${String(c.AMBIGUE).padStart(4)} · sans candidate ${String(c.SANS_CANDIDATE).padStart(4)}`);
    total.RATTACHABLE += c.RATTACHABLE;
    total.AMBIGUE += c.AMBIGUE;
    total.SANS_CANDIDATE += c.SANS_CANDIDATE;
  }
  const dejaLiees = await prisma.historiqueEntry.count({ where: { action: { in: actionsSignables }, actionSigneeId: { not: null } } });
  const anterieures = await prisma.historiqueEntry.count({ where: { action: { in: actionsSignables }, createdAt: { lt: miseEnService } } });
  log(`Total sans lien : ${lignes.length} → rattachables ${total.RATTACHABLE}, AMBIGUËS ${total.AMBIGUE} (laissées « Signature non rattachée »), sans candidate ${total.SANS_CANDIDATE}.`);
  log(`Déjà liées par identifiant : ${dejaLiees}. Antérieures à la mise en service (« Antérieur à la signature ») : ${anterieures}.`);

  let ecrites = 0;
  if (appliquer) {
    for (const r of rattachables) {
      const res = await prisma.historiqueEntry.updateMany({ where: { id: r.id, actionSigneeId: null }, data: { actionSigneeId: r.actionId } });
      ecrites += res.count;
    }
  }
  return {
    examinees: lignes.length,
    aTraiter: total.RATTACHABLE,
    traitees: ecrites,
    // Les ambiguës et sans candidate restent « Signature non rattachée » : jamais devinées, comptées pour information.
    ambigus: total.AMBIGUE + total.SANS_CANDIDATE,
    resume: appliquer
      ? `${ecrites} ligne(s) d'historique rattachée(s). Les cas ambigus ne sont jamais devinés.`
      : "Simulation : rien n'a été écrit. Relancer avec --appliquer pour rattacher les lignes rattachables.",
  };
}

// ---------- Lot D : comptage en lecture seule (comptage-reglements-articles.sql) ----------

/** Exécute le fichier SQL de comptage (SELECT uniquement : toute autre instruction est refusée) et renvoie ses lignes. */
export async function etapeComptageReglements(
  prisma: PrismaClient,
  cheminSql: string,
  log: (ligne: string) => void
): Promise<{ lignes: number; demandesAmbigues: number }> {
  const brut = await readFile(cheminSql, "utf8");
  const instructions = brut
    .split("\n")
    .filter((l) => !l.trim().startsWith("--"))
    .join("\n")
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  let lignes = 0;
  let demandesAmbigues = 0;
  for (const [i, sql] of instructions.entries()) {
    if (!/^(WITH|SELECT)\b/i.test(sql)) throw new Error("Le fichier de comptage ne doit contenir que des SELECT.");
    const rows = (await prisma.$queryRawUnsafe(sql)) as Array<Record<string, unknown>>;
    lignes += rows.length;
    for (const r of rows) log(`  ${Object.entries(r).map(([k, v]) => `${k}=${String(v)}`).join(" · ")}`);
    if (i === 1) demandesAmbigues = rows.length; // 2ᵉ requête = détail des demandes ambiguës
  }
  return { lignes, demandesAmbigues };
}
