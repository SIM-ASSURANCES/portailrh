import { LIBELLE_ANTERIEUR_SIGNATURE, libelleSignature } from "backend/client";

export interface SignatureAffichee {
  signatureId: string;
  signataire: string;
  fonction?: string;
  auNomDe: string | null;
  version: number;
}

/**
 * Signature d'une action : miniature (agrandie au survol, image entière au clic) et « signé par X, au nom de Y ».
 * L'image est servie par `/api/signatures/[id]`, jamais par une URL publique. `null` = action antérieure à la signature (jamais anormal).
 */
export function MentionSignature({ signature, anterieure }: { signature?: SignatureAffichee | null; anterieure?: boolean }) {
  if (signature) {
    return (
      <span className="mt-1 flex items-center gap-2" data-signature-mention data-signature-version={signature.version}>
        <a
          href={`/api/signatures/${signature.signatureId}`}
          target="_blank"
          rel="noreferrer"
          className="group relative inline-block shrink-0 rounded border border-border bg-white px-1"
          title="Voir la signature en grand"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`/api/signatures/${signature.signatureId}`} alt={`Signature de ${signature.signataire}`} className="h-6 w-auto" data-signature-miniature />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`/api/signatures/${signature.signatureId}`}
            alt=""
            aria-hidden="true"
            className="pointer-events-none absolute bottom-full left-0 z-20 mb-1 hidden h-24 w-auto rounded border border-border bg-white p-1 shadow-elevated-lg group-hover:block"
          />
        </a>
        <span className="text-xs text-muted-foreground" data-signature-libelle>
          {libelleSignature({ signataire: signature.signataire, auNomDe: signature.auNomDe })}
        </span>
      </span>
    );
  }
  if (anterieure) {
    return (
      <span className="mt-1 block text-xs italic text-muted-foreground" data-signature-anterieure>
        {LIBELLE_ANTERIEUR_SIGNATURE}
      </span>
    );
  }
  return null;
}
