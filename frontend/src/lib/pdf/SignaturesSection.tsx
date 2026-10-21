import { Image, Text, View } from "@react-pdf/renderer";
import { LIBELLE_ANTERIEUR_SIGNATURE, MENTION_SIGNATURE_INTERNE, libelleSignature } from "backend/client";

import { COLORS } from "./colors";
import { formatDate } from "./format";
import { styles } from "./ReceiptDocument";
import type { SignatureImprimee } from "./signaturesDocument";

/**
 * Bloc « Validations et signatures » (lot L) : une ligne par étape validée, dans l'ordre du circuit — nom, fonction, date, signature
 * manuscrite enregistrée. Une action faite par délégation dit « signé par X, au nom de Y ». Traçabilité interne, pas une signature
 * électronique qualifiée (mention imprimée en bas du bloc).
 */
export function SignaturesSection({ signatures }: { signatures: SignatureImprimee[] }) {
  if (signatures.length === 0) return null;
  return (
    <View style={styles.section} wrap={false}>
      <Text style={styles.sectionTitle}>Validations et signatures</Text>
      {signatures.map((s, i) => (
        <View
          key={i}
          style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderBottomWidth: i === signatures.length - 1 ? 0 : 1, borderBottomColor: COLORS.border, paddingVertical: 6 }}
        >
          <View style={{ flex: 1, paddingRight: 8 }}>
            <Text style={{ fontSize: 9, fontWeight: 700 }}>{s.etape}</Text>
            <Text style={{ fontSize: 9 }}>
              {s.nom} — {s.fonction}
            </Text>
            <Text style={{ fontSize: 8, color: COLORS.mutedForeground }}>
              {formatDate(s.date)}
              {s.auNomDe ? ` — ${libelleSignature({ signataire: s.nom, auNomDe: s.auNomDe })}` : ""}
            </Text>
          </View>
          {s.image ? (
            // eslint-disable-next-line jsx-a11y/alt-text -- <Image> de @react-pdf/renderer (pas une balise HTML) : aucune prop `alt` n'existe
            <Image src={{ data: s.image, format: "png" }} style={{ width: 96, height: 32, objectFit: "contain" }} />
          ) : (
            <Text style={{ fontSize: 8, color: COLORS.mutedForeground }}>{s.anterieure ? LIBELLE_ANTERIEUR_SIGNATURE : ""}</Text>
          )}
        </View>
      ))}
      <Text style={{ fontSize: 7, color: COLORS.mutedForeground, marginTop: 4 }}>{MENTION_SIGNATURE_INTERNE}</Text>
    </View>
  );
}
