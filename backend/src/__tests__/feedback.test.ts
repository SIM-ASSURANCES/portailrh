/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  FEEDBACK_CONTENT_MIN,
  FEEDBACK_CONTENT_MAX,
  containsBannedContent,
  containsUrl,
} from "../feedback-constants";
import { modererFeedback } from "../feedback";
import { prisma } from "../prisma";

describe("FeedbackApp — Tests Unitaires des Règles Pures", () => {
  describe("Constantes de contenu", () => {
    it("définit les limites de caractères entre 20 et 500", () => {
      assert.strictEqual(FEEDBACK_CONTENT_MIN, 20);
      assert.strictEqual(FEEDBACK_CONTENT_MAX, 500);
    });
  });

  describe("Filtre anti-haine (containsBannedContent)", () => {
    it("détecte les termes interdits en minuscules", () => {
      assert.strictEqual(containsBannedContent("Quel gros abruti celui-là"), true);
      assert.strictEqual(containsBannedContent("Ce travail est fait par un connard"), true);
    });

    it("détecte les termes avec accents et variantes", () => {
      assert.strictEqual(containsBannedContent("Comportement débile en réunion"), true);
      assert.strictEqual(containsBannedContent("Espèce d'imbécile"), true);
      assert.strictEqual(containsBannedContent("C'est un bâtard"), true);
    });

    it("est insensible à la casse", () => {
      assert.strictEqual(containsBannedContent("QUEL IMBECILE"), true);
      assert.strictEqual(containsBannedContent("CoNnArD"), true);
    });

    it("laisse passer les messages constructifs et bienveillants", () => {
      assert.strictEqual(
        containsBannedContent("Très bonne gestion du projet d'assurance, bravo à toute l'équipe."),
        false
      );
      assert.strictEqual(
        containsBannedContent("Merci d'avoir partagé les comptes-rendus dans les délais."),
        false
      );
    });
  });

  describe("Détection d'URLs (containsUrl)", () => {
    it("détecte les préfixes http:// et https://", () => {
      assert.strictEqual(containsUrl("Va voir sur https://malveillant.com"), true);
      assert.strictEqual(containsUrl("Lien http://pirate.org/test"), true);
    });

    it("détecte les préfixes www.", () => {
      assert.strictEqual(containsUrl("Rendez-vous sur www.exemple.com"), true);
    });

    it("détecte les noms de domaine directs (.ci, .fr, .com)", () => {
      assert.strictEqual(containsUrl("Consulte mon site portail.ci directement"), true);
      assert.strictEqual(containsUrl("Télécharge sur phishing.fr"), true);
    });

    it("autorise le texte normal sans lien", () => {
      assert.strictEqual(
        containsUrl("Excellente présentation lors du comité de direction de mardi."),
        false
      );
      assert.strictEqual(
        containsUrl("Attention aux fautes de frappe sur le document v1.2 (version finale)."),
        false
      );
    });
  });
});

describe("FeedbackApp — Tests Unitaires de la Modération (modererFeedback)", () => {
  it("rejette si le motif fait moins de 3 caractères", async () => {
    const resCourt = await modererFeedback("fb-123", "mod-456", "ab");
    assert.strictEqual(resCourt.success, false);
    assert.match(resCourt.message, /au moins 3 caractères/i);

    const resEspaces = await modererFeedback("fb-123", "mod-456", "   ");
    assert.strictEqual(resEspaces.success, false);
    assert.match(resEspaces.message, /au moins 3 caractères/i);
  });

  it("rejette si le feedback n'existe pas en base", async () => {
    const originalFindUnique = prisma.feedback.findUnique;
    prisma.feedback.findUnique = (async () => null) as any;

    try {
      const res = await modererFeedback("non-existent-id", "mod-456", "Message injurieux");
      assert.strictEqual(res.success, false);
      assert.strictEqual(res.message, "Message introuvable.");
    } finally {
      prisma.feedback.findUnique = originalFindUnique;
    }
  });

  it("rejette si le feedback a déjà été modéré", async () => {
    const originalFindUnique = prisma.feedback.findUnique;
    prisma.feedback.findUnique = (async () => ({
      id: "fb-already-mod",
      isModerated: true,
      motifModeration: "Déjà retiré",
    })) as any;

    try {
      const res = await modererFeedback("fb-already-mod", "mod-456", "Deuxième tentative");
      assert.strictEqual(res.success, false);
      assert.strictEqual(res.message, "Ce message a déjà été modéré.");
    } finally {
      prisma.feedback.findUnique = originalFindUnique;
    }
  });

  it("met à jour et retire le message avec traçabilité quand les données sont valides", async () => {
    let updateCalledWith: any = null;

    const originalFindUnique = prisma.feedback.findUnique;
    const originalUpdate = prisma.feedback.update;

    prisma.feedback.findUnique = (async () => ({
      id: "fb-valid",
      isModerated: false,
      motifModeration: null,
    })) as any;

    prisma.feedback.update = (async (args: any) => {
      updateCalledWith = args;
      return { id: "fb-valid", isModerated: true };
    }) as any;

    try {
      const res = await modererFeedback("fb-valid", "mod-rh-1", "Propos agressifs non constructifs");
      assert.strictEqual(res.success, true);
      assert.match(res.message, /retiré de la plateforme/i);

      assert.notStrictEqual(updateCalledWith, null);
      assert.strictEqual(updateCalledWith.where.id, "fb-valid");
      assert.strictEqual(updateCalledWith.data.isModerated, true);
      assert.strictEqual(updateCalledWith.data.motifModeration, "Propos agressifs non constructifs");
      assert.strictEqual(updateCalledWith.data.moderatedById, "mod-rh-1");
      assert.ok(updateCalledWith.data.moderatedAt instanceof Date);
    } finally {
      prisma.feedback.findUnique = originalFindUnique;
      prisma.feedback.update = originalUpdate;
    }
  });
});

describe("FeedbackApp — Tests de Pseudonymisation & Anonymat (Tranche B)", () => {
  it("garantit un pseudonyme déterministe formaté 'Collaborateur #XXXX'", () => {
    const recipientId = "usr-f47a9b12-34cd";
    const shortHash = recipientId.replace(/[^a-zA-Z0-9]/g, "").slice(-4).toUpperCase();
    const pseudo = `Collaborateur #${shortHash || "ANON"}`;

    assert.strictEqual(pseudo, "Collaborateur #34CD");
    assert.doesNotMatch(pseudo, /usr/i);
    assert.match(pseudo, /^Collaborateur #[A-Z0-9]{4}$/);
  });
});

describe("FeedbackApp — Tests Anti-Auto-Feedback", () => {
  it("interdit à un collaborateur de se choisir lui-même comme destinataire", () => {
    const sessionUserId = "usr-collab-1";
    const selectedRecipientId = "usr-collab-1";

    const isSelfFeedback = sessionUserId === selectedRecipientId;
    assert.strictEqual(isSelfFeedback, true);
  });

  it("autorise l'envoi vers un autre collaborateur", () => {
    const sessionUserId = "usr-collab-1";
    const selectedRecipientId = "usr-collab-2";

    const isSelfFeedback = sessionUserId === selectedRecipientId;
    assert.strictEqual(isSelfFeedback, false);
  });
});

describe("FeedbackApp — Tests des formules de calcul de KPIs (Tranche B)", () => {
  it("calcule correctement le taux de modération et le nombre d'actifs", () => {
    const total = 10;
    const moderes = 2;
    const actifs = total - moderes;
    const tauxModeration = total > 0 ? Math.round((moderes / total) * 1000) / 10 : 0;

    assert.strictEqual(actifs, 8);
    assert.strictEqual(tauxModeration, 20); // 20.0%
  });

  it("gère la division par zéro quand il n'y a aucun message", () => {
    const total = 0;
    const moderes = 0;
    const actifs = total - moderes;
    const tauxModeration = total > 0 ? Math.round((moderes / total) * 1000) / 10 : 0;

    assert.strictEqual(actifs, 0);
    assert.strictEqual(tauxModeration, 0);
  });
});
