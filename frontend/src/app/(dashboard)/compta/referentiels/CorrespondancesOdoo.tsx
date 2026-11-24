"use client";

// Onglet « Correspondances Odoo » des référentiels de Gestion Compta (lot GC-2e) : tiers, compte et journal Odoo de chaque
// partenaire, client, produit et compte d'encaissement, avec ce qui manque en tête. Ici : saisie et affichage seulement ; le
// droit (`cpt.parametrer`), la validation et l'audit sont revérifiés par `modifierCorrespondanceOdooAction`.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Badge, Button, Card, Input } from "@/components/ui";
import { CHAMPS_ODOO_CPT, LIBELLE_ENTITE_ODOO_CPT, type EntiteOdooCpt, type ResumeOdooCpt } from "backend/client";

import { modifierCorrespondanceOdooAction } from "./actions";

export interface LigneOdooRow {
  id: string;
  libelle: string;
  /** Précision sous le libellé (code du produit, type de compte, téléphone…). */
  detail: string;
  actif: boolean;
  /** Valeurs actuelles des champs Odoo de l'entité (texte vide = non renseigné). */
  valeurs: Record<string, string>;
  /** Libellés des champs Odoo non renseignés (vide = correspondance complète). */
  manquants: string[];
}

export interface SectionOdoo {
  entite: EntiteOdooCpt;
  resume: ResumeOdooCpt;
  lignes: LigneOdooRow[];
  /** Plus de fiches que celles affichées : la liste est tronquée (les manquantes d'abord). */
  tronque: boolean;
}

const normaliser = (texte: string | undefined) => (texte ?? "").replace(/\s+/g, " ").trim();

function LigneOdoo({ entite, ligne, peutEcrire }: { entite: EntiteOdooCpt; ligne: LigneOdooRow; peutEcrire: boolean }) {
  const router = useRouter();
  const champs = CHAMPS_ODOO_CPT[entite];
  const [valeurs, setValeurs] = useState<Record<string, string>>(ligne.valeurs);
  const [erreurs, setErreurs] = useState<Record<string, string>>({});
  const [enCours, demarrer] = useTransition();
  const modifie = champs.some(({ champ }) => normaliser(valeurs[champ]) !== normaliser(ligne.valeurs[champ]));
  const complet = ligne.manquants.length === 0;

  function enregistrer(e: React.FormEvent) {
    e.preventDefault();
    demarrer(async () => {
      const r = await modifierCorrespondanceOdooAction(entite, ligne.id, valeurs);
      if (r.status === "success") {
        setErreurs({});
        toast.success(r.message);
        router.refresh();
      } else {
        setErreurs(r.fieldErrors ?? {});
        toast.error(r.message);
      }
    });
  }

  return (
    <form
      onSubmit={enregistrer}
      data-odoo-ligne={ligne.id}
      data-odoo-entite={entite}
      data-odoo-statut={complet ? "complet" : "a-completer"}
      className="grid gap-3 border-b border-border py-3 last:border-b-0 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_auto] lg:items-end"
    >
      <div className="min-w-0 space-y-1">
        <p className="break-words text-sm font-medium text-foreground">{ligne.libelle}</p>
        {ligne.detail && <p className="break-words text-xs text-muted-foreground">{ligne.detail}</p>}
        <div className="flex flex-wrap gap-2">
          {complet ? <Badge variant="success">Complet</Badge> : <Badge variant="warning">À compléter : {ligne.manquants.join(", ")}</Badge>}
          {!ligne.actif && <Badge variant="neutral">Désactivé</Badge>}
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {champs.map(({ champ, libelle, max }) => (
          <Input
            key={champ}
            name={champ}
            label={libelle}
            maxLength={max + 20}
            value={valeurs[champ] ?? ""}
            error={erreurs[champ]}
            disabled={!peutEcrire || enCours}
            onChange={(ev) => setValeurs((v) => ({ ...v, [champ]: ev.target.value }))}
          />
        ))}
      </div>
      {peutEcrire && (
        <Button type="submit" loading={enCours} disabled={!modifie}>
          Enregistrer
        </Button>
      )}
    </form>
  );
}

export function CorrespondancesOdoo({
  sections,
  peutEcrire,
  manquantesSeulement,
  hrefTout,
  hrefManquantes,
}: {
  sections: SectionOdoo[];
  peutEcrire: boolean;
  manquantesSeulement: boolean;
  hrefTout: string;
  hrefManquantes: string;
}) {
  const aCompleter = sections.reduce((somme, s) => somme + s.resume.aCompleter, 0);
  return (
    <div className="space-y-6" data-referentiel="odoo">
      <Card className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-bold text-foreground">Correspondances Odoo</h2>
            <p className="text-sm text-muted-foreground" data-odoo-a-completer={aCompleter}>
              {aCompleter === 0 ? "Toutes les fiches actives ont leur correspondance Odoo." : `${aCompleter} fiche${aCompleter > 1 ? "s" : ""} active${aCompleter > 1 ? "s" : ""} à compléter avant l'export vers Odoo.`}
            </p>
          </div>
          <nav aria-label="Filtre des correspondances" className="flex gap-2">
            <Link
              href={hrefTout}
              data-odoo-filtre="tout"
              aria-current={manquantesSeulement ? undefined : "page"}
              className={`rounded-lg border px-3 py-1.5 text-sm font-medium ${manquantesSeulement ? "border-border bg-surface text-foreground hover:bg-muted" : "border-primary bg-primary text-primary-foreground"}`}
            >
              Toutes
            </Link>
            <Link
              href={hrefManquantes}
              data-odoo-filtre="manquantes"
              aria-current={manquantesSeulement ? "page" : undefined}
              className={`rounded-lg border px-3 py-1.5 text-sm font-medium ${manquantesSeulement ? "border-primary bg-primary text-primary-foreground" : "border-border bg-surface text-foreground hover:bg-muted"}`}
            >
              À compléter seulement
            </Link>
          </nav>
        </div>
        {!peutEcrire && <p className="text-sm text-muted-foreground">Consultation seule : la saisie des correspondances est réservée au paramétrage (permission « parametrer »).</p>}
      </Card>

      {sections.map((s) => (
        <Card key={s.entite} className="space-y-2">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-base font-bold text-foreground">{LIBELLE_ENTITE_ODOO_CPT[s.entite]}</h3>
            <p className="text-sm text-muted-foreground" data-odoo-resume={s.entite}>
              {s.resume.aCompleter} à compléter sur {s.resume.total}
            </p>
          </div>
          {s.lignes.length === 0 ? (
            <p className="py-4 text-sm text-muted-foreground" data-odoo-vide={s.entite}>
              {manquantesSeulement ? "Rien à compléter ici." : "Aucune fiche."}
            </p>
          ) : (
            <div data-odoo-section={s.entite}>
              {s.lignes.map((l) => (
                <LigneOdoo key={`${l.id}|${Object.values(l.valeurs).join("|")}`} entite={s.entite} ligne={l} peutEcrire={peutEcrire} />
              ))}
            </div>
          )}
          {s.tronque && <p className="text-xs text-muted-foreground">Seules les premières fiches sont affichées (les fiches à compléter d&apos;abord) : affinez avec la recherche rapide.</p>}
        </Card>
      ))}
    </div>
  );
}
