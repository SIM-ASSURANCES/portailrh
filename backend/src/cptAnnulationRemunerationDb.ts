import type { PrismaClient } from "./generated/prisma/client";
import { raisonBlocageAnnulationCpt, validerSaisieAnnulationCpt, type OperationRemunerationCpt } from "./cptAnnulationRemuneration";
import { ecrireAudit } from "./cptAudit";
import { texteDepuisCentimes } from "./cptEcheancier";
import { moisCloturePourCpt, verrouillerRemunerationCpt, type ParametresRemunerationCpt, type RemunerationEcritureDbCpt } from "./cptReglementPartenaireDb";
import { centimesSignesRemunerationCpt } from "./cptRemunerationDb";

// Aucun import d'`enc*` ou de `treso*` (règle d'indépendance du module).

export type OperationsRemunerationDbCpt = Pick<PrismaClient, "cptReglementPartenaire" | "cptCompensation" | "cptLigneRemuneration">;

/** Règlements, compensations (annulés compris, marqués) et dû des lignes d'un partenaire : l'écran et le serveur lisent la même chose. */
export async function chargerOperationsRemunerationCpt(
  db: OperationsRemunerationDbCpt,
  partenaireId: string,
): Promise<{ operations: OperationRemunerationCpt[]; dus: Map<string, bigint> }> {
  const affectations = { select: { ligneRemunerationId: true, montant: true } } as const;
  const annulation = { select: { id: true } } as const;
  const [reglements, compensations, lignes] = await Promise.all([
    db.cptReglementPartenaire.findMany({
      where: { partenaireId },
      select: { id: true, reference: true, montant: true, creeParId: true, creeAt: true, affectations, annulation },
    }),
    db.cptCompensation.findMany({ where: { partenaireId }, select: { id: true, montant: true, valideeParId: true, creeAt: true, affectations, annulation } }),
    db.cptLigneRemuneration.findMany({ where: { partenaireBeneficiaireId: partenaireId }, select: { id: true, du: true } }),
  ]);
  const parts = (a: { ligneRemunerationId: string; montant: { toFixed(n: number): string } }[]) =>
    a.map((x) => ({ ligneId: x.ligneRemunerationId, montant: centimesSignesRemunerationCpt(x.montant) }));
  const operations: OperationRemunerationCpt[] = [
    ...reglements.map((r) => ({
      type: "REGLEMENT" as const,
      id: r.id,
      reference: r.reference,
      montant: centimesSignesRemunerationCpt(r.montant),
      auteurId: r.creeParId,
      creeAt: r.creeAt.toISOString(),
      annulee: r.annulation !== null,
      affectations: parts(r.affectations),
    })),
    ...compensations.map((c) => ({
      type: "COMPENSATION" as const,
      id: c.id,
      reference: "",
      montant: centimesSignesRemunerationCpt(c.montant),
      auteurId: c.valideeParId,
      creeAt: c.creeAt.toISOString(),
      annulee: c.annulation !== null,
      affectations: parts(c.affectations),
    })),
  ];
  return { operations, dus: new Map(lignes.map((l) => [l.id, centimesSignesRemunerationCpt(l.du)])) };
}

export type ResultatAnnulationRemunerationCpt = { ok: true; annulationId: string } | { ok: false; message: string; erreurs?: Record<string, string> };

/**
 * Annule un règlement ou une compensation, dans la transaction de l'appelant, sous le verrou du partenaire (le même que les
 * règlements). Datée du jour : seul le mois DU JOUR doit être ouvert (RG-08), pas celui de l'opération d'origine. La permission est
 * vérifiée par l'action ; l'auteur de l'opération est toujours écarté ici et par la base. La base rejoue le contrôle des lignes.
 */
export async function enregistrerAnnulationRemunerationCpt(
  db: RemunerationEcritureDbCpt,
  saisie: Record<string, unknown>,
  p: ParametresRemunerationCpt,
): Promise<ResultatAnnulationRemunerationCpt> {
  const v = validerSaisieAnnulationCpt(saisie);
  if (!v.ok) return { ok: false, message: Object.values(v.erreurs)[0], erreurs: v.erreurs };
  const s = v.valeur;
  const cible =
    s.type === "REGLEMENT"
      ? await db.cptReglementPartenaire.findUnique({ where: { id: s.operationId }, select: { partenaireId: true } })
      : await db.cptCompensation.findUnique({ where: { id: s.operationId }, select: { partenaireId: true } });
  if (!cible) return { ok: false, message: "Opération à annuler introuvable." };
  await verrouillerRemunerationCpt(db, cible.partenaireId);
  const maintenant = p.maintenant ?? new Date();
  const aujourdhui = maintenant.toISOString().slice(0, 10);
  if (await moisCloturePourCpt(db, aujourdhui)) return { ok: false, message: "Le mois en cours est clôturé : aucune écriture ne peut y être datée." };

  const { operations, dus } = await chargerOperationsRemunerationCpt(db, cible.partenaireId);
  const operation = operations.find((o) => o.type === s.type && o.id === s.operationId)!;
  const raison = raisonBlocageAnnulationCpt({ operation, operations, dus, userId: p.userId });
  if (raison) return { ok: false, message: raison };

  const annulation = await db.cptAnnulationRemuneration.create({
    data: {
      reglementId: s.type === "REGLEMENT" ? s.operationId : null,
      compensationId: s.type === "COMPENSATION" ? s.operationId : null,
      date: new Date(`${aujourdhui}T00:00:00.000Z`),
      motif: s.motif,
      sansVersement: s.sansVersement,
      pieceOdoo: s.pieceOdoo,
      creeParId: p.userId,
      creeAt: maintenant,
    },
    select: { id: true },
  });
  await ecrireAudit(db, {
    entite: "CptAnnulationRemuneration",
    entiteId: annulation.id,
    action: s.type === "REGLEMENT" ? "annulation_reglement_partenaire" : "annulation_compensation",
    avant: {
      operation: s.type,
      operationId: s.operationId,
      reference: operation.reference || null,
      montant: texteDepuisCentimes(operation.montant),
      affectations: operation.affectations.map((a) => ({ ligne: a.ligneId, montant: texteDepuisCentimes(a.montant) })),
    },
    apres: { date: aujourdhui, aucunVersement: s.type === "REGLEMENT" ? s.sansVersement : null, pieceOdoo: s.pieceOdoo },
    motif: s.motif,
    mois: maintenant,
    userId: p.userId,
    ip: p.ip,
  });
  return { ok: true, annulationId: annulation.id };
}
