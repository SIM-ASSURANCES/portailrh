"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button, Input, Select, Textarea } from "@/components/ui";
import { apercuPermissionAction, soumettrePermissionAction, type ApercuPermission } from "../actions";

/** 150 → « 2h30 », 45 → « 45 min » (affichage seulement ; la durée vient du serveur). */
function enHeures(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h}h` : `${h}h${String(m).padStart(2, "0")}`;
}

export interface TypePermissionOption {
  id: string;
  label: string;
  dureeMaxHeures: number;
  plafondMensuel: number;
}

/**
 * Formulaire de demande de permission d'absence. Aucun calcul de durée ni de plafond ici : l'aperçu vient du serveur
 * (`apercuPermissionAction`, mêmes règles que la soumission), rangé avec la clé de la saisie qui l'a produit.
 */
export function DemandePermissionForm({ types, aujourdhui }: { types: TypePermissionOption[]; aujourdhui: string }) {
  const router = useRouter();
  const [enCours, demarrer] = useTransition();
  const [typePermissionId, setTypePermissionId] = useState("");
  const [date, setDate] = useState(aujourdhui);
  const [heureDepart, setHeureDepart] = useState("");
  const [heureRetourPrevue, setHeureRetourPrevue] = useState("");
  const [motif, setMotif] = useState("");
  const [erreurs, setErreurs] = useState<Partial<Record<string, string>>>({});
  const [apercu, setApercu] = useState<{ cle: string; valeur: ApercuPermission | null; erreur: string | null } | null>(null);

  const type = useMemo(() => types.find((t) => t.id === typePermissionId) ?? null, [types, typePermissionId]);
  const cle = `${typePermissionId}|${date}|${heureDepart}|${heureRetourPrevue}`;
  const pret = Boolean(typePermissionId && date && heureDepart && heureRetourPrevue);

  useEffect(() => {
    if (!pret) return;
    let annule = false;
    const minuteur = setTimeout(async () => {
      const r = await apercuPermissionAction({ typePermissionId, date, heureDepart, heureRetourPrevue });
      if (annule) return;
      if (r.status === "success" && r.data) setApercu({ cle, valeur: r.data, erreur: null });
      else setApercu({ cle, valeur: null, erreur: r.status === "error" ? r.message : null });
    }, 300);
    return () => {
      annule = true;
      clearTimeout(minuteur);
    };
  }, [pret, cle, typePermissionId, date, heureDepart, heureRetourPrevue]);

  const apercuCourant = apercu && apercu.cle === cle ? apercu : null;
  const valeur = apercuCourant?.valeur ?? null;
  const incomplet = !typePermissionId || !date || !heureDepart || !heureRetourPrevue || motif.trim().length < 5;
  const bloque = Boolean(valeur?.depasseMax);

  const envoyer = () => {
    setErreurs({});
    demarrer(async () => {
      const r = await soumettrePermissionAction({ typePermissionId, date, heureDepart, heureRetourPrevue, motif });
      if (r.status === "success") {
        toast.success(r.message ?? "Demande envoyée.");
        if (r.data?.avertissement) toast.warning(r.data.avertissement);
        router.push(r.data?.id ? `/permissions-absence/${r.data.id}` : "/permissions-absence");
        router.refresh();
      } else if (r.status === "error") {
        setErreurs(r.fieldErrors ?? {});
        toast.error(r.message);
      }
    });
  };

  return (
    <form
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        envoyer();
      }}
    >
      <Select
        label="Type de permission"
        required
        placeholder="Choisir un type"
        options={types.map((t) => ({ value: t.id, label: t.label }))}
        value={typePermissionId}
        onChange={(e) => setTypePermissionId(e.target.value)}
        error={erreurs.typePermissionId}
        hint={type ? `${type.dureeMaxHeures} h au plus par permission, ${type.plafondMensuel} par mois.` : undefined}
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <Input label="Date" type="date" required min={aujourdhui} value={date} onChange={(e) => setDate(e.target.value)} error={erreurs.date} />
        <Input label="Heure de départ" type="time" required value={heureDepart} onChange={(e) => setHeureDepart(e.target.value)} error={erreurs.heureDepart} />
        <Input
          label="Retour prévu"
          type="time"
          required
          value={heureRetourPrevue}
          onChange={(e) => setHeureRetourPrevue(e.target.value)}
          error={erreurs.heureRetourPrevue}
        />
      </div>

      {apercuCourant ? (
        <div className="space-y-1 rounded-lg border border-border bg-muted px-4 py-3 text-sm" role="status" aria-live="polite">
          {valeur ? (
            <>
              <p className="font-semibold text-foreground">Durée : {enHeures(valeur.dureeMinutes)}</p>
              <p className="text-muted-foreground">
                Ce mois-ci pour ce type : {valeur.utilise} / {valeur.plafond} déjà demandée(s) ou accordée(s).
              </p>
              {valeur.depasseMax ? (
                <p className="font-medium text-danger">La durée dépasse le maximum de {valeur.dureeMaxHeures} h pour ce type : la demande sera refusée.</p>
              ) : null}
              {valeur.alerteCongeRecommande ? <p className="font-medium text-warning">Au-delà de 4 heures, un congé est plus adapté.</p> : null}
              {valeur.auDelaDuPlafond ? (
                <p className="font-medium text-warning">Le plafond mensuel est atteint : la RH devra accorder une dérogation motivée.</p>
              ) : null}
            </>
          ) : (
            <p className="text-warning">{apercuCourant.erreur ?? "Aperçu indisponible."}</p>
          )}
        </div>
      ) : null}

      <Textarea label="Motif" required rows={4} maxLength={500} value={motif} onChange={(e) => setMotif(e.target.value)} error={erreurs.motif} hint="5 caractères minimum." />

      <div className="flex flex-col gap-2 sm:flex-row">
        <Button type="submit" variant="primary" loading={enCours} disabled={incomplet || bloque}>
          Envoyer la demande
        </Button>
        <Button type="button" variant="secondary" disabled={enCours} onClick={() => router.back()}>
          Annuler
        </Button>
      </div>
    </form>
  );
}
