/* eslint-disable @typescript-eslint/no-explicit-any */
//import { describe, it } from "node:test";
import { describe, it } from "vitest";

import assert from "node:assert/strict";
import {
  FEEDBACK_CONTENT_MIN,
  FEEDBACK_CONTENT_MAX,
  containsBannedContent,
  containsUrl,
} from "../feedback-constants";
import { modererFeedback, retablirFeedback } from "../feedback";
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

describe("FeedbackApp — Tests Unitaires de la Modération (masquer, rétablir)", () => {
  const RH = { voirDetails: true };
  const ADMIN = { voirDetails: false };

  /** Remplace la lecture et la transaction par des doublures qui notent les écritures. */
  async function avecBase(feedback: any, run: (ecritures: { maj: any[]; historique: any[] }) => Promise<void>) {
    const ecritures = { maj: [] as any[], historique: [] as any[] };
    const findOriginal = prisma.feedback.findUnique;
    const txOriginal = prisma.$transaction;
    prisma.feedback.findUnique = (async () => feedback) as any;
    (prisma as any).$transaction = async (fn: any) =>
      fn({
        feedback: { updateMany: async (a: any) => (ecritures.maj.push(a), { count: 1 }) },
        historiqueEntry: { create: async (a: any) => ecritures.historique.push(a.data) },
      });
    try {
      await run(ecritures);
    } finally {
      prisma.feedback.findUnique = findOriginal;
      (prisma as any).$transaction = txOriginal;
    }
  }

  it("rejette si le motif fait moins de 3 caractères, sans accès à la base", async () => {
    for (const action of [modererFeedback, retablirFeedback]) {
      for (const motif of ["ab", "   "]) {
        const res = await action("fb-123", "mod-456", motif, RH);
        assert.strictEqual(res.success, false);
        assert.match(res.message, /au moins 3 caractères/i);
      }
    }
  });

  it("introuvable : avis inexistant, comme avis « Conditions de travail » sans le droit de le lire (quel que soit son état)", async () => {
    const cas = [
      null,
      { id: "ct", type: "CONDITIONS_TRAVAIL", isModerated: false },
      { id: "ct", type: "CONDITIONS_TRAVAIL", isModerated: true },
    ];
    for (const feedback of cas) {
      await avecBase(feedback, async (e) => {
        for (const action of [modererFeedback, retablirFeedback]) {
          const res = await action("ct", "admin", "Motif valable", ADMIN);
          assert.deepStrictEqual(res, { success: false, message: "Message introuvable." });
        }
        assert.strictEqual(e.maj.length + e.historique.length, 0);
      });
    }
  });

  it("refuse de masquer un avis déjà masqué et de rétablir un avis visible", async () => {
    await avecBase({ id: "a", type: "COLLABORATION", isModerated: true }, async () => {
      assert.strictEqual((await modererFeedback("a", "m", "Deuxième tentative", RH)).message, "Ce message a déjà été modéré.");
    });
    await avecBase({ id: "a", type: "COLLABORATION", isModerated: false }, async () => {
      assert.strictEqual((await retablirFeedback("a", "m", "Rien à rétablir", RH)).message, "Ce message n'est pas masqué.");
    });
  });

  it("masque avec une ligne d'historique (un compte sans voir_details peut masquer un avis « Collaboration »)", async () => {
    await avecBase({ id: "a", type: "COLLABORATION", isModerated: false }, async (e) => {
      const res = await modererFeedback("a", "mod-1", "  Propos agressifs  ", ADMIN);
      assert.strictEqual(res.success, true);
      assert.deepStrictEqual(e.maj[0].where, { id: "a", isModerated: false });
      assert.strictEqual(e.maj[0].data.motifModeration, "Propos agressifs");
      assert.strictEqual(e.maj[0].data.moderatedById, "mod-1");
      assert.deepStrictEqual(e.historique, [
        { entity: "Feedback", entityId: "a", action: "moderation_masquage", detail: "Avis masqué. Motif : Propos agressifs", userId: "mod-1" },
      ]);
    });
  });

  it("rétablit sans réécrire les colonnes du masquage, que l'historique rappelle ; entité distincte pour les conditions de travail", async () => {
    const masque = {
      id: "ct",
      type: "CONDITIONS_TRAVAIL",
      isModerated: true,
      motifModeration: "Masqué par erreur",
      moderatedAt: new Date("2026-11-20T10:00:00Z"),
    };
    await avecBase(masque, async (e) => {
      const res = await retablirFeedback("ct", "mod-2", "Avis finalement acceptable", RH);
      assert.strictEqual(res.success, true);
      assert.deepStrictEqual(e.maj, [{ where: { id: "ct", isModerated: true }, data: { isModerated: false } }]);
      assert.deepStrictEqual(e.historique, [
        {
          entity: "FeedbackConditionsTravail",
          entityId: "ct",
          action: "moderation_retablissement",
          detail: "Avis rétabli. Motif : Avis finalement acceptable. Masquage levé du 20/11/2026 (motif : Masqué par erreur).",
          userId: "mod-2",
        },
      ]);
    });
  });
});
