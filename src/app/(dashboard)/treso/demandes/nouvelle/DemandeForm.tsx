"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import Link from "next/link";

import { Button, Card, Input, Select, Textarea } from "@/components/ui";
import { Icon } from "@/components/icons";
import { BENEFICIAIRE_TYPE_OPTIONS } from "@/components/tresorerie/beneficiaire";
import { DEVISE_OPTIONS, formatMontantDevise } from "@/components/tresorerie/devise";
import { PieceJointeUpload } from "@/components/tresorerie/PieceJointeUpload";

import { creerDemandeAction } from "./actions";

interface CategorieOption {
  id: string;
  label: string;
}

type LigneEdit = {
  key: string;
  libelle: string;
  quantite: number;
  prixUnitaire: number;
};

function nouvelleLigne(): LigneEdit {
  return {
    key: `ligne-${Math.random().toString(36).slice(2)}`,
    libelle: "",
    quantite: 1,
    prixUnitaire: 0,
  };
}

type FieldErrors = Partial<Record<string, string>>;

/**
 * Formulaire de création d'une demande d'achat ("Demande d'Achat").
 *
 * Deux blocs : l'en-tête (bénéficiaire, catégorie, date de livraison, poste
 * budgétaire, devise, motif) et le "Tableau des articles" — une liste
 * dynamique de lignes (libellé / nombre / prix unitaire), au moins une
 * obligatoire. Le "Total général" est recalculé en direct et n'est jamais
 * saisi : le `montant` de la demande est recomposé côté serveur à partir
 * des lignes (voir `creerDemandeAction`).
 *
 * Un tableau de lignes ne se prête pas à `FormData` : on appelle donc
 * directement l'action via `useTransition` (même pattern que
 * `RetourCaisseForm`, Phase D), pas via `<form action={...}>`.
 */
export function DemandeForm({ categories }: { categories: CategorieOption[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [beneficiaireType, setBeneficiaireType] = useState("");
  const [categorieId, setCategorieId] = useState("");
  const [dateLivraison, setDateLivraison] = useState("");
  const [posteBudgetaireId, setPosteBudgetaireId] = useState("");
  const [devise, setDevise] = useState("XOF");
  const [motif, setMotif] = useState("");
  const [lignes, setLignes] = useState<LigneEdit[]>([nouvelleLigne()]);
  const [pieceJointeUrl, setPieceJointeUrl] = useState<string | null>(null);

  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [erreurLignes, setErreurLignes] = useState<string | undefined>();
  const [demandeCreeeId, setDemandeCreeeId] = useState<string | null>(null);

  const categorieOptions = useMemo(
    () => categories.map((c) => ({ value: c.id, label: c.label })),
    [categories]
  );

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
    if (!beneficiaireType) errors.beneficiaireType = "Entité bénéficiaire requise";
    if (!categorieId) errors.categorieId = "Catégorie d'achat requise";
    if (motif.trim().length < 3) errors.motif = "Merci de préciser le motif de l'achat";
    setFieldErrors(errors);

    let ligneError: string | undefined;
    if (lignes.some((l) => !l.libelle.trim())) {
      ligneError = "Chaque ligne doit avoir un libellé.";
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
        beneficiaireType,
        categorieId,
        dateLivraisonSouhaitee: dateLivraison || undefined,
        posteBudgetaireId: posteBudgetaireId || undefined,
        devise,
        motif,
        lignes: lignes.map((l) => ({
          libelle: l.libelle,
          quantite: l.quantite,
          prixUnitaire: l.prixUnitaire,
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
          if (result.fieldErrors.lignes) setErreurLignes(result.fieldErrors.lignes);
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
      {/* En-tête de la demande */}
      <Card>
        <h2 className="text-base font-bold text-foreground">En-tête de la demande</h2>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Select
            label="Entité bénéficiaire"
            placeholder="Sélectionner..."
            options={[...BENEFICIAIRE_TYPE_OPTIONS]}
            defaultValue={beneficiaireType}
            onChange={(e) => setBeneficiaireType(e.target.value)}
            error={fieldErrors.beneficiaireType}
          />
          <Select
            label="Catégorie d'achat"
            placeholder="Sélectionner..."
            options={categorieOptions}
            defaultValue={categorieId}
            onChange={(e) => setCategorieId(e.target.value)}
            error={fieldErrors.categorieId}
          />
          <Input
            label="Date de livraison souhaitée"
            type="date"
            value={dateLivraison}
            onChange={(e) => setDateLivraison(e.target.value)}
            error={fieldErrors.dateLivraisonSouhaitee}
          />
          <Select
            label="Poste budgétaire concerné (facultatif)"
            placeholder="Aucun / non déterminé"
            options={categorieOptions}
            defaultValue={posteBudgetaireId}
            onChange={(e) => setPosteBudgetaireId(e.target.value)}
            error={fieldErrors.posteBudgetaireId}
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
          <Textarea
            label="Motif de l'achat"
            rows={4}
            value={motif}
            onChange={(e) => setMotif(e.target.value)}
            error={fieldErrors.motif}
          />
        </div>
        <div className="mt-4">
          <PieceJointeUpload onChange={setPieceJointeUrl} />
        </div>
      </Card>

      {/* Tableau des articles */}
      <Card>
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-base font-bold text-foreground">Tableau des articles</h2>
          <Button type="button" onClick={ajouterLigne} className="shrink-0">
            <Icon name="plus-circle" className="size-4" />
            Ajouter une ligne
          </Button>
        </div>

        <div className="mt-4 space-y-3">
          {/* En-têtes de colonnes (desktop) */}
          <div className="hidden gap-3 border-b border-border pb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground sm:grid sm:grid-cols-[1fr_90px_140px_120px_36px]">
            <span>Libellé</span>
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
                    value={ligne.prixUnitaire}
                    onChange={(e) => updateLigne(ligne.key, { prixUnitaire: Number(e.target.value) })}
                  />
                </div>
                <div className="text-sm font-semibold text-foreground sm:text-right">
                  <span className="mr-2 text-xs font-medium text-muted-foreground sm:hidden">Total</span>
                  {formatMontantDevise(total, devise)}
                </div>
                <div className="flex justify-end">
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
              </div>
            );
          })}
        </div>

        <div className="mt-4 flex flex-col items-end border-t border-border pt-4">
          <span className="text-sm text-muted-foreground">Total général</span>
          <span className="text-xl font-bold text-primary">
            {formatMontantDevise(totalGeneral, devise)}
          </span>
        </div>
      </Card>

      {erreurLignes ? <p className="text-sm text-danger">{erreurLignes}</p> : null}

      <Button type="button" onClick={handleSubmit} loading={isPending} className="w-full">
        Envoyer la demande
      </Button>
    </div>
  );
}
