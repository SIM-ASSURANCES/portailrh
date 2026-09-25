import { Badge } from "@/components/ui";
import { getSession, hasPermission } from "@/lib/auth";
import { prisma } from "backend";

import { RetourExceptionnelDecision, RetourExceptionnelForm } from "./RetourExceptionnelClient";

const STATUT_LABEL = { EN_ATTENTE_VALIDATION: "En attente de validation", VALIDE: "Validé", REJETE: "Rejeté" } as const;
const STATUT_VARIANT = { EN_ATTENTE_VALIDATION: "warning", VALIDE: "success", REJETE: "danger" } as const;

/**
 * Section "Retours exceptionnels post-clôture" (voir CLAUDE.md "Retour de
 * caisse exceptionnel post-clôture"), affichée uniquement sur une demande
 * `CLOTUREE` de l'espace Finance. Saisie : Assistant Finance UNIQUEMENT ;
 * validation/rejet : Responsable Finance UNIQUEMENT, jamais sur sa propre
 * saisie (revérifié côté serveur).
 */
export async function RetourExceptionnelSection({ demandeId }: { demandeId: string }) {
  const session = await getSession();
  const estAssistant = !!session && hasPermission(session, "treso.receptionner_retour");
  const estResponsable =
    !!session &&
    hasPermission(session, "treso.valider_demande") &&
    !hasPermission(session, "treso.approuver_validation_complete");

  const retours = await prisma.retourExceptionnel.findMany({
    where: { demandeId },
    include: { saisiPar: true, validePar: true, pieceJointe: { select: { id: true } } },
    orderBy: { saisiAt: "asc" },
  });
  const aUnEnAttente = retours.some((r) => r.statut === "EN_ATTENTE_VALIDATION");

  return (
    <div className="space-y-4 rounded-lg border border-border bg-surface p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-foreground">Retours exceptionnels post-clôture</h2>
        {estAssistant && !aUnEnAttente ? (
          <RetourExceptionnelForm demandeId={demandeId} disabled={false} />
        ) : null}
      </div>
      {retours.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Aucun retour exceptionnel. Utilisez-le quand le collaborateur rend de l&apos;argent après la clôture.
        </p>
      ) : (
        <ul className="space-y-3">
          {retours.map((r) => (
            <li key={r.id} className="space-y-1.5 rounded-md border border-border p-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-semibold text-foreground">{Number(r.montant).toLocaleString("fr-FR")} FCFA</span>
                <Badge variant={STATUT_VARIANT[r.statut]}>{STATUT_LABEL[r.statut]}</Badge>
              </div>
              <p className="text-foreground">{r.motif}</p>
              <p className="text-xs text-muted-foreground">
                Saisi par {r.saisiPar.fullName} le {r.saisiAt.toLocaleDateString("fr-FR")}
                {r.validePar && r.valideAt
                  ? ` — ${r.statut === "VALIDE" ? "validé" : "rejeté"} par ${r.validePar.fullName} le ${r.valideAt.toLocaleDateString("fr-FR")}`
                  : ""}
              </p>
              {r.motifRejet ? <p className="text-xs text-danger">Motif du rejet : {r.motifRejet}</p> : null}
              {r.pieceJointe ? (
                <a
                  href={`/api/treso/pieces-jointes/${r.pieceJointe.id}`}
                  className="inline-block text-xs text-info underline-offset-4 hover:text-primary hover:underline"
                >
                  Télécharger le justificatif
                </a>
              ) : null}
              {r.statut === "EN_ATTENTE_VALIDATION" && estResponsable ? (
                <div className="pt-1">
                  {r.saisiParId === session!.user.id ? (
                    <p className="text-xs text-muted-foreground">
                      Vous avez saisi ce retour : un autre Responsable Finance doit le valider (séparation des tâches).
                    </p>
                  ) : (
                    <RetourExceptionnelDecision retourId={r.id} disabled={false} />
                  )}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
