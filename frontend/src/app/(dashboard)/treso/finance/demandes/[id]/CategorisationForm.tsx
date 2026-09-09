"use client";

import { useActionState, useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button, Input, Select } from "@/components/ui";
import { useActionFeedback } from "@/lib/hooks/useActionFeedback";
import { IDLE_ACTION_STATE } from "backend/client";

import { categoriserDemandeAction, creerObjetInlineAction } from "./actions";

interface CategorieOption {
  id: string;
  label: string;
}

interface ObjetOption {
  id: string;
  label: string;
  categorieId: string;
}

/** Valeur spéciale du Select "Objet" déclenchant le panneau de création
 * inline — jamais une valeur réellement soumise (voir `onChange` ci-dessous,
 * qui referme immédiatement le Select sur cette sélection). */
const VALEUR_NOUVEL_OBJET = "__nouvel_objet__";

/**
 * Filtrage Catégorie -> Objet fait entièrement côté client, sans requête
 * réseau supplémentaire : les objets (peu nombreux, ~une poignée par
 * catégorie) sont chargés une fois par la page serveur et filtrés en
 * mémoire au changement de catégorie — le plus simple qui reste fluide vu
 * le volume de données (9 catégories, quelques objets).
 *
 * Débloque le cas où une Catégorie n'a encore aucun Objet (voir CLAUDE.md
 * "Création d'Objet inline depuis la catégorisation") : une option
 * "+ Ajouter un nouvel objet" est toujours proposée dans le Select, et le
 * panneau de création s'ouvre automatiquement dès que la liste filtrée est
 * vide pour la catégorie choisie.
 */
export function CategorisationForm({
  demandeId,
  categories,
  objets,
  initialCategorieId = "",
  initialObjetId = "",
}: {
  demandeId: string;
  categories: CategorieOption[];
  objets: ObjetOption[];
  /** Pré-remplissage si la demande a déjà été catégorisée mais reste
   * EN_ATTENTE (Finance peut corriger tant qu'elle n'est pas validée). */
  initialCategorieId?: string;
  initialObjetId?: string;
}) {
  const [state, formAction, isPending] = useActionState(categoriserDemandeAction, IDLE_ACTION_STATE);
  const router = useRouter();
  useActionFeedback(state);
  const [categorieId, setCategorieId] = useState(initialCategorieId);
  const [objetsLocaux, setObjetsLocaux] = useState(objets);
  const [creationOuverte, setCreationOuverte] = useState(false);
  const [nouvelObjetLabel, setNouvelObjetLabel] = useState("");
  const [nouvelObjetErreur, setNouvelObjetErreur] = useState<string | undefined>();
  const [objetSelectionneId, setObjetSelectionneId] = useState(initialObjetId);
  const [isPendingObjet, startTransitionObjet] = useTransition();

  useEffect(() => {
    if (state.status === "success") {
      // Retour à la liste plutôt que de rester sur un formulaire qui vient
      // de se réinitialiser visuellement (comportement natif après une
      // Server Action réussie) : plus cohérent avec le flux "traiter la
      // file d'attente" de Finance.
      router.push("/treso/finance/demandes");
    }
  }, [state, router]);

  const objetsFiltres = useMemo(
    () => objetsLocaux.filter((o) => o.categorieId === categorieId),
    [objetsLocaux, categorieId]
  );

  // Panneau de création : dérivé du rendu (jamais un `useEffect` +
  // `setState`, qui déclencherait un rendu en cascade évitable) — ouvert
  // soit explicitement (`creationOuverte`), soit automatiquement dès que
  // la catégorie choisie n'a encore aucun objet, jamais un formulaire
  // bloqué sans issue.
  const afficherCreation = creationOuverte || (categorieId !== "" && objetsFiltres.length === 0);

  function handleCategorieChange(nouvelleCategorieId: string) {
    setCategorieId(nouvelleCategorieId);
    setObjetSelectionneId("");
    setCreationOuverte(false);
    setNouvelObjetLabel("");
    setNouvelObjetErreur(undefined);
  }

  function handleObjetChange(valeur: string) {
    if (valeur === VALEUR_NOUVEL_OBJET) {
      // Jamais soumise telle quelle : ouvre le panneau de création et
      // remet le Select à vide (via son changement de `key` ci-dessous).
      setCreationOuverte(true);
      setObjetSelectionneId("");
      return;
    }
    setObjetSelectionneId(valeur);
  }

  function handleCreerObjet() {
    const label = nouvelObjetLabel.trim();
    if (label.length < 2) {
      setNouvelObjetErreur("Le libellé doit contenir au moins 2 caractères.");
      return;
    }
    setNouvelObjetErreur(undefined);
    startTransitionObjet(async () => {
      const result = await creerObjetInlineAction(categorieId, label);
      if (result.status === "success") {
        setObjetsLocaux((prev) => [...prev, result.objet]);
        setObjetSelectionneId(result.objet.id);
        setCreationOuverte(false);
        setNouvelObjetLabel("");
        toast.success(`Objet « ${result.objet.label} » créé.`);
      } else {
        toast.error(result.message);
      }
    });
  }

  return (
    <form
      action={formAction}
      className="space-y-5 rounded-lg border border-border bg-surface p-4 sm:p-6"
    >
      <input type="hidden" name="demandeId" value={demandeId} />

      <Select
        name="categorieId"
        label="Catégorie"
        placeholder="Sélectionner une catégorie..."
        required
        defaultValue={initialCategorieId}
        onChange={(e) => handleCategorieChange(e.target.value)}
        options={categories.map((c) => ({ value: c.id, label: c.label }))}
        error={state.status === "error" ? state.fieldErrors?.categorieId : undefined}
      />

      <Select
        key={`${categorieId}-${objetSelectionneId}`}
        name="objetId"
        label="Objet"
        placeholder={categorieId ? "Sélectionner un objet..." : "Choisir d'abord une catégorie"}
        required
        disabled={!categorieId}
        defaultValue={objetSelectionneId}
        onChange={(e) => handleObjetChange(e.target.value)}
        options={[
          ...objetsFiltres.map((o) => ({ value: o.id, label: o.label })),
          ...(categorieId ? [{ value: VALEUR_NOUVEL_OBJET, label: "+ Ajouter un nouvel objet" }] : []),
        ]}
        error={state.status === "error" ? state.fieldErrors?.objetId : undefined}
        hint={
          categorieId && objetsFiltres.length === 0
            ? "Aucun objet n'existe encore pour cette catégorie — créez-en un ci-dessous."
            : undefined
        }
      />

      {afficherCreation ? (
        <div className="animate-fade-in-up space-y-3 rounded-md border border-border p-3">
          <Input
            label="Nom du nouvel objet"
            required
            value={nouvelObjetLabel}
            onChange={(e) => {
              setNouvelObjetLabel(e.target.value);
              if (nouvelObjetErreur) setNouvelObjetErreur(undefined);
            }}
            error={nouvelObjetErreur}
          />
          <div className="flex flex-wrap gap-3">
            <Button type="button" loading={isPendingObjet} onClick={handleCreerObjet}>
              Créer l&apos;objet
            </Button>
            {/* "Annuler" masqué si aucun autre objet n'existe pour cette
                catégorie : rien à quoi revenir, la création reste la seule
                issue possible (rouvert automatiquement sinon par l'effet
                ci-dessus). */}
            {objetsFiltres.length > 0 ? (
              <Button
                type="button"
                variant="secondary"
                disabled={isPendingObjet}
                onClick={() => {
                  setCreationOuverte(false);
                  setNouvelObjetLabel("");
                  setNouvelObjetErreur(undefined);
                }}
              >
                Annuler
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}

      <Button type="submit" loading={isPending} className="w-full sm:w-auto">
        Enregistrer la catégorisation
      </Button>
    </form>
  );
}
