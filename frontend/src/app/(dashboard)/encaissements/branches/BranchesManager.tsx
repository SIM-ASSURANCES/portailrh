"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Badge, Button, Card, DataTable, Input } from "@/components/ui";

import { creerBrancheAction, toggleBrancheActiveAction } from "../parametres/actions";

export interface BrancheRow {
  id: string;
  code: string;
  libelle: string;
  actif: boolean;
  /** Formatée côté serveur. */
  creeLe: string;
}

export function BranchesManager({ branches }: { branches: BrancheRow[] }) {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [libelle, setLibelle] = useState("");
  const [erreur, setErreur] = useState<string | null>(null);
  const [creationEnCours, startCreation] = useTransition();
  const [basculeEnCours, setBasculeEnCours] = useState<string | null>(null);

  function creer(e: React.FormEvent) {
    e.preventDefault();
    setErreur(null);
    startCreation(async () => {
      const r = await creerBrancheAction(code, libelle);
      if (r.status === "error") {
        setErreur(r.message);
        toast.error(r.message);
        return;
      }
      toast.success(r.message);
      setCode("");
      setLibelle("");
      router.refresh();
    });
  }

  async function basculer(b: BrancheRow) {
    setBasculeEnCours(b.id);
    try {
      const r = await toggleBrancheActiveAction(b.id, !b.actif);
      if (r.status === "error") toast.error(r.message);
      else {
        toast.success(r.message);
        router.refresh();
      }
    } finally {
      setBasculeEnCours(null);
    }
  }

  return (
    <div className="space-y-6">
      <Card className="space-y-4">
        <h2 className="text-base font-bold text-foreground">Ajouter une branche</h2>
        <form onSubmit={creer} className="grid gap-4 sm:grid-cols-[12rem_1fr_auto] sm:items-end">
          <Input
            label="Code"
            required
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            hint="Ex. AUTO, SANTE"
            maxLength={20}
            disabled={creationEnCours}
          />
          <Input
            label="Libellé"
            required
            value={libelle}
            onChange={(e) => setLibelle(e.target.value)}
            hint="Nom affiché à l'écran"
            disabled={creationEnCours}
          />
          <Button type="submit" loading={creationEnCours} disabled={!code.trim() || !libelle.trim()}>
            Ajouter
          </Button>
        </form>
        {erreur && (
          <p role="alert" className="text-sm text-danger">
            {erreur}
          </p>
        )}
      </Card>

      <DataTable
        rowKey={(b) => b.id}
        data={branches}
        emptyMessage="Aucune branche : ajoutez-en une pour pouvoir importer un fichier sans colonne « Branche »."
        columns={[
          { key: "libelle", header: "Libellé", sortable: true, accessor: (b) => b.libelle },
          { key: "code", header: "Code", sortable: true, accessor: (b) => b.code, render: (b) => <span className="font-mono text-sm">{b.code}</span> },
          {
            key: "etat",
            header: "État",
            render: (b) => <Badge variant={b.actif ? "success" : "neutral"}>{b.actif ? "Active" : "Désactivée"}</Badge>,
          },
          { key: "creeLe", header: "Créée le", accessor: (b) => b.creeLe },
          {
            key: "actions",
            header: "Actions",
            render: (b) => (
              <Button
                type="button"
                variant={b.actif ? "secondary" : "primary"}
                loading={basculeEnCours === b.id}
                disabled={basculeEnCours !== null}
                onClick={() => void basculer(b)}
              >
                {b.actif ? "Désactiver" : "Réactiver"}
              </Button>
            ),
          },
        ]}
      />
    </div>
  );
}
