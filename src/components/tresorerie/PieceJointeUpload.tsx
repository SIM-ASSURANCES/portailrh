"use client";

import { useState } from "react";

import { FormField } from "@/components/ui";

const ACCEPT = ".pdf,.jpg,.jpeg,.png";
const MAX_SIZE = 10 * 1024 * 1024; // 10 Mo

/**
 * Champ de pièce jointe partagé par les 3 formulaires concernés (création
 * de demande, chaque ligne de dépense d'un retour de caisse, dépense
 * directe) — un seul point d'upload, jamais trois implémentations
 * séparées de la même logique.
 *
 * Upload immédiat au choix du fichier (`POST /api/treso/pieces-jointes/upload`,
 * décodé en amont de toute création de Demande/DepenseLigne — ces entités
 * n'existent pas encore au moment où l'utilisateur choisit son fichier).
 * `onChange` remonte le nom de fichier généré (`url`) au parent, qui
 * l'inclut dans son propre appel de Server Action à la soumission — cette
 * route d'upload ne crée elle-même aucune ligne `PieceJointe` en base.
 *
 * Validation client (taille/type) redondante avec la route — même principe
 * que partout ailleurs dans le projet (l'UI donne un premier retour rapide,
 * le serveur reste la seule autorité réelle).
 */
export function PieceJointeUpload({
  label = "Pièce jointe",
  hint = "PDF, JPG ou PNG — 10 Mo maximum. Optionnel.",
  onChange,
  error,
}: {
  label?: string;
  hint?: string;
  onChange: (url: string | null) => void;
  error?: string;
}) {
  const [uploading, setUploading] = useState(false);
  const [localError, setLocalError] = useState<string | undefined>();
  const [fileName, setFileName] = useState<string | null>(null);

  async function handleFile(file: File | undefined) {
    if (!file) {
      setFileName(null);
      onChange(null);
      return;
    }
    if (file.size > MAX_SIZE) {
      setLocalError("Le fichier dépasse la taille maximale autorisée (10 Mo).");
      onChange(null);
      return;
    }

    setLocalError(undefined);
    setUploading(true);
    try {
      const body = new FormData();
      body.set("file", file);
      const res = await fetch("/api/treso/pieces-jointes/upload", { method: "POST", body });
      const data = await res.json();
      if (!res.ok) {
        setLocalError(data.error ?? "Échec de l'envoi du fichier.");
        setFileName(null);
        onChange(null);
        return;
      }
      setFileName(file.name);
      onChange(data.url as string);
    } catch {
      setLocalError("Échec de l'envoi du fichier.");
      setFileName(null);
      onChange(null);
    } finally {
      setUploading(false);
    }
  }

  return (
    <FormField label={label} hint={hint} error={error ?? localError}>
      <input
        type="file"
        accept={ACCEPT}
        disabled={uploading}
        onChange={(e) => handleFile(e.target.files?.[0])}
        className="block w-full rounded-md border border-border bg-surface text-sm text-foreground transition-colors duration-150 ease-out-strong hover:border-muted-foreground/60 file:mr-3 file:cursor-pointer file:rounded-md file:border-0 file:bg-primary file:px-3 file:py-2 file:text-sm file:font-medium file:text-primary-foreground disabled:cursor-not-allowed disabled:opacity-60"
      />
      {uploading ? <p className="mt-1 text-xs text-muted-foreground">Envoi en cours…</p> : null}
      {!uploading && fileName ? (
        <p className="mt-1 text-xs text-success">Fichier envoyé : {fileName}</p>
      ) : null}
    </FormField>
  );
}
