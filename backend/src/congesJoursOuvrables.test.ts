// C2 (consignes du 2026-10-16) : jours ouvrables = du lundi au vendredi, hors jours fériés. La règle est celle du code
// (`estNonOuvre` / `estJourNonOuvre`) : ces tests la FIXENT ; les libellés d'écran la nomment.

import { describe, expect, it } from "vitest";

import { calculerNbJours, dateFinPourJours } from "./congesCalcul";
import { LIBELLE_DECOMPTE_CONGE } from "./typesCongeHistorique";

// 2026-10-16 est un vendredi.
describe("Jours ouvrables : lundi à vendredi, hors jours fériés", () => {
  it("un mariage de 4 jours commencé un vendredi finit le mercredi", () => {
    const fin = dateFinPourJours({ debut: "2026-10-16", nbJours: 4, decompte: "OUVRABLE", joursFeries: [] });
    expect(fin).toBe("2026-10-21");
    expect(new Date("2026-10-21T00:00:00Z").getUTCDay()).toBe(3); // mercredi
  });

  it("le samedi et le dimanche ne comptent pas", () => {
    const d = calculerNbJours({ debut: "2026-10-16", fin: "2026-10-19", decompte: "OUVRABLE", joursFeries: [] });
    expect(d.nbJours).toBe(2); // vendredi + lundi
    expect(d.joursCalendaires).toBe(4);
  });

  it("un jour férié en semaine ne compte pas non plus : la fin recule d'un jour ouvrable", () => {
    const fin = dateFinPourJours({ debut: "2026-10-16", nbJours: 4, decompte: "OUVRABLE", joursFeries: ["2026-10-19"] });
    expect(fin).toBe("2026-10-22"); // jeudi : vendredi, mardi, mercredi, jeudi
  });

  it("le décompte calendaire compte tous les jours", () => {
    expect(dateFinPourJours({ debut: "2026-10-16", nbJours: 4, decompte: "CALENDAIRE", joursFeries: [] })).toBe("2026-10-19");
  });

  it("les libellés d'écran nomment la règle", () => {
    expect(LIBELLE_DECOMPTE_CONGE.OUVRABLE).toBe("jours ouvrables (lundi à vendredi)");
    expect(LIBELLE_DECOMPTE_CONGE.CALENDAIRE).toBe("jours calendaires");
  });
});
