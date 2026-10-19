import { Icon } from "@/components/icons";
import type { EtapeFrise, EtatEtapeFrise } from "backend";

/**
 * Frise d'avancement d'une demande de congé : Dépôt → Responsable → RH → Décision.
 * Lecture seule, calcul unique par `friseAbsence` (moteur du circuit).
 */
export function FriseAbsence({ etapes }: { etapes: readonly EtapeFrise[] }) {
  return (
    <section aria-label="Avancement de la demande" className="space-y-3 rounded-2xl border border-border bg-surface p-4 shadow-elevated sm:p-6">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Avancement</h2>
      <ol className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {etapes.map((e) => (
          <li
            key={e.cle}
            data-etape={e.cle}
            data-etat={e.etat}
            aria-current={e.etat === "en_cours" ? "step" : undefined}
            className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm ${STYLE[e.etat]}`}
          >
            <Icon name={ICONE[e.etat]} className="size-4 shrink-0" />
            <span className="min-w-0">
              <span className="block font-semibold">{e.libelle}</span>
              <span className="block text-xs">{LIBELLE[e.etat]}</span>
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}

const LIBELLE: Record<EtatEtapeFrise, string> = {
  faite: "Faite",
  en_cours: "En cours",
  a_venir: "À venir",
  non_requise: "Non requise",
  interrompue: "Interrompue",
};

const STYLE: Record<EtatEtapeFrise, string> = {
  faite: "border-success-border bg-success-bg text-success",
  en_cours: "border-primary bg-primary text-primary-foreground shadow-elevated",
  a_venir: "border-border bg-surface text-foreground",
  non_requise: "border-dashed border-border bg-muted text-muted-foreground",
  interrompue: "border-danger-border bg-danger-bg text-danger",
};

const ICONE = {
  faite: "circle-check",
  en_cours: "clock",
  a_venir: "chevron-right",
  non_requise: "x-circle",
  interrompue: "circle-x",
} as const satisfies Record<EtatEtapeFrise, string>;
