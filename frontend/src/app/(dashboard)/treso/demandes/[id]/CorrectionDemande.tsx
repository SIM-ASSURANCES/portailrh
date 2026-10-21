"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Icon } from "@/components/icons";
import { formatMontantDevise } from "@/components/tresorerie/devise";
import { DetailsArticleEditeur, type DetailsArticleSaisie } from "@/components/tresorerie/DetailsArticleEditeur";
import { PieceJointeUpload } from "@/components/tresorerie/PieceJointeUpload";
import { Button, Input, InputMontant, Textarea } from "@/components/ui";
import {
  analyserMontant,
  erreurSaisieBeneficiaire,
  jourCourant,
  MOTIF_LIGNE_MIN,
  refusDateLivraison,
  saisieVersChoix,
  texteSaisieMontant,
  valeurSaisieMontant,
  type SaisieBeneficiaire,
} from "backend/client";

import { abandonnerDemandeAction, corrigerEtResoumettreDemandeAction } from "../../circuit/actions";

export interface LigneACorriger {
  id: string;
  libelle: string;
  /** Motif de la ligne vu par le demandeur ; vide pour une ancienne ligne (à compléter pour resoumettre). */
  motif: string;
  quantite: number;
  prixUnitaire: number;
  /** Bénéficiaire propre de l'article ; `null` = hérite de celui de la demande. */
  beneficiaire: SaisieBeneficiaire | null;
  /** Date de livraison de l'article (« AAAA-MM-JJ »), vide pour un ancien article. */
  dateLivraison: string;
}

type LigneEdit = {
  key: string;
  id?: string;
  libelle: string;
  motif: string;
  quantite: number;
  prixUnitaire: string;
  /** Bénéficiaire propre et NOUVELLES pièces (les pièces déjà jointes sont conservées par le serveur). */
  details: DetailsArticleSaisie;
  /** Date de livraison de l'article, « AAAA-MM-JJ » (vide = aucune). */
  dateLivraison: string;
  /** Valeur d'origine : une date inchangée n'est pas réexaminée (elle peut être passée). */
  dateLivraisonInitiale: string;
};

let compteur = 0;
const cle = () => `n${++compteur}`;

/**
 * « À corriger » (circuit de validation, commit 4) : le demandeur corrige sa demande (lignes, motifs, montants, pièce
 * jointe) et la resoumet, ou l'abandonne après confirmation. Le motif est porté par chaque ligne (2026-10-09) ;
 * l'ancien motif d'en-tête d'une demande antérieure reste affiché en lecture seule. Une dépense directe garde son seul
 * motif d'en-tête, modifiable. Le serveur (`corrigerEtResoumettre`) recopie la version
 * précédente dans l'historique avant toute modification et revérifie tout : seul le demandeur, et seulement à
 * l'étape « À corriger ». Une dépense directe n'a pas de lignes : son montant reste celui de la saisie.
 */
export function CorrectionDemande({
  demandeId,
  avecLignes,
  descriptionInitiale,
  lignesInitiales,
  devise,
  commun,
  createurId,
  comptes,
  dateCommune,
}: {
  demandeId: string;
  avecLignes: boolean;
  /** Motif d'en-tête : modifiable pour une dépense directe, lecture seule pour une ancienne demande, `null` sinon. */
  descriptionInitiale: string | null;
  lignesInitiales: LigneACorriger[];
  devise: string;
  /** Bénéficiaire par défaut de la demande (non modifiable à la correction) et comptes proposés pour un article. */
  commun: SaisieBeneficiaire;
  createurId: string;
  comptes: { value: string; label: string }[];
  /** Date de livraison commune de la demande (« AAAA-MM-JJ »), vide si aucune. */
  dateCommune: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [mode, setMode] = useState<"idle" | "corriger" | "abandonner">("idle");
  const [description, setDescription] = useState(descriptionInitiale ?? "");
  const [pieceJointeUrl, setPieceJointeUrl] = useState<string | null>(null);
  const [lignes, setLignes] = useState<LigneEdit[]>(() =>
    lignesInitiales.map((l) => ({
      key: l.id,
      id: l.id,
      libelle: l.libelle,
      motif: l.motif,
      quantite: l.quantite,
      prixUnitaire: texteSaisieMontant(l.prixUnitaire, { devise }),
      details: { beneficiaire: l.beneficiaire, pieces: [] },
      dateLivraison: l.dateLivraison,
      dateLivraisonInitiale: l.dateLivraison,
    }))
  );
  const aujourdHui = jourCourant();
  const [dateAppliquee, setDateAppliquee] = useState(dateCommune);
  const refusDate = (l: LigneEdit) => (l.dateLivraison === l.dateLivraisonInitiale ? null : refusDateLivraison(l.dateLivraison, aujourdHui));
  const datesValides = lignes.every((l) => refusDate(l) === null);
  const appliquerDateATous = () => {
    const refus = refusDateLivraison(dateAppliquee, aujourdHui);
    if (!dateAppliquee || refus) {
      toast.error(refus ?? "Choisissez d'abord une date de livraison.");
      return;
    }
    setLignes((ls) => ls.map((l) => ({ ...l, dateLivraison: dateAppliquee })));
  };
  const motifsValides = lignes.every((l) => l.motif.trim().length >= MOTIF_LIGNE_MIN);
  const beneficiairesValides = lignes.every((l) => !l.details.beneficiaire || erreurSaisieBeneficiaire(l.details.beneficiaire) === null);
  const prixValides = lignes.every((l) => l.prixUnitaire.trim() === "" || analyserMontant(l.prixUnitaire, { devise }).ok);
  const peutResoumettre = avecLignes ? lignes.length > 0 && motifsValides && beneficiairesValides && datesValides && prixValides : description.trim().length >= 3;

  const total = lignes.reduce((s, l) => s + (Number(l.quantite) || 0) * valeurSaisieMontant(l.prixUnitaire, { devise }), 0);
  const maj = (key: string, patch: Partial<LigneEdit>) => setLignes((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  function resoumettre() {
    startTransition(async () => {
      const r = await corrigerEtResoumettreDemandeAction(demandeId, {
        ...(avecLignes ? {} : { description }),
        lignes: lignes.map((l) => ({
          id: l.id,
          libelle: l.libelle,
          motif: l.motif,
          quantite: Number(l.quantite),
          prixUnitaire: valeurSaisieMontant(l.prixUnitaire, { devise }),
          beneficiaire: l.details.beneficiaire ? saisieVersChoix(l.details.beneficiaire) : null,
          pieceJointeUrls: l.details.pieces.map((p) => p.url),
          dateLivraison: l.dateLivraison,
        })),
        pieceJointeUrl: pieceJointeUrl ?? undefined,
      });
      if (r.status === "success") {
        toast.success(r.message);
        setMode("idle");
        router.refresh();
      } else toast.error(r.message);
    });
  }

  function abandonner() {
    startTransition(async () => {
      const r = await abandonnerDemandeAction(demandeId);
      if (r.status === "success") {
        toast.success(r.message);
        setMode("idle");
        router.refresh();
      } else toast.error(r.message);
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <Button type="button" disabled={isPending || mode === "corriger"} onClick={() => setMode("corriger")}>
          Corriger et resoumettre
        </Button>
        <Button type="button" variant="danger" disabled={isPending || mode === "abandonner"} onClick={() => setMode("abandonner")}>
          Abandonner
        </Button>
      </div>

      {mode === "abandonner" ? (
        <div className="space-y-3 rounded-lg border border-danger bg-danger-bg p-4">
          <p className="text-sm text-danger">
            Abandonner la demande est définitif : elle ne pourra plus être corrigée ni resoumise. Confirmez-vous
            l&apos;abandon&nbsp;?
          </p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="danger" loading={isPending} onClick={abandonner}>
              Confirmer l&apos;abandon
            </Button>
            <Button type="button" variant="secondary" disabled={isPending} onClick={() => setMode("idle")}>
              Annuler
            </Button>
          </div>
        </div>
      ) : null}

      {mode === "corriger" ? (
        <div className="animate-fade-in-up space-y-4 rounded-lg border border-border p-4">
          {avecLignes ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Articles</p>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setLignes((ls) => [...ls, { key: cle(), libelle: "", motif: "", quantite: 1, prixUnitaire: "", details: { beneficiaire: null, pieces: [] }, dateLivraison: dateAppliquee, dateLivraisonInitiale: "" }])}
                >
                  <Icon name="plus-circle" className="size-4" />
                  Ajouter une ligne
                </Button>
              </div>
              <div className="flex flex-wrap items-end gap-2 rounded-md bg-muted/40 p-3">
                <Input
                  label="Date de livraison commune"
                  type="date"
                  min={aujourdHui}
                  value={dateAppliquee}
                  onChange={(e) => setDateAppliquee(e.target.value)}
                  data-date-livraison-commune
                />
                <Button type="button" variant="secondary" data-appliquer-date-a-tous onClick={appliquerDateATous}>
                  Appliquer la date à tous les articles
                </Button>
              </div>
              {lignes.map((l) => (
                <div
                  key={l.key}
                  data-ligne-correction
                  className="grid gap-2 border-b border-border pb-3 last:border-b-0 sm:grid-cols-[1fr_90px_140px_120px_36px] sm:items-center sm:gap-3"
                >
                  <Input aria-label="Libellé de l'article" value={l.libelle} onChange={(e) => maj(l.key, { libelle: e.target.value })} />
                  <Input
                    aria-label="Nombre"
                    type="number"
                    min="1"
                    step="1"
                    value={l.quantite}
                    onChange={(e) => maj(l.key, { quantite: Number(e.target.value) })}
                  />
                  <InputMontant
                    aria-label="Prix unitaire"
                    devise={devise}
                    placeholder="0"
                    echo={false}
                    value={l.prixUnitaire}
                    onValueChange={(texte) => maj(l.key, { prixUnitaire: texte })}
                  />
                  <span className="text-sm font-bold tabular-nums text-foreground sm:text-right">
                    {formatMontantDevise((Number(l.quantite) || 0) * valeurSaisieMontant(l.prixUnitaire, { devise }), devise)}
                  </span>
                  <div className="flex justify-end sm:row-start-1 sm:col-start-5">
                    {lignes.length > 1 ? (
                      <button
                        type="button"
                        aria-label="Retirer la ligne"
                        onClick={() => setLignes((ls) => ls.filter((x) => x.key !== l.key))}
                        className="grid size-8 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-danger-bg hover:text-danger"
                      >
                        <Icon name="x" className="size-4" />
                      </button>
                    ) : null}
                  </div>
                  <div className="sm:col-span-4">
                    <Input
                      aria-label="Motif de la ligne"
                      placeholder="Motif : pourquoi cet article"
                      value={l.motif}
                      onChange={(e) => maj(l.key, { motif: e.target.value })}
                      error={l.motif.trim().length < MOTIF_LIGNE_MIN ? `Motif obligatoire (${MOTIF_LIGNE_MIN} caractères minimum).` : undefined}
                    />
                    <Input
                      label="Date de livraison de l'article"
                      type="date"
                      min={aujourdHui}
                      value={l.dateLivraison}
                      onChange={(e) => maj(l.key, { dateLivraison: e.target.value })}
                      error={refusDate(l) ?? undefined}
                      data-date-livraison-article
                    />
                    <DetailsArticleEditeur
                      details={l.details}
                      commun={commun}
                      createurId={createurId}
                      comptes={comptes}
                      onChange={(patch) => maj(l.key, { details: { ...l.details, ...patch } })}
                      erreur={
                        l.details.beneficiaire ? (erreurSaisieBeneficiaire(l.details.beneficiaire) ?? undefined) : undefined
                      }
                    />
                  </div>
                </div>
              ))}
              <p className="text-right text-sm font-bold text-foreground">
                Nouveau total : <span className="tabular-nums">{formatMontantDevise(total, devise)}</span>
              </p>
            </div>
          ) : null}

          {!avecLignes ? (
            <Textarea
              label="Motif de l'achat"
              rows={5}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              error={description.trim().length > 0 && description.trim().length < 3 ? "3 caractères minimum." : undefined}
            />
          ) : descriptionInitiale ? (
            <div className="rounded-md bg-muted/40 px-3 py-2 text-sm">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Motif de l&apos;achat (ancienne demande, lecture seule)
              </p>
              <p className="whitespace-pre-wrap text-foreground">{descriptionInitiale}</p>
            </div>
          ) : null}
          <PieceJointeUpload
            label="Nouvelle pièce jointe"
            hint="PDF, JPG ou PNG — 10 Mo maximum. Optionnel : les pièces déjà jointes sont conservées."
            onChange={setPieceJointeUrl}
          />
          <p className="text-xs text-muted-foreground">
            La version actuelle est conservée dans l&apos;historique. La demande repart au début du circuit.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" loading={isPending} disabled={!peutResoumettre} onClick={resoumettre}>
              Resoumettre la demande
            </Button>
            <Button type="button" variant="secondary" disabled={isPending} onClick={() => setMode("idle")}>
              Annuler
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
