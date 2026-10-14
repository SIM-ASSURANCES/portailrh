import { describe, expect, it } from "vitest";

import {
  dateLivraisonAEnregistrer,
  jourDepuisDate,
  libelleDateLivraison,
  MESSAGE_DATE_LIVRAISON_INVALIDE,
  MESSAGE_DATE_LIVRAISON_PASSEE,
  refusDateLivraison,
  versDateStockee,
} from "./dateLivraisonArticle";

describe("date de livraison par article", () => {
  it("refuse le passé, accepte aujourd'hui, le futur et le vide", () => {
    expect(refusDateLivraison("2026-10-13", "2026-10-14")).toBe(MESSAGE_DATE_LIVRAISON_PASSEE);
    expect(refusDateLivraison("2026-10-14", "2026-10-14")).toBeNull();
    expect(refusDateLivraison("2026-12-01", "2026-10-14")).toBeNull();
    expect(refusDateLivraison("", "2026-10-14")).toBeNull();
    expect(refusDateLivraison(undefined, "2026-10-14")).toBeNull();
  });
  it("refuse un format invalide", () => {
    expect(refusDateLivraison("demain", "2026-10-14")).toBe(MESSAGE_DATE_LIVRAISON_INVALIDE);
    expect(refusDateLivraison("2026-13-45", "2026-10-14")).toBe(MESSAGE_DATE_LIVRAISON_INVALIDE);
  });
  it("un article sans date propre reçoit la date commune (copiée) ; sans date commune, rien", () => {
    expect(dateLivraisonAEnregistrer("2026-11-01", "2026-12-01")).toBe("2026-11-01");
    expect(dateLivraisonAEnregistrer("", "2026-12-01")).toBe("2026-12-01");
    expect(dateLivraisonAEnregistrer(null, undefined)).toBeNull();
  });
  it("aller-retour stockage / affichage ; un ancien article vide s'affiche « — »", () => {
    const d = versDateStockee("2026-11-05");
    expect(jourDepuisDate(d)).toBe("2026-11-05");
    expect(libelleDateLivraison(d)).toBe("05/11/2026");
    expect(libelleDateLivraison(null)).toBe("—");
    expect(versDateStockee(null)).toBeNull();
    expect(jourDepuisDate(null)).toBe("");
  });
});
