"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button, Input, Select, Textarea } from "@/components/ui";
import { PieceJointeUpload } from "@/components/tresorerie/PieceJointeUpload";

import type { DemandeRattachable } from "backend/client";

import { chercherDemandeRattachableAction, creerRetourExterneAction } from "./actions";

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
  const [rattacher, setRattacher] = useState(false);
  const [referenceDemande, setReferenceDemande] = useState("");
  const [demande, setDemande] = useState<DemandeRattachable | null>(null);
  const [perimetre, setPerimetre] = useState("");
  const [resetKey, setResetKey] = useState(0);
  const [erreur, setErreur] = useState<string | undefined>();
  const [isPending, startTransition] = useTransition();

  const articleChoisi = demande?.articles.find((a) => (a.ligneId ?? "") === perimetre);

  function rechercherDemande() {
    setErreur(undefined);
    setDemande(null);
    setPerimetre("");
    startTransition(async () => {
      const r = await chercherDemandeRattachableAction(referenceDemande);
      if (r.status === "success") {
        setDemande(r.demande);
        if (r.demande.articles.length === 1) setPerimetre(r.demande.articles[0].ligneId ?? "");
      } else {
        setErreur(r.message);
      }
    });
  }

  function submit() {
    if (typePersonne === "COLLABORATEUR" && !collaborateurId) return setErreur("Choisissez un collaborateur.");
    if (typePersonne === "EXTERNE" && nomExterne.trim().length < 2) return setErreur("Saisissez le nom de la personne externe.");
    if (!(Number(cheque) > 0) || !(Number(retourne) > 0)) return setErreur("Les deux montants doivent être supérieurs à 0.");
    if (motif.trim().length < 10) return setErreur("Le motif est obligatoire (10 caractères minimum).");
    if (!pjCheque) return setErreur("Le justificatif du chèque initial est obligatoire.");
    if (!pj) return setErreur("Le justificatif du retour est obligatoire.");
    if (rattacher && (!demande || !articleChoisi)) return setErreur("Recherchez la demande par sa référence puis choisissez l'article concerné.");
    setErreur(undefined);
    startTransition(async () => {
      const r = await creerRetourExterneAction(
        typePersonne === "COLLABORATEUR" ? collaborateurId : undefined,
        typePersonne === "EXTERNE" ? nomExterne : undefined,
        Number(cheque),
        Number(retourne),
        motif,
        pj,
        pjCheque,
        rattacher ? demande?.demandeId : undefined,
        rattacher ? articleChoisi?.ligneId ?? undefined : undefined
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
        setRattacher(false);
        setReferenceDemande("");
        setDemande(null);
        setPerimetre("");
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
      <div className="space-y-3 rounded-md border border-border p-3">
        <label className="flex items-start gap-2 text-sm font-medium text-foreground">
          <input
            type="checkbox"
            className="mt-1"
            checked={rattacher}
            onChange={(e) => {
              setRattacher(e.target.checked);
              setDemande(null);
              setPerimetre("");
            }}
          />
          <span>
            Rattacher à une demande (retour d&apos;un fonds versé par banque)
            <span className="block text-xs font-normal text-muted-foreground">
              Facultatif. Rattaché, le retour compte comme retour reçu de l&apos;article (son solde à régulariser baisse) ; non
              rattaché, il reste un retour autonome. Le montant est de toute façon ajouté au solde de caisse.
            </span>
          </span>
        </label>
        {rattacher ? (
          <div className="space-y-3">
            <div className="flex flex-wrap items-end gap-2">
              <div className="min-w-[14rem] flex-1">
                <Input
                  label="Référence de la demande"
                  placeholder="DEM-2026-000123"
                  value={referenceDemande}
                  onChange={(e) => {
                    setReferenceDemande(e.target.value);
                    setDemande(null);
                    setPerimetre("");
                  }}
                />
              </div>
              <Button type="button" variant="secondary" loading={isPending} onClick={rechercherDemande}>
                Rechercher
              </Button>
            </div>
            {demande ? (
              <Select
                label={`Article de la demande ${demande.reference}`}
                required
                placeholder="Choisir..."
                value={perimetre}
                onChange={(e) => setPerimetre(e.target.value)}
                options={demande.articles.map((a) => ({
                  value: a.ligneId ?? "",
                  label: `${a.libelle} — banque ${a.fondsBanque.toLocaleString("fr-FR")} FCFA`,
                }))}
              />
            ) : null}
            {articleChoisi ? (
              <p className="text-xs text-muted-foreground" data-retour-externe-plafond>
                Fonds versés par banque : {articleChoisi.fondsBanque.toLocaleString("fr-FR")} FCFA · déjà retournés (retours externes) :{" "}
                {articleChoisi.dejaRetourne.toLocaleString("fr-FR")} FCFA · solde à régulariser :{" "}
                {articleChoisi.ecart.toLocaleString("fr-FR")} FCFA.
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
      <Textarea label="Motif" required rows={3} value={motif} onChange={(e) => setMotif(e.target.value)} />
      <PieceJointeUpload key={`c${resetKey}`} label="Justificatif du chèque initial (obligatoire)" onChange={(url) => setPjCheque(url ?? undefined)} />
      <PieceJointeUpload key={`r${resetKey}`} label="Justificatif du retour (obligatoire)" onChange={(url) => setPj(url ?? undefined)} />
      {erreur ? <p className="text-sm text-danger">{erreur}</p> : null}
      <Button signe type="button" loading={isPending} onClick={submit}>
        Enregistrer le retour externe
      </Button>
    </div>
  );
}
