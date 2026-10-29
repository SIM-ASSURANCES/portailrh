import { describe, expect, it, vi } from "vitest";
import { CLE_CLOTURE_INITIALE, MOTIF_CLOTURE_INITIALE_ABSENCE, cloturerEnAttenteInitiale, debutDuJour } from "./clotureInitiale";

/** Faux client Prisma : `inserees` simule la clé du marqueur (1 = première fois, 0 = déjà posée). */
function fauxClient(inserees: number, comptes = { justifications: 4, sansMotif: 3, avecMotif: 1 }) {
  const absenceUpdateMany = vi
    .fn()
    .mockResolvedValueOnce({ count: comptes.sansMotif })
    .mockResolvedValueOnce({ count: comptes.avecMotif });
  const tx = {
    $executeRaw: vi.fn().mockResolvedValue(inserees),
    justificationPointage: { updateMany: vi.fn().mockResolvedValue({ count: comptes.justifications }) },
    absence: { updateMany: absenceUpdateMany },
    marqueurUnique: { update: vi.fn().mockResolvedValue({}) },
    journalTechnique: { create: vi.fn().mockResolvedValue({}) },
  };
  const db = { $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)) };
  return { db: db as never, tx };
}

const maintenant = new Date(2026, 9, 14, 10, 30, 0);

describe("debutDuJour", () => {
  it("00:00 du jour courant, heure locale", () => {
    expect(debutDuJour(maintenant)).toEqual(new Date(2026, 9, 14, 0, 0, 0, 0));
  });
});

describe("cloturerEnAttenteInitiale", () => {
  it("première exécution : clôture les justifications et confirme les absences antérieures au jour courant, sans notification", async () => {
    const { db, tx } = fauxClient(1);
    const r = await cloturerEnAttenteInitiale(db, maintenant);
    expect(r).toEqual({ executee: true, justificationsCloturees: 4, absencesConfirmees: 4 });

    const avantAujourdhui = new Date(2026, 9, 14, 0, 0, 0, 0);
    expect(tx.justificationPointage.updateMany).toHaveBeenCalledWith({
      where: { statut: "EN_ATTENTE", pointage: { heure: { lt: avantAujourdhui } } },
      data: { statut: "NON_JUSTIFIEE", clotureeAt: maintenant },
    });
    expect(tx.absence.updateMany).toHaveBeenNthCalledWith(1, {
      where: { statut: "A_CONTROLER", date: { lt: avantAujourdhui }, motif: null },
      data: { statut: "CONFIRMEE", motif: MOTIF_CLOTURE_INITIALE_ABSENCE },
    });
    expect(tx.absence.updateMany).toHaveBeenNthCalledWith(2, {
      where: { statut: "A_CONTROLER", date: { lt: avantAujourdhui } },
      data: { statut: "CONFIRMEE" },
    });
  });

  it("le statut posé sur les absences est CONFIRMEE (jamais JUSTIFIEE) et aucune notification n'est créée", async () => {
    const { db, tx } = fauxClient(1);
    await cloturerEnAttenteInitiale(db, maintenant);
    for (const appel of tx.absence.updateMany.mock.calls) expect(appel[0].data.statut).toBe("CONFIRMEE");
    expect(tx).not.toHaveProperty("notification");
  });

  it("une ligne TACHE au journal technique avec les nombres, et le bilan au marqueur", async () => {
    const { db, tx } = fauxClient(1);
    await cloturerEnAttenteInitiale(db, maintenant);
    expect(tx.journalTechnique.create).toHaveBeenCalledTimes(1);
    const data = tx.journalTechnique.create.mock.calls[0][0].data;
    expect(data).toMatchObject({
      source: "TACHE",
      code: "CLOTURE_INITIALE",
      contexte: { justificationsCloturees: 4, absencesConfirmees: 4 },
    });
    expect(tx.marqueurUnique.update).toHaveBeenCalledWith({
      where: { cle: CLE_CLOTURE_INITIALE },
      data: { bilan: { executee: true, justificationsCloturees: 4, absencesConfirmees: 4 } },
    });
  });

  it("déjà exécutée (marqueur présent) : rien n'est touché, aucune ligne de journal", async () => {
    const { db, tx } = fauxClient(0);
    const r = await cloturerEnAttenteInitiale(db, maintenant);
    expect(r).toEqual({ executee: false, justificationsCloturees: 0, absencesConfirmees: 0 });
    expect(tx.justificationPointage.updateMany).not.toHaveBeenCalled();
    expect(tx.absence.updateMany).not.toHaveBeenCalled();
    expect(tx.journalTechnique.create).not.toHaveBeenCalled();
  });
});
