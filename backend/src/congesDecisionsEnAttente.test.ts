// Décisions de la RH encore ATTENDUES (relecture du 2026-10-16, consignes partie B) : rien n'est implémenté.
// Chaque cas décrit le comportement visé SI l'option recommandée est retenue.

import { describe, it } from "vitest";

describe("B1 — même personne aux deux étapes", () => {
  it.todo("congé : à l'étape RH, celui qui a approuvé l'étape responsable (approuveParId) est refusé, même s'il porte conges.valider_rh");
  it.todo("congé : la demande passe alors à un autre compte RH, sinon au DG (repli)");
  it.todo("permission : même règle (approuveParId refusé à l'étape RH), repli sur un autre compte RH puis le DG");
  it.todo("la phrase du refus est la même côté serveur et côté écran (bouton grisé)");
});

describe("B2 — congé dans le passé", () => {
  it.todo("preparerConge refuse une date de début antérieure à aujourd'hui pour une demande (soumission et resoumission)");
  it.todo("accorderCongeOffice (RH, régularisation) accepte une date de début passée");
});

describe("B3 — règles de solde (D6), provisoires", () => {
  it.todo("dotation complète à la date anniversaire, jours entiers, pas de report, maladie non déductible : isolées dans des fonctions pures (congesCalcul.ts)");
  it.todo("à remplacer selon la réponse de la RH, sans que rien d'autre n'en dépende");
});
