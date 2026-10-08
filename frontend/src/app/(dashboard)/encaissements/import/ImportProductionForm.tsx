"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useRef, useState, useTransition } from "react";
import { toast } from "sonner";

import { Icon } from "@/components/icons";
import { Button, Card, Select } from "@/components/ui";

import { importerProductionAction, inspecterFichierProductionAction } from "./actions";

const EXTENSIONS = [".xlsx", ".xls", ".csv"];
const TAILLE_MAX = 10 * 1024 * 1024;

interface FichierDepose {
  url: string;
  nomOrigine: string;
  nbLignes: number;
  brancheColonnePresente: boolean;
}

export function ImportProductionForm({
  branches,
  peutGererBranches,
}: {
  branches: { code: string; libelle: string }[];
  peutGererBranches: boolean;
}) {
  const router = useRouter();
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [fichier, setFichier] = useState<FichierDepose | null>(null);
  const [depotEnCours, setDepotEnCours] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [branche, setBranche] = useState("");
  const [importEnCours, startImport] = useTransition();

  const brancheRequise = fichier !== null && !fichier.brancheColonnePresente;
  const aucuneBranche = branches.length === 0;
  const peutLancer = fichier !== null && !importEnCours && (!brancheRequise || branche !== "");

  async function deposer(f: File) {
    setErreur(null);
    setFichier(null);
    setBranche("");
    if (!EXTENSIONS.some((ext) => f.name.toLowerCase().endsWith(ext))) {
      setErreur("Type de fichier non autorisé : .xlsx, .xls ou .csv uniquement.");
      return;
    }
    if (f.size > TAILLE_MAX) {
      setErreur("Le fichier dépasse la taille maximale autorisée (10 Mo).");
      return;
    }
    setDepotEnCours(true);
    try {
      const corps = new FormData();
      corps.append("file", f);
      const reponse = await fetch("/api/encaissements/import/upload", { method: "POST", body: corps });
      const json = (await reponse.json().catch(() => ({}))) as { url?: string; error?: string };
      if (!reponse.ok || !json.url) {
        setErreur(json.error ?? "Le dépôt du fichier a échoué.");
        return;
      }
      const inspection = await inspecterFichierProductionAction(json.url);
      if (inspection.status === "error") {
        setErreur(inspection.message);
        return;
      }
      setFichier({ url: json.url, nomOrigine: f.name, nbLignes: inspection.nbLignes, brancheColonnePresente: inspection.brancheColonnePresente });
    } catch {
      setErreur("Le dépôt du fichier a échoué (connexion interrompue ?). Réessayez.");
    } finally {
      setDepotEnCours(false);
    }
  }

  function changerDeFichier() {
    setFichier(null);
    setErreur(null);
    setBranche("");
    if (inputRef.current) inputRef.current.value = "";
  }

  function lancerImport() {
    if (!fichier) return;
    setErreur(null);
    startImport(async () => {
      const resultat = await importerProductionAction({
        url: fichier.url,
        nomOrigine: fichier.nomOrigine,
        brancheParDefaut: brancheRequise ? branche : null,
      });
      if (resultat.status === "error") {
        setErreur(resultat.message);
        toast.error(resultat.message);
        return;
      }
      toast.success(resultat.message);
      router.push(`/encaissements/import/${resultat.importId}`);
    });
  }

  return (
    <Card className="space-y-5">
      <div>
        <h2 className="text-base font-bold text-foreground">Nouvel import</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Fichier de production mensuel (.xlsx, .xls ou .csv, 10 Mo au plus). Les paiements importés restent « à confirmer ».
        </p>
      </div>

      {fichier === null ? (
        <label
          htmlFor={inputId}
          className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border bg-muted/40 px-4 py-8 text-center transition-colors hover:border-primary/60 ${
            depotEnCours ? "pointer-events-none opacity-70" : ""
          }`}
        >
          <span className="grid size-11 place-items-center rounded-full bg-primary text-primary-foreground">
            <Icon name={depotEnCours ? "loader" : "file-text"} className={`size-5 ${depotEnCours ? "animate-spin" : ""}`} />
          </span>
          <span className="text-sm font-semibold text-foreground">
            {depotEnCours ? "Dépôt et lecture du fichier…" : "Choisir le fichier de production"}
          </span>
          <span className="text-xs text-muted-foreground">Touchez ou cliquez pour sélectionner un fichier</span>
          <input
            ref={inputRef}
            id={inputId}
            type="file"
            accept=".xlsx,.xls,.csv"
            className="sr-only"
            disabled={depotEnCours}
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
              <p className="text-xs text-muted-foreground">
                {fichier.nbLignes.toLocaleString("fr-FR")} ligne(s) lue(s) ·{" "}
                {fichier.brancheColonnePresente ? "colonne « Branche » présente" : "sans colonne « Branche »"}
              </p>
            </div>
          </div>
          <Button variant="secondary" type="button" onClick={changerDeFichier} disabled={importEnCours}>
            Changer de fichier
          </Button>
        </div>
      )}

      {brancheRequise &&
        (aucuneBranche ? (
          <div role="alert" className="rounded-lg border border-warning/40 bg-warning-bg px-4 py-3 text-sm text-warning">
            Ce fichier n&apos;a pas de colonne « Branche » et aucune branche active n&apos;existe encore : l&apos;import est
            impossible.{" "}
            {peutGererBranches ? (
              <Link href="/encaissements/branches" className="font-semibold underline">
                Créer une branche
              </Link>
            ) : (
              "Demandez à la Finance de créer une branche."
            )}
          </div>
        ) : (
          <Select
            label="Branche de toutes les lignes"
            hint="Le fichier n'a pas de colonne « Branche » : choisissez celle qui s'applique à toutes ses lignes."
            required
            placeholder="Choisir une branche…"
            value={branche}
            onChange={(e) => setBranche(e.target.value)}
            disabled={importEnCours}
            options={branches.map((b) => ({ value: b.code, label: `${b.libelle} (${b.code})` }))}
          />
        ))}

      {erreur && (
        <div role="alert" className="flex items-start gap-2 rounded-lg border border-danger/40 bg-danger/5 px-4 py-3 text-sm text-danger">
          <Icon name="alert-triangle" className="mt-0.5 size-4 shrink-0" />
          <span>{erreur}</span>
        </div>
      )}

      {importEnCours && (
        <div role="status" className="flex items-start gap-3 rounded-lg border border-info/30 bg-info-bg px-4 py-3 text-sm text-info">
          <Icon name="loader" className="mt-0.5 size-4 shrink-0 animate-spin" />
          <span>
            Import en cours — jusqu&apos;à environ une minute pour 5 000 lignes. Gardez cette page ouverte : le rapport
            s&apos;affichera automatiquement.
          </span>
        </div>
      )}

      <div className="flex justify-end">
        <Button type="button" onClick={lancerImport} disabled={!peutLancer} loading={importEnCours}>
          {importEnCours ? "Import en cours…" : "Lancer l'import"}
        </Button>
      </div>
    </Card>
  );
}
