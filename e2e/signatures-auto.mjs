// Lot L — les actions sensibles sont signées : le serveur REFUSE toute action signée d'un compte sans signature enrôlée.
// Les scripts e2e historiques (Trésorerie) n'enrôlent pas de signature : ce module le fait pour eux, sur la base JETABLE seulement.
//   1. une signature (PNG de test, vrai tracé) est ajoutée à chaque compte existant qui n'en a pas ;
//   2. un déclencheur PostgreSQL en ajoute une à chaque compte créé ensuite (comptes créés en cours de script ou par l'écran Admin).
// Usage : `import { assurerSignatures } from "./signatures-auto.mjs"; await assurerSignatures(db);` juste après `db.connect()`.
// `lot-l.mjs` teste, lui, le refus sans signature : il supprime explicitement la signature des comptes concernés.
import { createHash } from "node:crypto";
import { deflateSync } from "node:zlib";

const TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
const crc = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  data.copy(out, 8);
  out.writeUInt32BE(crc(Buffer.concat([Buffer.from(type, "ascii"), data])), 8 + data.length);
  return out;
};

/** PNG RGBA 600 × 200 transparent avec un tracé sinusoïdal (accepté par la validation serveur). `decalage` distingue deux versions. */
export function pngSignatureTest(decalage = 0, { w = 600, h = 200, vide = false, remplissage = 0 } = {}) {
  const lignes = [];
  for (let y = 0; y < h; y++) {
    const l = Buffer.alloc(1 + w * 4);
    for (let x = 0; x < w; x++) {
      const encre = !vide && x > 50 && x < w - 80 && Math.abs(y - h / 2 - 40 * Math.sin((x + decalage) / 25)) < 3;
      if (encre) l[1 + x * 4 + 3] = 255;
    }
    lignes.push(l);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const idat = deflateSync(Buffer.concat(lignes));
  // `remplissage` : octets ajoutés (chunk privé « zzZz ») pour dépasser la taille maximale sans changer l'image.
  const extra = remplissage > 0 ? [chunk("zzZz", Buffer.alloc(remplissage, 7))] : [];
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), ...extra, chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0))]);
}

export const dataUrlSignatureTest = (decalage = 0, options = {}) => `data:image/png;base64,${pngSignatureTest(decalage, options).toString("base64")}`;

/** Enrôle une signature pour chaque compte qui n'en a pas, et crée un déclencheur qui le fera pour les comptes à venir. */
export async function assurerSignatures(db) {
  const png = pngSignatureTest();
  const hex = png.toString("hex");
  const empreinte = createHash("sha256").update(png).digest("hex");
  await db.query(`
    CREATE OR REPLACE FUNCTION e2e_signature_auto() RETURNS trigger AS $$
    BEGIN
      INSERT INTO "SignatureUtilisateur" ("id","userId","version","image","largeur","hauteur","empreinte")
      VALUES ('e2e-sig-' || NEW."id", NEW."id", 1, decode('${hex}', 'hex'), 600, 200, '${empreinte}')
      ON CONFLICT DO NOTHING;
      RETURN NEW;
    END; $$ LANGUAGE plpgsql;`);
  await db.query(`DROP TRIGGER IF EXISTS e2e_signature_auto ON "User"`);
  await db.query(`CREATE TRIGGER e2e_signature_auto AFTER INSERT ON "User" FOR EACH ROW EXECUTE FUNCTION e2e_signature_auto()`);
  await db.query(
    `INSERT INTO "SignatureUtilisateur" ("id","userId","version","image","largeur","hauteur","empreinte")
     SELECT 'e2e-sig-' || u."id", u."id", 1, decode($1,'hex'), 600, 200, $2 FROM "User" u
     WHERE NOT EXISTS (SELECT 1 FROM "SignatureUtilisateur" s WHERE s."userId" = u."id")`,
    [hex, empreinte]
  );
}
