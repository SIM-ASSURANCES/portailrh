"use client";

import { useState } from "react";

import { FormField } from "@/components/ui";

const ACCEPT = ".pdf,.jpg,.jpeg,.png";
const MAX_SIZE = 10 * 1024 * 1024; // 10 Mo
const MAX_PIECES = 5;

export interface PieceDeposee {
  url: string;
  nomFichier: string;
}

/**
 * Dépôt de pièces justificatives d'une demande de congé. Chaque fichier est envoyé dès son
 * choix à la route `endpoint` (qui génère le nom : UUID + extension) ; la liste des noms est remontée au parent, qui
 * l'envoie avec la demande. La route ne crée rien en base. Contrôles client redondants avec le serveur (retour rapide).
 */
export function PiecesUpload({
  endpoint,
  pieces,
  onChange,
  obligatoire = false,
  urlsFixes = [],
  error,
}: {
  endpoint: string;
  pieces: readonly PieceDeposee[];
  onChange: (pieces: PieceDeposee[]) => void;
  obligatoire?: boolean;
  /** Pièces déjà enregistrées avec la demande : conservées par le serveur, donc non retirables ici. */
  urlsFixes?: readonly string[];
  error?: string;
}) {
  const [envoiEnCours, setEnvoiEnCours] = useState(false);
  const [erreurLocale, setErreurLocale] = useState<string | undefined>();

  async function ajouter(fichier: File | undefined) {
    if (!fichier) return;
    if (pieces.length >= MAX_PIECES) {
      setErreurLocale(`${MAX_PIECES} pièces au maximum par demande.`);
      return;
    }
    if (fichier.size > MAX_SIZE) {
      setErreurLocale("Le fichier dépasse la taille maximale autorisée (10 Mo).");
      return;
    }
    setErreurLocale(undefined);
    setEnvoiEnCours(true);
    try {
      const body = new FormData();
      body.set("file", fichier);
      const res = await fetch(endpoint, { method: "POST", body });
      const data = await res.json();
      if (!res.ok) {
        setErreurLocale(data.error ?? "Échec de l'envoi du fichier.");
        return;
      }
      onChange([...pieces, { url: data.url as string, nomFichier: (data.nomFichier as string) ?? fichier.name }]);
    } catch {
      setErreurLocale("Échec de l'envoi du fichier.");
    } finally {
      setEnvoiEnCours(false);
    }
  }

  return (
    <FormField
      label="Pièces justificatives"
      required={obligatoire}
      hint={`PDF, JPG ou PNG — 10 Mo maximum, ${MAX_PIECES} pièces au plus.${obligatoire ? "" : " Facultatif."}`}
      error={error ?? erreurLocale}
    >
      <div className="space-y-2">
        <input
          type="file"
          accept={ACCEPT}
          disabled={envoiEnCours || pieces.length >= MAX_PIECES}
          onChange={(e) => {
            void ajouter(e.target.files?.[0]);
            e.target.value = "";
          }}
          className="block w-full text-sm text-foreground file:mr-3 file:rounded-lg file:border-0 file:bg-primary/10 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-primary disabled:opacity-60"
        />
        {envoiEnCours ? <p className="text-xs text-muted-foreground">Envoi du fichier…</p> : null}
        {pieces.length > 0 ? (
          <ul className="space-y-1">
            {pieces.map((p) => (
              <li key={p.url} className="flex items-center justify-between gap-2 rounded-lg border border-border bg-muted px-3 py-2 text-sm">
                <span className="min-w-0 truncate">{p.nomFichier}</span>
                {urlsFixes.includes(p.url) ? (
                  <span className="shrink-0 text-xs text-muted-foreground">Déjà déposée</span>
                ) : (
                  <button
                    type="button"
                    onClick={() => onChange(pieces.filter((x) => x.url !== p.url))}
                    className="shrink-0 text-xs font-semibold text-danger hover:underline"
                  >
                    Retirer
                  </button>
                )}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </FormField>
  );
}
