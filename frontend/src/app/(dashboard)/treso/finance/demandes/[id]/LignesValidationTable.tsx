"use client";

import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";

import { Icon } from "@/components/icons";
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
 * **Refonte visuelle en cartes** (Tâche "Refonte visuelle du tableau
 * Lignes d'articles", voir CLAUDE.md) — un tableau HTML classique
 * (défilement horizontal, colonnes serrées) a été remplacé par une carte
 * empilée par ligne (`LigneCard`), même langage visuel que
 * `FinanceActionCard`/le tableau de bord Finance modernisé
 * (`rounded-2xl`/`shadow-elevated`/`card-shadow-hover`) : plus aucun
 * défilement horizontal nécessaire, lisible nativement sur mobile.
 *
 * Deux modes, déterminés par la page appelante via `dejaDecidees`
 * (`lignes.every(l => l.statutValidation !== "EN_ATTENTE")`) — **jamais**
 * uniquement `demande.statut === "EN_ATTENTE_VALIDATION"` : si TOUTES les
 * lignes sont rejetées, `montantValide` retombe à 0 et
 * `calculerStatutDemande` (jamais modifiée) repasse la demande en
 * `EN_ATTENTE_VALIDATION` alors que ses lignes sont pourtant déjà toutes
 * décidées — seul un contrôle basé sur le statut de chaque ligne distingue
 * correctement ce cas d'une demande qui n'a encore reçu aucune décision.
 * - `dejaDecidees = false` : cartes interactives (catégorisation +
 *   décision + motif + total qui se recalcule en direct + bouton
 *   d'enregistrement unique).
 * - `dejaDecidees = true` : mêmes cartes, mais en lecture seule pour les
 *   blocs Catégorie/Objet et Décision, sans aucun contrôle.
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
 * `canValider`/`canModifierLibelle`) pilotent un bloc Catégorie/Objet PAR
 * LIGNE, verrouillé dès que `ligne.statutValidation !== "EN_ATTENTE"`
 * (`categoriserLigneAction` refuse de toute façon côté serveur) —
 * `CategorisationForm` reste utilisé tel quel UNIQUEMENT pour les
 * `DEPENSE_DIRECTE` (gate posé sur `categoriserDemandeAction`), jamais
 * affiché en même temps que ce tableau pour une même demande.
 *
 * **Budget disponible par ligne** (Tâche "Budget disponible en temps réel
 * par ligne catégorisée", voir CLAUDE.md) : dès qu'une catégorie est
 * sélectionnée ou déjà assignée sur une ligne, `BudgetCategorieApercu`
 * (réutilisée telle quelle, jamais un second composant) s'affiche à côté
 * du montant de CETTE ligne précise — `budgetParCategorie` est un
 * instantané calculé une fois par le serveur pour toutes les catégories
 * proposables (même convention que `CategorisationForm`, jamais
 * recalculé au changement de sélection) : basculer de catégorie sur une
 * ligne affiche instantanément l'aperçu de l'autre catégorie, sans
 * requête réseau ni rechargement, à partir de ce même instantané déjà en
 * mémoire.
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

      <div className="space-y-3">
        {lignes.map((ligne) => (
          <LigneCard
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

/**
 * Une ligne d'article, en carte — remplace l'ancienne ligne de `<table>`.
 * Même silhouette générale que `FinanceActionCard` (`rounded-2xl`,
 * `shadow-elevated`, `card-shadow-hover` + légère translation verticale au
 * survol — voir CLAUDE.md "Refonte visuelle du dashboard Finance" pour
 * pourquoi `hover:shadow-elevated-lg` ne compile pas dans ce projet et
 * pourquoi `card-shadow-hover` est la seule technique qui fonctionne),
 * jamais copiée telle quelle (celle-ci n'est ni cliquable ni un lien —
 * pas de `<Link>`, pas de `group-hover` sur un chevron).
 */
function LigneCard({
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
    <div className="card-shadow-hover relative rounded-2xl border border-border bg-surface p-4 shadow-elevated transition-transform duration-200 ease-out-strong motion-safe:hover:-translate-y-0.5 sm:p-5">
      {/* En-tête de carte : libellé + action Modifier, montant Total en face */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          {/* Même mécanique que `DescriptionEditor` : les deux versions
              restent visibles EN PERMANENCE dès qu'elles divergent. */}
          {ligne.libelleOriginal != null ? (
            <p className="mb-1 text-xs text-muted-foreground">
              Version initiale : <span className="italic">{ligne.libelleOriginal}</span>
            </p>
          ) : null}
          {!ouvertLibelle ? (
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="break-words text-base font-bold text-foreground">{ligne.libelle}</h3>
              {canModifierLibelle ? (
                <button
                  type="button"
                  disabled={!libelleModifiable}
                  className="inline-flex shrink-0 items-center gap-1 rounded-full border border-border px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:border-info hover:text-info disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-border disabled:hover:text-muted-foreground"
                  onClick={() => {
                    setValeurLibelle(ligne.libelle);
                    setOuvertLibelle(true);
                  }}
                >
                  <Icon name="pencil" className="size-3" />
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
          {/* Quantité / prix unitaire — informations secondaires, jamais en
              compétition visuelle avec le libellé/le total. */}
          <p className="mt-1.5 text-xs text-muted-foreground">
            <span className="font-medium text-foreground tabular-nums">{ligne.quantite}</span>
            {" × "}
            <span className="tabular-nums">{ligne.prixUnitaire.toLocaleString("fr-FR")} FCFA</span>
          </p>
        </div>

        <div className="shrink-0 text-right">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Total</p>
          <p className="text-xl font-black leading-tight tracking-tight tabular-nums text-foreground">
            {total.toLocaleString("fr-FR")} FCFA
          </p>
        </div>
      </div>

      {/* Corps de carte : Catégorie/Objet + Décision côte à côte (empilés en
          dessous du seuil `sm`, aucun défilement horizontal jamais requis). */}
      <div className="mt-4 grid grid-cols-1 gap-4 border-t border-border pt-4 sm:grid-cols-2">
        <div>
          <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Catégorie
          </p>
          <LigneCategorisationCell
            ligne={ligne}
            canCategoriser={canCategoriser}
            categories={categories}
            objets={objets}
            budgetParCategorie={budgetParCategorie}
          />
        </div>

        <div>
          <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            {dejaDecidee ? "Statut" : "Décision"}
          </p>
          {dejaDecidee ? (
            <div>
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
            </div>
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
        </div>
      </div>
    </div>
  );
}

/**
 * Le montant de CETTE ligne, affiché juste au-dessus de
 * `BudgetCategorieApercu` — Tâche "Budget disponible en temps réel par
 * ligne catégorisée" (voir CLAUDE.md) : lien visuel direct entre "cette
 * ligne vaut X FCFA" et "sa catégorie a Y FCFA de restant", jamais deux
 * informations dissociées à rapprocher mentalement.
 */
function LigneBudgetApercu({ montantLigne, info }: { montantLigne: number; info: BudgetCategorieInfo }) {
  return (
    <div className="mt-2 space-y-2 rounded-lg border border-border bg-muted/30 p-2.5">
      <div className="flex items-center justify-between gap-3 text-xs">
        <span className="font-medium text-muted-foreground">Montant de cette ligne</span>
        <span className="font-semibold tabular-nums text-foreground">
          {montantLigne.toLocaleString("fr-FR")} FCFA
        </span>
      </div>
      <BudgetCategorieApercu info={info} />
    </div>
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
 * ne s'affiche donc JAMAIS pour une ligne déjà décidée, seul un badge en
 * lecture seule (même principe que le bloc Statut).
 *
 * **Budget par ligne** — `LigneBudgetApercu` s'affiche dès qu'une
 * catégorie est retenue, dans les DEUX états (lecture seule ET édition) :
 * en édition, elle suit `categorieId` (l'état local du Select, pas
 * `ligne.categorieId`) pour se mettre à jour dès que Finance change de
 * catégorie, avant même d'enregistrer.
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
  const montantLigne = ligne.quantite * ligne.prixUnitaire;

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

  const badgeCategorie = (
    <span
      className={`inline-flex max-w-full items-center gap-1.5 truncate rounded-full px-2.5 py-1 text-xs font-semibold ${
        ligne.categorieId ? "bg-info-bg text-info" : "bg-muted text-muted-foreground"
      }`}
    >
      {ligne.categorieId ? (
        <>
          {ligne.categorieLabel}
          {ligne.objetLabel ? ` · ${ligne.objetLabel}` : ""}
        </>
      ) : (
        "Non catégorisée"
      )}
    </span>
  );

  if (dejaDecidee) {
    return <div className="flex flex-wrap items-center gap-2">{badgeCategorie}</div>;
  }

  if (!ouvert) {
    return (
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          {badgeCategorie}
          {canCategoriser ? (
            <button
              type="button"
              className="inline-flex shrink-0 items-center gap-1 rounded-full border border-border px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:border-info hover:text-info"
              onClick={() => {
                setCategorieId(ligne.categorieId ?? "");
                setObjetId(ligne.objetId ?? "");
                setOuvert(true);
              }}
            >
              <Icon name="pencil" className="size-3" />
              {ligne.categorieId ? "Modifier" : "Catégoriser"}
            </button>
          ) : null}
        </div>
        {ligne.categorieId && budgetParCategorie[ligne.categorieId] ? (
          <LigneBudgetApercu montantLigne={montantLigne} info={budgetParCategorie[ligne.categorieId]} />
        ) : null}
      </div>
    );
  }

  return (
    <div className="animate-fade-in-up space-y-2 rounded-xl border border-border bg-muted/30 p-3">
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
        <div className="space-y-2 rounded-md border border-border bg-surface p-2">
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
        <LigneBudgetApercu montantLigne={montantLigne} info={budgetParCategorie[categorieId]} />
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
        <div className="space-y-2 rounded-md border border-border bg-surface p-2">
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
