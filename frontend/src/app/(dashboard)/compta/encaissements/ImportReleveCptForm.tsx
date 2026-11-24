"use client";

import { useRouter } from "next/navigation";
import { useId, useRef, useState, useTransition } from "react";
import { toast } from "sonner";

import { Icon } from "@/components/icons";
import { Button, Card, Select } from "@/components/ui";

import { importerReleveCptAction, type ResultatImportReleveCpt } from "./actions";

const EXTENSIONS = [".xlsx", ".xls", ".csv"];
const TAILLE_MAX_MO = 10;

export interface CompteImportable {
  id: string;
  libelle: string;
  typeLibelle: string;
}

interface FichierDepose {
  pieceJointeId: string;
  nomOrigine: string;
  taille: number;
}

/**
 * Dépôt puis import d'un relevé (lot GC-4e). Le compte est choisi AVANT : son type détermine le type de relevé et donc le format utilisé.
 * Deux temps volontaires, comme pour la production : le fichier est d'abord déposé (route dédiée, qui contrôle la taille et le type réel),
 * puis l'import est lancé par un second clic — l'utilisateur voit ce qu'il va importer avant d'écrire quoi que ce soit en base.
 */
export function ImportReleveCptForm({ comptes }: { comptes: CompteImportable[] }) {
  const router = useRouter();
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [compteId, setCompteId] = useState("");
  const [fichier, setFichier] = useState<FichierDepose | null>(null);
  const [depotEnCours, setDepotEnCours] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [resultat, setResultat] = useState<Extract<ResultatImportReleveCpt, { status: "success" }> | null>(null);
  const [importEnCours, startImport] = useTransition();

  async function deposer(f: File) {
    setErreur(null);
    setResultat(null);
    setFichier(null);
    if (!EXTENSIONS.some((ext) => f.name.toLowerCase().endsWith(ext))) {
      setErreur("Type de fichier non autorisé : .xlsx, .xls ou .csv uniquement.");
      return;
    }
    if (f.size > TAILLE_MAX_MO * 1024 * 1024) {
      setErreur(`Le fichier dépasse la taille maximale autorisée (${TAILLE_MAX_MO} Mo).`);
      return;
    }
    setDepotEnCours(true);
    try {
      const corps = new FormData();
      corps.append("file", f);
      const reponse = await fetch("/api/compta/import/upload", { method: "POST", body: corps });
      const json = (await reponse.json().catch(() => ({}))) as { pieceJointeId?: string; nomOrigine?: string; taille?: number; error?: string };
      if (!reponse.ok || !json.pieceJointeId) {
        setErreur(json.error ?? "Le dépôt du fichier a échoué.");
        return;
      }
      setFichier({ pieceJointeId: json.pieceJointeId, nomOrigine: json.nomOrigine ?? f.name, taille: json.taille ?? f.size });
    } catch {
      setErreur("Le dépôt du fichier a échoué (connexion interrompue ?). Réessayez.");
    } finally {
      setDepotEnCours(false);
    }
  }

  function changerDeFichier() {
    setFichier(null);
    setErreur(null);
    setResultat(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  function lancerImport() {
    if (!fichier || !compteId) return;
    setErreur(null);
    startImport(async () => {
      const r = await importerReleveCptAction(compteId, fichier.pieceJointeId);
      if (r.status === "error") {
        setErreur(r.message);
        toast.error(r.message);
        return;
      }
      toast.success(r.message);
      setResultat(r);
      setFichier(null);
      if (inputRef.current) inputRef.current.value = "";
      router.refresh();
    });
  }

  const peutLancer = fichier !== null && compteId !== "" && !importEnCours;

  return (
    <Card className="space-y-5">
      <div>
        <h2 data-import-releve-cpt className="text-base font-bold text-foreground">
          Importer un relevé
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Relevé d&apos;un compte d&apos;encaissement (.xlsx, .xls ou .csv, {TAILLE_MAX_MO} Mo au plus). Un même fichier ne s&apos;importe qu&apos;une fois et une
          ligne déjà connue du compte n&apos;est jamais recréée : un relevé réexporté peut donc se recouvrir sans risque.
        </p>
      </div>

      <div className="max-w-md">
        <Select
          label="Compte du relevé"
          name="compte"
          required
          value={compteId}
          onChange={(e) => setCompteId(e.target.value)}
          placeholder="Choisir le compte…"
          options={comptes.map((c) => ({ value: c.id, label: `${c.libelle} — ${c.typeLibelle}` }))}
          disabled={importEnCours}
          data-import-releve-compte
        />
      </div>

      {fichier === null ? (
        <label
          htmlFor={inputId}
          className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border bg-muted/40 px-4 py-8 text-center transition-colors hover:border-primary/60 ${
            depotEnCours ? "pointer-events-none opacity-70" : ""
          }`}
        >
          <span className="grid size-11 place-items-center rounded-full bg-primary text-primary-foreground">
            <Icon name={depotEnCours ? "loader" : "wallet"} className={`size-5 ${depotEnCours ? "animate-spin" : ""}`} />
          </span>
          <span className="text-sm font-semibold text-foreground">{depotEnCours ? "Dépôt du fichier…" : "Choisir le relevé"}</span>
          <span className="text-xs text-muted-foreground">Touchez ou cliquez pour sélectionner un fichier</span>
          <input
            ref={inputRef}
            id={inputId}
            type="file"
            accept=".xlsx,.xls,.csv"
            className="sr-only"
            disabled={depotEnCours}
            data-import-releve-fichier
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void deposer(f);
            }}
          />
        </label>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-muted/40 px-4 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <span className="grid size-9 shrink-0 place-items-center rounded-full bg-success-bg text-success">
              <Icon name="circle-check" className="size-5" />
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-foreground">{fichier.nomOrigine}</p>
              <p className="text-xs text-muted-foreground">{Math.max(1, Math.round(fichier.taille / 1024)).toLocaleString("fr-FR")} Ko · déposé, pas encore importé</p>
            </div>
          </div>
          <Button variant="secondary" type="button" onClick={changerDeFichier} disabled={importEnCours}>
            Changer de fichier
          </Button>
        </div>
      )}

      {erreur && (
        <div role="alert" data-import-releve-erreur className="flex items-start gap-2 rounded-lg border border-danger/40 bg-danger/5 px-4 py-3 text-sm text-danger">
          <Icon name="alert-triangle" className="mt-0.5 size-4 shrink-0" />
          <span>{erreur}</span>
        </div>
      )}

      {importEnCours && (
        <div role="status" className="flex items-start gap-3 rounded-lg border border-info/30 bg-info-bg px-4 py-3 text-sm text-info">
          <Icon name="loader" className="mt-0.5 size-4 shrink-0 animate-spin" />
          <span>Import en cours — gardez cette page ouverte, le bilan s&apos;affichera ici.</span>
        </div>
      )}

      {resultat && (
        <div role="status" data-import-releve-bilan className="space-y-2 rounded-lg border border-success/30 bg-success-bg px-4 py-3 text-sm text-success">
          <p className="font-semibold">{resultat.message}</p>
          <ul className="grid gap-x-6 gap-y-1 text-foreground sm:grid-cols-2">
            <li>{resultat.bilan.lignesLues.toLocaleString("fr-FR")} ligne(s) lue(s)</li>
            <li>{resultat.bilan.encaissementsCrees.toLocaleString("fr-FR")} encaissement(s) créé(s)</li>
            <li>{resultat.bilan.lignesDejaImportees.toLocaleString("fr-FR")} ligne(s) déjà importée(s)</li>
            <li>{resultat.bilan.lignesRejetees.toLocaleString("fr-FR")} ligne(s) rejetée(s)</li>
            <li>{resultat.bilan.virementsApparies.toLocaleString("fr-FR")} virement(s) interne(s) reconnu(s)</li>
            <li>{resultat.bilan.anomaliesCreees.toLocaleString("fr-FR")} anomalie(s) à traiter</li>
          </ul>
        </div>
      )}

      <div className="flex justify-end">
        <Button type="button" onClick={lancerImport} disabled={!peutLancer} loading={importEnCours} data-import-releve-lancer>
          {importEnCours ? "Import en cours…" : "Lancer l'import"}
        </Button>
      </div>
    </Card>
  );
}
