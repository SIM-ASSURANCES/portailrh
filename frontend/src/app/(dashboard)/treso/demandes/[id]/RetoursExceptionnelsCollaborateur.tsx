import { prisma } from "backend";

/**
 * Retours exceptionnels post-clôture VALIDÉS d'une demande (voir CLAUDE.md
 * "Retour de caisse exceptionnel post-clôture"), en lecture seule côté
 * Collaborateur. Les retours en attente ou rejetés ne sont JAMAIS montrés
 * ici (pas de fausse alerte avant décision du Responsable Finance).
 */
export async function RetoursExceptionnelsCollaborateur({ demandeId }: { demandeId: string }) {
  const retours = await prisma.retourExceptionnel.findMany({
    where: { demandeId, statut: "VALIDE" },
    orderBy: { valideAt: "asc" },
  });
  if (retours.length === 0) return null;

  return (
    <div className="space-y-3 rounded-lg border border-border bg-surface p-4 sm:p-6">
      <h2 className="text-sm font-semibold text-foreground">Retours enregistrés après la clôture</h2>
      <ul className="space-y-2">
        {retours.map((r) => (
          <li key={r.id} className="rounded-md bg-muted p-3 text-sm">
            <p className="font-semibold text-foreground">
              {Number(r.montant).toLocaleString("fr-FR")} FCFA — enregistré le{" "}
              {r.valideAt?.toLocaleDateString("fr-FR")}
            </p>
            <p className="text-xs text-foreground">{r.motif}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}
