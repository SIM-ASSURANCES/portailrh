// ".env" de la racine du monorepo chargé AVANT tout autre import (voir `chargerEnv.ts`) : toujours la première ligne.
import "./chargerEnv";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { ACTIONS_HISTORIQUE_SIGNEES } from "../src/signatureConstantes";
import { rattacherEntrees, type ActionPourReprise, type EntreeAReprendre, type VerdictReprise } from "../src/signatureReprise";

/**
 * Lot L bis (2026-10-28) — reprise des signatures du lot L : rattache à leur action signée, PAR IDENTIFIANT, les lignes d'historique
 * qui ne l'étaient que par l'ancien rapprochement (même compte, dans la minute). Même règle que la migration
 * `20261028090000_signature_lien_identifiant` (qui l'a déjà appliquée UNE fois) : ce script sert à contrôler et à rattraper les lignes
 * restées sans lien, et à COMPTER les cas ambigus, qu'il ne devine jamais (elles restent « Signature non rattachée »).
 *
 * Par défaut : SIMULATION (compte par action : déjà liées, rattachables, ambiguës, sans candidate, antérieures à la mise en service
 * des signatures ; n'écrit rien). Avec `--appliquer` : écrit `HistoriqueEntry.actionSigneeId` des seules lignes rattachables, jamais
 * une autre colonne ni une autre table (le journal de caisse n'est pas touché). IDEMPOTENT : seules les lignes sans lien sont vues.
 *
 * LANCÉ À LA MAIN, JAMAIS PAR UNE MIGRATION NI AU DÉMARRAGE.
 *
 *   npx tsx prisma/rattacher-signatures.ts               # simulation
 *   npx tsx prisma/rattacher-signatures.ts --appliquer   # écriture
 */
async function main() {
  const appliquer = process.argv.includes("--appliquer");
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL absente.");
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
  try {
    const marqueur = await prisma.marqueurUnique.findUnique({ where: { cle: "signatures.mise_en_service" }, select: { creeAt: true } });
    if (!marqueur) {
      console.log("Les signatures ne sont pas encore en service (aucun repère de mise en service) : rien à rattacher.");
      return;
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
    console.log(`Mise en service des signatures : ${miseEnService.toISOString()}`);
    console.log("Lignes d'historique d'actions signables, postérieures à la mise en service et SANS lien :");
    for (const [action, c] of [...comptes.entries()].sort()) {
      console.log(`  ${action.padEnd(36)} rattachables ${String(c.RATTACHABLE).padStart(4)} · ambiguës ${String(c.AMBIGUE).padStart(4)} · sans candidate ${String(c.SANS_CANDIDATE).padStart(4)}`);
      total.RATTACHABLE += c.RATTACHABLE;
      total.AMBIGUE += c.AMBIGUE;
      total.SANS_CANDIDATE += c.SANS_CANDIDATE;
    }
    const dejaLiees = await prisma.historiqueEntry.count({ where: { action: { in: actionsSignables }, actionSigneeId: { not: null } } });
    const anterieures = await prisma.historiqueEntry.count({ where: { action: { in: actionsSignables }, createdAt: { lt: miseEnService } } });
    console.log(
      `Total sans lien : ${lignes.length} → rattachables ${total.RATTACHABLE}, AMBIGUËS ${total.AMBIGUE} (laissées « Signature non rattachée »), sans candidate ${total.SANS_CANDIDATE}.`
    );
    console.log(`Déjà liées par identifiant : ${dejaLiees}. Antérieures à la mise en service (« Antérieur à la signature ») : ${anterieures}.`);

    if (!appliquer) {
      console.log("Simulation : rien n'a été écrit. Relancer avec --appliquer pour rattacher les lignes rattachables.");
      return;
    }
    let ecrites = 0;
    for (const r of rattachables) {
      const res = await prisma.historiqueEntry.updateMany({ where: { id: r.id, actionSigneeId: null }, data: { actionSigneeId: r.actionId } });
      ecrites += res.count;
    }
    console.log(`${ecrites} ligne(s) d'historique rattachée(s). Les cas ambigus ne sont jamais devinés.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
