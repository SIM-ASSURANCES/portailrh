"use client";

import { useState } from "react";

import { PieceJointeUpload } from "@/components/tresorerie/PieceJointeUpload";

export interface PieceSaisie {
  /** Nom de fichier généré par la route d'envoi. */
  url: string;
  /** Nom d'origine, pour l'affichage seulement. */
  nom: string;
}

/**
 * Plusieurs pièces jointes pour un même article (autonomie des articles, lot A) : chaque fichier est envoyé dès sa
 * sélection (même route que la pièce commune), puis listé avec un bouton « Retirer ». Le champ d'envoi se vide après
 * chaque ajout pour pouvoir en ajouter une autre.
 */
export function PiecesJointesMultiples({
  pieces,
  onChange,
  label = "Pièces de l'article",
}: {
  pieces: PieceSaisie[];
  onChange: (pieces: PieceSaisie[]) => void;
  label?: string;
}) {
  const [cle, setCle] = useState(0);
  return (
    <div className="space-y-2" data-pieces-article-champ>
      {pieces.length > 0 ? (
        <ul className="space-y-1 text-sm">
          {pieces.map((p) => (
            <li key={p.url} className="flex items-center justify-between gap-2 rounded-md bg-muted px-3 py-1.5">
              <span className="min-w-0 truncate text-foreground">{p.nom}</span>
              <button
                type="button"
                className="shrink-0 text-xs font-medium text-danger underline-offset-4 hover:underline"
                onClick={() => onChange(pieces.filter((x) => x.url !== p.url))}
              >
                Retirer
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <PieceJointeUpload
        key={cle}
        label={pieces.length === 0 ? label : "Ajouter une autre pièce"}
        onChange={(url, nom) => {
          if (!url) return;
          onChange([...pieces, { url, nom: nom ?? "Pièce jointe" }]);
          setCle((c) => c + 1);
        }}
      />
    </div>
  );
}
