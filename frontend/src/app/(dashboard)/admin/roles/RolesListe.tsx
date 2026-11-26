"use client";

import { useEffect, useLayoutEffect, useRef, useState, type DragEvent, type ReactNode } from "react";

import { Icon } from "@/components/icons";
import { Badge, Button } from "@/components/ui";

export interface RoleCarte {
  id: string;
  nom: string;
  estAdmin: boolean;
  beneficiaireDelegation: boolean;
  nbPermissions: number;
  /** Rendu par la page (Server Component) : les cases à cocher ne sont jamais reconstruites ici. */
  corps: ReactNode;
}

// Confort personnel, propre à ce navigateur : rien n'est enregistré en base.
const CLE_ORDRE = "admin-roles:ordre";
const CLE_DEPLIES = "admin-roles:deplies";
// Type propre au glisser des cartes : un champ de saisie n'accepte pas ce dépôt (contrairement à « text/plain »).
const TYPE_GLISSE = "application/x-role-id";

function lireIds(cle: string): string[] | null {
  try {
    const valeur: unknown = JSON.parse(window.localStorage.getItem(cle) ?? "null");
    return Array.isArray(valeur) ? valeur.filter((v): v is string => typeof v === "string") : null;
  } catch {
    return null;
  }
}

function ecrireIds(cle: string, ids: string[] | null) {
  try {
    if (ids) window.localStorage.setItem(cle, JSON.stringify(ids));
    else window.localStorage.removeItem(cle);
  } catch {
    // Stockage indisponible : le choix vaut seulement jusqu'au prochain chargement.
  }
}

/** Ordre mémorisé d'abord (rôles disparus ignorés), puis les rôles inconnus dans l'ordre du serveur. */
function ordonner(roles: RoleCarte[], ordre: string[] | null): RoleCarte[] {
  if (!ordre) return roles;
  const parId = new Map(roles.map((r) => [r.id, r]));
  const connus = [...new Set(ordre)].flatMap((id) => parId.get(id) ?? []);
  const dejaPlaces = new Set(connus.map((r) => r.id));
  return [...connus, ...roles.filter((r) => !dejaPlaces.has(r.id))];
}

type Sens = "monter" | "descendre";
type Cible = { id: string; position: "avant" | "apres" };

const CLASSE_BOUTON_ORDRE =
  "flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary disabled:cursor-default disabled:opacity-30 disabled:hover:bg-transparent";

export function RolesListe({ roles }: { roles: RoleCarte[] }) {
  const [ordre, setOrdre] = useState<string[] | null>(null);
  const [deplies, setDeplies] = useState<string[]>([]);
  const [glisse, setGlisse] = useState<string | null>(null);
  const [cible, setCible] = useState<Cible | null>(null);
  const aRefocaliser = useRef<{ id: string; sens: Sens } | null>(null);
  const boutons = useRef(new Map<string, HTMLButtonElement>());

  // Lecture APRÈS le montage : le rendu serveur et l'hydratation voient le même contenu (ordre serveur, tout plié).
  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect */
    setOrdre(lireIds(CLE_ORDRE));
    setDeplies(lireIds(CLE_DEPLIES) ?? []);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

  const affiches = ordonner(roles, ordre);
  const ids = affiches.map((r) => r.id);

  // Déplacer une carte déplace ses éléments dans le DOM et peut faire perdre le focus clavier : on le rend au bouton
  // utilisé, ou à son voisin s'il vient d'être désactivé (carte arrivée en tête ou en fin de liste).
  useLayoutEffect(() => {
    const demande = aRefocaliser.current;
    if (!demande) return;
    aRefocaliser.current = null;
    const autre: Sens = demande.sens === "monter" ? "descendre" : "monter";
    const voulu = boutons.current.get(`${demande.id}:${demande.sens}`);
    (voulu && !voulu.disabled ? voulu : boutons.current.get(`${demande.id}:${autre}`))?.focus();
  }, [ordre]);

  function changerDeplies(suivants: string[]) {
    setDeplies(suivants);
    ecrireIds(CLE_DEPLIES, suivants);
  }

  function changerOrdre(suivant: string[] | null) {
    setOrdre(suivant);
    ecrireIds(CLE_ORDRE, suivant);
  }

  function deplacer(id: string, sens: Sens) {
    const depuis = ids.indexOf(id);
    const vers = depuis + (sens === "monter" ? -1 : 1);
    if (depuis < 0 || vers < 0 || vers >= ids.length) return;
    const suivant = [...ids];
    [suivant[depuis], suivant[vers]] = [suivant[vers], suivant[depuis]];
    aRefocaliser.current = { id, sens };
    changerOrdre(suivant);
  }

  function finGlisser() {
    setGlisse(null);
    setCible(null);
  }

  function positionSurvolee(e: DragEvent<HTMLLIElement>): Cible["position"] {
    const cadre = e.currentTarget.getBoundingClientRect();
    return e.clientY < cadre.top + cadre.height / 2 ? "avant" : "apres";
  }

  function survoler(e: DragEvent<HTMLLIElement>, id: string) {
    if (!glisse) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    const position = positionSurvolee(e);
    if (cible?.id !== id || cible.position !== position) setCible({ id, position });
  }

  function deposer(e: DragEvent<HTMLLIElement>, id: string) {
    if (!glisse) return;
    e.preventDefault();
    if (glisse !== id) {
      const suivant = ids.filter((i) => i !== glisse);
      suivant.splice(suivant.indexOf(id) + (positionSurvolee(e) === "apres" ? 1 : 0), 0, glisse);
      changerOrdre(suivant);
    }
    finGlisser();
  }

  function refBouton(cle: string) {
    return (element: HTMLButtonElement | null) => {
      if (element) boutons.current.set(cle, element);
      else boutons.current.delete(cle);
    };
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="secondary" onClick={() => changerDeplies(ids)}>
          Tout déplier
        </Button>
        <Button type="button" variant="secondary" onClick={() => changerDeplies([])}>
          Tout plier
        </Button>
        <button
          type="button"
          onClick={() => changerOrdre(null)}
          className="ml-auto cursor-pointer text-sm text-muted-foreground underline underline-offset-2 hover:text-foreground"
        >
          Ordre par défaut
        </button>
      </div>

      <ul
        className="space-y-3"
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setCible(null);
        }}
      >
        {affiches.map((role, index) => {
          const ouvert = deplies.includes(role.id);
          const idCorps = `role-corps-${role.id}`;
          const repere = glisse && glisse !== role.id && cible?.id === role.id ? cible.position : null;

          return (
            <li
              key={role.id}
              data-role-id={role.id}
              onDragOver={(e) => survoler(e, role.id)}
              onDrop={(e) => deposer(e, role.id)}
              className={`card-shadow-hover relative rounded-2xl border border-border bg-surface shadow-elevated ${
                glisse === role.id ? "opacity-50" : ""
              }`}
            >
              {repere ? (
                <span
                  aria-hidden="true"
                  data-repere-depot={repere}
                  className={`pointer-events-none absolute inset-x-0 h-1 rounded-full bg-primary ${
                    repere === "avant" ? "-top-2" : "-bottom-2"
                  }`}
                />
              ) : null}

              <div className="flex items-center gap-1 p-2">
                {/* Seul élément « draggable » : le corps de la carte ne déclenche jamais de déplacement.
                    Au clavier et au doigt, ce sont les boutons Monter / Descendre. */}
                <span
                  draggable
                  data-poignee
                  aria-hidden="true"
                  title="Glisser pour déplacer"
                  onDragStart={(e) => {
                    e.dataTransfer.setData(TYPE_GLISSE, role.id);
                    e.dataTransfer.effectAllowed = "move";
                    const carte = e.currentTarget.closest("li");
                    if (carte) e.dataTransfer.setDragImage(carte, 20, 20);
                    setGlisse(role.id);
                  }}
                  onDragEnd={finGlisser}
                  className="flex size-9 shrink-0 cursor-grab items-center justify-center rounded-lg text-muted-foreground hover:bg-muted active:cursor-grabbing"
                >
                  <Icon name="menu" className="size-4" />
                </span>

                <h2 className="min-w-0 flex-1">
                  <button
                    type="button"
                    aria-expanded={ouvert}
                    aria-controls={idCorps}
                    onClick={() =>
                      changerDeplies(ouvert ? deplies.filter((i) => i !== role.id) : [...deplies, role.id])
                    }
                    className="flex w-full cursor-pointer items-center gap-2 rounded-lg px-1 py-2 text-left focus-visible:outline-2 focus-visible:outline-primary"
                  >
                    <Icon
                      name="chevron-right"
                      className={`size-4 shrink-0 text-muted-foreground motion-safe:transition-transform ${
                        ouvert ? "rotate-90" : ""
                      }`}
                    />
                    <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="min-w-0 font-semibold break-words text-foreground">{role.nom}</span>
                      {role.estAdmin ? <Badge variant="info">Accès administrateur</Badge> : null}
                      {role.beneficiaireDelegation ? (
                        <Badge variant="neutral">Bénéficiaire de délégation</Badge>
                      ) : null}
                      <span className="text-sm font-normal text-muted-foreground">
                        {role.nbPermissions} permission{role.nbPermissions > 1 ? "s" : ""}
                      </span>
                    </span>
                  </button>
                </h2>

                <button
                  type="button"
                  ref={refBouton(`${role.id}:monter`)}
                  aria-label={`Monter le rôle ${role.nom}`}
                  title="Monter"
                  disabled={index === 0}
                  onClick={() => deplacer(role.id, "monter")}
                  className={CLASSE_BOUTON_ORDRE}
                >
                  <Icon name="arrow-left" className="size-4 rotate-90" />
                </button>
                <button
                  type="button"
                  ref={refBouton(`${role.id}:descendre`)}
                  aria-label={`Descendre le rôle ${role.nom}`}
                  title="Descendre"
                  disabled={index === affiches.length - 1}
                  onClick={() => deplacer(role.id, "descendre")}
                  className={CLASSE_BOUTON_ORDRE}
                >
                  <Icon name="arrow-right" className="size-4 rotate-90" />
                </button>
              </div>

              {/* Caché, jamais démonté : les cases utilisent `defaultChecked` (+ useOptimistic). */}
              <div id={idCorps} hidden={!ouvert}>
                <div className="border-t border-border p-5">{role.corps}</div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
