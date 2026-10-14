"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import Link from "next/link";

import { Button, Card, Input, Select } from "@/components/ui";
import { Icon } from "@/components/icons";
import {
  appliquerATous,
  erreurSaisieBeneficiaire,
  ilYADesPersonnalisations,
  refusDateLivraison,
  MOTIF_LIGNE_MIN,
  SAISIE_BENEFICIAIRE_MOI,
  saisieVersChoix,
  type SaisieBeneficiaire,
} from "backend/client";
import { BeneficiaireChamp } from "@/components/tresorerie/BeneficiaireChamp";
import { DetailsArticleEditeur, type DetailsArticleSaisie } from "@/components/tresorerie/DetailsArticleEditeur";
import { DEVISE_OPTIONS, formatMontantDevise } from "@/components/tresorerie/devise";
import { PieceJointeUpload } from "@/components/tresorerie/PieceJointeUpload";

import { creerDemandeAction } from "./actions";

type LigneEdit = {
  key: string;
  libelle: string;
  /** Motif de la ligne (pourquoi cet article), obligatoire. */
  motif: string;
  quantite: number;
  /**
   * Chaîne brute telle que tapée, jamais un nombre : un état initial à `0`
   * afficherait "0" dans le champ, obligeant à le sélectionner/effacer avant
   * de saisir un vrai montant (et risquant un "012000" si l'utilisateur tape
   * sans l'avoir effacé). Vide par défaut, converti en nombre uniquement au
   * calcul (`Number(...) || 0`) et à l'envoi.
   */
  prixUnitaire: string;
  /** Bénéficiaire et pièces propres à l'article (autonomie des articles, lot A). */
  details: DetailsArticleSaisie;
  /** Date de livraison de l'article (`YYYY-MM-DD`, lot G) ; vide = reçoit la date commune à l'enregistrement. */
  dateLivraison: string;
};

function nouvelleLigne(): LigneEdit {
  return {
    key: `ligne-${Math.random().toString(36).slice(2)}`,
    libelle: "",
    motif: "",
    quantite: 1,
    prixUnitaire: "",
    details: { beneficiaire: null, pieces: [] },
    dateLivraison: "",
  };
}

type FieldErrors = Partial<Record<string, string>>;

/**
 * Formulaire de création d'une demande d'achat ("Demande d'Achat").
 *
 * Deux blocs : le "Tableau des articles" (première chose à remplir — une
 * liste dynamique de lignes libellé/motif/nombre/prix unitaire, au moins une
 * obligatoire ; le motif est porté par chaque ligne depuis le 2026-10-09) puis
 * l'en-tête (bénéficiaire : moi-même, un autre compte ou un nom libre ; date de
 * livraison, devise). Le "Total général" est recalculé en direct et n'est jamais
 * saisi : le `montant` de la demande est recomposé côté serveur à partir
 * des lignes (voir `creerDemandeAction`).
 *
 * **Aucune Catégorie d'achat ici** : la catégorisation reste un travail de
 * Finance après création (`CategorisationForm`, écran
 * `/treso/finance/demandes/[id]`) — le collaborateur ne la choisit jamais
 * à la création (`Demande.categorieId` est nullable, voir schema.prisma).
 *
 * Un tableau de lignes ne se prête pas à `FormData` : on appelle donc
 * directement l'action via `useTransition` (même pattern que
 * `RetourCaisseForm`, Phase D), pas via `<form action={...}>`.
 */
export function DemandeForm({ comptes, createurId }: { comptes: { value: string; label: string }[]; createurId: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  // « Détails communs » : bénéficiaire par défaut de la demande (hérité par chaque article qui n'a pas le sien).
  const [commun, setCommun] = useState<SaisieBeneficiaire>(SAISIE_BENEFICIAIRE_MOI);
  const [confirmerAppliquer, setConfirmerAppliquer] = useState(false);
  const [dateLivraison, setDateLivraison] = useState("");
  const [devise, setDevise] = useState("XOF");
  const [lignes, setLignes] = useState<LigneEdit[]>([nouvelleLigne()]);
  const [pieceJointeUrl, setPieceJointeUrl] = useState<string | null>(null);

  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [erreurLignes, setErreurLignes] = useState<string | undefined>();
  const [demandeCreeeId, setDemandeCreeeId] = useState<string | null>(null);

  // Tâche "Aucune date dans le passé" (voir CLAUDE.md) : la date du jour
  // reste autorisée, revérifiée de toute façon côté serveur
  // (`creerDemandeAction`) — cette borne `min` n'est qu'un confort de
  // saisie, jamais la seule protection.
  const aujourdHui = new Date().toISOString().slice(0, 10);

  const totalGeneral = lignes.reduce(
    (sum, l) => sum + (Number(l.quantite) || 0) * (Number(l.prixUnitaire) || 0),
    0
  );

  function updateLigne(key: string, patch: Partial<LigneEdit>) {
    setLignes((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }
  function ajouterLigne() {
    setLignes((prev) => [...prev, nouvelleLigne()]);
  }
  function retirerLigne(key: string) {
    setLignes((prev) => (prev.length > 1 ? prev.filter((l) => l.key !== key) : prev));
  }

  // UN SEUL bouton « Appliquer à tous les articles » : bénéficiaire commun, pièce commune et date de livraison commune.
  // La pièce commune est portée par la demande et héritée par chaque article (les pièces propres d'un article sont
  // gardées) : rien à copier. La date n'est appliquée que si elle est saisie (une date vide n'efface jamais les dates
  // des articles).
  const datesPersonnalisees = Boolean(dateLivraison) && lignes.some((l) => l.dateLivraison && l.dateLivraison !== dateLivraison);
  const beneficiairesPersonnalises = ilYADesPersonnalisations(lignes.map((l) => l.details), commun, createurId);

  function appliquerCommunATous() {
    setLignes((prev) => {
      const maj = appliquerATous(prev.map((l) => l.details));
      return prev.map((l, i) => ({
        ...l,
        details: { ...l.details, beneficiaire: maj[i].beneficiaire },
        ...(dateLivraison ? { dateLivraison } : {}),
      }));
    });
    setConfirmerAppliquer(false);
    toast.success(
      dateLivraison
        ? "Le bénéficiaire, la pièce et la date de livraison communs sont appliqués à tous les articles."
        : "Le bénéficiaire et la pièce communs sont appliqués à tous les articles."
    );
  }
  function demanderAppliquerATous() {
    if (beneficiairesPersonnalises || datesPersonnalisees) setConfirmerAppliquer(true);
    else appliquerCommunATous();
  }

  function handleSubmit() {
    const errors: FieldErrors = {};
    const erreurCommun = erreurSaisieBeneficiaire(commun);
    if (erreurCommun) errors.beneficiaire = erreurCommun;
    lignes.forEach((l, i) => {
      const e = l.details.beneficiaire ? erreurSaisieBeneficiaire(l.details.beneficiaire) : null;
      if (e) errors[`lignes.${i}.beneficiaire`] = e;
    });
    const erreurDateCommune = refusDateLivraison(dateLivraison);
    if (erreurDateCommune) errors.dateLivraisonSouhaitee = erreurDateCommune;
    lignes.forEach((l, i) => {
      const e = refusDateLivraison(l.dateLivraison);
      if (e) errors[`lignes.${i}.dateLivraison`] = e;
    });
    setFieldErrors(errors);

    let ligneError: string | undefined;
    if (lignes.some((l) => !l.libelle.trim())) {
      ligneError = "Chaque ligne doit avoir un libellé.";
    } else if (lignes.some((l) => l.motif.trim().length < MOTIF_LIGNE_MIN)) {
      ligneError = `Chaque ligne doit avoir un motif (${MOTIF_LIGNE_MIN} caractères minimum).`;
    } else if (lignes.some((l) => !l.quantite || l.quantite < 1)) {
      ligneError = "Chaque ligne doit avoir un nombre supérieur à 0.";
    } else if (totalGeneral <= 0) {
      ligneError = "Le total général doit être supérieur à 0.";
    }
    setErreurLignes(ligneError);

    if (Object.keys(errors).length > 0 || ligneError) {
      return;
    }

    startTransition(async () => {
      const result = await creerDemandeAction({
        beneficiaire: saisieVersChoix(commun),
        dateLivraisonSouhaitee: dateLivraison || undefined,
        devise,
        lignes: lignes.map((l) => ({
          libelle: l.libelle,
          motif: l.motif,
          quantite: l.quantite,
          prixUnitaire: Number(l.prixUnitaire) || 0,
          beneficiaire: l.details.beneficiaire ? saisieVersChoix(l.details.beneficiaire) : null,
          pieceJointeUrls: l.details.pieces.map((p) => p.url),
          dateLivraison: l.dateLivraison || undefined,
        })),
        pieceJointeUrl: pieceJointeUrl ?? undefined,
      });

      if (result.status === "success") {
        toast.success(result.message ?? "Demande créée.");
        // Reste sur place pour proposer les deux redirections possibles
        // (voir la demande créée, ou revenir à la liste) plutôt qu'une
        // navigation automatique unique.
        setDemandeCreeeId(result.data?.demandeId ?? null);
      } else if (result.status === "error") {
        if (result.fieldErrors) {
          setFieldErrors(result.fieldErrors);
          const erreurLigne = Object.entries(result.fieldErrors).find(([k]) => k.startsWith("lignes"))?.[1];
          if (erreurLigne) setErreurLignes(erreurLigne);
        }
        toast.error(result.message);
      }
    });
  }

  if (demandeCreeeId) {
    return (
      <div className="animate-fade-in-up space-y-4 rounded-lg border border-success/30 bg-success-bg p-6 text-center">
        <p className="text-sm font-medium text-success">Demande créée avec succès.</p>
        <div className="flex flex-wrap justify-center gap-3">
          <Link href={`/treso/demandes/${demandeCreeeId}`}>
            <Button type="button">Voir ma demande</Button>
          </Link>
          <Button type="button" variant="secondary" onClick={() => router.push("/treso/demandes")}>
            Retour à la liste
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Tableau des articles — en premier : c'est la première chose que le
          collaborateur doit remplir, avant les champs secondaires de
          l'en-tête. */}
      <Card>
        <div className="flex items-center justify-between gap-4">
          <h2 className="flex items-center gap-2 text-base font-bold text-foreground">
            <span className="h-4 w-1 rounded-full bg-primary" aria-hidden="true" />
            Tableau des articles
          </h2>
          <Button type="button" onClick={ajouterLigne} className="shrink-0">
            <Icon name="plus-circle" className="size-4" />
            Ajouter une ligne
          </Button>
        </div>

        <div className="mt-4 space-y-3">
          {/* En-têtes de colonnes (desktop) */}
          <div className="hidden gap-3 border-b border-border pb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground sm:grid sm:grid-cols-[1fr_90px_140px_120px_36px]">
            <span>Libellé et motif</span>
            <span>Nombre</span>
            <span>Prix unitaire</span>
            <span className="text-right">Total</span>
            <span className="sr-only">Retirer</span>
          </div>

          {lignes.map((ligne) => {
            const total = (Number(ligne.quantite) || 0) * (Number(ligne.prixUnitaire) || 0);
            return (
              <div
                key={ligne.key}
                className="grid gap-2 border-b border-border pb-3 last:border-b-0 last:pb-0 sm:grid-cols-[1fr_90px_140px_120px_36px] sm:items-center sm:gap-3 sm:border-b-0 sm:pb-0"
              >
                <div>
                  <span className="mb-1 block text-xs font-medium text-muted-foreground sm:hidden">Libellé</span>
                  <Input
                    aria-label="Libellé de l'article"
                    value={ligne.libelle}
                    onChange={(e) => updateLigne(ligne.key, { libelle: e.target.value })}
                  />
                </div>
                <div>
                  <span className="mb-1 block text-xs font-medium text-muted-foreground sm:hidden">Nombre</span>
                  <Input
                    aria-label="Nombre"
                    type="number"
                    inputMode="numeric"
                    min="1"
                    step="1"
                    value={ligne.quantite}
                    onChange={(e) => updateLigne(ligne.key, { quantite: Number(e.target.value) })}
                  />
                </div>
                <div>
                  <span className="mb-1 block text-xs font-medium text-muted-foreground sm:hidden">Prix unitaire</span>
                  <Input
                    aria-label="Prix unitaire"
                    type="number"
                    inputMode="decimal"
                    min="0"
                    step="1"
                    placeholder="0"
                    value={ligne.prixUnitaire}
                    onChange={(e) => updateLigne(ligne.key, { prixUnitaire: e.target.value })}
                  />
                </div>
                <div className="text-sm font-bold text-foreground tabular-nums sm:text-right">
                  <span className="mr-2 text-xs font-medium text-muted-foreground sm:hidden">Total</span>
                  {formatMontantDevise(total, devise)}
                </div>
                <div className="flex justify-end sm:row-start-1 sm:col-start-5">
                  {lignes.length > 1 ? (
                    <button
                      type="button"
                      onClick={() => retirerLigne(ligne.key)}
                      aria-label="Retirer la ligne"
                      className="grid size-8 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-danger-bg hover:text-danger"
                    >
                      <Icon name="x" className="size-4" />
                    </button>
                  ) : null}
                </div>
                <div className="sm:col-span-4">
                  <span className="mb-1 block text-xs font-medium text-muted-foreground sm:hidden">Motif</span>
                  <Input
                    aria-label="Motif de la ligne"
                    placeholder="Motif : pourquoi cet article (usage prévu, urgence…)"
                    value={ligne.motif}
                    onChange={(e) => updateLigne(ligne.key, { motif: e.target.value })}
                  />
                  <div className="mt-2 max-w-xs">
                    <Input
                      label="Date de livraison de l'article"
                      type="date"
                      min={aujourdHui}
                      data-date-livraison-article
                      hint={ligne.dateLivraison ? undefined : dateLivraison ? "Vide : la date commune sera utilisée." : undefined}
                      value={ligne.dateLivraison}
                      onChange={(e) => updateLigne(ligne.key, { dateLivraison: e.target.value })}
                      error={fieldErrors[`lignes.${lignes.indexOf(ligne)}.dateLivraison`]}
                    />
                  </div>
                  <DetailsArticleEditeur
                    details={ligne.details}
                    commun={commun}
                    createurId={createurId}
                    comptes={comptes}
                    onChange={(patch) => updateLigne(ligne.key, { details: { ...ligne.details, ...patch } })}
                    erreur={fieldErrors[`lignes.${lignes.indexOf(ligne)}.beneficiaire`]}
                  />
                </div>
              </div>
            );
          })}
        </div>

        <div className="mt-4 flex flex-col items-end rounded-xl bg-primary/[0.05] px-4 py-3.5 sm:px-5">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Total général
          </span>
          <span className="text-3xl font-black leading-tight tracking-tight text-primary tabular-nums">
            {formatMontantDevise(totalGeneral, devise)}
          </span>
        </div>
      </Card>

      {erreurLignes ? <p className="text-sm text-danger">{erreurLignes}</p> : null}

      {/* Détails communs (autonomie des articles, lot A) : bénéficiaire par défaut et pièce commune, hérités par chaque
          article qui n'a pas ses propres détails. « Appliquer à tous les articles » remet tous les articles sur ces valeurs. */}
      <Card>
        <h2 className="flex items-center gap-2 text-base font-bold text-foreground">
          <span className="h-4 w-1 rounded-full bg-primary" aria-hidden="true" />
          Détails communs
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Valables pour tous les articles, sauf ceux dont vous personnalisez les détails dans le tableau ci-dessus.
        </p>
        <div className="mt-4 space-y-4">
          <BeneficiaireChamp value={commun} onChange={setCommun} comptes={comptes} error={fieldErrors.beneficiaire} />
          <PieceJointeUpload label="Pièce commune" onChange={(url) => setPieceJointeUrl(url)} />
          <div className="max-w-xs">
            <Input
              label="Date de livraison commune"
              type="date"
              min={aujourdHui}
              data-date-livraison-commune
              hint="Ne peut pas être dans le passé."
              value={dateLivraison}
              onChange={(e) => setDateLivraison(e.target.value)}
              error={fieldErrors.dateLivraisonSouhaitee}
            />
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button type="button" variant="secondary" data-appliquer-a-tous onClick={demanderAppliquerATous}>
              Appliquer à tous les articles
            </Button>
            {confirmerAppliquer ? (
              <div role="alert" data-confirmation-appliquer className="flex flex-wrap items-center gap-2 text-sm text-foreground">
                <span>
                  {beneficiairesPersonnalises && datesPersonnalisees
                    ? "Certains articles ont un bénéficiaire ou une date de livraison personnalisés : ils seront remplacés par les valeurs communes."
                    : datesPersonnalisees
                      ? "Certains articles ont une date de livraison personnalisée : elle sera remplacée par la date commune."
                      : "Certains articles ont un bénéficiaire personnalisé : il sera remplacé par la valeur commune."}
                </span>
                <Button type="button" onClick={appliquerCommunATous}>Remplacer</Button>
                <Button type="button" variant="secondary" onClick={() => setConfirmerAppliquer(false)}>Annuler</Button>
              </div>
            ) : null}
          </div>
        </div>
      </Card>

      {/* En-tête de la demande — champs secondaires, remplis après les
          articles. Pas de Catégorie d'achat ici : la catégorisation reste
          un travail de Finance après création. */}
      <Card>
        <h2 className="flex items-center gap-2 text-base font-bold text-foreground">
          <span className="h-4 w-1 rounded-full bg-primary" aria-hidden="true" />
          En-tête de la demande
        </h2>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Select
            label="Devise"
            options={[...DEVISE_OPTIONS]}
            defaultValue={devise}
            onChange={(e) => setDevise(e.target.value)}
            error={fieldErrors.devise}
          />
          {/* Date de création : posée par le serveur à l'enregistrement (`Demande.createdAt`), jamais saisie. */}
          <div data-demande-creee-le>
            <span className="block text-sm font-medium text-foreground">Demande créée le</span>
            <p className="mt-1.5 rounded-lg border border-border bg-muted/60 px-3 py-2 text-sm font-semibold text-foreground" suppressHydrationWarning>
              {new Date().toLocaleDateString("fr-FR", { timeZone: "Africa/Abidjan" })}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">Automatique, non modifiable.</p>
          </div>
        </div>
      </Card>

      <Button type="button" onClick={handleSubmit} loading={isPending} className="w-full">
        Envoyer la demande
      </Button>
    </div>
  );
}
