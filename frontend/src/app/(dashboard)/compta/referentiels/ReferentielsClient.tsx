"use client";

// Écrans des référentiels de Gestion Compta (lot GC-2c) : un formulaire générique (champs décrits par des données) et un
// gestionnaire générique (formulaire de création/modification + tableau), puis une configuration par référentiel.
// Les règles (validation, chevauchement, droits) sont revérifiées par les Server Actions : ici, uniquement la saisie et
// l'affichage des erreurs par champ.

import { useRouter } from "next/navigation";
import { useState, useTransition, type ReactNode } from "react";
import { toast } from "sonner";

import { Badge, Button, Card, DataTable, Input, Select } from "@/components/ui";
import type { DataTableColumn } from "@/components/ui";
import {
  BASES_CONVENTION_CPT,
  BRANCHES_CPT,
  FAITS_GENERATEURS_CPT,
  LIBELLE_BASE_CONVENTION_CPT,
  LIBELLE_BRANCHE_CPT,
  LIBELLE_FAIT_GENERATEUR_CPT,
  LIBELLE_MODE_REGLEMENT_CPT,
  LIBELLE_NATURE_CONTRAT_CPT,
  LIBELLE_NATURE_REMUNERATION_CPT,
  LIBELLE_TYPE_COMPTE_CPT,
  MODES_REGLEMENT_CPT,
  NATURES_CONTRAT_CPT,
  NATURES_REMUNERATION_CPT,
  TYPES_COMPTE_CPT,
  faitGenerateurSuggereCpt,
  fractionVersPourcentCpt,
} from "backend/client";

import {
  basculerCompteAction,
  basculerPartenaireAction,
  basculerProduitAction,
  cloturerConventionAction,
  creerClientAction,
  creerCompteAction,
  creerConventionAction,
  creerPartenaireAction,
  creerProduitAction,
  creerTauxTcaAction,
  modifierClientAction,
  modifierCompteAction,
  modifierPartenaireAction,
  modifierProduitAction,
  type ResultatReferentielCpt,
  type SaisieReferentielCpt,
} from "./actions";

// ---------- Formatage ----------

/** `AAAA-MM-JJ` → `JJ/MM/AAAA` (sans fuseau : la date est déjà celle du calendrier). */
function dateFr(iso: string | null): string {
  if (!iso) return "—";
  const [a, m, j] = iso.split("-");
  return `${j}/${m}/${a}`;
}

function pourcent(fraction: string): string {
  const p = fractionVersPourcentCpt(fraction);
  return p === null ? fraction : `${p} %`;
}

function options<T extends string>(valeurs: readonly T[], libelles: Record<T, string>) {
  return valeurs.map((v) => ({ value: v, label: libelles[v] }));
}

// ---------- Formulaire générique ----------

interface ChampDef {
  nom: string;
  libelle: string;
  type?: "texte" | "date" | "liste" | "cases";
  options?: { value: string; label: string }[];
  /** Pour `cases` : une case par entrée (nom du champ envoyé, libellé). */
  cases?: { nom: string; libelle: string }[];
  aide?: string;
  obligatoire?: boolean;
  /** Champ affiché mais non modifiable en édition (ex. code d'un produit existant). */
  verrouilleEnEdition?: boolean;
}

type Valeurs = SaisieReferentielCpt;

function FormulaireReferentiel(props: {
  titre: string;
  champs: ChampDef[];
  initiales: Valeurs;
  bouton: string;
  enEdition: boolean;
  onSoumettre: (valeurs: Valeurs) => Promise<ResultatReferentielCpt>;
  onSucces: () => void;
  onAnnuler?: () => void;
  /** Ajuste les valeurs quand un champ change (suggestions) ; ne retire jamais ce que l'utilisateur a saisi ailleurs. */
  surChangement?: (nom: string, valeurs: Valeurs) => Valeurs;
}) {
  const { titre, champs, initiales, bouton, enEdition, onSoumettre, onSucces, onAnnuler, surChangement } = props;
  const [valeurs, setValeurs] = useState<Valeurs>(initiales);
  const [erreurs, setErreurs] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [enCours, demarrer] = useTransition();

  function changer(nom: string, valeur: string) {
    setValeurs((v) => {
      const suivant = { ...v, [nom]: valeur };
      return surChangement ? surChangement(nom, suivant) : suivant;
    });
  }

  function soumettre(e: React.FormEvent) {
    e.preventDefault();
    setErreurs({});
    setMessage(null);
    demarrer(async () => {
      const r = await onSoumettre(valeurs);
      if (r.status === "error") {
        setErreurs(r.fieldErrors ?? {});
        setMessage(r.message);
        toast.error(r.message);
        return;
      }
      toast.success(r.message);
      setValeurs(initiales);
      onSucces();
    });
  }

  return (
    <Card className="space-y-4">
      <h2 className="text-base font-bold text-foreground">{titre}</h2>
      <form onSubmit={soumettre} className="grid gap-4 sm:grid-cols-2" data-formulaire-cpt={titre}>
        {champs.map((c) => {
          const erreur = erreurs[c.nom];
          const verrouille = enCours || (enEdition && c.verrouilleEnEdition);
          if (c.type === "liste") {
            return (
              <Select
                key={c.nom}
                label={c.libelle}
                required={c.obligatoire}
                hint={c.aide}
                error={erreur}
                value={valeurs[c.nom] ?? ""}
                options={c.options ?? []}
                disabled={verrouille}
                onChange={(e) => changer(c.nom, e.target.value)}
                name={c.nom}
              />
            );
          }
          if (c.type === "cases") {
            return (
              <fieldset key={c.nom} className="space-y-2 sm:col-span-2" data-champ={c.nom}>
                <legend className="text-sm font-medium text-foreground">{c.libelle}</legend>
                <div className="flex flex-wrap gap-x-6 gap-y-2">
                  {(c.cases ?? []).map((k) => (
                    <label key={k.nom} className="flex items-center gap-2 text-sm text-foreground">
                      <input
                        type="checkbox"
                        checked={valeurs[k.nom] === "true"}
                        disabled={enCours}
                        onChange={(e) => changer(k.nom, e.target.checked ? "true" : "")}
                        name={k.nom}
                      />
                      {k.libelle}
                    </label>
                  ))}
                </div>
                {erreur && (
                  <p role="alert" className="text-sm text-danger">
                    {erreur}
                  </p>
                )}
              </fieldset>
            );
          }
          return (
            <Input
              key={c.nom}
              label={c.libelle}
              type={c.type === "date" ? "date" : "text"}
              required={c.obligatoire}
              hint={c.aide}
              error={erreur}
              value={valeurs[c.nom] ?? ""}
              disabled={verrouille}
              onChange={(e) => changer(c.nom, e.target.value)}
              name={c.nom}
            />
          );
        })}
        <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
          <Button type="submit" loading={enCours}>
            {bouton}
          </Button>
          {onAnnuler && (
            <Button type="button" variant="secondary" onClick={onAnnuler} disabled={enCours}>
              Annuler
            </Button>
          )}
          {message && Object.keys(erreurs).length === 0 && (
            <p role="alert" className="text-sm text-danger">
              {message}
            </p>
          )}
        </div>
      </form>
    </Card>
  );
}

// ---------- Gestionnaire générique ----------

interface ConfigManager<T extends { id: string }> {
  nom: string;
  titreCreation: string;
  titreModification?: string;
  champs: ChampDef[];
  vide: Valeurs;
  lignes: T[];
  colonnes: DataTableColumn<T>[];
  messageVide: string;
  /** Peut créer / modifier / désactiver (droit du compte, revérifié par le serveur). */
  peutEcrire: boolean;
  creer?: (v: Valeurs) => Promise<ResultatReferentielCpt>;
  modifier?: (id: string, v: Valeurs) => Promise<ResultatReferentielCpt>;
  versSaisie?: (ligne: T) => Valeurs;
  basculer?: (id: string, actif: boolean) => Promise<ResultatReferentielCpt>;
  estActif?: (ligne: T) => boolean;
  actionsSupplementaires?: (ligne: T, rafraichir: () => void) => ReactNode;
  surChangement?: (nom: string, valeurs: Valeurs) => Valeurs;
}

function Manager<T extends { id: string }>(config: ConfigManager<T>) {
  const router = useRouter();
  const [edition, setEdition] = useState<T | null>(null);
  const [bascule, setBascule] = useState<string | null>(null);
  const rafraichir = () => router.refresh();

  async function basculer(ligne: T) {
    if (!config.basculer || !config.estActif) return;
    setBascule(ligne.id);
    try {
      const r = await config.basculer(ligne.id, !config.estActif(ligne));
      if (r.status === "error") toast.error(r.message);
      else {
        toast.success(r.message);
        rafraichir();
      }
    } finally {
      setBascule(null);
    }
  }

  const colonnes: DataTableColumn<T>[] = [...config.colonnes];
  if (config.estActif) {
    const estActif = config.estActif;
    colonnes.push({ key: "etat", header: "État", render: (l) => <Badge variant={estActif(l) ? "success" : "neutral"}>{estActif(l) ? "Actif" : "Désactivé"}</Badge> });
  }
  if (config.peutEcrire && (config.modifier || config.basculer || config.actionsSupplementaires)) {
    colonnes.push({
      key: "actions",
      header: "Actions",
      render: (l) => (
        <div className="flex flex-wrap items-center gap-2">
          {config.modifier && (
            <Button type="button" variant="secondary" onClick={() => setEdition(l)} data-action="modifier">
              Modifier
            </Button>
          )}
          {config.basculer && config.estActif && (
            <Button type="button" variant="secondary" loading={bascule === l.id} disabled={bascule !== null} onClick={() => void basculer(l)}>
              {config.estActif(l) ? "Désactiver" : "Réactiver"}
            </Button>
          )}
          {config.actionsSupplementaires?.(l, rafraichir)}
        </div>
      ),
    });
  }

  const modifier = config.modifier;
  return (
    <div className="space-y-6" data-referentiel={config.nom}>
      {config.peutEcrire && config.creer && !edition && (
        <FormulaireReferentiel
          titre={config.titreCreation}
          champs={config.champs}
          initiales={config.vide}
          bouton="Enregistrer"
          enEdition={false}
          onSoumettre={config.creer}
          onSucces={rafraichir}
          surChangement={config.surChangement}
        />
      )}
      {config.peutEcrire && edition && modifier && config.versSaisie && (
        <FormulaireReferentiel
          key={edition.id}
          titre={config.titreModification ?? "Modifier"}
          champs={config.champs}
          initiales={config.versSaisie(edition)}
          bouton="Enregistrer les modifications"
          enEdition
          onSoumettre={(v) => modifier(edition.id, v)}
          onSucces={() => {
            setEdition(null);
            rafraichir();
          }}
          onAnnuler={() => setEdition(null)}
          surChangement={config.surChangement}
        />
      )}
      {!config.peutEcrire && (
        <p className="rounded-xl border border-border bg-surface px-4 py-3 text-sm text-muted-foreground">
          Consultation seule : votre rôle ne permet pas de modifier cette liste.
        </p>
      )}
      <DataTable rowKey={(l) => l.id} data={config.lignes} columns={colonnes} emptyMessage={config.messageVide} />
    </div>
  );
}

// ---------- Partenaires ----------

export interface PartenaireRow {
  id: string;
  nom: string;
  estApporteur: boolean;
  estBeneficiaire: boolean;
  estGestionnaire: boolean;
  estClient: boolean;
  coordonnees: string | null;
  tiersOdoo: string | null;
  actif: boolean;
}

const VIDE_PARTENAIRE: Valeurs = { nom: "", estApporteur: "", estBeneficiaire: "", estGestionnaire: "", estClient: "", coordonnees: "", tiersOdoo: "" };

export function PartenairesManager({ lignes, peutEcrire }: { lignes: PartenaireRow[]; peutEcrire: boolean }) {
  return (
    <Manager<PartenaireRow>
      nom="partenaires"
      titreCreation="Ajouter un partenaire"
      titreModification="Modifier le partenaire"
      champs={[
        { nom: "nom", libelle: "Nom", obligatoire: true },
        {
          nom: "roles",
          libelle: "Rôles",
          type: "cases",
          cases: [
            { nom: "estApporteur", libelle: "Apporteur" },
            { nom: "estBeneficiaire", libelle: "Bénéficiaire de rémunération" },
            { nom: "estGestionnaire", libelle: "Gestionnaire" },
            { nom: "estClient", libelle: "Client" },
          ],
        },
        { nom: "coordonnees", libelle: "Coordonnées" },
        { nom: "tiersOdoo", libelle: "Tiers Odoo", aide: "Code du tiers dans Odoo (facultatif)." },
      ]}
      vide={VIDE_PARTENAIRE}
      lignes={lignes}
      peutEcrire={peutEcrire}
      messageVide="Aucun partenaire : ajoutez le premier."
      creer={creerPartenaireAction}
      modifier={modifierPartenaireAction}
      basculer={basculerPartenaireAction}
      estActif={(p) => p.actif}
      versSaisie={(p) => ({
        nom: p.nom,
        estApporteur: p.estApporteur ? "true" : "",
        estBeneficiaire: p.estBeneficiaire ? "true" : "",
        estGestionnaire: p.estGestionnaire ? "true" : "",
        estClient: p.estClient ? "true" : "",
        coordonnees: p.coordonnees ?? "",
        tiersOdoo: p.tiersOdoo ?? "",
      })}
      colonnes={[
        { key: "nom", header: "Nom", sortable: true, accessor: (p) => p.nom },
        {
          key: "roles",
          header: "Rôles",
          render: (p) =>
            [p.estApporteur && "Apporteur", p.estBeneficiaire && "Bénéficiaire", p.estGestionnaire && "Gestionnaire", p.estClient && "Client"].filter(Boolean).join(", ") || "—",
        },
        { key: "tiersOdoo", header: "Tiers Odoo", accessor: (p) => p.tiersOdoo ?? "—" },
      ]}
    />
  );
}

// ---------- Clients ----------

export interface ClientRow {
  id: string;
  nom: string;
  telephone: string | null;
  pieceIdentite: string | null;
  partenaireOrigineId: string | null;
  partenaireOrigineNom: string | null;
  tiersOdoo: string | null;
}

export function ClientsManager({ lignes, partenaires, peutEcrire }: { lignes: ClientRow[]; partenaires: { id: string; nom: string }[]; peutEcrire: boolean }) {
  return (
    <Manager<ClientRow>
      nom="clients"
      titreCreation="Ajouter un client"
      titreModification="Modifier le client"
      champs={[
        { nom: "nom", libelle: "Nom", obligatoire: true },
        { nom: "telephone", libelle: "Téléphone", aide: "8 à 15 chiffres, le + initial est admis." },
        { nom: "pieceIdentite", libelle: "Pièce d'identité" },
        {
          nom: "partenaireOrigineId",
          libelle: "Partenaire d'origine",
          type: "liste",
          options: [{ value: "", label: "Aucun" }, ...partenaires.map((p) => ({ value: p.id, label: p.nom }))],
        },
        { nom: "tiersOdoo", libelle: "Tiers Odoo" },
      ]}
      vide={{ nom: "", telephone: "", pieceIdentite: "", partenaireOrigineId: "", tiersOdoo: "" }}
      lignes={lignes}
      peutEcrire={peutEcrire}
      messageVide="Aucun client enregistré."
      creer={creerClientAction}
      modifier={modifierClientAction}
      versSaisie={(c) => ({ nom: c.nom, telephone: c.telephone ?? "", pieceIdentite: c.pieceIdentite ?? "", partenaireOrigineId: c.partenaireOrigineId ?? "", tiersOdoo: c.tiersOdoo ?? "" })}
      colonnes={[
        { key: "nom", header: "Nom", sortable: true, accessor: (c) => c.nom },
        { key: "telephone", header: "Téléphone", accessor: (c) => c.telephone ?? "—" },
        { key: "origine", header: "Partenaire d'origine", accessor: (c) => c.partenaireOrigineNom ?? "—" },
        { key: "tiersOdoo", header: "Tiers Odoo", accessor: (c) => c.tiersOdoo ?? "—" },
      ]}
    />
  );
}

// ---------- Produits ----------

export interface ProduitRow {
  id: string;
  code: string;
  libelle: string;
  branche: (typeof BRANCHES_CPT)[number];
  tarifReference: string | null;
  compteOdoo: string | null;
  actif: boolean;
}

export function ProduitsManager({ lignes, peutEcrire }: { lignes: ProduitRow[]; peutEcrire: boolean }) {
  return (
    <Manager<ProduitRow>
      nom="produits"
      titreCreation="Ajouter un produit"
      titreModification="Modifier le produit"
      champs={[
        { nom: "code", libelle: "Code", obligatoire: true, verrouilleEnEdition: true, aide: "Clé du produit, jamais modifiable (exemple : SECURPRO)." },
        { nom: "libelle", libelle: "Libellé", obligatoire: true },
        { nom: "branche", libelle: "Branche", type: "liste", obligatoire: true, options: [{ value: "", label: "Choisir…" }, ...options(BRANCHES_CPT, LIBELLE_BRANCHE_CPT)] },
        { nom: "tarifReference", libelle: "Tarif de référence (FCFA)", aide: "Facultatif." },
        { nom: "compteOdoo", libelle: "Compte Odoo", aide: "Facultatif." },
      ]}
      vide={{ code: "", libelle: "", branche: "", tarifReference: "", compteOdoo: "" }}
      lignes={lignes}
      peutEcrire={peutEcrire}
      messageVide="Aucun produit : ajoutez le premier."
      creer={creerProduitAction}
      modifier={modifierProduitAction}
      basculer={basculerProduitAction}
      estActif={(p) => p.actif}
      versSaisie={(p) => ({ code: p.code, libelle: p.libelle, branche: p.branche, tarifReference: p.tarifReference ?? "", compteOdoo: p.compteOdoo ?? "" })}
      colonnes={[
        { key: "code", header: "Code", sortable: true, accessor: (p) => p.code, render: (p) => <span className="font-mono text-sm">{p.code}</span> },
        { key: "libelle", header: "Libellé", sortable: true, accessor: (p) => p.libelle },
        { key: "branche", header: "Branche", accessor: (p) => LIBELLE_BRANCHE_CPT[p.branche] },
        { key: "tarif", header: "Tarif de référence", accessor: (p) => p.tarifReference ?? "—" },
        { key: "compteOdoo", header: "Compte Odoo", accessor: (p) => p.compteOdoo ?? "—" },
      ]}
    />
  );
}

// ---------- Comptes d'encaissement ----------

export interface CompteRow {
  id: string;
  libelle: string;
  type: (typeof TYPES_COMPTE_CPT)[number];
  journalOdoo: string | null;
  compteOdoo: string | null;
  actif: boolean;
}

export function ComptesManager({ lignes, peutEcrire }: { lignes: CompteRow[]; peutEcrire: boolean }) {
  return (
    <Manager<CompteRow>
      nom="comptes"
      titreCreation="Ajouter un compte d'encaissement"
      titreModification="Modifier le compte"
      champs={[
        { nom: "libelle", libelle: "Libellé", obligatoire: true },
        { nom: "type", libelle: "Type de compte", type: "liste", obligatoire: true, options: [{ value: "", label: "Choisir…" }, ...options(TYPES_COMPTE_CPT, LIBELLE_TYPE_COMPTE_CPT)] },
        { nom: "journalOdoo", libelle: "Journal Odoo" },
        { nom: "compteOdoo", libelle: "Compte Odoo" },
      ]}
      vide={{ libelle: "", type: "", journalOdoo: "", compteOdoo: "" }}
      lignes={lignes}
      peutEcrire={peutEcrire}
      messageVide="Aucun compte d'encaissement."
      creer={creerCompteAction}
      modifier={modifierCompteAction}
      basculer={basculerCompteAction}
      estActif={(c) => c.actif}
      versSaisie={(c) => ({ libelle: c.libelle, type: c.type, journalOdoo: c.journalOdoo ?? "", compteOdoo: c.compteOdoo ?? "" })}
      colonnes={[
        { key: "libelle", header: "Libellé", sortable: true, accessor: (c) => c.libelle },
        { key: "type", header: "Type", accessor: (c) => LIBELLE_TYPE_COMPTE_CPT[c.type] },
        { key: "journal", header: "Journal Odoo", accessor: (c) => c.journalOdoo ?? "—" },
        { key: "compteOdoo", header: "Compte Odoo", accessor: (c) => c.compteOdoo ?? "—" },
      ]}
    />
  );
}

// ---------- Taux de TCA ----------

export interface TauxRow {
  id: string;
  branche: (typeof BRANCHES_CPT)[number];
  produitCode: string | null;
  natureContrat: (typeof NATURES_CONTRAT_CPT)[number] | null;
  taux: string;
  dateEffet: string;
  etat: "REMPLACE" | "EN_VIGUEUR" | "A_VENIR";
}

const LIBELLE_ETAT_TAUX: Record<TauxRow["etat"], string> = { REMPLACE: "Remplacé", EN_VIGUEUR: "En vigueur", A_VENIR: "À venir" };
const VARIANTE_ETAT_TAUX: Record<TauxRow["etat"], "neutral" | "success" | "info"> = { REMPLACE: "neutral", EN_VIGUEUR: "success", A_VENIR: "info" };

export function TauxTcaManager({ lignes, produits, peutEcrire }: { lignes: TauxRow[]; produits: { code: string; libelle: string }[]; peutEcrire: boolean }) {
  return (
    <div className="space-y-4">
      <p className="rounded-xl border border-border bg-surface px-4 py-3 text-sm text-muted-foreground">
        Un taux ne se modifie jamais : pour le changer, ajoutez une nouvelle ligne avec sa date d&apos;effet. L&apos;ancienne reste visible comme « Remplacé ».
      </p>
      <Manager<TauxRow>
        nom="taux"
        titreCreation="Ajouter un taux de taxe"
        champs={[
          { nom: "branche", libelle: "Branche", type: "liste", obligatoire: true, options: [{ value: "", label: "Choisir…" }, ...options(BRANCHES_CPT, LIBELLE_BRANCHE_CPT)] },
          {
            nom: "produitCode",
            libelle: "Produit",
            type: "liste",
            aide: "« Tous » : le taux vaut pour toute la branche.",
            options: [{ value: "", label: "Tous les produits" }, ...produits.map((p) => ({ value: p.code, label: `${p.code} — ${p.libelle}` }))],
          },
          { nom: "natureContrat", libelle: "Nature du contrat", type: "liste", options: [{ value: "", label: "Toutes" }, ...options(NATURES_CONTRAT_CPT, LIBELLE_NATURE_CONTRAT_CPT)] },
          { nom: "taux", libelle: "Taux (%)", obligatoire: true, aide: "Exemple : 7,25 (quatre décimales au plus)." },
          { nom: "dateEffet", libelle: "Date d'effet", type: "date", obligatoire: true },
        ]}
        vide={{ branche: "", produitCode: "", natureContrat: "", taux: "", dateEffet: "" }}
        lignes={lignes}
        peutEcrire={peutEcrire}
        messageVide="Aucun taux de taxe : sans taux, le calcul de la taxe d'un contrat est signalé, jamais deviné à zéro."
        creer={creerTauxTcaAction}
        colonnes={[
          { key: "branche", header: "Branche", accessor: (t) => LIBELLE_BRANCHE_CPT[t.branche] },
          { key: "produit", header: "Produit", accessor: (t) => t.produitCode ?? "Tous" },
          { key: "nature", header: "Nature", accessor: (t) => (t.natureContrat ? LIBELLE_NATURE_CONTRAT_CPT[t.natureContrat] : "Toutes") },
          { key: "taux", header: "Taux", accessor: (t) => t.taux, render: (t) => <span className="font-bold tabular-nums">{pourcent(t.taux)}</span> },
          { key: "dateEffet", header: "Date d'effet", sortable: true, accessor: (t) => t.dateEffet, render: (t) => dateFr(t.dateEffet) },
          { key: "etat", header: "État", render: (t) => <Badge variant={VARIANTE_ETAT_TAUX[t.etat]}>{LIBELLE_ETAT_TAUX[t.etat]}</Badge> },
        ]}
      />
    </div>
  );
}

// ---------- Conventions ----------

export interface ConventionRow {
  id: string;
  partenaireId: string;
  partenaireNom: string;
  produitCode: string | null;
  nature: (typeof NATURES_REMUNERATION_CPT)[number];
  taux: string;
  base: (typeof BASES_CONVENTION_CPT)[number];
  faitGenerateur: (typeof FAITS_GENERATEURS_CPT)[number];
  apporteurNom: string | null;
  beneficiaireNom: string | null;
  modeReglement: (typeof MODES_REGLEMENT_CPT)[number];
  dateEffet: string;
  dateFin: string | null;
  etat: "A_VENIR" | "EN_COURS" | "CLOSE";
}

const LIBELLE_ETAT_CONVENTION: Record<ConventionRow["etat"], string> = { A_VENIR: "À venir", EN_COURS: "En cours", CLOSE: "Close" };
const VARIANTE_ETAT_CONVENTION: Record<ConventionRow["etat"], "neutral" | "success" | "info"> = { A_VENIR: "info", EN_COURS: "success", CLOSE: "neutral" };

function ClotureConvention({ ligne, rafraichir }: { ligne: ConventionRow; rafraichir: () => void }) {
  const [ouvert, setOuvert] = useState(false);
  const [date, setDate] = useState("");
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, demarrer] = useTransition();

  if (ligne.etat === "CLOSE") return null;
  if (!ouvert) {
    return (
      <Button type="button" variant="secondary" onClick={() => setOuvert(true)} data-action="cloturer">
        {ligne.dateFin ? "Changer la fin" : "Clôturer"}
      </Button>
    );
  }
  return (
    <div className="flex flex-wrap items-end gap-2">
      <Input label="Date de fin" type="date" value={date} onChange={(e) => setDate(e.target.value)} error={erreur ?? undefined} disabled={enCours} />
      <Button
        type="button"
        loading={enCours}
        disabled={!date}
        onClick={() =>
          demarrer(async () => {
            const r = await cloturerConventionAction(ligne.id, date);
            if (r.status === "error") {
              setErreur(r.fieldErrors?.dateFin ?? r.message);
              toast.error(r.message);
              return;
            }
            toast.success(r.message);
            setOuvert(false);
            rafraichir();
          })
        }
      >
        Confirmer
      </Button>
      <Button type="button" variant="secondary" onClick={() => setOuvert(false)} disabled={enCours}>
        Annuler
      </Button>
    </div>
  );
}

export function ConventionsManager({
  lignes,
  partenaires,
  produits,
  peutEcrire,
}: {
  lignes: ConventionRow[];
  partenaires: { id: string; nom: string; estGestionnaire: boolean }[];
  produits: { code: string; libelle: string }[];
  peutEcrire: boolean;
}) {
  const gestionnaires = new Set(partenaires.filter((p) => p.estGestionnaire).map((p) => p.id));
  const listePartenaires = partenaires.map((p) => ({ value: p.id, label: p.nom }));
  return (
    <div className="space-y-4">
      <p className="rounded-xl border border-border bg-surface px-4 py-3 text-sm text-muted-foreground">
        Une convention ne se modifie pas : seule sa date de fin peut être fixée. Pour changer un taux, clôturez la convention puis créez-en une nouvelle à partir du lendemain.
      </p>
      <Manager<ConventionRow>
        nom="conventions"
        titreCreation="Ajouter une convention de rémunération"
        champs={[
          { nom: "partenaireId", libelle: "Partenaire", type: "liste", obligatoire: true, options: [{ value: "", label: "Choisir…" }, ...listePartenaires] },
          { nom: "nature", libelle: "Nature", type: "liste", obligatoire: true, options: [{ value: "", label: "Choisir…" }, ...options(NATURES_REMUNERATION_CPT, LIBELLE_NATURE_REMUNERATION_CPT)] },
          {
            nom: "produitCode",
            libelle: "Produit",
            type: "liste",
            aide: "« Tous » : valable pour tous les produits ; un produit précis l'emporte.",
            options: [{ value: "", label: "Tous les produits" }, ...produits.map((p) => ({ value: p.code, label: `${p.code} — ${p.libelle}` }))],
          },
          { nom: "apporteurId", libelle: "Apporteur", type: "liste", options: [{ value: "", label: "Tout apporteur" }, ...listePartenaires] },
          { nom: "beneficiaireId", libelle: "Bénéficiaire (si autre que le partenaire)", type: "liste", options: [{ value: "", label: "Le partenaire lui-même" }, ...listePartenaires] },
          { nom: "taux", libelle: "Taux (%)", obligatoire: true, aide: "Exemple : 10 ou 7,25." },
          { nom: "base", libelle: "Base de calcul", type: "liste", obligatoire: true, options: [{ value: "", label: "Choisir…" }, ...options(BASES_CONVENTION_CPT, LIBELLE_BASE_CONVENTION_CPT)] },
          {
            nom: "faitGenerateur",
            libelle: "Fait générateur",
            type: "liste",
            obligatoire: true,
            aide: "Pour les honoraires, proposé selon l'apporteur ; vous pouvez le changer.",
            options: [{ value: "", label: "Choisir…" }, ...options(FAITS_GENERATEURS_CPT, LIBELLE_FAIT_GENERATEUR_CPT)],
          },
          { nom: "modeReglement", libelle: "Mode de règlement", type: "liste", obligatoire: true, options: [{ value: "", label: "Choisir…" }, ...options(MODES_REGLEMENT_CPT, LIBELLE_MODE_REGLEMENT_CPT)] },
          { nom: "dateEffet", libelle: "Date d'effet", type: "date", obligatoire: true },
          { nom: "dateFin", libelle: "Date de fin", type: "date", aide: "Facultative : vide = convention ouverte." },
        ]}
        vide={{ partenaireId: "", nature: "", produitCode: "", apporteurId: "", beneficiaireId: "", taux: "", base: "", faitGenerateur: "", modeReglement: "", dateEffet: "", dateFin: "" }}
        lignes={lignes}
        peutEcrire={peutEcrire}
        messageVide="Aucune convention : sans convention, la rémunération d'un partenaire n'est jamais calculée."
        creer={creerConventionAction}
        actionsSupplementaires={(l, rafraichir) => <ClotureConvention ligne={l} rafraichir={rafraichir} />}
        surChangement={(nom, v) => {
          if (nom !== "nature" && nom !== "apporteurId") return v;
          if (v.nature !== "HONORAIRES") return v;
          const suggere = faitGenerateurSuggereCpt("HONORAIRES", gestionnaires.has(v.apporteurId ?? ""));
          return suggere ? { ...v, faitGenerateur: suggere } : v;
        }}
        colonnes={[
          { key: "partenaire", header: "Partenaire", sortable: true, accessor: (c) => c.partenaireNom },
          { key: "nature", header: "Nature", accessor: (c) => LIBELLE_NATURE_REMUNERATION_CPT[c.nature] },
          { key: "portee", header: "Portée", render: (c) => `${c.produitCode ?? "Tous produits"} · ${c.apporteurNom ?? "tout apporteur"}` },
          { key: "taux", header: "Taux", accessor: (c) => c.taux, render: (c) => <span className="font-bold tabular-nums">{pourcent(c.taux)}</span> },
          { key: "base", header: "Base", render: (c) => `${LIBELLE_BASE_CONVENTION_CPT[c.base]} · ${LIBELLE_FAIT_GENERATEUR_CPT[c.faitGenerateur]}` },
          { key: "periode", header: "Période", accessor: (c) => c.dateEffet, render: (c) => `${dateFr(c.dateEffet)} → ${c.dateFin ? dateFr(c.dateFin) : "sans fin"}` },
          { key: "etat", header: "État", render: (c) => <Badge variant={VARIANTE_ETAT_CONVENTION[c.etat]}>{LIBELLE_ETAT_CONVENTION[c.etat]}</Badge> },
        ]}
      />
    </div>
  );
}
