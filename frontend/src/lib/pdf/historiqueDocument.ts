import { getAgregatsRegularisation, getEcartLigne, prisma, resteNonDetailleTotal } from "backend";

/**
 * Historique détaillé imprimé sur les reçus (lot G, 2026-10-14) : TOUT ce qui a été fait pour l'article (ou, sans article,
 * pour la demande) — chaque règlement (Caisse ET Banque), chaque retour de caisse, chaque dépense déclarée — puis le
 * solde final. Les chiffres viennent des mêmes agrégats que l'écran (`getAgregatsRegularisation`, `getEcartLigne`) : un
 * seul calcul. Aucune information de gestion interne (motif Finance, catégorie d'une dépense) n'y est imprimée : le
 * document peut être remis au demandeur.
 */
export interface HistoriqueImprime {
  portee: "ARTICLE" | "DEMANDE";
  reglements: {
    reference: string;
    date: Date | null;
    mode: "CAISSE" | "BANQUE";
    montant: number;
    auteur: string;
    /** Le règlement qui fait l'objet du document. */
    courant: boolean;
  }[];
  totalRegle: number;
  retours: {
    /** Date de réception, sinon de déclaration. */
    date: Date;
    montant: number;
    etat: "Réceptionné" | "En attente de réception";
    declarant: string;
    receptionnePar: string | null;
    /** Sur quel règlement (référence du règlement) il porte. */
    reglementReference: string;
    nul: boolean;
  }[];
  /** Retours externes rattachés (lot G bis) : fonds versé par banque, rendu à la caisse par la Finance. */
  retoursExternes: { date: Date; montant: number; par: string }[];
  depenses: { libelle: string; montant: number; etat: "Justifiée" | "Sans pièce formelle" | "Non détaillée"; date: Date }[];
  fondsRemis: number;
  totalDepenses: number;
  retoursRecus: number;
  solde: number;
  /** Fonds remis ni retournés ni détaillés (lot G ter). */
  resteNonDetaille: number;
}

/** Historique de l'article d'un règlement (ou de la demande entière si ce règlement n'est rattaché à aucun article). */
export async function chargerHistoriqueDocument(p: {
  demandeId: string;
  ligneDemandeId: string | null;
  /** Règlement mis en avant (celui du reçu), le cas échéant. */
  reglementCourantId?: string;
}): Promise<HistoriqueImprime> {
  const [tous, agregats, externes] = await Promise.all([
    prisma.reglement.findMany({
      where: { demandeId: p.demandeId, estConfirme: true, estAnnule: false },
      orderBy: { createdAt: "asc" },
      include: {
        auteur: { select: { fullName: true } },
        demande: { select: { reference: true } },
        retours: {
          orderBy: { createdAt: "asc" },
          include: {
            declarant: { select: { fullName: true } },
            receptionnePar: { select: { fullName: true } },
            depenses: { orderBy: { date: "asc" } },
          },
        },
      },
    }),
    getAgregatsRegularisation(p.demandeId),
    prisma.retourExterne.findMany({
      where: { demandeId: p.demandeId, ...(p.ligneDemandeId ? { ligneDemandeId: p.ligneDemandeId } : {}) },
      orderBy: { creeAt: "asc" },
      select: { creeAt: true, montantRetourne: true, creePar: { select: { fullName: true } } },
    }),
  ]);
  // Même numérotation que le reçu de règlement : `<demande>-R<rang>` parmi les règlements confirmés de la demande.
  const confirmesRang = await prisma.reglement.findMany({
    where: { demandeId: p.demandeId, estConfirme: true },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  const reference = (id: string, demandeRef: string) => `${demandeRef}-R${confirmesRang.findIndex((r) => r.id === id) + 1}`;

  const portee = p.ligneDemandeId ? "ARTICLE" : "DEMANDE";
  const concernes = p.ligneDemandeId ? tous.filter((r) => r.ligneDemandeId === p.ligneDemandeId) : tous;
  const chiffres = p.ligneDemandeId ? (agregats.parArticle.get(p.ligneDemandeId) ?? agregats.total) : agregats.total;

  const reglements = concernes.map((r) => ({
    reference: reference(r.id, r.demande.reference),
    date: r.confirmeAt,
    mode: r.mode,
    montant: Number(r.montant),
    auteur: r.auteur.fullName,
    courant: r.id === p.reglementCourantId,
  }));
  const retours = concernes.flatMap((r) =>
    r.retours.map((t) => ({
      date: t.receptionneAt ?? t.createdAt,
      montant: Number(t.montantARetourner),
      etat: (t.estReceptionne ? "Réceptionné" : "En attente de réception") as "Réceptionné" | "En attente de réception",
      declarant: t.declarant.fullName,
      receptionnePar: t.receptionnePar?.fullName ?? null,
      reglementReference: reference(r.id, r.demande.reference),
      nul: t.estReceptionne && !t.versementBancaire && Number(t.montantARetourner) === 0,
    }))
  );
  const depenses = concernes.flatMap((r) =>
    r.retours.flatMap((t) =>
      t.depenses.map((d) => ({
        libelle: d.objet,
        montant: Number(d.montant),
        etat: (d.justification !== "SANS_PIECE" ? "Justifiée" : d.motifNonJustifie ? "Sans pièce formelle" : "Non détaillée") as
          | "Justifiée"
          | "Sans pièce formelle"
          | "Non détaillée",
        date: d.date,
      }))
    )
  );

  return {
    portee,
    reglements,
    totalRegle: reglements.reduce((s, r) => s + Math.round(r.montant * 100), 0) / 100,
    retours,
    retoursExternes: externes.map((x) => ({ date: x.creeAt, montant: Number(x.montantRetourne), par: x.creePar.fullName })),
    depenses,
    fondsRemis: chiffres.fondsRemis,
    totalDepenses: Math.round((chiffres.depensesJustifiees + chiffres.depensesSansPieceFormelle + chiffres.resteNonDetaille) * 100) / 100,
    retoursRecus: chiffres.retoursRecus,
    solde: getEcartLigne(chiffres),
    // Lot G ter : même calcul que l'écran (lignes de reste + fonds remis, Caisse ET Banque, ni retournés ni détaillés).
    resteNonDetaille: resteNonDetailleTotal(chiffres),
  };
}
