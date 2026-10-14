/**
 * Rappel compact, en tête d'un article, de la demande à laquelle il appartient : numéro, demandeur, service, date de la
 * demande, devise (lot B bis). Aucune donnée propre à l'article : lecture seule, partagé par les écrans Finance, DG,
 * Service et collaborateur, pour qu'un article reste identifiable une fois sorti du contexte de sa demande.
 */
export interface ContexteDemandeArticle {
  reference: string;
  demandeurNom: string;
  serviceNom: string | null;
  creeeLe: Date;
  /** Code de la devise de la demande (`Demande.devise`, « XOF » = FCFA). */
  devise: string;
}

const nomDevise = (code: string) => (code === "XOF" ? "FCFA" : code);

export function EnteteDemandeArticle({ contexte }: { contexte: ContexteDemandeArticle }) {
  return (
    <span data-entete-demande className="mb-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] font-medium text-muted-foreground">
      <span className="font-semibold text-foreground">{contexte.reference}</span>
      <span aria-hidden="true">·</span>
      <span>{contexte.demandeurNom}</span>
      <span aria-hidden="true">·</span>
      <span>{contexte.serviceNom ?? "Sans service"}</span>
      <span aria-hidden="true">·</span>
      <span>Demande créée le {contexte.creeeLe.toLocaleDateString("fr-FR")}</span>
      <span aria-hidden="true">·</span>
      <span>{nomDevise(contexte.devise)}</span>
    </span>
  );
}
