// Retour de caisse nul et reçu du retour (2026-10-08). Fonctions pures, sans dépendance Prisma : partagées par les
// Server Actions, la route du reçu PDF et les écrans.

/** Action d'historique (entité Demande) d'un retour nul constaté à la réception — visible du collaborateur. */
export const ACTION_RETOUR_NUL_CONSTATE = "retour_nul_constate";

/** Phrase de l'écran du collaborateur, et refus serveur d'une déclaration sans objet. */
export const MESSAGE_RIEN_A_RENDRE =
  "Rien à rendre sur ce règlement : les dépenses couvrent les fonds remis. Aucune déclaration n'est attendue de votre part.";

const centimes = (m: number) => Math.round(m * 100);

/**
 * Un retour est « nul » quand le montant à rendre calculé vaut 0 sur un règlement Caisse : sa réception n'écrit aucun
 * mouvement dans le journal de caisse (un mouvement de 0 FCFA n'a pas de sens), seulement un constat dans l'historique.
 * Un retour Banque n'est jamais nul (montant reversé > 0, bordereau obligatoire).
 */
export function estRetourNul(retour: { montantARetourner: number; mode: "CAISSE" | "BANQUE" }): boolean {
  return retour.mode === "CAISSE" && centimes(retour.montantARetourner) === 0;
}

/** Plus rien à rendre sur ce règlement (solde calculé nul) : le collaborateur n'a rien à déclarer. */
export function rienARendre(soldeARendre: number): boolean {
  return centimes(soldeARendre) <= 0;
}

/** Texte de l'entrée d'historique du retour nul constaté (qui, quand, sur quel montant remis). */
export function detailRetourNulConstate(p: { auteurNom: string; date: Date; montantRegle: number; totalDepenses: number }): string {
  const jour = p.date.toLocaleDateString("fr-FR", { timeZone: "Africa/Abidjan" });
  const heure = p.date.toLocaleTimeString("fr-FR", { timeZone: "Africa/Abidjan", hour: "2-digit", minute: "2-digit" });
  return (
    `Retour nul constaté par ${p.auteurNom} le ${jour} à ${heure} : dépenses (${p.totalDepenses.toLocaleString("fr-FR")} FCFA) ` +
    `égales aux fonds remis (${p.montantRegle.toLocaleString("fr-FR")} FCFA), aucun mouvement de caisse.`
  );
}

/**
 * Référence du reçu d'un retour : même convention que le reçu de règlement (`<référence demande>-R<rang>`), avec le
 * préfixe RC et le rang du retour parmi les retours RÉCEPTIONNÉS de la demande (ordre de réception).
 */
export function referenceRecuRetour(demandeReference: string, rang: number): string {
  return `${demandeReference}-RC${rang}`;
}
