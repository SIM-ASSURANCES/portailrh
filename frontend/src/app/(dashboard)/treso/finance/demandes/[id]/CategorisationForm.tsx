"use client";

import { useActionState, useMemo, useState, useTransition } from "react";
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

interface BudgetCategorieInfo {
  budgetAlloue: number | null;
  consomme: number;
  restant: number | null;
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
  budgetParCategorie = {},
}: {
  demandeId: string;
  categories: CategorieOption[];
  objets: ObjetOption[];
  /** Pré-remplissage si la demande a déjà été catégorisée mais reste
   * EN_ATTENTE (Finance peut corriger tant qu'elle n'est pas validée). */
  initialCategorieId?: string;
  initialObjetId?: string;
  /**
   * Niveau de budget de chaque Catégorie proposable, déjà calculé côté
   * serveur (`getMontantConsommeCategorie`, voir CLAUDE.md "Budget partagé
   * par Catégorie") — jamais recalculé ici ni refetché au changement de
   * Select : même volume que `categories`/`objets`, déjà chargé une fois
   * par la page, filtré en mémoire selon la catégorie choisie.
   */
  budgetParCategorie?: Record<string, BudgetCategorieInfo>;
}) {
  const [state, formAction, isPending] = useActionState(categoriserDemandeAction, IDLE_ACTION_STATE);
  useActionFeedback(state);
  const [categorieId, setCategorieId] = useState(initialCategorieId);
  const [objetsLocaux, setObjetsLocaux] = useState(objets);
  const [creationOuverte, setCreationOuverte] = useState(false);
  const [nouvelObjetLabel, setNouvelObjetLabel] = useState("");
  const [nouvelObjetErreur, setNouvelObjetErreur] = useState<string | undefined>();
  const [objetSelectionneId, setObjetSelectionneId] = useState(initialObjetId);
  const [isPendingObjet, startTransitionObjet] = useTransition();

  // Volontairement PAS de redirection après succès : Finance reste sur cet
  // écran de traitement (toast de confirmation via `useActionFeedback`
  // suffit). `categoriserDemandeAction` ne change jamais le statut — la
  // demande reste `EN_ATTENTE_VALIDATION` — donc `revalidatePath` (appelé
  // par l'action) suffit à réafficher ce même formulaire, désormais
  // pré-rempli avec la catégorie/l'objet qui viennent d'être enregistrés,
  // avec les boutons de décision (`ValidationActions`) toujours visibles
  // juste en dessous sur la même page.

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

      {categorieId && budgetParCategorie[categorieId] ? (
        <BudgetCategorieApercu info={budgetParCategorie[categorieId]} />
      ) : null}

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

/**
 * Aperçu du budget de la Catégorie actuellement sélectionnée dans le Select
 * ci-dessus — "Budget visible au moment de la catégorisation" : Finance
 * voit où en est l'argent de cette Catégorie AVANT de valider son choix,
 * jamais après coup. Purement informatif (aucune action, aucun blocage —
 * le contrôle bloquant réel reste au RÈGLEMENT, voir
 * `confirmerReglementAction`/CLAUDE.md "Budget partagé par Catégorie") :
 * une catégorie déjà en dépassement reste sélectionnable ici, Finance est
 * seulement prévenue à l'avance plutôt que découvrir le blocage plus tard
 * au moment de confirmer un règlement.
 */
function BudgetCategorieApercu({ info }: { info: BudgetCategorieInfo }) {
  if (info.budgetAlloue == null) {
    return (
      <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
        Aucun budget défini pour cette catégorie — aucune limite appliquée.
      </p>
    );
  }

  const depasse = info.restant != null && info.restant < 0;

  return (
    <dl className="grid grid-cols-1 gap-3 rounded-md border border-border bg-muted/40 px-3 py-2.5 sm:grid-cols-3">
      <div>
        <dt className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Budget alloué</dt>
        <dd className="text-sm font-semibold text-foreground tabular-nums">
          {info.budgetAlloue.toLocaleString("fr-FR")} FCFA
        </dd>
      </div>
      <div>
        <dt className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Déjà consommé</dt>
        <dd className="text-sm font-semibold text-foreground tabular-nums">
          {info.consomme.toLocaleString("fr-FR")} FCFA
        </dd>
      </div>
      <div>
        <dt className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          Restant disponible
        </dt>
        <dd className={`text-sm font-semibold tabular-nums ${depasse ? "text-danger" : "text-success"}`}>
          {info.restant!.toLocaleString("fr-FR")} FCFA
        </dd>
      </div>
    </dl>
  );
}
