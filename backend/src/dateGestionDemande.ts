// Lot H — « Géré le » au niveau d'une DEMANDE : date du dernier événement de la demande (décision d'un article, règlement
// confirmé, retour de caisse, retour enregistré par la Finance, clôture), avec le nom de l'étape. Même règle que le parcours
// d'un article (`parcoursArticle.gere`), calculée en lot pour une liste de demandes : aucune colonne ajoutée, aucun calcul modifié.
// Le nom « Régularisé » n'est pas produit ici (il demanderait le solde de chaque règlement) : la date, elle, est la même, puisque
// la régularisation prend la date du dernier événement qui a rendu le solde nul.

import { prisma } from "./prisma";
import { derniereGestion, type GestionArticle } from "./parcoursArticle";

export async function getDatesGestionDemandes(demandeIds: readonly string[]): Promise<Map<string, GestionArticle | null>> {
  const resultat = new Map<string, GestionArticle | null>();
  if (demandeIds.length === 0) return resultat;
  const ids = [...demandeIds];

  const [lignes, reglements, retours, externes, clotures] = await Promise.all([
    prisma.ligneDemande.findMany({
      where: { demandeId: { in: ids }, statutValidation: { not: "EN_ATTENTE" }, decideAt: { not: null } },
      select: { demandeId: true, statutValidation: true, decideAt: true },
    }),
    prisma.reglement.findMany({
      where: { demandeId: { in: ids }, estConfirme: true, estAnnule: false, confirmeAt: { not: null } },
      select: { demandeId: true, confirmeAt: true },
    }),
    prisma.retourCaisse.findMany({
      // Comme le parcours de l'article : la fiche de détail d'un fonds versé par banque n'est pas un retour de caisse.
      where: { reglement: { demandeId: { in: ids } }, NOT: { reglement: { mode: "BANQUE" }, versementBancaire: false } },
      select: { estReceptionne: true, receptionneAt: true, createdAt: true, reglement: { select: { demandeId: true } } },
    }),
    prisma.retourExterne.findMany({
      where: { demandeId: { in: ids } },
      select: { demandeId: true, creeAt: true },
    }),
    prisma.historiqueEntry.findMany({
      where: { entity: "Demande", entityId: { in: ids }, action: { in: ["cloture_totale", "cloture_partielle"] } },
      select: { entityId: true, createdAt: true },
    }),
  ]);

  const evenements = new Map<string, { etape: GestionArticle["etape"]; date: Date | null }[]>();
  const ajouter = (id: string | null, etape: GestionArticle["etape"], date: Date | null) => {
    if (!id) return;
    const liste = evenements.get(id) ?? [];
    liste.push({ etape, date });
    evenements.set(id, liste);
  };
  for (const l of lignes) ajouter(l.demandeId, l.statutValidation === "REJETEE" ? "Rejeté" : "Validé", l.decideAt);
  for (const r of reglements) ajouter(r.demandeId, "Réglé", r.confirmeAt);
  for (const r of retours) ajouter(r.reglement.demandeId, "Retour de caisse", r.estReceptionne ? (r.receptionneAt ?? r.createdAt) : r.createdAt);
  for (const x of externes) ajouter(x.demandeId, "Retour enregistré par la Finance", x.creeAt);
  for (const h of clotures) ajouter(h.entityId, "Clôturée", h.createdAt);

  for (const id of ids) resultat.set(id, derniereGestion(evenements.get(id) ?? []));
  return resultat;
}
