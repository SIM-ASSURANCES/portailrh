// Lot L bis — reprise des données du lot L : rattachement, UNE DERNIÈRE FOIS, des lignes d'historique d'actions signées à l'action
// signée correspondante (l'ancien rapprochement : même compte, dans la minute). La migration `20261028090000_signature_lien_identifiant`
// applique la même règle en SQL ; le script `prisma/rattacher-signatures.ts` la rejoue (simulation par défaut) et compte les cas ambigus.
//
// Règle (pure, sans base) pour une ligne d'historique d'une action signable, postérieure à la mise en service et sans lien :
//   candidates = actions signées du MÊME compte, à moins de 60 s, de la même demande quand les deux la connaissent ;
//   - aucune candidate        -> « sans candidate » (reste non rattachée) ;
//   - candidates équivalentes -> rattachée à la plus proche (même version de signature, même titulaire : même mention à l'écran) ;
//   - candidates différentes  -> AMBIGUË : on ne devine pas, la ligne reste « Signature non rattachée ».

export const FENETRE_REPRISE_MS = 60_000;

export interface EntreeAReprendre {
  id: string;
  userId: string;
  createdAt: Date;
  action: string;
  /** Demande de la ligne d'historique (entité Demande ou article), `null` si elle n'en a pas. */
  demandeId: string | null;
  actionSigneeId: string | null;
}

export interface ActionPourReprise {
  id: string;
  signataireId: string;
  creeAt: Date;
  demandeId: string | null;
  signatureId: string;
  auNomDeId: string | null;
}

export type VerdictReprise =
  | { etat: "DEJA_LIEE"; actionId: string }
  | { etat: "ANTERIEURE" }
  | { etat: "RATTACHABLE"; actionId: string; candidates: number }
  | { etat: "AMBIGUE"; candidates: string[] }
  | { etat: "SANS_CANDIDATE" };

export function rattacherEntrees(
  entrees: readonly EntreeAReprendre[],
  actions: readonly ActionPourReprise[],
  miseEnService: Date,
  actionsSignables: ReadonlySet<string>
): Map<string, VerdictReprise> {
  const resultat = new Map<string, VerdictReprise>();
  for (const e of entrees) {
    if (!actionsSignables.has(e.action)) continue;
    if (e.actionSigneeId) {
      resultat.set(e.id, { etat: "DEJA_LIEE", actionId: e.actionSigneeId });
      continue;
    }
    if (e.createdAt.getTime() < miseEnService.getTime()) {
      resultat.set(e.id, { etat: "ANTERIEURE" });
      continue;
    }
    const candidates = actions
      .filter(
        (a) =>
          a.signataireId === e.userId &&
          Math.abs(a.creeAt.getTime() - e.createdAt.getTime()) <= FENETRE_REPRISE_MS &&
          (a.demandeId === null || e.demandeId === null || a.demandeId === e.demandeId)
      )
      .sort((x, y) => {
        const ex = Math.abs(x.creeAt.getTime() - e.createdAt.getTime());
        const ey = Math.abs(y.creeAt.getTime() - e.createdAt.getTime());
        return ex - ey || x.creeAt.getTime() - y.creeAt.getTime() || x.id.localeCompare(y.id);
      });
    if (candidates.length === 0) {
      resultat.set(e.id, { etat: "SANS_CANDIDATE" });
      continue;
    }
    const mentions = new Set(candidates.map((a) => `${a.signatureId}|${a.auNomDeId ?? ""}`));
    resultat.set(
      e.id,
      mentions.size === 1 ? { etat: "RATTACHABLE", actionId: candidates[0].id, candidates: candidates.length } : { etat: "AMBIGUE", candidates: candidates.map((a) => a.id) }
    );
  }
  return resultat;
}
