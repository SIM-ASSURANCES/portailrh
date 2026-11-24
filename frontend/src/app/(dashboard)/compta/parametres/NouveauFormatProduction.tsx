"use client";

import { useRouter } from "next/navigation";
import { useId, useRef, useState, useTransition } from "react";
import { toast } from "sonner";

import { Icon } from "@/components/icons";
import { Button, Card, Input, Select } from "@/components/ui";

import { apercuFormatProductionAction, creerFormatProductionAction } from "./actions";

import type { ColonneProposee } from "backend";

export interface ChampBordereau {
  champ: string;
  libelle: string;
  type: "texte" | "date" | "montant";
  obligatoire: boolean;
}

interface Choix {
  champ: string;
  formatDate: string;
}

/**
 * Création d'un format d'import de production à partir d'un fichier d'exemple : dépôt, lecture des en-têtes, association de chaque
 * colonne à un champ du bordereau (suggérée, toujours modifiable), ordre des dates, nom. Rien n'est enregistré avant « Enregistrer ».
 * Le serveur revérifie tout : droit, associations, champs obligatoires, ordre des dates.
 */
export function NouveauFormatProduction({ champs, formatsDate }: { champs: ChampBordereau[]; formatsDate: string[] }) {
  const router = useRouter();
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [ligneEntete, setLigneEntete] = useState("1");
  const [pieceJointeId, setPieceJointeId] = useState<string | null>(null);
  const [nomFichier, setNomFichier] = useState<string | null>(null);
  const [colonnes, setColonnes] = useState<ColonneProposee[] | null>(null);
  const [choix, setChoix] = useState<Record<number, Choix>>({});
  const [nom, setNom] = useState("");
  const [parDefaut, setParDefaut] = useState(false);
  const [depotEnCours, setDepotEnCours] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, startTransition] = useTransition();

  const ligne = Number(ligneEntete);
  const ligneValide = Number.isInteger(ligne) && ligne >= 1 && ligne <= 50;
  const defChamp = (code: string) => champs.find((c) => c.champ === code);

  function appliquerApercu(cols: ColonneProposee[]) {
    setColonnes(cols);
    setChoix(Object.fromEntries(cols.map((c) => [c.index, { champ: c.champ ?? "", formatDate: c.formatDate ?? "" }])));
  }

  async function lire(id: string) {
    setErreur(null);
    const r = await apercuFormatProductionAction(id, ligne);
    if (r.status === "error") {
      setColonnes(null);
      setErreur(r.message);
      return;
    }
    appliquerApercu(r.proposition.colonnes);
  }

  async function deposer(f: File) {
    setErreur(null);
    setColonnes(null);
    if (!ligneValide) {
      setErreur("La ligne des en-têtes doit être un entier de 1 à 50.");
      return;
    }
    setDepotEnCours(true);
    try {
      const corps = new FormData();
      corps.append("file", f);
      const reponse = await fetch("/api/compta/import/upload", { method: "POST", body: corps });
      const json = (await reponse.json().catch(() => ({}))) as { pieceJointeId?: string; nomOrigine?: string; error?: string };
      if (!reponse.ok || !json.pieceJointeId) {
        setErreur(json.error ?? "Le dépôt du fichier a échoué.");
        return;
      }
      setPieceJointeId(json.pieceJointeId);
      setNomFichier(json.nomOrigine ?? f.name);
      await lire(json.pieceJointeId);
    } catch {
      setErreur("Le dépôt du fichier a échoué (connexion interrompue ?). Réessayez.");
    } finally {
      setDepotEnCours(false);
    }
  }

  function modifier(index: number, partiel: Partial<Choix>) {
    setChoix((precedent) => {
      const courant = precedent[index] ?? { champ: "", formatDate: "" };
      const suivant = { ...courant, ...partiel };
      if (partiel.champ !== undefined && defChamp(partiel.champ)?.type !== "date") suivant.formatDate = "";
      return { ...precedent, [index]: suivant };
    });
  }

  const associes = colonnes ? colonnes.map((c) => choix[c.index]?.champ ?? "").filter((v) => v !== "") : [];
  const doublons = associes.filter((v, i) => associes.indexOf(v) !== i);
  const manquants = champs.filter((c) => c.obligatoire && !associes.includes(c.champ)).map((c) => c.libelle);
  const datesSansOrdre = colonnes
    ? colonnes.filter((c) => defChamp(choix[c.index]?.champ ?? "")?.type === "date" && !(choix[c.index]?.formatDate ?? "")).map((c) => c.entete)
    : [];
  const nomValide = nom.trim().length >= 3;
  const peutEnregistrer = colonnes !== null && manquants.length === 0 && doublons.length === 0 && datesSansOrdre.length === 0 && nomValide && ligneValide;

  function enregistrer() {
    if (!colonnes) return;
    setErreur(null);
    startTransition(async () => {
      const r = await creerFormatProductionAction({
        nom,
        ligneEntete: ligne,
        parDefaut,
        choix: colonnes.map((c) => ({ entete: c.entete, champ: choix[c.index]?.champ || null, formatDate: choix[c.index]?.formatDate || null })),
      });
      if (r.status === "error") {
        setErreur(r.message);
        toast.error(r.message);
        return;
      }
      toast.success(r.message);
      setColonnes(null);
      setPieceJointeId(null);
      setNomFichier(null);
      setNom("");
      setParDefaut(false);
      if (inputRef.current) inputRef.current.value = "";
      router.refresh();
    });
  }

  return (
    <Card className="space-y-5">
      <div>
        <h2 data-nouveau-format-production className="text-base font-bold text-foreground">
          Nouveau format de bordereau de production
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Déposez un fichier d&apos;exemple (.xlsx, .xls ou .csv) : les colonnes sont associées aux champs du bordereau, vous corrigez au besoin. Un
          fichier d&apos;exemple n&apos;importe aucun contrat.
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-4">
        <div className="w-48">
          <Input
            name="ligneEntete"
            label="Ligne des en-têtes"
            type="number"
            min={1}
            max={50}
            value={ligneEntete}
            onChange={(e) => setLigneEntete(e.target.value)}
            hint="1 = la première ligne"
            disabled={depotEnCours || enCours}
          />
        </div>
        <label
          htmlFor={inputId}
          className={`flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-border bg-muted/40 px-4 py-2 text-sm font-semibold text-foreground hover:border-primary/60 ${
            depotEnCours ? "pointer-events-none opacity-70" : ""
          }`}
        >
          <Icon name={depotEnCours ? "loader" : "file-text"} className={`size-4 ${depotEnCours ? "animate-spin" : ""}`} />
          {depotEnCours ? "Lecture du fichier…" : nomFichier ? "Choisir un autre fichier" : "Choisir le fichier d'exemple"}
          <input
            ref={inputRef}
            id={inputId}
            type="file"
            accept=".xlsx,.xls,.csv"
            className="sr-only"
            disabled={depotEnCours}
            data-format-fichier
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void deposer(f);
            }}
          />
        </label>
        {pieceJointeId && colonnes && (
          <Button type="button" variant="secondary" disabled={depotEnCours || !ligneValide} onClick={() => lire(pieceJointeId)} data-format-relire>
            Relire avec cette ligne d&apos;en-têtes
          </Button>
        )}
      </div>
      {nomFichier && <p className="text-xs text-muted-foreground">Fichier : {nomFichier}</p>}

      {erreur && (
        <div role="alert" data-format-erreur className="flex items-start gap-2 rounded-lg border border-danger/40 bg-danger/5 px-4 py-3 text-sm text-danger">
          <Icon name="alert-triangle" className="mt-0.5 size-4 shrink-0" />
          <span>{erreur}</span>
        </div>
      )}

      {colonnes && (
        <>
          <div className="overflow-x-auto rounded-xl border border-border" data-format-colonnes>
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="border-b border-border bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-3 py-2">Colonne du fichier</th>
                  <th className="px-3 py-2">Exemples</th>
                  <th className="px-3 py-2">Champ du bordereau</th>
                  <th className="px-3 py-2">Ordre de la date</th>
                </tr>
              </thead>
              <tbody>
                {colonnes.map((c) => {
                  const choisi = choix[c.index] ?? { champ: "", formatDate: "" };
                  const estDate = defChamp(choisi.champ)?.type === "date";
                  return (
                    <tr key={c.index} className="border-b border-border last:border-0" data-format-colonne={c.entete}>
                      <td className="px-3 py-2 font-semibold text-foreground">{c.entete}</td>
                      <td className="max-w-64 truncate px-3 py-2 text-muted-foreground">{c.echantillon.filter((v) => v !== "").slice(0, 3).join(" · ") || "—"}</td>
                      <td className="px-3 py-2">
                        <Select
                          aria-label={`Champ du bordereau pour la colonne ${c.entete}`}
                          value={choisi.champ}
                          onChange={(e) => modifier(c.index, { champ: e.target.value })}
                          options={[
                            { value: "", label: "— Ignorer cette colonne —" },
                            ...champs.map((d) => ({ value: d.champ, label: `${d.libelle}${d.obligatoire ? " *" : ""}` })),
                          ]}
                        />
                      </td>
                      <td className="px-3 py-2">
                        {estDate ? (
                          <Select
                            aria-label={`Ordre de la date pour la colonne ${c.entete}`}
                            value={choisi.formatDate}
                            onChange={(e) => modifier(c.index, { formatDate: e.target.value })}
                            options={[{ value: "", label: "À choisir…" }, ...formatsDate.map((f) => ({ value: f, label: f }))]}
                          />
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <ul className="space-y-1 text-sm" data-format-controles>
            {manquants.length > 0 && <li className="text-danger">Champs obligatoires sans colonne : {manquants.join(", ")}.</li>}
            {doublons.length > 0 && <li className="text-danger">Un même champ est associé à plusieurs colonnes.</li>}
            {datesSansOrdre.length > 0 && <li className="text-danger">Choisissez l&apos;ordre de la date : {datesSansOrdre.join(", ")}.</li>}
            {peutEnregistrer && <li className="text-success">Associations complètes.</li>}
          </ul>

          <div className="flex flex-wrap items-end gap-4">
            <div className="min-w-64 flex-1">
              <Input name="nomFormat" label="Nom du format" required value={nom} onChange={(e) => setNom(e.target.value)} placeholder="Ex. Bordereau Courtier A 2027" maxLength={80} disabled={enCours} />
            </div>
            <label className="flex items-center gap-2 pb-2 text-sm text-foreground">
              <input type="checkbox" checked={parDefaut} onChange={(e) => setParDefaut(e.target.checked)} disabled={enCours} data-format-par-defaut />
              Définir comme format par défaut
            </label>
            <Button type="button" onClick={enregistrer} disabled={!peutEnregistrer || enCours} loading={enCours} data-format-enregistrer>
              Enregistrer le format
            </Button>
          </div>
        </>
      )}
    </Card>
  );
}
