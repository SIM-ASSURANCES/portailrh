"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button, Input, Select, Textarea } from "@/components/ui";
import { PieceJointeUpload } from "@/components/tresorerie/PieceJointeUpload";

import { creerRetourExterneAction } from "./actions";

export function RetourExterneForm({ utilisateurs }: { utilisateurs: { id: string; fullName: string }[] }) {
  const router = useRouter();
  const [typePersonne, setTypePersonne] = useState<"COLLABORATEUR" | "EXTERNE">("COLLABORATEUR");
  const [collaborateurId, setCollaborateurId] = useState("");
  const [nomExterne, setNomExterne] = useState("");
  const [cheque, setCheque] = useState("");
  const [retourne, setRetourne] = useState("");
  const [motif, setMotif] = useState("");
  const [pj, setPj] = useState<string | undefined>();
  const [pjCheque, setPjCheque] = useState<string | undefined>();
  const [resetKey, setResetKey] = useState(0);
  const [erreur, setErreur] = useState<string | undefined>();
  const [isPending, startTransition] = useTransition();

  function submit() {
    if (typePersonne === "COLLABORATEUR" && !collaborateurId) return setErreur("Choisissez un collaborateur.");
    if (typePersonne === "EXTERNE" && nomExterne.trim().length < 2) return setErreur("Saisissez le nom de la personne externe.");
    if (!(Number(cheque) > 0) || !(Number(retourne) > 0)) return setErreur("Les deux montants doivent être supérieurs à 0.");
    if (motif.trim().length < 10) return setErreur("Le motif est obligatoire (10 caractères minimum).");
    if (!pjCheque) return setErreur("Le justificatif du chèque initial est obligatoire.");
    if (!pj) return setErreur("Le justificatif du retour est obligatoire.");
    setErreur(undefined);
    startTransition(async () => {
      const r = await creerRetourExterneAction(
        typePersonne === "COLLABORATEUR" ? collaborateurId : undefined,
        typePersonne === "EXTERNE" ? nomExterne : undefined,
        Number(cheque),
        Number(retourne),
        motif,
        pj,
        pjCheque
      );
      if (r.status === "success") {
        toast.success(r.message);
        setCollaborateurId("");
        setNomExterne("");
        setCheque("");
        setRetourne("");
        setMotif("");
        setPj(undefined);
        setPjCheque(undefined);
        setResetKey((k) => k + 1);
        router.refresh();
      } else {
        toast.error(r.message);
      }
    });
  }

  return (
    <div className="space-y-4 rounded-lg border border-border bg-surface p-5">
      <Select
        label="Type de personne"
        value={typePersonne}
        onChange={(e) => setTypePersonne(e.target.value as "COLLABORATEUR" | "EXTERNE")}
        options={[
          { value: "COLLABORATEUR", label: "Collaborateur du portail" },
          { value: "EXTERNE", label: "Personne externe (nom libre)" },
        ]}
      />
      {typePersonne === "COLLABORATEUR" ? (
        <Select
          label="Collaborateur"
          required
          placeholder="Choisir..."
          value={collaborateurId}
          onChange={(e) => setCollaborateurId(e.target.value)}
          options={utilisateurs.map((u) => ({ value: u.id, label: u.fullName }))}
        />
      ) : (
        <Input label="Nom de la personne" required value={nomExterne} onChange={(e) => setNomExterne(e.target.value)} />
      )}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Input
          label="Montant du chèque initial (FCFA)"
          type="number"
          min="0"
          required
          hint="Information déclarative : non vérifiée par le système."
          value={cheque}
          onChange={(e) => setCheque(e.target.value)}
        />
        <Input
          label="Montant retourné en caisse (FCFA)"
          type="number"
          min="0"
          required
          hint="Ce montant est immédiatement ajouté au solde de caisse."
          value={retourne}
          onChange={(e) => setRetourne(e.target.value)}
        />
      </div>
      <Textarea label="Motif" required rows={3} value={motif} onChange={(e) => setMotif(e.target.value)} />
      <PieceJointeUpload key={`c${resetKey}`} label="Justificatif du chèque initial (obligatoire)" onChange={(url) => setPjCheque(url ?? undefined)} />
      <PieceJointeUpload key={`r${resetKey}`} label="Justificatif du retour (obligatoire)" onChange={(url) => setPj(url ?? undefined)} />
      {erreur ? <p className="text-sm text-danger">{erreur}</p> : null}
      <Button type="button" loading={isPending} onClick={submit}>
        Enregistrer le retour externe
      </Button>
    </div>
  );
}
