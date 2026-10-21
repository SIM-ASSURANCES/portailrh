import { describe, expect, it } from "vitest";
import { ACTIONS_HISTORIQUE_SIGNEES } from "./signatureConstantes";
import { rattacherEntrees, type ActionPourReprise, type EntreeAReprendre } from "./signatureReprise";

const MISE = new Date("2026-10-27T08:00:00Z");
const t = (s: number) => new Date(MISE.getTime() + 3600_000 + s * 1000);

function entree(p: Partial<EntreeAReprendre> = {}): EntreeAReprendre {
  return { id: "H1", userId: "U1", createdAt: t(0), action: "validation_ligne", demandeId: "D1", actionSigneeId: null, ...p };
}
function action(p: Partial<ActionPourReprise> = {}): ActionPourReprise {
  return { id: "A1", signataireId: "U1", creeAt: t(-2), demandeId: "D1", signatureId: "SIG-1", auNomDeId: null, ...p };
}
const verdict = (e: EntreeAReprendre[], a: ActionPourReprise[]) => rattacherEntrees(e, a, MISE, ACTIONS_HISTORIQUE_SIGNEES).get("H1");

describe("rattacherEntrees (reprise du lot L, dernière fois)", () => {
  it("rattache à l'unique action du même compte dans la minute", () => {
    expect(verdict([entree()], [action()])).toEqual({ etat: "RATTACHABLE", actionId: "A1", candidates: 1 });
  });

  it("deux actions de VERSIONS différentes dans la minute : ambigu, on ne devine pas", () => {
    const v = verdict([entree()], [action({ id: "A1", signatureId: "SIG-1" }), action({ id: "A2", signatureId: "SIG-2", creeAt: t(-1) })]);
    expect(v).toEqual({ etat: "AMBIGUE", candidates: ["A2", "A1"] });
  });

  it("deux actions avec un titulaire différent (délégation) : ambigu", () => {
    const v = verdict([entree()], [action({ id: "A1" }), action({ id: "A2", creeAt: t(-1), auNomDeId: "TITULAIRE" })]);
    expect(v?.etat).toBe("AMBIGUE");
  });

  it("deux candidates équivalentes (même version, même titulaire : ancien double enregistrement) : la plus proche", () => {
    const v = verdict([entree()], [action({ id: "A1", creeAt: t(-10) }), action({ id: "A2", creeAt: t(-1) })]);
    expect(v).toEqual({ etat: "RATTACHABLE", actionId: "A2", candidates: 2 });
  });

  it("une action d'un autre compte n'est jamais candidate", () => {
    expect(verdict([entree()], [action({ signataireId: "U2" })])).toEqual({ etat: "SANS_CANDIDATE" });
  });

  it("une action à plus de 60 s n'est pas candidate, à exactement 60 s elle l'est", () => {
    expect(verdict([entree()], [action({ creeAt: t(-61) })])).toEqual({ etat: "SANS_CANDIDATE" });
    expect(verdict([entree()], [action({ creeAt: t(-60) })])?.etat).toBe("RATTACHABLE");
  });

  it("une autre demande n'est pas candidate ; une action sans demande connue l'est", () => {
    expect(verdict([entree()], [action({ demandeId: "D2" })])).toEqual({ etat: "SANS_CANDIDATE" });
    expect(verdict([entree()], [action({ demandeId: null })])?.etat).toBe("RATTACHABLE");
    expect(verdict([entree({ demandeId: null })], [action({ demandeId: "D9" })])?.etat).toBe("RATTACHABLE");
  });

  it("une ligne antérieure à la mise en service reste « antérieure », même avec une candidate", () => {
    const avant = new Date(MISE.getTime() - 1000);
    expect(verdict([entree({ createdAt: avant })], [action({ creeAt: avant })])).toEqual({ etat: "ANTERIEURE" });
  });

  it("une ligne déjà liée est laissée telle quelle", () => {
    expect(verdict([entree({ actionSigneeId: "AX" })], [action()])).toEqual({ etat: "DEJA_LIEE", actionId: "AX" });
  });

  it("une action non signable est ignorée", () => {
    expect(verdict([entree({ action: "creation_demande" })], [action()])).toBeUndefined();
  });

  it("deux lignes d'un même clic reçoivent la même action ; deux clics de versions différentes restent séparés si distincts dans le temps... sinon ambigus", () => {
    const entrees = [entree({ id: "H1" }), entree({ id: "H2", createdAt: t(1) })];
    const r = rattacherEntrees(entrees, [action()], MISE, ACTIONS_HISTORIQUE_SIGNEES);
    expect(r.get("H1")).toMatchObject({ etat: "RATTACHABLE", actionId: "A1" });
    expect(r.get("H2")).toMatchObject({ etat: "RATTACHABLE", actionId: "A1" });
  });
});
