"use client";

import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";

import { Button, Input } from "@/components/ui";

import { definirResponsableServiceAction } from "./actions";

export interface UtilisateurActif {
  id: string;
  fullName: string;
  email: string;
  serviceNom: string | null;
}

const normaliser = (t: string) =>
  t
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

/**
 * Bouton « Désigner / Changer » du responsable d'un service : liste des utilisateurs actifs avec recherche (nom, e-mail,
 * service). Un responsable peut être extérieur au service et responsable de plusieurs services. Remplacer un
 * responsable existant passe par une confirmation qui le nomme (il reste membre de son service) ; le serveur revérifie.
 */
export function ServiceResponsablePicker({
  serviceId,
  serviceNom,
  responsableActuel,
  utilisateurs,
}: {
  serviceId: string;
  serviceNom: string;
  responsableActuel: { id: string; fullName: string } | null;
  utilisateurs: UtilisateurActif[];
}) {
  const [ouvert, setOuvert] = useState(false);
  const [recherche, setRecherche] = useState("");
  const [choisi, setChoisi] = useState<UtilisateurActif | null>(null);
  const [isPending, startTransition] = useTransition();

  const resultats = useMemo(() => {
    const q = normaliser(recherche.trim());
    const liste = q
      ? utilisateurs.filter((u) => normaliser(`${u.fullName} ${u.email} ${u.serviceNom ?? ""}`).includes(q))
      : utilisateurs;
    return liste.slice(0, 30);
  }, [recherche, utilisateurs]);

  function fermer() {
    setOuvert(false);
    setRecherche("");
    setChoisi(null);
  }

  function designer(u: UtilisateurActif, confirme: boolean) {
    startTransition(async () => {
      const res = await definirResponsableServiceAction(serviceId, u.id, confirme);
      if (res.status === "error") toast.error(res.message);
      else {
        if (res.status === "success" && res.message) toast.success(res.message);
        fermer();
      }
    });
  }

  function choisir(u: UtilisateurActif) {
    if (responsableActuel && responsableActuel.id !== u.id) setChoisi(u);
    else designer(u, false);
  }

  if (!ouvert) {
    return (
      <Button type="button" variant="secondary" onClick={() => setOuvert(true)}>
        {responsableActuel ? "Changer" : "Désigner"}
      </Button>
    );
  }

  return (
    <div className="w-full min-w-[260px] space-y-2 rounded-lg border border-border bg-surface p-3" data-picker-responsable={serviceNom}>
      {choisi && responsableActuel ? (
        <div className="space-y-2">
          <p className="text-sm text-foreground">
            Remplacer <span className="font-semibold">{responsableActuel.fullName}</span> par{" "}
            <span className="font-semibold">{choisi.fullName}</span> comme responsable du service « {serviceNom} » ?{" "}
            {responsableActuel.fullName} reste membre de son service mais n&apos;en est plus responsable.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" loading={isPending} onClick={() => designer(choisi, true)}>
              Confirmer le remplacement
            </Button>
            <Button type="button" variant="secondary" disabled={isPending} onClick={() => setChoisi(null)}>
              Retour
            </Button>
          </div>
        </div>
      ) : (
        <>
          <Input
            aria-label={`Rechercher un responsable pour ${serviceNom}`}
            placeholder="Rechercher un nom, un e-mail, un service…"
            value={recherche}
            onChange={(e) => setRecherche(e.target.value)}
            autoFocus
          />
          <ul className="max-h-64 space-y-1 overflow-y-auto">
            {resultats.length === 0 ? (
              <li className="px-2 py-1 text-sm text-muted-foreground">Aucun utilisateur actif ne correspond.</li>
            ) : (
              resultats.map((u) => (
                <li key={u.id}>
                  <button
                    type="button"
                    disabled={isPending || u.id === responsableActuel?.id}
                    onClick={() => choisir(u)}
                    className="w-full rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <span className="block font-medium text-foreground">
                      {u.fullName}
                      {u.id === responsableActuel?.id ? " (responsable actuel)" : ""}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {u.email} — {u.serviceNom ?? "sans service"}
                    </span>
                  </button>
                </li>
              ))
            )}
          </ul>
          <Button type="button" variant="secondary" disabled={isPending} onClick={fermer}>
            Annuler
          </Button>
        </>
      )}
    </div>
  );
}
