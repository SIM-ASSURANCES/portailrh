import { prisma } from "backend";

/**
 * Lot J bis : « Désactivée le 20/10/2026 à 09:14 par X » pour chaque catégorie ou objet inactif, lu dans l'historique (dernière
 * entrée `DEACTIVATE` de l'élément). Une seule requête pour tout le catalogue ; absent si l'historique n'a pas gardé la trace
 * (élément créé inactif).
 */
export async function chargerDesactivations(ids: readonly string[]): Promise<Map<string, string>> {
  const resultat = new Map<string, string>();
  if (ids.length === 0) return resultat;
  const entrees = await prisma.historiqueEntry.findMany({
    where: { entity: { in: ["Categorie", "Objet"] }, entityId: { in: [...ids] }, action: { in: ["DEACTIVATE", "ACTIVATE"] } },
    orderBy: { createdAt: "desc" },
    select: { entityId: true, action: true, createdAt: true, user: { select: { fullName: true } } },
  });
  for (const e of entrees) {
    if (resultat.has(e.entityId) || e.action !== "DEACTIVATE") continue;
    const date = e.createdAt.toLocaleString("fr-FR", { timeZone: "Africa/Abidjan", dateStyle: "short", timeStyle: "short" });
    resultat.set(e.entityId, `Désactivée le ${date} par ${e.user.fullName}`);
  }
  // Une réactivation plus récente annule la mention : on ne garde que les éléments dont la DERNIÈRE entrée est une désactivation.
  const derniere = new Set<string>();
  const vus = new Set<string>();
  for (const e of entrees) {
    if (vus.has(e.entityId)) continue;
    vus.add(e.entityId);
    if (e.action === "DEACTIVATE") derniere.add(e.entityId);
  }
  for (const id of [...resultat.keys()]) if (!derniere.has(id)) resultat.delete(id);
  return resultat;
}
