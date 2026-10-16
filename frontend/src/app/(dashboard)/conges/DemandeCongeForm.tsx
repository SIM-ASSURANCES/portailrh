"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { refusDateDebutPassee } from "backend/client";

import { Button, Input, Select, Textarea } from "@/components/ui";
import { PiecesUpload, type PieceDeposee } from "@/components/conges/PiecesUpload";
import {
  accorderCongeOfficeAction,
  apercuCongeAction,
  resoumettreCongeAction,
  soumettreCongeAction,
  type ApercuConge,
} from "./actions";

export interface TypeCongeOption {
  id: string;
  label: string;
  categorie: "CONGE_STANDARD" | "PERMISSION_EXCEPTIONNELLE";
  nbJoursDefaut: number;
  decompteType: "CALENDAIRE" | "OUVRABLE";
  justificatifObligatoire: boolean;
  nonDeductibleSolde: boolean;
  ancienneteMinimumMois: number;
}

export interface ValeursInitiales {
  typeCongeId: string;
  dateDebut: string;
  dateFin: string;
  motif: string;
  interimaire: string;
  pieces: PieceDeposee[];
}

type Mode = "nouvelle" | "modifier" | "office";

/**
 * Formulaire de demande de congé — trois usages, un seul composant :
 *  - `nouvelle` : le collaborateur dépose sa demande ;
 *  - `modifier` : il corrige puis renvoie une demande dont la modification a été demandée (le circuit repart de zéro) ;
 *  - `office` : la RH accorde un congé à un collaborateur, sans circuit (aucune demande préalable).
 * Aucun calcul de jours ni de solde ici : l'aperçu vient du serveur (`apercuCongeAction`, mêmes règles que la soumission).
 */
export function DemandeCongeForm({
  mode,
  types,
  collaborateurs,
  demandeId,
  initial,
  aujourdhui,
}: {
  mode: Mode;
  types: TypeCongeOption[];
  collaborateurs?: { id: string; label: string }[];
  demandeId?: string;
  initial?: ValeursInitiales;
  aujourdhui: string;
}) {
  const router = useRouter();
  const [enCours, demarrer] = useTransition();
  const [userId, setUserId] = useState("");
  const [typeCongeId, setTypeCongeId] = useState(initial?.typeCongeId ?? "");
  const [dateDebut, setDateDebut] = useState(initial?.dateDebut ?? "");
  const [dateFin, setDateFin] = useState(initial?.dateFin ?? "");
  const [motif, setMotif] = useState(initial?.motif ?? "");
  const [interimaire, setInterimaire] = useState(initial?.interimaire ?? "");
  const [pieces, setPieces] = useState<PieceDeposee[]>(initial?.pieces ?? []);
  const [erreurs, setErreurs] = useState<Partial<Record<string, string>>>({});
  // L'aperçu est rangé avec la clé de la saisie qui l'a produit : jamais affiché pour une saisie différente.
  const [apercu, setApercu] = useState<{ cle: string; valeur: ApercuConge | null; erreur: string | null } | null>(null);

  const type = useMemo(() => types.find((t) => t.id === typeCongeId) ?? null, [types, typeCongeId]);
  const dureeFixee = type?.categorie === "PERMISSION_EXCEPTIONNELLE";
  const pieceObligatoire = Boolean(type && (type.categorie === "PERMISSION_EXCEPTIONNELLE" || type.justificatifObligatoire));

  const finPourApercu = dureeFixee ? dateDebut : dateFin;
  const cle = `${mode === "office" ? userId : ""}|${typeCongeId}|${dateDebut}|${finPourApercu}`;
  const pret = Boolean(typeCongeId && dateDebut && finPourApercu && (mode !== "office" || userId));

  useEffect(() => {
    if (!pret) return;
    let annule = false;
    const minuteur = setTimeout(async () => {
      const r = await apercuCongeAction({ typeCongeId, dateDebut, dateFin: finPourApercu, ...(mode === "office" ? { userId } : {}) });
      if (annule) return;
      if (r.status === "success" && r.data) setApercu({ cle, valeur: r.data, erreur: null });
      else setApercu({ cle, valeur: null, erreur: r.status === "error" ? r.message : null });
    }, 300);
    return () => {
      annule = true;
      clearTimeout(minuteur);
    };
  }, [pret, cle, typeCongeId, dateDebut, finPourApercu, mode, userId]);

  const apercuCourant = apercu && apercu.cle === cle ? apercu : null;

  const envoyer = () => {
    setErreurs({});
    const donnees = {
      typeCongeId,
      dateDebut,
      // Pour une durée fixée par le type, le serveur recalcule la fin : on envoie le début pour un champ jamais vide.
      dateFin: dureeFixee ? (apercuCourant?.valeur?.dateFin ?? dateDebut) : dateFin,
      motif,
      interimaire: interimaire.trim() === "" ? undefined : interimaire,
      piecesJointes: pieces.map((p) => ({ url: p.url, nomFichier: p.nomFichier })),
    };
    demarrer(async () => {
      const r =
        mode === "office"
          ? await accorderCongeOfficeAction({ ...donnees, userId })
          : mode === "modifier" && demandeId
            ? await resoumettreCongeAction(demandeId, donnees)
            : await soumettreCongeAction(donnees);
      if (r.status === "success") {
        toast.success(r.message ?? "Enregistré.");
        const id = (r.data as { id?: string } | undefined)?.id;
        router.push(id ? `/conges/${id}` : "/conges");
        router.refresh();
      } else if (r.status === "error") {
        setErreurs(r.fieldErrors ?? {});
        toast.error(r.message);
      }
    });
  };

  const titreBouton = mode === "office" ? "Accorder le congé" : mode === "modifier" ? "Renvoyer la demande" : "Envoyer la demande";
  const minDebut = mode === "office" ? undefined : aujourdhui;
  // Art. 12 : autorisation préalable. Même règle et même phrase que le serveur ; seul le congé d'office (RH) y échappe.
  const erreurPasse = mode !== "office" && dateDebut ? refusDateDebutPassee(dateDebut, aujourdhui) : null;
  const incomplet = !typeCongeId || !dateDebut || (!dureeFixee && !dateFin) || motif.trim().length < 5 || (mode === "office" && !userId) || erreurPasse !== null;

  return (
    <form
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        envoyer();
      }}
    >
      {mode === "office" ? (
        <Select
          label="Collaborateur"
          required
          placeholder="Choisir un collaborateur"
          options={(collaborateurs ?? []).map((c) => ({ value: c.id, label: c.label }))}
          value={userId}
          onChange={(e) => setUserId(e.target.value)}
        />
      ) : null}

      <Select
        label="Type de congé"
        required
        placeholder="Choisir un type"
        options={types.map((t) => ({ value: t.id, label: t.label }))}
        value={typeCongeId}
        onChange={(e) => setTypeCongeId(e.target.value)}
        error={erreurs.typeCongeId}
        hint={
          type
            ? [
                type.nonDeductibleSolde ? "Non déduit de votre solde annuel." : null,
                type.ancienneteMinimumMois > 0 ? `Ancienneté minimale : ${type.ancienneteMinimumMois} mois.` : null,
                type.decompteType === "OUVRABLE" ? "Jours ouvrables (lundi à vendredi), jours fériés exclus." : "Jours calendaires.",
              ]
                .filter(Boolean)
                .join(" ")
            : undefined
        }
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <Input
          label="Date de début"
          type="date"
          required
          min={minDebut}
          value={dateDebut}
          onChange={(e) => setDateDebut(e.target.value)}
          error={erreurs.dateDebut ?? erreurPasse ?? undefined}
        />
        {dureeFixee ? (
          <Input
            label="Date de fin"
            type="date"
            disabled
            value={apercuCourant?.valeur?.dateFin ?? ""}
            onChange={() => {}}
            hint={`Durée fixée par le type : ${type?.nbJoursDefaut} jour(s).`}
            error={erreurs.dateFin}
          />
        ) : (
          <Input
            label="Date de fin"
            type="date"
            required
            min={dateDebut || minDebut}
            value={dateFin}
            onChange={(e) => setDateFin(e.target.value)}
            error={erreurs.dateFin}
          />
        )}
      </div>

      {apercuCourant ? (
        <div className="space-y-1 rounded-lg border border-border bg-muted px-4 py-3 text-sm" role="status" aria-live="polite">
          {apercuCourant.valeur ? (
            <>
              <p className="font-semibold text-foreground">
                {apercuCourant.valeur.nbJours} jour{apercuCourant.valeur.nbJours > 1 ? "s" : ""} décompté{apercuCourant.valeur.nbJours > 1 ? "s" : ""}
                {apercuCourant.valeur.joursFeriesInclus > 0 ? ` (dont ${apercuCourant.valeur.joursFeriesInclus} jour(s) férié(s) sur la période)` : ""}
              </p>
              {apercuCourant.valeur.soldeRestant !== null ? (
                <p className="text-muted-foreground">
                  Solde de l&apos;exercice {apercuCourant.valeur.exercice} : {apercuCourant.valeur.soldeRestant} jour(s) avant cette demande.
                </p>
              ) : null}
              {apercuCourant.valeur.avertissement ? <p className="font-medium text-warning">{apercuCourant.valeur.avertissement}</p> : null}
            </>
          ) : (
            <p className="text-warning">{apercuCourant.erreur ?? "Aperçu indisponible."}</p>
          )}
        </div>
      ) : null}

      <Textarea
        label="Motif"
        required
        rows={4}
        maxLength={500}
        value={motif}
        onChange={(e) => setMotif(e.target.value)}
        error={erreurs.motif}
        hint="5 caractères minimum."
      />

      <Input
        label="Intérimaire (facultatif)"
        maxLength={120}
        value={interimaire}
        onChange={(e) => setInterimaire(e.target.value)}
        hint="Nom de la personne qui vous remplace."
        error={erreurs.interimaire}
      />

      <PiecesUpload
        endpoint="/api/conges/upload"
        pieces={pieces}
        onChange={setPieces}
        obligatoire={pieceObligatoire}
        urlsFixes={initial?.pieces.map((p) => p.url)}
        error={erreurs.piecesJointes}
      />

      <div className="flex flex-col gap-2 sm:flex-row">
        <Button type="submit" variant="primary" loading={enCours} disabled={incomplet}>
          {titreBouton}
        </Button>
        <Button type="button" variant="secondary" disabled={enCours} onClick={() => router.back()}>
          Annuler
        </Button>
      </div>
    </form>
  );
}
