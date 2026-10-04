"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";

import { suggererContratsAction } from "@/app/(dashboard)/encaissements/recherche/actions";
import { libelleSituation } from "@/components/encaissements/libelles";
import type { ResumeContrat } from "@/lib/encaissements/resumesContrats";

const DELAI_MS = 250;

/**
 * Barre de recherche du module Encaissements (F2, commit 5a) — dans le layout du module seulement, jamais dans
 * l'en-tête global. Police, client (nom ou identifiant), partenaire, produit, branche ou référence de paiement ;
 * plusieurs mots possibles, accents/apostrophes/tirets ignorés. Entrée ou clic ouvre la fiche police ; Entrée sans
 * suggestion choisie ouvre la page de résultats (sauf s'il n'y en a qu'une).
 */
export function RechercheContrats() {
  const router = useRouter();
  const idListe = useId();
  const [saisie, setSaisie] = useState("");
  const [suggestions, setSuggestions] = useState<ResumeContrat[]>([]);
  const [ouvert, setOuvert] = useState(false);
  const [actif, setActif] = useState(-1);
  const [enCours, setEnCours] = useState(false);
  // Garde contre les réponses arrivées dans le désordre : seule la dernière requête lancée est prise en compte.
  const derniereRequete = useRef(0);
  const conteneur = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const texte = saisie.trim();
    const numero = ++derniereRequete.current;
    if (texte.length === 0) return;
    const minuterie = setTimeout(async () => {
      setEnCours(true);
      try {
        const resultats = await suggererContratsAction(texte);
        if (numero !== derniereRequete.current) return;
        setSuggestions(resultats);
        setActif(-1);
        setOuvert(true);
      } finally {
        if (numero === derniereRequete.current) setEnCours(false);
      }
    }, DELAI_MS);
    return () => clearTimeout(minuterie);
  }, [saisie]);

  useEffect(() => {
    function auClicExterieur(e: MouseEvent) {
      if (conteneur.current && !conteneur.current.contains(e.target as Node)) setOuvert(false);
    }
    document.addEventListener("mousedown", auClicExterieur);
    return () => document.removeEventListener("mousedown", auClicExterieur);
  }, []);

  function ouvrirFiche(id: string) {
    setOuvert(false);
    router.push(`/encaissements/contrats/${id}`);
  }

  function auClavier(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (suggestions.length > 0) {
        setOuvert(true);
        setActif((i) => (i + 1) % suggestions.length);
      }
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (suggestions.length > 0) {
        setOuvert(true);
        setActif((i) => (i <= 0 ? suggestions.length - 1 : i - 1));
      }
    } else if (e.key === "Enter") {
      e.preventDefault();
      const texte = saisie.trim();
      if (!texte) return;
      if (ouvert && actif >= 0 && suggestions[actif]) return ouvrirFiche(suggestions[actif].id);
      if (ouvert && suggestions.length === 1) return ouvrirFiche(suggestions[0].id);
      setOuvert(false);
      router.push(`/encaissements/recherche?q=${encodeURIComponent(texte)}`);
    } else if (e.key === "Escape") {
      setOuvert(false);
      setActif(-1);
    }
  }

  const afficherListe = ouvert && saisie.trim().length > 0;

  return (
    <div ref={conteneur} className="relative">
      <label htmlFor={`${idListe}-saisie`} className="sr-only">
        Rechercher un contrat
      </label>
      <div className="relative">
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
        >
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" />
        </svg>
        <input
          id={`${idListe}-saisie`}
          type="search"
          role="combobox"
          aria-expanded={afficherListe}
          aria-controls={idListe}
          aria-autocomplete="list"
          aria-activedescendant={afficherListe && actif >= 0 ? `${idListe}-${actif}` : undefined}
          autoComplete="off"
          value={saisie}
          onChange={(e) => {
            setSaisie(e.target.value);
            if (!e.target.value.trim()) {
              derniereRequete.current++;
              setSuggestions([]);
              setOuvert(false);
              setEnCours(false);
            }
          }}
          onFocus={() => suggestions.length > 0 && setOuvert(true)}
          onKeyDown={auClavier}
          placeholder="Rechercher : n° de police, client, partenaire, produit, branche, référence de paiement…"
          className="w-full rounded-lg border border-border bg-background py-2.5 pl-9 pr-3 text-sm shadow-elevated placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
        />
      </div>

      {afficherListe && (
        <ul
          id={idListe}
          role="listbox"
          aria-label="Contrats trouvés"
          className="absolute z-30 mt-1 max-h-96 w-full overflow-y-auto rounded-lg border border-border bg-background py-1 shadow-elevated-lg"
        >
          {suggestions.length === 0 ? (
            <li className="px-3 py-2 text-sm text-muted-foreground">{enCours ? "Recherche…" : "Aucun contrat trouvé."}</li>
          ) : (
            suggestions.map((s, i) => (
              <li
                key={s.id}
                id={`${idListe}-${i}`}
                role="option"
                aria-selected={i === actif}
                onMouseDown={(e) => {
                  e.preventDefault();
                  ouvrirFiche(s.id);
                }}
                onMouseEnter={() => setActif(i)}
                className={`cursor-pointer px-3 py-2 text-sm ${i === actif ? "bg-primary-bg" : ""}`}
              >
                <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <span className="font-semibold tabular-nums">{s.numPolice}</span>
                  <span
                    className={`text-xs font-semibold tabular-nums ${
                      s.situation.type === "trop" ? "text-warning" : s.situation.type === "reste" ? "text-foreground" : "text-success"
                    }`}
                  >
                    {libelleSituation(s.situation)}
                  </span>
                </div>
                <div className="text-xs text-muted-foreground">
                  {[s.clientNom ?? "Client non renseigné", s.partenaire, s.branche].filter(Boolean).join(" · ")}
                </div>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
