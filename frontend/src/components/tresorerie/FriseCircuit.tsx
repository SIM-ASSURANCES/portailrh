import { Icon } from "@/components/icons";
import {
  friseProgression,
  messageAttente,
  type DemandeCircuit,
  type StatutEtapeFrise,
} from "backend/client";
import type { EtapeCircuit, NiveauRejet } from "backend/client";

/**
 * Frise d'avancement d'une demande dans le circuit de validation (2026-10-06) : Service, Finance, DG, Assistant.
 * Marque l'étape en cours, les étapes faites et celles « non requise » (parcours du demandeur, ou DG non soumise).
 * Lecture seule ; calcul unique par `friseProgression` (moteur du circuit). Domaine Trésorerie, partagée par les
 * écrans Finance, DG et Collaborateur.
 */
export function FriseCircuit({
  demande,
  niveauRejet,
  motifRejet,
}: {
  demande: DemandeCircuit & { soumiseAuDG: boolean };
  niveauRejet?: NiveauRejet | null;
  motifRejet?: string | null;
}) {
  const etapes = friseProgression(demande);
  return (
    <section aria-label="Avancement de la demande" className="space-y-3 rounded-2xl border border-border bg-surface p-4 shadow-elevated sm:p-6">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Avancement</h2>
      <ol className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {etapes.map((e) => (
          <li
            key={e.etape}
            data-etape={e.etape}
            data-statut={e.statut}
            aria-current={e.statut === "EN_COURS" ? "step" : undefined}
            className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm ${STYLE[e.statut]}`}
          >
            <Icon name={ICONE[e.statut]} className="size-4 shrink-0" />
            <span className="min-w-0">
              <span className="block font-semibold">{LIBELLE_ETAPE[e.etape]}</span>
              <span className="block text-xs">{LIBELLE_STATUT[e.statut]}</span>
            </span>
          </li>
        ))}
      </ol>
      <p className={`text-sm ${demande.etape === "A_CORRIGER" ? "text-warning" : "text-muted-foreground"}`}>
        {phraseEtape(demande.etape, niveauRejet, motifRejet)}
      </p>
    </section>
  );
}

const LIBELLE_ETAPE = { SERVICE: "Service", FINANCE: "Finance", DG: "DG", ASSISTANT: "Assistant" } as const;

const LIBELLE_STATUT: Record<StatutEtapeFrise, string> = {
  FAITE: "Faite",
  EN_COURS: "En cours",
  A_VENIR: "À venir",
  NON_REQUISE: "Non requise",
};

const STYLE: Record<StatutEtapeFrise, string> = {
  FAITE: "border-success-border bg-success-bg text-success",
  EN_COURS: "border-primary bg-primary text-primary-foreground shadow-elevated",
  A_VENIR: "border-border bg-surface text-foreground",
  NON_REQUISE: "border-dashed border-border bg-muted text-muted-foreground",
};

const ICONE = {
  FAITE: "circle-check",
  EN_COURS: "clock",
  A_VENIR: "chevron-right",
  NON_REQUISE: "x-circle",
} as const satisfies Record<StatutEtapeFrise, string>;

const NIVEAU: Record<NiveauRejet, string> = { SERVICE: "le responsable de service", FINANCE: "la Finance", DG: "le DG" };

function phraseEtape(etape: EtapeCircuit, niveauRejet?: NiveauRejet | null, motifRejet?: string | null): string {
  if (etape === "A_CORRIGER" && niveauRejet) {
    return `Renvoyée au demandeur pour correction par ${NIVEAU[niveauRejet]}${motifRejet ? ` — motif : ${motifRejet}` : ""}.`;
  }
  if (etape === "REJET_DG" && motifRejet) {
    return `Rejetée par le DG — motif : ${motifRejet}. En attente de la Finance (resoumission ou renvoi au demandeur).`;
  }
  return messageAttente(etape);
}
