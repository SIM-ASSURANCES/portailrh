"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Badge, Button, Input, Textarea } from "@/components/ui";
import {
  MOTIF_LEVEE_MAX,
  MOTIF_LEVEE_MIN,
  PHRASE_LEVEE_VERROU,
  PHRASE_PURGE,
  lignesEtapes,
  motifLeveeValide,
  type EtatEtapes,
  type IdEtape,
  type StatutEtape,
} from "backend/client";

import { leverVerrouAction, reinitialiserAction, simulerAction } from "./actions";

/** Forme de la simulation renvoyée par le serveur (sérialisable). */
interface LigneDecompte {
  table: string;
  nombre: number;
  note: string | null;
}
interface Simulation {
  supprime: LigneDecompte[];
  conserve: LigneDecompte[];
  totalSupprime: number;
  fichiers: number;
  caisse: { lignes: number; solde: number };
  encEnService: boolean;
  verrouActif: boolean;
}

const nombre = new Intl.NumberFormat("fr-FR");

const VARIANTE_STATUT: Record<StatutEtape, "success" | "warning" | "neutral"> = {
  FAITE: "success",
  ACTIVE: "warning",
  BLOQUEE: "neutral",
  NON_APPLICABLE: "neutral",
};
const LIBELLE_STATUT: Record<StatutEtape, string> = {
  FAITE: "Faite",
  ACTIVE: "À faire",
  BLOQUEE: "Bloquée",
  NON_APPLICABLE: "Sans objet",
};

function EnTeteEtape({ id, titre, statut }: { id: IdEtape; titre: string; statut: StatutEtape }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h2 className="text-sm font-bold text-foreground" data-etape-titre={id}>
        {titre}
      </h2>
      <Badge variant={VARIANTE_STATUT[statut]}>
        <span data-etape-statut={id}>{LIBELLE_STATUT[statut]}</span>
      </Badge>
    </div>
  );
}

function TableauDecompte({ titre, lignes, vide }: { titre: string; lignes: LigneDecompte[]; vide: string }) {
  const visibles = lignes.filter((l) => l.nombre > 0);
  return (
    <details className="rounded-md border border-border bg-app-bg p-3">
      <summary className="cursor-pointer text-xs font-semibold text-foreground">
        {titre} ({lignes.length} table(s), {nombre.format(lignes.reduce((a, l) => a + l.nombre, 0))} ligne(s))
      </summary>
      {visibles.length === 0 ? (
        <p className="mt-2 text-xs text-muted-foreground">{vide}</p>
      ) : null}
      <ul className="mt-2 grid grid-cols-1 gap-x-6 gap-y-1 text-xs sm:grid-cols-2">
        {lignes.map((l) => (
          <li key={l.table} className="flex justify-between gap-3 border-b border-border py-0.5" title={l.note ?? undefined}>
            <span>{l.table}</span>
            <span className="tabular-nums">{nombre.format(l.nombre)}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}

/**
 * Les 4 étapes de la remise à zéro (lot R) : chacune n'est possible que si la précédente est faite — l'état vient du
 * serveur (audit), le serveur REFUSE de toute façon une action hors ordre. La sauvegarde doit avoir été téléchargée dans
 * cette session (l'empreinte est gardée ici) pour que le bouton de purge se dégrise.
 */
export function AssistantReinitialisation({ etatInitial }: { etatInitial: EtatEtapes }) {
  const router = useRouter();
  const [etat, setEtat] = useState<EtatEtapes>(etatInitial);
  const [simulation, setSimulation] = useState<Simulation | null>(null);
  const [empreinte, setEmpreinte] = useState<string | null>(null);
  const [enCours, setEnCours] = useState<IdEtape | null>(null);
  const [phraseLevee, setPhraseLevee] = useState("");
  const [motifLevee, setMotifLevee] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [resultat, setResultat] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const lignes = lignesEtapes(etat);
  const statut = (id: IdEtape) => lignes.find((l) => l.id === id)!;
  const occupe = enCours !== null || isPending;

  function lancerSimulation() {
    setEnCours("SIMULATION");
    startTransition(async () => {
      try {
        const r = await simulerAction();
        if (r.status === "error") {
          toast.error(r.message);
          return;
        }
        setSimulation(r.simulation);
        setEtat((e) => ({ ...e, simulationFaite: true, sauvegardeFaite: false, verrouActif: r.simulation.verrouActif }));
        setEmpreinte(null);
      } finally {
        setEnCours(null);
      }
    });
  }

  async function telechargerSauvegarde() {
    setEnCours("SAUVEGARDE");
    try {
      const reponse = await fetch("/api/systeme/reinitialisation/sauvegarde", { cache: "no-store" });
      if (!reponse.ok) {
        toast.error(await reponse.text());
        return;
      }
      const hash = reponse.headers.get("X-Backup-Sha256");
      const disposition = reponse.headers.get("Content-Disposition") ?? "";
      const nom = /filename="([^"]+)"/.exec(disposition)?.[1] ?? "sauvegarde-avant-reinitialisation.json";
      const blob = await reponse.blob();
      const url = URL.createObjectURL(blob);
      const lien = document.createElement("a");
      lien.href = url;
      lien.download = nom;
      document.body.appendChild(lien);
      lien.click();
      lien.remove();
      URL.revokeObjectURL(url);
      if (!hash) {
        toast.error("Empreinte de sauvegarde manquante : réessayez.");
        return;
      }
      setEmpreinte(hash);
      setEtat((e) => ({ ...e, sauvegardeFaite: true }));
      toast.success("Sauvegarde générée et téléchargée.");
    } finally {
      setEnCours(null);
    }
  }

  function leverVerrou() {
    setEnCours("LEVEE_VERROU");
    startTransition(async () => {
      try {
        const r = await leverVerrouAction(phraseLevee, motifLevee);
        if (r.status === "success") {
          toast.success(r.message);
          setEtat((e) => ({ ...e, verrouActif: false, verrouLeveDansLeFlux: true }));
          setPhraseLevee("");
          setMotifLevee("");
          router.refresh();
        } else {
          toast.error(r.message);
        }
      } finally {
        setEnCours(null);
      }
    });
  }

  function reinitialiser() {
    if (!empreinte) return;
    setEnCours("PURGE");
    startTransition(async () => {
      try {
        const r = await reinitialiserAction(confirmation, empreinte);
        if (r.status === "success") {
          setResultat(r.message);
          toast.success("Remise à zéro effectuée.");
          router.refresh();
        } else {
          toast.error(r.message);
          if (r.message.includes("sauvegarde")) {
            setEmpreinte(null);
            setEtat((e) => ({ ...e, sauvegardeFaite: false }));
          }
        }
      } finally {
        setEnCours(null);
      }
    });
  }

  if (resultat) {
    return (
      <p className="rounded-md bg-success-bg px-3 py-3 text-sm text-success" data-resultat-reinitialisation>
        {resultat}
      </p>
    );
  }

  const e1 = statut("SIMULATION");
  const e2 = statut("SAUVEGARDE");
  const e3 = statut("LEVEE_VERROU");
  const e4 = statut("PURGE");
  const motifOk = motifLeveeValide(motifLevee) !== null;
  const peutPurger = e4.statut === "ACTIVE" && empreinte !== null && confirmation === PHRASE_PURGE;

  return (
    <div className="space-y-4">
      {/* Étape 1 */}
      <section className="space-y-3 rounded-lg border border-border bg-surface p-4" data-etape="SIMULATION">
        <EnTeteEtape id="SIMULATION" titre={e1.titre} statut={e1.statut} />
        <p className="text-xs text-muted-foreground">
          Compte ce qui sera supprimé et ce qui sera conservé, table par table. Rien n&apos;est supprimé à cette étape.
        </p>
        <Button type="button" loading={enCours === "SIMULATION"} disabled={occupe} onClick={lancerSimulation} data-action="simuler">
          {e1.statut === "FAITE" ? "Relancer la simulation" : "Lancer la simulation"}
        </Button>
        {simulation ? (
          <div className="space-y-3" data-simulation>
            <div
              className="space-y-1 rounded-md border border-danger bg-danger-bg px-3 py-3 text-sm font-semibold text-danger"
              role="alert"
              data-avertissement-caisse
            >
              <p>La caisse est entièrement vidée, solde d&apos;ouverture compris ; il faudra le ressaisir.</p>
              <p className="text-xs font-normal">
                {nombre.format(simulation.caisse.lignes)} écriture(s) du journal de caisse supprimée(s) ; solde actuel :{" "}
                {nombre.format(simulation.caisse.solde)} FCFA, qui passera à 0.
              </p>
            </div>
            <p className="text-sm">
              <strong data-total-supprime>{nombre.format(simulation.totalSupprime)}</strong> ligne(s) seront supprimées,{" "}
              {nombre.format(simulation.fichiers)} fichier(s) de <code>uploads/</code>.
              {simulation.encEnService ? " Le module Encaissements est en service : il est conservé en entier." : null}
            </p>
            <TableauDecompte titre="Supprimé" lignes={simulation.supprime} vide="Rien à supprimer." />
            <TableauDecompte titre="Conservé" lignes={simulation.conserve} vide="Rien n'est conservé." />
          </div>
        ) : null}
      </section>

      {/* Étape 2 */}
      <section className={`space-y-3 rounded-lg border border-border bg-surface p-4 ${e2.statut === "BLOQUEE" ? "opacity-60" : ""}`} data-etape="SAUVEGARDE">
        <EnTeteEtape id="SAUVEGARDE" titre={e2.titre} statut={e2.statut} />
        <p className="text-xs text-muted-foreground">
          JSON des lignes qui seront supprimées, avec son empreinte (SHA-256). <strong>Obligatoire</strong> : le bouton de la
          remise à zéro reste grisé tant que la sauvegarde n&apos;est pas téléchargée dans cette session. Les fichiers de{" "}
          <code>uploads/</code> n&apos;y sont pas : copiez ce dossier à la main si vous voulez pouvoir restaurer les pièces jointes.
        </p>
        <Button
          type="button"
          loading={enCours === "SAUVEGARDE"}
          disabled={e2.statut === "BLOQUEE" || occupe}
          onClick={telechargerSauvegarde}
          data-action="sauvegarder"
        >
          {empreinte ? "Régénérer la sauvegarde" : "Générer et télécharger la sauvegarde"}
        </Button>
        {e2.raison ? <p className="text-xs text-muted-foreground">{e2.raison}</p> : null}
        {empreinte ? (
          <p className="break-all text-xs text-success" data-empreinte={empreinte}>
            Sauvegarde téléchargée. Empreinte SHA-256 : {empreinte}
          </p>
        ) : e2.statut === "FAITE" ? (
          <p className="text-xs text-warning">
            Une sauvegarde a déjà été générée mais pas dans cette page : téléchargez-la de nouveau pour dégriser la remise à zéro.
          </p>
        ) : null}
      </section>

      {/* Étape 3 : seulement si un verrou existe ou vient d'être levé */}
      {e3.statut !== "NON_APPLICABLE" ? (
        <section className={`space-y-3 rounded-lg border border-border bg-surface p-4 ${e3.statut === "BLOQUEE" ? "opacity-60" : ""}`} data-etape="LEVEE_VERROU">
          <EnTeteEtape id="LEVEE_VERROU" titre={e3.titre} statut={e3.statut} />
          <p className="text-xs text-muted-foreground">
            Une remise à zéro a déjà été effectuée : le verrou empêche d&apos;en refaire une. Le lever est une décision du DG,
            tracée. La ligne d&apos;audit de la remise à zéro précédente est <strong>conservée</strong> (jamais supprimée).
          </p>
          {e3.statut !== "FAITE" ? (
            <>
              <Input
                label={`Tapez ${PHRASE_LEVEE_VERROU} pour confirmer`}
                value={phraseLevee}
                onChange={(ev) => setPhraseLevee(ev.target.value)}
                disabled={e3.statut !== "ACTIVE" || occupe}
                autoComplete="off"
                data-champ="phrase-levee"
              />
              <Textarea
                label="Motif (obligatoire)"
                hint={`${MOTIF_LEVEE_MIN} à ${MOTIF_LEVEE_MAX} caractères, conservé dans l'historique.`}
                value={motifLevee}
                onChange={(ev) => setMotifLevee(ev.target.value)}
                disabled={e3.statut !== "ACTIVE" || occupe}
                rows={3}
                data-champ="motif-levee"
              />
              <Button
                type="button"
                variant="danger"
                loading={enCours === "LEVEE_VERROU"}
                disabled={e3.statut !== "ACTIVE" || occupe || phraseLevee !== PHRASE_LEVEE_VERROU || !motifOk}
                onClick={leverVerrou}
                data-action="lever-verrou"
              >
                Lever le verrou
              </Button>
              {e3.raison ? <p className="text-xs text-muted-foreground">{e3.raison}</p> : null}
            </>
          ) : (
            <p className="text-xs text-success">Verrou levé. La remise à zéro (étape 4) reposera le verrou.</p>
          )}
        </section>
      ) : null}

      {/* Étape 4 */}
      <section className={`space-y-3 rounded-lg border border-danger/40 bg-surface p-4 ${e4.statut === "BLOQUEE" ? "opacity-60" : ""}`} data-etape="PURGE">
        <EnTeteEtape id="PURGE" titre={e4.titre} statut={e4.statut} />
        <p className="text-xs text-muted-foreground">
          Supprime définitivement les données listées à l&apos;étape 1, en une seule transaction (tout ou rien), puis repose le
          verrou. C&apos;est exactement la même purge que la ligne de commande.
        </p>
        <Input
          label={`Tapez ${PHRASE_PURGE} pour confirmer`}
          value={confirmation}
          onChange={(ev) => setConfirmation(ev.target.value)}
          disabled={e4.statut !== "ACTIVE" || empreinte === null || occupe}
          autoComplete="off"
          data-champ="phrase-purge"
        />
        <Button
          type="button"
          variant="danger"
          loading={enCours === "PURGE"}
          disabled={!peutPurger || occupe}
          onClick={reinitialiser}
          data-action="purger"
        >
          Réinitialiser définitivement
        </Button>
        {e4.statut !== "ACTIVE" && e4.raison ? <p className="text-xs text-muted-foreground">{e4.raison}</p> : null}
        {e4.statut === "ACTIVE" && empreinte === null ? (
          <p className="text-xs text-muted-foreground">Téléchargez la sauvegarde dans cette page (étape 2) pour dégriser ce bouton.</p>
        ) : null}
      </section>
    </div>
  );
}
