import { calculerSituationContrat, prisma, rechercherContratIds } from "backend";

/**
 * Résumés de contrats pour la recherche (F2, commit 5a) : barre de recherche et page de résultats. La situation est
 * calculée sur les seuls paiements CONFIRMÉS (§5.1, décision du 2026-10-02) — jamais un reste dû négatif.
 */
export interface ResumeContrat {
  id: string;
  numPolice: string;
  clientNom: string | null;
  clientId: string | null;
  partenaire: string | null;
  branche: string;
  produit: string | null;
  /** Montant en chaîne (centimes conservés), mis en forme à l'affichage. */
  situation: { type: "reste" | "trop" | "solde"; montant: string };
}

export async function rechercherResumesContrats(saisie: string, limite: number): Promise<ResumeContrat[]> {
  const ids = await rechercherContratIds(prisma, saisie, limite);
  if (ids.length === 0) return [];

  const [contrats, sommes] = await Promise.all([
    prisma.encContrat.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        numPolice: true,
        clientNom: true,
        clientId: true,
        produitLibelle: true,
        produitCode: true,
        S: true,
        partenaire: { select: { nom: true } },
        branche: { select: { libelle: true } },
      },
    }),
    prisma.encEncaissement.groupBy({
      by: ["contratId"],
      where: { contratId: { in: ids }, statut: "CONFIRME" },
      _sum: { Z: true },
    }),
  ]);

  const encaisseParContrat = new Map(sommes.map((s) => [s.contratId, s._sum.Z?.toString() ?? "0"]));
  const parId = new Map(
    contrats.map((c) => {
      const s = calculerSituationContrat(c.S.toString(), [encaisseParContrat.get(c.id) ?? "0"]);
      const situation: ResumeContrat["situation"] = s.tropPercu.gt(0)
        ? { type: "trop", montant: s.tropPercu.toFixed(2) }
        : s.resteDu.gt(0)
          ? { type: "reste", montant: s.resteDu.toFixed(2) }
          : { type: "solde", montant: "0" };
      return [
        c.id,
        {
          id: c.id,
          numPolice: c.numPolice,
          clientNom: c.clientNom,
          clientId: c.clientId,
          partenaire: c.partenaire?.nom ?? null,
          branche: c.branche.libelle,
          produit: c.produitLibelle ?? c.produitCode,
          situation,
        },
      ] as const;
    }),
  );
  // Ordre de la recherche (n° de police) conservé.
  return ids.flatMap((id) => {
    const r = parId.get(id);
    return r ? [r] : [];
  });
}
