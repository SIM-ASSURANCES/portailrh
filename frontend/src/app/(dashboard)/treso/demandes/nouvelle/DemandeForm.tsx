"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import Link from "next/link";

import { Button, Card, Input, Select } from "@/components/ui";
import { Icon } from "@/components/icons";
import { MOTIF_LIGNE_MIN, type ChoixBeneficiaire } from "backend/client";
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
};

function nouvelleLigne(): LigneEdit {
  return {
    key: `ligne-${Math.random().toString(36).slice(2)}`,
    libelle: "",
    motif: "",
    quantite: 1,
    prixUnitaire: "",
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
type ModeBeneficiaire = ChoixBeneficiaire["mode"];

const OPTIONS_BENEFICIAIRE: { value: ModeBeneficiaire; label: string }[] = [
  { value: "MOI", label: "Moi-même" },
  { value: "COMPTE", label: "Un autre compte du portail" },
  { value: "NOM", label: "Un nom libre (fournisseur, entreprise…)" },
];

export function DemandeForm({ comptes }: { comptes: { value: string; label: string }[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [modeBeneficiaire, setModeBeneficiaire] = useState<ModeBeneficiaire>("MOI");
  const [compteBeneficiaire, setCompteBeneficiaire] = useState("");
  const [nomBeneficiaire, setNomBeneficiaire] = useState("");
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

  function handleSubmit() {
    const errors: FieldErrors = {};
    if (modeBeneficiaire === "COMPTE" && !compteBeneficiaire) errors.beneficiaire = "Choisissez un compte.";
    if (modeBeneficiaire === "NOM" && nomBeneficiaire.trim().length < 2) errors.beneficiaire = "Saisissez le nom du bénéficiaire.";
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
      const beneficiaire: ChoixBeneficiaire =
        modeBeneficiaire === "COMPTE"
          ? { mode: "COMPTE", userId: compteBeneficiaire }
          : modeBeneficiaire === "NOM"
            ? { mode: "NOM", nom: nomBeneficiaire }
            : { mode: "MOI" };
      const result = await creerDemandeAction({
        beneficiaire,
        dateLivraisonSouhaitee: dateLivraison || undefined,
        devise,
        lignes: lignes.map((l) => ({
          libelle: l.libelle,
          motif: l.motif,
          quantite: l.quantite,
          prixUnitaire: Number(l.prixUnitaire) || 0,
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

      {/* En-tête de la demande — champs secondaires, remplis après les
          articles. Pas de Catégorie d'achat ici : la catégorisation reste
          un travail de Finance après création. */}
      <Card>
        <h2 className="flex items-center gap-2 text-base font-bold text-foreground">
          <span className="h-4 w-1 rounded-full bg-primary" aria-hidden="true" />
          En-tête de la demande
        </h2>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div className="space-y-2 sm:col-span-2">
            <Select
              label="Bénéficiaire"
              options={OPTIONS_BENEFICIAIRE}
              value={modeBeneficiaire}
              onChange={(e) => setModeBeneficiaire(e.target.value as ModeBeneficiaire)}
              error={modeBeneficiaire === "MOI" ? fieldErrors.beneficiaire : undefined}
            />
            {modeBeneficiaire === "COMPTE" ? (
              <Select
                label="Compte bénéficiaire"
                placeholder="Sélectionner un compte..."
                options={comptes}
                value={compteBeneficiaire}
                onChange={(e) => setCompteBeneficiaire(e.target.value)}
                error={fieldErrors.beneficiaire}
              />
            ) : null}
            {modeBeneficiaire === "NOM" ? (
              <Input
                label="Nom du bénéficiaire"
                hint="Fournisseur, prestataire ou « SIM Assurances CI »."
                value={nomBeneficiaire}
                onChange={(e) => setNomBeneficiaire(e.target.value)}
                error={fieldErrors.beneficiaire}
              />
            ) : null}
          </div>
          <Input
            label="Date de livraison souhaitée"
            type="date"
            min={aujourdHui}
            hint="Ne peut pas être dans le passé."
            value={dateLivraison}
            onChange={(e) => setDateLivraison(e.target.value)}
            error={fieldErrors.dateLivraisonSouhaitee}
          />
          <Select
            label="Devise"
            options={[...DEVISE_OPTIONS]}
            defaultValue={devise}
            onChange={(e) => setDevise(e.target.value)}
            error={fieldErrors.devise}
          />
        </div>

        <div className="mt-4">
          <PieceJointeUpload onChange={setPieceJointeUrl} />
        </div>
      </Card>

      <Button type="button" onClick={handleSubmit} loading={isPending} className="w-full">
        Envoyer la demande
      </Button>
    </div>
  );
}
