import { deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import {
  ACTIONS_SIGNEES,
  decoderDataUrlPng,
  LIBELLE_ANTERIEUR_SIGNATURE,
  LIBELLE_NON_RATTACHEE_SIGNATURE,
  libelleSignature,
  lierSignatures,
  refusSansSignature,
  SIGNATURE_TAILLE_MAX,
  validerImageSignature,
} from "./signature";

// --- Générateur de PNG pour les tests (RGBA 8 bits, filtre 0 sauf indication) ---
const TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc(buf: Buffer): number {
  let c = 0xffffffff;
  for (const b of buf) c = TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Buffer): Buffer {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  data.copy(out, 8);
  out.writeUInt32BE(crc(Buffer.concat([Buffer.from(type, "ascii"), data])), 8 + data.length);
  return out;
}
function png(opts: { w?: number; h?: number; type?: number; depth?: number; interlace?: number; trace?: (x: number, y: number) => boolean; extra?: Buffer[]; filtre?: number } = {}): Buffer {
  const w = opts.w ?? 600, h = opts.h ?? 200, type = opts.type ?? 6, depth = opts.depth ?? 8;
  const bpp = ({ 0: 1, 2: 3, 4: 2, 6: 4 } as Record<number, number>)[type];
  const trace = opts.trace ?? ((x, y) => Math.abs(y - 100 - 40 * Math.sin(x / 25)) < 3 && x > 50 && x < 500);
  const lignes: Buffer[] = [];
  for (let y = 0; y < h; y++) {
    const l = Buffer.alloc(1 + w * bpp);
    l[0] = 0;
    for (let x = 0; x < w; x++) {
      const encre = trace(x, y);
      const o = 1 + x * bpp;
      if (type === 6) { l[o] = 0; l[o + 1] = 0; l[o + 2] = 0; l[o + 3] = encre ? 255 : 0; }
      else if (type === 4) { l[o] = 0; l[o + 1] = encre ? 255 : 0; }
      else if (type === 2) { const v = encre ? 0 : 255; l[o] = v; l[o + 1] = v; l[o + 2] = v; }
      else { l[o] = encre ? 0 : 255; }
    }
    lignes.push(l);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = depth; ihdr[9] = type; ihdr[12] = opts.interlace ?? 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    ...(opts.extra ?? []),
    chunk("IDAT", deflateSync(Buffer.concat(lignes))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

describe("validerImageSignature", () => {
  it("accepte un tracé RGBA, gris+alpha, RVB et gris", () => {
    for (const type of [6, 4, 2, 0]) {
      const r = validerImageSignature(png({ type }));
      expect(r.ok, `type ${type}`).toBe(true);
      if (r.ok) {
        expect(r.largeur).toBe(600);
        expect(r.hauteur).toBe(200);
        expect(r.empreinte).toMatch(/^[0-9a-f]{64}$/);
      }
    }
  });

  it("reconstruit un PNG propre : les métadonnées (tEXt) sont retirées et l'image reste valide", () => {
    const secret = chunk("tEXt", Buffer.from("Comment\0donnee-privee"));
    const entree = png({ extra: [secret] });
    expect(entree.includes(Buffer.from("donnee-privee"))).toBe(true);
    const r = validerImageSignature(entree);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.png.includes(Buffer.from("donnee-privee"))).toBe(false);
      expect(validerImageSignature(r.png).ok).toBe(true);
    }
  });

  it("refuse une image vide, un simple point et un trait trop court", () => {
    expect(validerImageSignature(png({ trace: () => false }))).toMatchObject({ ok: false });
    expect(validerImageSignature(png({ trace: (x, y) => x >= 100 && x < 104 && y >= 100 && y < 104 }))).toMatchObject({ ok: false });
    expect(validerImageSignature(png({ trace: (x, y) => x >= 100 && x < 120 && y >= 100 && y < 110 }))).toMatchObject({ ok: false });
  });

  it("refuse ce qui n'est pas un PNG (JPEG, texte, vide)", () => {
    expect(validerImageSignature(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]))).toMatchObject({ ok: false });
    expect(validerImageSignature(Buffer.from("<svg onload=alert(1)></svg>".repeat(5)))).toMatchObject({ ok: false });
    expect(validerImageSignature(Buffer.alloc(0))).toMatchObject({ ok: false, message: expect.stringContaining("vide") });
  });

  it("refuse des dimensions hors limites", () => {
    expect(validerImageSignature(png({ w: 100, h: 100 }))).toMatchObject({ ok: false, message: expect.stringContaining("Dimensions") });
    expect(validerImageSignature(png({ w: 1500, h: 200 }))).toMatchObject({ ok: false });
    expect(validerImageSignature(png({ w: 600, h: 800 }))).toMatchObject({ ok: false });
  });

  it("refuse une image trop lourde (> 100 Ko)", () => {
    const lourd = Buffer.concat([png(), Buffer.alloc(SIGNATURE_TAILLE_MAX)]);
    expect(validerImageSignature(lourd)).toMatchObject({ ok: false, message: expect.stringContaining("volumineuse") });
  });

  it("refuse un PNG entrelacé, 16 bits ou corrompu (CRC)", () => {
    expect(validerImageSignature(png({ interlace: 1 }))).toMatchObject({ ok: false });
    expect(validerImageSignature(png({ depth: 16 }))).toMatchObject({ ok: false });
    const casse = png();
    casse[40] ^= 0xff;
    expect(validerImageSignature(casse)).toMatchObject({ ok: false });
  });
});

describe("decoderDataUrlPng", () => {
  it("décode une data URL PNG et refuse le reste", () => {
    const p = png();
    const ok = decoderDataUrlPng("data:image/png;base64," + p.toString("base64"));
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.octets.equals(p)).toBe(true);
    expect(decoderDataUrlPng("data:image/jpeg;base64,AAAA")).toMatchObject({ ok: false });
    expect(decoderDataUrlPng("https://exemple.test/x.png")).toMatchObject({ ok: false });
    expect(decoderDataUrlPng(42)).toMatchObject({ ok: false });
    expect(decoderDataUrlPng("data:image/png;base64,@@@@")).toMatchObject({ ok: false });
  });
  it("refuse une charge énorme AVANT de la décoder", () => {
    const enorme = "data:image/png;base64," + "A".repeat(SIGNATURE_TAILLE_MAX * 2);
    expect(decoderDataUrlPng(enorme)).toMatchObject({ ok: false, message: expect.stringContaining("volumineuse") });
  });
});

describe("refus sans signature enrôlée", () => {
  it("refuse sans version, accepte avec", () => {
    expect(refusSansSignature(null)).toContain("enregistrer votre signature");
    expect(refusSansSignature(undefined)).not.toBeNull();
    expect(refusSansSignature(0)).not.toBeNull();
    expect(refusSansSignature(1)).toBeNull();
  });
});

describe("lierSignatures (lien par identifiant, lot L bis)", () => {
  const t0 = new Date("2026-11-02T10:00:00Z");
  const mise = new Date("2026-10-27T00:00:00Z");
  const signables = new Set(["confirmation_reglement"]);
  const entree = (id: string, createdAt: Date, actionSigneeId: string | null, action = "confirmation_reglement") => ({ id, createdAt, action, actionSigneeId });
  const sig = (id: string, version: number) => ({ id, version });
  const parId = (...s: { id: string; version: number }[]) => new Map(s.map((x) => [x.id, x]));

  it("garde la version de signature de SON action, même après un nouvel enrôlement", () => {
    const r = lierSignatures([entree("e1", t0, "s1"), entree("e2", new Date(t0.getTime() + 3 * 86400_000), "s2")], parId(sig("s1", 1), sig("s2", 2)), mise, signables);
    expect(r.get("e1")).toMatchObject({ etat: "SIGNEE", signature: { version: 1 } });
    expect(r.get("e2")).toMatchObject({ etat: "SIGNEE", signature: { version: 2 } });
  });

  it("deux actions du même compte à moins de 60 secondes, deux versions de signature : chacune garde la sienne", () => {
    // Avec l'ancienne fenêtre de 60 s, les deux lignes auraient pu se confondre ; le lien par identifiant ne se trompe pas.
    const e1 = entree("e1", t0, "s1");
    const e2 = entree("e2", new Date(t0.getTime() + 1500), "s2");
    const r = lierSignatures([e1, e2], parId(sig("s1", 1), sig("s2", 2)), mise, signables);
    expect(r.get("e1")).toMatchObject({ etat: "SIGNEE", signature: { id: "s1", version: 1 } });
    expect(r.get("e2")).toMatchObject({ etat: "SIGNEE", signature: { id: "s2", version: 2 } });
  });

  it("plusieurs lignes d'une même action pointent vers la même signature", () => {
    const r = lierSignatures([entree("e1", t0, "s1"), entree("e2", t0, "s1")], parId(sig("s1", 3)), mise, signables);
    expect(r.get("e1")).toMatchObject({ etat: "SIGNEE", signature: { id: "s1" } });
    expect(r.get("e2")).toMatchObject({ etat: "SIGNEE", signature: { id: "s1" } });
  });

  it("une action d'avant la mise en service est « antérieure », jamais anormale", () => {
    const avant = entree("e0", new Date("2026-09-01T10:00:00Z"), null);
    expect(lierSignatures([avant], new Map(), mise, signables).get("e0")).toEqual({ etat: "ANTERIEURE" });
    expect(LIBELLE_ANTERIEUR_SIGNATURE).toBe("Antérieur à la signature");
  });

  it("après la mise en service sans lien (rattachement ambigu du lot L) : « non rattachée » ; la proximité dans le temps ne compte plus", () => {
    const r = lierSignatures([entree("e1", t0, null)], parId(sig("sx", 1)), mise, signables);
    expect(r.get("e1")).toEqual({ etat: "NON_RATTACHEE" });
    expect(LIBELLE_NON_RATTACHEE_SIGNATURE).toBe("Signature non rattachée");
  });

  it("un lien vers une signature inconnue est « non rattaché », jamais une signature inventée", () => {
    expect(lierSignatures([entree("e1", t0, "fantome")], new Map(), mise, signables).get("e1")).toEqual({ etat: "NON_RATTACHEE" });
  });

  it("ignore les actions non signables", () => {
    const r = lierSignatures([entree("e1", t0, "s1", "creation")], parId(sig("s1", 1)), mise, signables);
    expect(r.has("e1")).toBe(false);
  });
});

describe("libellés", () => {
  it("« signé par » et « au nom de »", () => {
    expect(libelleSignature({ signataire: "Awa Koné" })).toBe("signé par Awa Koné");
    expect(libelleSignature({ signataire: "Awa Koné", auNomDe: "Moussa Traoré" })).toBe("signé par Awa Koné, au nom de Moussa Traoré");
    expect(libelleSignature({ signataire: "Awa Koné", auNomDe: "Awa Koné" })).toBe("signé par Awa Koné");
  });
  it("la liste des actions signées est complète et sans doublon de libellé vide", () => {
    for (const [code, libelle] of Object.entries(ACTIONS_SIGNEES)) expect(libelle.length, code).toBeGreaterThan(5);
    expect(Object.keys(ACTIONS_SIGNEES)).toContain("confirmation_reglement");
  });
});
