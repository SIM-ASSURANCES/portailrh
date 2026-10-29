/**
 * Comptes de test (`*@simassurances.test`) à désactiver après la remise à zéro de mise en production (lot R) — logique PURE.
 * On DÉSACTIVE, on ne supprime jamais (la suppression est refusée dès qu'un compte a une trace, et effacerait des auteurs).
 */
import { messageRefusResponsableSansRemplacant } from "./services";

export const SUFFIXE_EMAIL_TEST = "@simassurances.test";

export function estCompteDeTest(email: string | null | undefined): boolean {
  return typeof email === "string" && email.trim().toLowerCase().endsWith(SUFFIXE_EMAIL_TEST);
}

export interface CompteTest {
  id: string;
  fullName: string;
  email: string;
  roleName: string;
  /** Le RÔLE du compte porte `systeme.reinitialiser`. */
  porteReinitialisation: boolean;
  /** Services dont il est le responsable (désigné dans Administration › Services). */
  servicesResponsable: string[];
}

export interface RefusDesactivation {
  compte: CompteTest;
  raison: string;
}

export interface PlanDesactivation {
  aDesactiver: CompteTest[];
  refuses: RefusDesactivation[];
}

/**
 * Qui peut être désactivé parmi la sélection. Jamais : le compte connecté ; un responsable de service (les demandes de ses
 * membres resteraient bloquées à l'étape Service : même règle que la désactivation d'un compte dans Administration) ;
 * le DERNIER compte actif qui porte `systeme.reinitialiser` (sans lui, plus personne ne pourrait refaire la remise à zéro
 * ni la mise en service).
 * `porteursActifsIds` : tous les comptes actifs dont le rôle porte `systeme.reinitialiser` (test ou non).
 */
export function planifierDesactivation(
  selection: readonly CompteTest[],
  porteursActifsIds: readonly string[],
  connecteId: string
): PlanDesactivation {
  const refuses: RefusDesactivation[] = [];
  let restants: CompteTest[] = [];
  for (const c of selection) {
    if (c.id === connecteId) {
      refuses.push({ compte: c, raison: "C'est le compte avec lequel vous êtes connecté : il ne peut pas se désactiver lui-même." });
      continue;
    }
    const resp = messageRefusResponsableSansRemplacant(c.fullName, c.servicesResponsable, "desactiver");
    if (resp) {
      refuses.push({ compte: c, raison: resp });
      continue;
    }
    restants.push(c);
  }
  // Dernier porteur de systeme.reinitialiser : si, la sélection retenue désactivée, plus aucun compte actif ne le porte,
  // les porteurs de la sélection sont refusés (créer d'abord un vrai compte DG).
  const idsRetenus = new Set(restants.map((c) => c.id));
  const porteursApres = porteursActifsIds.filter((id) => !idsRetenus.has(id));
  if (porteursApres.length === 0) {
    const porteurs = restants.filter((c) => c.porteReinitialisation);
    for (const c of porteurs) {
      refuses.push({
        compte: c,
        raison:
          "C'est le dernier compte actif qui porte « systeme.reinitialiser » : créez d'abord le compte réel du DG (rôle DG), puis désactivez celui-ci.",
      });
    }
    restants = restants.filter((c) => !c.porteReinitialisation);
  }
  return { aDesactiver: restants, refuses };
}
