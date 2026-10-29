import { z } from "zod";

import { lireMontant, type OptionsMontant } from "backend";

/**
 * Schéma zod d'un montant reçu d'un formulaire ou d'un appel direct (lot M) : le TEXTE brut (« 1 500 000 », « 1.500.000 »)
 * ou un nombre est réanalysé ici avec la même règle que l'écran (`backend/src/montant.ts`) — le serveur ne fait jamais
 * confiance au formatage du client. Produit un `number`. Sans devise connue : FCFA (entiers). Pour une devise propre à la
 * demande, appeler `lireMontant(brut, { devise })` une fois la demande chargée.
 */
export function schemaMontant(options: OptionsMontant & { positif?: boolean; messagePositif?: string; zeroAdmis?: boolean } = {}) {
  const { positif = true, messagePositif = "Le montant doit être supérieur à 0.", zeroAdmis = false, ...analyse } = options;
  return z
    .unknown()
    .transform((brut, ctx) => {
      const r = lireMontant(brut, analyse);
      if (!r.ok) {
        ctx.addIssue({ code: "custom", message: r.message });
        return z.NEVER;
      }
      return r.valeur;
    })
    .pipe(positif ? z.number().refine((v) => v > 0, messagePositif) : zeroAdmis ? z.number() : z.number().refine((v) => v >= 0, messagePositif));
}
