"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button, Textarea } from "@/components/ui";
import { MOTIF_REPRISE_MIN } from "backend/client";

import { reprendreEtapeAction } from "@/app/(dashboard)/treso/circuit/actions";

export interface ElementRepriseAffiche {
  ligneId: string | null;
  libelle: string;
  situation: string;
  /** Pourquoi le bouton est grisé (phrase du serveur) ; `null` = possible. */
  raison: string | null;
}

/**
 * Lot K — « Reprise » : renvoyer la demande entière, ou un article, à l'étape PRÉCÉDENTE du circuit, avec un motif obligatoire
 * (10 caractères). Un bouton par élément, toujours visible, grisé avec la phrase du serveur quand la reprise est interdite (article
 * réglé, validé par le DG, garde 8…). Aucune écriture de caisse, jamais.
 */
export function RepriseEtapeSection({
  demandeId,
  elements,
  titre = "Reprise — retour à l'étape précédente",
  libelleBoutonArticle = "Reprendre",
  libelleBoutonDemande = "Renvoyer au responsable de service",
}: {
  demandeId: string;
  elements: ElementRepriseAffiche[];
  titre?: string;
  /** Libellés en texte (une fonction ne passe pas d'un Server Component à un Client Component). */
  libelleBoutonArticle?: string;
  libelleBoutonDemande?: string;
}) {
  const router = useRouter();
  const [ouvert, setOuvert] = useState<string | null>(null);
  const [motif, setMotif] = useState("");
  const [isPending, startTransition] = useTransition();
  const motifValide = motif.trim().length >= MOTIF_REPRISE_MIN;
  if (elements.length === 0) return null;

  function confirmer(e: ElementRepriseAffiche) {
    startTransition(async () => {
      const r = await reprendreEtapeAction(demandeId, e.ligneId, motif);
      if (r.status === "success") {
        toast.success(r.message);
        setOuvert(null);
        setMotif("");
        router.refresh();
      } else {
        toast.error(r.message);
      }
    });
  }

  return (
    <section aria-label={titre} data-reprise className="space-y-3 rounded-2xl border border-border bg-surface p-4 shadow-elevated sm:p-6">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{titre}</h2>
      <ul className="space-y-3">
        {elements.map((e) => {
          const cle = e.ligneId ?? "demande";
          return (
            <li key={cle} data-reprise-element={cle} className="space-y-2 rounded-xl border border-border p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold text-foreground">{e.libelle}</p>
                  <p className="text-xs text-muted-foreground">{e.situation}</p>
                </div>
                <Button
                  type="button"
                  variant="secondary"
                  data-reprise-ouvrir={cle}
                  disabled={!!e.raison || isPending}
                  onClick={() => {
                    setOuvert(ouvert === cle ? null : cle);
                    setMotif("");
                  }}
                >
                  {e.ligneId ? libelleBoutonArticle : libelleBoutonDemande}
                </Button>
              </div>
              {e.raison ? <p className="text-xs text-foreground" data-reprise-raison>{e.raison}</p> : null}
              {ouvert === cle && !e.raison ? (
                <div className="space-y-2" data-reprise-formulaire>
                  <Textarea
                    label="Motif de la reprise"
                    required
                    rows={3}
                    value={motif}
                    onChange={(ev) => setMotif(ev.target.value)}
                    hint={`${MOTIF_REPRISE_MIN} caractères minimum. Transmis à l'étape précédente et conservé dans l'historique.`}
                    error={motif.length > 0 && !motifValide ? `${MOTIF_REPRISE_MIN} caractères minimum.` : undefined}
                  />
                  <div className="flex flex-wrap gap-2">
                    <Button signe type="button" disabled={!motifValide || isPending} loading={isPending} onClick={() => confirmer(e)}>
                      Confirmer la reprise
                    </Button>
                    <Button type="button" variant="secondary" disabled={isPending} onClick={() => setOuvert(null)}>
                      Annuler
                    </Button>
                  </div>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
