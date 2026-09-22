"use client";

import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";

import { STATUT_LIGNE_DEMANDE_BADGE_VARIANT, STATUT_LIGNE_DEMANDE_LABEL } from "@/components/tresorerie/demandeStatut";
import { Badge, Button, Input, Select, Textarea } from "@/components/ui";

import { BudgetCategorieApercu, type BudgetCategorieInfo } from "./CategorisationForm";
import {
  categoriserLigneAction,
  creerCategorieInlineAction,
  creerObjetInlineAction,
  modifierLibelleLigneAction,
  validerLignesAction,
} from "./actions";

type LigneStatut = "EN_ATTENTE" | "VALIDEE" | "REJETEE";

export interface CategorieOption {
  id: string;
  label: string;
}

export interface ObjetOption {
  id: string;
  label: string;
  categorieId: string;
}

export type LigneValidation = {
  id: string;
  libelle: string;
  libelleOriginal: string | null;
  quantite: number;
  prixUnitaire: number;
  statutValidation: LigneStatut;
  motifRejet: string | null;
  decideParNom: string | null;
  decideAt: Date | null;
  /** Catégorisation par ligne (voir CLAUDE.md "Catégorisation par ligne"). */
  categorieId: string | null;
  categorieLabel: string | null;
  objetId: string | null;
  objetLabel: string | null;
};

type Decision = { statut: "VALIDEE" | "REJETEE"; motif: string };

/** Même sentinelles que `CategorisationForm.tsx` — jamais soumises telles
 * quelles, ouvrent le panneau de création inline (voir CLAUDE.md
 * "Visibilité des catégories/objets existants pendant la catégorisation"). */
const VALEUR_NOUVEL_OBJET = "__nouvel_objet__";
const VALEUR_NOUVELLE_CATEGORIE = "__nouvelle_categorie__";

/**
 * "Lignes d'articles" côté Finance — Tâche "Validation ligne par ligne"
 * (voir CLAUDE.md). Remplace `ValidationActions` pour toute demande ayant
 * AU MOINS une ligne (`demande.lignes.length > 0`) : `page.tsx` ne rend
 * plus jamais les deux composants en même temps pour une même demande.
 *
 * Deux modes, déterminés par la page appelante via `dejaDecidees`
 * (`lignes.every(l => l.statutValidation !== "EN_ATTENTE")`) — **jamais**
 * uniquement `demande.statut === "EN_ATTENTE_VALIDATION"` : si TOUTES les
 * lignes sont rejetées, `montantValide` retombe à 0 et
 * `calculerStatutDemande` (jamais modifiée) repasse la demande en
 * `EN_ATTENTE_VALIDATION` alors que ses lignes sont pourtant déjà toutes
 * décidées — seul un contrôle basé sur le statut de chaque ligne distingue
 * correctement ce cas d'une demande qui n'a encore reçu aucune décision.
 * - `dejaDecidees = false` : tableau interactif (catégorisation + décision
 *   + motif + total qui se recalcule en direct + bouton d'enregistrement
 *   unique).
 * - `dejaDecidees = true` : même tableau, mais en lecture seule pour les
 *   colonnes Catégorie/Objet et Décision, sans aucun contrôle.
 *
 * Le libellé reste modifiable indépendamment de l'état de décision
 * (`canModifierLibelle`/`libelleModifiable`) — même verrou que
 * `DescriptionEditor` (`CLOTUREE` uniquement), jamais lié à la décision de
 * VALIDATION elle-même : modifier un libellé n'est jamais une décision.
 *
 * **Catégorisation par ligne (voir CLAUDE.md)** — `categories`/`objets`/
 * `budgetParCategorie` (catalogue complet + aperçu budgétaire, mêmes
 * données que `CategorisationForm` pour une `DEPENSE_DIRECTE`) et
 * `canCategoriser` (`treso.categoriser_demande`, indépendante de
 * `canValider`/`canModifierLibelle`) pilotent une colonne Catégorie/Objet
 * PAR LIGNE, verrouillée dès que `ligne.statutValidation !== "EN_ATTENTE"`
 * (`categoriserLigneAction` refuse de toute façon côté serveur) —
 * `CategorisationForm` reste utilisé tel quel UNIQUEMENT pour les
 * `DEPENSE_DIRECTE` (gate posé sur `categoriserDemandeAction`), jamais
 * affiché en même temps que ce tableau pour une même demande.
 */
export function LignesValidationTable({
  demandeId,
  lignes,
  canValider,
  canModifierLibelle,
  libelleModifiable,
  canCategoriser,
  categories,
  objets,
  budgetParCategorie,
}: {
  demandeId: string;
  lignes: LigneValidation[];
  canValider: boolean;
  canModifierLibelle: boolean;
  libelleModifiable: boolean;
  canCategoriser: boolean;
  categories: CategorieOption[];
  objets: ObjetOption[];
  budgetParCategorie: Record<string, BudgetCategorieInfo>;
}) {
  const dejaDecidees = lignes.every((ligne) => ligne.statutValidation !== "EN_ATTENTE");

  const [decisions, setDecisions] = useState<Record<string, Decision | undefined>>({});
  const [isPending, startTransition] = useTransition();

  function setDecisionStatut(ligneId: string, statut: "VALIDEE" | "REJETEE") {
    setDecisions((prev) => ({ ...prev, [ligneId]: { statut, motif: prev[ligneId]?.motif ?? "" } }));
  }

  function setDecisionMotif(ligneId: string, motif: string) {
    setDecisions((prev) => ({ ...prev, [ligneId]: { statut: prev[ligneId]?.statut ?? "REJETEE", motif } }));
  }

  const montantQuiSeraValide = useMemo(
    () =>
      lignes.reduce((total, ligne) => {
        const decision = decisions[ligne.id];
        return decision?.statut === "VALIDEE" ? total + ligne.quantite * ligne.prixUnitaire : total;
      }, 0),
    [lignes, decisions]
  );

  const toutesDecidees = lignes.every((ligne) => decisions[ligne.id] != null);
  const motifsValides = lignes.every((ligne) => {
    const decision = decisions[ligne.id];
    return !decision || decision.statut !== "REJETEE" || decision.motif.trim().length >= 3;
  });
  const peutEnregistrer = canValider && toutesDecidees && motifsValides && !isPending;

  // Bug signalé "l'interaction se bloque après avoir cliqué Rejeter" (voir
  // CLAUDE.md) : le bouton restait CORRECTEMENT désactivé tant qu'un motif
  // de rejet faisait moins de 3 caractères, mais RIEN sur l'écran
  // n'expliquait pourquoi — perçu à tort comme un blocage. Message explicite
  // ci-dessous, même principe que le message "Votre rôle ne permet pas..."
  // déjà présent juste en dessous pour le cas de permission.
  const raisonBlocage = !toutesDecidees
    ? "Chaque ligne doit avoir une décision (Valider ou Rejeter) avant de pouvoir enregistrer."
    : !motifsValides
      ? "Un motif de rejet d'au moins 3 caractères est requis pour chaque ligne rejetée."
      : null;

  function handleEnregistrer() {
    const payload = lignes.map((ligne) => {
      const decision = decisions[ligne.id]!;
      return {
        ligneId: ligne.id,
        statut: decision.statut,
        motif: decision.statut === "REJETEE" ? decision.motif.trim() : undefined,
      };
    });
    startTransition(async () => {
      const result = await validerLignesAction(demandeId, payload);
      if (result.status === "success") {
        toast.success(result.message);
      } else {
        toast.error(result.message);
      }
    });
  }

  return (
    <div className="space-y-4 rounded-lg border border-border bg-surface p-4 sm:p-6">
      <h2 className="text-sm font-semibold text-foreground">Lignes d&apos;articles</h2>
      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full min-w-full divide-y divide-border text-sm">
          <thead className="bg-muted">
            <tr>
              <th className="px-3 py-2 text-left font-medium text-muted-foreground">Libellé</th>
              <th className="px-3 py-2 text-right font-medium text-muted-foreground">Nombre</th>
              <th className="px-3 py-2 text-right font-medium text-muted-foreground">Prix unitaire</th>
              <th className="px-3 py-2 text-right font-medium text-muted-foreground">Total</th>
              <th className="px-3 py-2 text-left font-medium text-muted-foreground">Catégorie / Objet</th>
              <th className="px-3 py-2 text-left font-medium text-muted-foreground">
                {dejaDecidees ? "Statut" : "Décision"}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border bg-surface">
            {lignes.map((ligne) => (
              <LigneRow
                key={ligne.id}
                ligne={ligne}
                dejaDecidee={dejaDecidees}
                decision={decisions[ligne.id]}
                onChangeStatut={(statut) => setDecisionStatut(ligne.id, statut)}
                onChangeMotif={(motif) => setDecisionMotif(ligne.id, motif)}
                canModifierLibelle={canModifierLibelle}
                libelleModifiable={libelleModifiable}
                decisionsPending={isPending}
                canCategoriser={canCategoriser}
                categories={categories}
                objets={objets}
                budgetParCategorie={budgetParCategorie}
              />
            ))}
          </tbody>
        </table>
      </div>

      {!dejaDecidees ? (
        <>
          <p className="text-sm font-semibold text-foreground">
            Montant qui sera validé :{" "}
            <span className="tabular-nums">{montantQuiSeraValide.toLocaleString("fr-FR")} FCFA</span>
          </p>
          {!canValider ? (
            <p className="text-xs text-muted-foreground">
              Votre rôle ne permet pas de valider ou rejeter les lignes de cette demande — réservé au
              Responsable Finance.
            </p>
          ) : raisonBlocage ? (
            <p className="text-xs text-muted-foreground">{raisonBlocage}</p>
          ) : null}
          <Button type="button" loading={isPending} disabled={!peutEnregistrer} onClick={handleEnregistrer}>
            Enregistrer les décisions
          </Button>
        </>
      ) : null}
    </div>
  );
}

function LigneRow({
  ligne,
  dejaDecidee,
  decision,
  onChangeStatut,
  onChangeMotif,
  canModifierLibelle,
  libelleModifiable,
  decisionsPending,
  canCategoriser,
  categories,
  objets,
  budgetParCategorie,
}: {
  ligne: LigneValidation;
  dejaDecidee: boolean;
  decision: Decision | undefined;
  onChangeStatut: (statut: "VALIDEE" | "REJETEE") => void;
  onChangeMotif: (motif: string) => void;
  canModifierLibelle: boolean;
  libelleModifiable: boolean;
  decisionsPending: boolean;
  canCategoriser: boolean;
  categories: CategorieOption[];
  objets: ObjetOption[];
  budgetParCategorie: Record<string, BudgetCategorieInfo>;
}) {
  const [ouvertLibelle, setOuvertLibelle] = useState(false);
  const [valeurLibelle, setValeurLibelle] = useState(ligne.libelle);
  const [erreurLibelle, setErreurLibelle] = useState<string | undefined>();
  const [isPendingLibelle, startTransitionLibelle] = useTransition();

  function handleEnregistrerLibelle() {
    if (valeurLibelle.trim().length < 3) {
      setErreurLibelle("Le libellé doit contenir au moins 3 caractères.");
      return;
    }
    setErreurLibelle(undefined);
    startTransitionLibelle(async () => {
      const result = await modifierLibelleLigneAction(ligne.id, valeurLibelle.trim());
      if (result.status === "success") {
        toast.success(result.message);
        setOuvertLibelle(false);
      } else {
        toast.error(result.message);
      }
    });
  }

  const total = ligne.quantite * ligne.prixUnitaire;

  return (
    <tr>
      <td className="min-w-[14rem] px-3 py-2 align-top text-foreground">
        {/* Même mécanique que `DescriptionEditor` : les deux versions restent
            visibles EN PERMANENCE dès qu'elles divergent. */}
        {ligne.libelleOriginal != null ? (
          <p className="mb-1 text-xs text-muted-foreground">
            Version initiale : <span className="italic">{ligne.libelleOriginal}</span>
          </p>
        ) : null}
        {!ouvertLibelle ? (
          <div className="flex flex-wrap items-center gap-2">
            <span>{ligne.libelle}</span>
            {canModifierLibelle ? (
              <button
                type="button"
                disabled={!libelleModifiable}
                className="text-xs font-medium text-info underline-offset-4 hover:text-primary hover:underline disabled:cursor-not-allowed disabled:text-muted-foreground disabled:no-underline disabled:hover:text-muted-foreground"
                onClick={() => {
                  setValeurLibelle(ligne.libelle);
                  setOuvertLibelle(true);
                }}
              >
                Modifier
              </button>
            ) : null}
          </div>
        ) : (
          <div className="animate-fade-in-up space-y-2">
            <Input
              aria-label="Libellé de la ligne"
              value={valeurLibelle}
              onChange={(e) => {
                setValeurLibelle(e.target.value);
                if (erreurLibelle) setErreurLibelle(undefined);
              }}
              error={erreurLibelle}
            />
            <div className="flex flex-wrap gap-2">
              <Button type="button" loading={isPendingLibelle} onClick={handleEnregistrerLibelle}>
                Enregistrer
              </Button>
              <Button
                type="button"
                variant="secondary"
                disabled={isPendingLibelle}
                onClick={() => {
                  setOuvertLibelle(false);
                  setErreurLibelle(undefined);
                }}
              >
                Annuler
              </Button>
            </div>
          </div>
        )}
      </td>
      <td className="px-3 py-2 text-right align-top text-foreground">{ligne.quantite}</td>
      <td className="px-3 py-2 text-right align-top text-foreground">
        {ligne.prixUnitaire.toLocaleString("fr-FR")} FCFA
      </td>
      <td className="px-3 py-2 text-right align-top font-medium text-foreground">
        {total.toLocaleString("fr-FR")} FCFA
      </td>
      <td className="min-w-[13rem] px-3 py-2 align-top">
        <LigneCategorisationCell
          ligne={ligne}
          canCategoriser={canCategoriser}
          categories={categories}
          objets={objets}
          budgetParCategorie={budgetParCategorie}
        />
      </td>
      <td className="min-w-[12rem] px-3 py-2 align-top">
        {dejaDecidee ? (
          <>
            <Badge variant={STATUT_LIGNE_DEMANDE_BADGE_VARIANT[ligne.statutValidation]}>
              {STATUT_LIGNE_DEMANDE_LABEL[ligne.statutValidation]}
            </Badge>
            {ligne.statutValidation === "REJETEE" && ligne.motifRejet ? (
              <p className="mt-1 text-xs text-muted-foreground">Motif : {ligne.motifRejet}</p>
            ) : null}
            {ligne.decideParNom ? (
              <p className="mt-1 text-xs text-muted-foreground">
                Par {ligne.decideParNom}
                {ligne.decideAt ? ` — ${ligne.decideAt.toLocaleDateString("fr-FR")}` : ""}
              </p>
            ) : null}
          </>
        ) : (
          <div className="space-y-2">
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant={decision?.statut === "VALIDEE" ? "primary" : "secondary"}
                disabled={decisionsPending}
                onClick={() => onChangeStatut("VALIDEE")}
              >
                Valider
              </Button>
              <Button
                type="button"
                variant={decision?.statut === "REJETEE" ? "danger" : "secondary"}
                disabled={decisionsPending}
                onClick={() => onChangeStatut("REJETEE")}
              >
                Rejeter
              </Button>
            </div>
            {decision?.statut === "REJETEE" ? (
              <Textarea
                aria-label="Motif du rejet de la ligne"
                rows={2}
                placeholder="Motif du rejet (3 caractères minimum)..."
                value={decision.motif}
                disabled={decisionsPending}
                onChange={(e) => onChangeMotif(e.target.value)}
                error={
                  decision.motif.length > 0 && decision.motif.trim().length < 3
                    ? "3 caractères minimum."
                    : undefined
                }
              />
            ) : null}
          </div>
        )}
      </td>
    </tr>
  );
}

/**
 * Catégorisation d'UNE ligne — Tâche "Catégorisation par ligne" (voir
 * CLAUDE.md). Condensé de `CategorisationForm.tsx` (mêmes Select en
 * cascade, même création inline, même aperçu de budget), mais appelle
 * directement `categoriserLigneAction` via `useTransition` (comme
 * `modifierLibelleLigneAction` ci-dessus) plutôt qu'un `<form action>` —
 * cohérent avec le reste de ce tableau, où chaque ligne agit
 * indépendamment sans navigation ni rechargement.
 *
 * **Verrouillée dès que `ligne.statutValidation !== "EN_ATTENTE"`** —
 * `categoriserLigneAction` refuse de toute façon côté serveur ; l'éditeur
 * ne s'affiche donc JAMAIS pour une ligne déjà décidée, seul un texte en
 * lecture seule (même principe que la colonne Statut).
 */
function LigneCategorisationCell({
  ligne,
  canCategoriser,
  categories,
  objets,
  budgetParCategorie,
}: {
  ligne: LigneValidation;
  canCategoriser: boolean;
  categories: CategorieOption[];
  objets: ObjetOption[];
  budgetParCategorie: Record<string, BudgetCategorieInfo>;
}) {
  const dejaDecidee = ligne.statutValidation !== "EN_ATTENTE";
  const [ouvert, setOuvert] = useState(false);
  const [categorieId, setCategorieId] = useState(ligne.categorieId ?? "");
  const [objetId, setObjetId] = useState(ligne.objetId ?? "");
  const [categoriesLocaux, setCategoriesLocaux] = useState(categories);
  const [objetsLocaux, setObjetsLocaux] = useState(objets);
  const [creationCategorieOuverte, setCreationCategorieOuverte] = useState(false);
  const [nouvelleCategorieLabel, setNouvelleCategorieLabel] = useState("");
  const [creationObjetOuverte, setCreationObjetOuverte] = useState(false);
  const [nouvelObjetLabel, setNouvelObjetLabel] = useState("");
  const [isPending, startTransition] = useTransition();
  const [isPendingCreation, startTransitionCreation] = useTransition();

  const objetsFiltres = objetsLocaux.filter((o) => o.categorieId === categorieId);

  function handleCategorieChange(valeur: string) {
    if (valeur === VALEUR_NOUVELLE_CATEGORIE) {
      setCreationCategorieOuverte(true);
      setCategorieId("");
      setObjetId("");
      return;
    }
    setCategorieId(valeur);
    setObjetId("");
    setCreationCategorieOuverte(false);
  }

  function handleObjetChange(valeur: string) {
    if (valeur === VALEUR_NOUVEL_OBJET) {
      setCreationObjetOuverte(true);
      setObjetId("");
      return;
    }
    setObjetId(valeur);
  }

  function handleCreerCategorie() {
    const label = nouvelleCategorieLabel.trim();
    if (label.length < 2) return;
    startTransitionCreation(async () => {
      const result = await creerCategorieInlineAction(label);
      if (result.status === "success") {
        setCategoriesLocaux((prev) => [...prev, result.categorie]);
        setCategorieId(result.categorie.id);
        setObjetId("");
        setCreationCategorieOuverte(false);
        setNouvelleCategorieLabel("");
        toast.success(`Catégorie « ${result.categorie.label} » créée.`);
      } else {
        toast.error(result.message);
      }
    });
  }

  function handleCreerObjet() {
    const label = nouvelObjetLabel.trim();
    if (label.length < 2 || !categorieId) return;
    startTransitionCreation(async () => {
      const result = await creerObjetInlineAction(categorieId, label);
      if (result.status === "success") {
        setObjetsLocaux((prev) => [...prev, result.objet]);
        setObjetId(result.objet.id);
        setCreationObjetOuverte(false);
        setNouvelObjetLabel("");
        toast.success(`Objet « ${result.objet.label} » créé.`);
      } else {
        toast.error(result.message);
      }
    });
  }

  function handleEnregistrer() {
    if (!categorieId || !objetId) return;
    startTransition(async () => {
      const result = await categoriserLigneAction(ligne.id, categorieId, objetId);
      if (result.status === "success") {
        toast.success(result.message);
        setOuvert(false);
      } else {
        toast.error(result.message);
      }
    });
  }

  if (dejaDecidee) {
    return (
      <p className="text-foreground">
        {ligne.categorieLabel ?? "Non catégorisée"}
        {ligne.objetLabel ? ` / ${ligne.objetLabel}` : ""}
      </p>
    );
  }

  if (!ouvert) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-foreground">
          {ligne.categorieLabel ?? "Non catégorisée"}
          {ligne.objetLabel ? ` / ${ligne.objetLabel}` : ""}
        </span>
        {canCategoriser ? (
          <button
            type="button"
            className="text-xs font-medium text-info underline-offset-4 hover:text-primary hover:underline"
            onClick={() => {
              setCategorieId(ligne.categorieId ?? "");
              setObjetId(ligne.objetId ?? "");
              setOuvert(true);
            }}
          >
            {ligne.categorieId ? "Modifier" : "Catégoriser"}
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <div className="animate-fade-in-up space-y-2">
      <Select
        aria-label="Catégorie de la ligne"
        value={categorieId}
        onChange={(e) => handleCategorieChange(e.target.value)}
        placeholder="Sélectionner une catégorie..."
        options={[
          ...categoriesLocaux.map((c) => ({ value: c.id, label: c.label })),
          { value: VALEUR_NOUVELLE_CATEGORIE, label: "+ Ajouter une nouvelle catégorie" },
        ]}
      />
      {creationCategorieOuverte ? (
        <div className="space-y-2 rounded-md border border-border p-2">
          <Input
            aria-label="Nom de la nouvelle catégorie"
            placeholder="Nom de la catégorie"
            value={nouvelleCategorieLabel}
            onChange={(e) => setNouvelleCategorieLabel(e.target.value)}
          />
          <div className="flex flex-wrap gap-2">
            <Button type="button" loading={isPendingCreation} onClick={handleCreerCategorie}>
              Créer
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={isPendingCreation}
              onClick={() => {
                setCreationCategorieOuverte(false);
                setNouvelleCategorieLabel("");
              }}
            >
              Annuler
            </Button>
          </div>
        </div>
      ) : null}

      {categorieId && budgetParCategorie[categorieId] ? (
        <BudgetCategorieApercu info={budgetParCategorie[categorieId]} />
      ) : null}

      <Select
        aria-label="Objet de la ligne"
        value={objetId}
        disabled={!categorieId}
        onChange={(e) => handleObjetChange(e.target.value)}
        placeholder={categorieId ? "Sélectionner un objet..." : "Choisir d'abord une catégorie"}
        options={[
          ...objetsFiltres.map((o) => ({ value: o.id, label: o.label })),
          ...(categorieId ? [{ value: VALEUR_NOUVEL_OBJET, label: "+ Ajouter un nouvel objet" }] : []),
        ]}
      />
      {creationObjetOuverte ? (
        <div className="space-y-2 rounded-md border border-border p-2">
          <Input
            aria-label="Nom du nouvel objet"
            placeholder="Nom de l'objet"
            value={nouvelObjetLabel}
            onChange={(e) => setNouvelObjetLabel(e.target.value)}
          />
          <div className="flex flex-wrap gap-2">
            <Button type="button" loading={isPendingCreation} onClick={handleCreerObjet}>
              Créer
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={isPendingCreation}
              onClick={() => {
                setCreationObjetOuverte(false);
                setNouvelObjetLabel("");
              }}
            >
              Annuler
            </Button>
          </div>
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button type="button" loading={isPending} disabled={!categorieId || !objetId} onClick={handleEnregistrer}>
          Enregistrer
        </Button>
        <Button type="button" variant="secondary" disabled={isPending} onClick={() => setOuvert(false)}>
          Annuler
        </Button>
      </div>
    </div>
  );
}
