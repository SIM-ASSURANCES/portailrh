import { redirect } from "next/navigation";

/**
 * Ancienne route de soumission — le formulaire vit désormais directement
 * sur `/feedback` (section "Soumettre un feedback", voir CLAUDE.md
 * "FeedbackApp — refonte visuelle de la soumission") : hero, réassurance
 * et avis publics partagent maintenant la même page que la soumission,
 * plutôt qu'un aller-retour entre deux routes. Redirection conservée
 * (jamais un simple retrait de la route) pour ne pas casser un ancien
 * lien/signet vers `/feedback/nouveau` — ancre directement sur la section
 * de soumission plutôt que le haut de page, même principe que la
 * redirection déjà en place pour `/admin/feedbacks` → `/feedback/admin`.
 */
export default function NouveauFeedbackRedirectPage() {
  redirect("/feedback#soumettre-un-feedback");
}
