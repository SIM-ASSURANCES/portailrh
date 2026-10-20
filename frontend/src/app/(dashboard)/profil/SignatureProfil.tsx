"use client";

import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { MENTION_SIGNATURE_INTERNE } from "backend/client";

import { SignaturePad } from "@/components/signature/SignaturePad";

import { enregistrerSignatureAction } from "./signatureActions";

interface VersionSignature {
  id: string;
  version: number;
  creeAt: string;
}

/** Section « Ma signature » du profil : aperçu de la signature actuelle, redessin (nouvelle version), historique des versions. */
export function SignatureProfil({ versions }: { versions: VersionSignature[] }) {
  const router = useRouter();
  const courante = versions[0] ?? null;
  return (
    <section className="mt-8 rounded-xl bg-white p-5 shadow-elevated" id="ma-signature" data-section-signature>
      <h2 className="text-lg font-bold text-foreground">Ma signature</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Dessinez votre signature une seule fois (souris, stylet ou doigt). Elle est ensuite appliquée automatiquement aux actions sensibles
        (valider, régler, clôturer…) : un seul clic « Signer et valider », sans nouveau dessin. {MENTION_SIGNATURE_INTERNE}
      </p>

      <div className="mt-4 grid gap-6 md:grid-cols-2">
        <div>
          <h3 className="text-sm font-semibold text-foreground">Signature actuelle</h3>
          {courante ? (
            <div className="mt-2 rounded-lg border border-border bg-white p-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`/api/signatures/${courante.id}`} alt="Votre signature enregistrée" className="mx-auto h-auto max-h-32 w-auto" data-signature-apercu />
              <p className="mt-2 text-xs text-muted-foreground" data-signature-version>
                Version {courante.version} — enregistrée le {new Date(courante.creeAt).toLocaleString("fr-FR", { timeZone: "Africa/Abidjan" })}
              </p>
            </div>
          ) : (
            <p className="mt-2 rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground" data-signature-absente>
              Aucune signature enregistrée pour le moment.
            </p>
          )}
          {versions.length > 1 ? (
            <details className="mt-3 text-sm">
              <summary className="cursor-pointer font-medium text-primary">Anciennes versions ({versions.length - 1})</summary>
              <ul className="mt-2 space-y-1 text-muted-foreground">
                {versions.slice(1).map((v) => (
                  <li key={v.id}>
                    Version {v.version} — {new Date(v.creeAt).toLocaleDateString("fr-FR", { timeZone: "Africa/Abidjan" })} (conservée pour les actions déjà signées)
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </div>

        <div>
          <h3 className="text-sm font-semibold text-foreground">{courante ? "Modifier ma signature" : "Créer ma signature"}</h3>
          <div className="mt-2">
            <SignaturePad
              libelleEnregistrer="Enregistrer"
              onEnregistrer={async (dataUrl) => {
                const r = await enregistrerSignatureAction(dataUrl);
                if (r.status === "success") {
                  toast.success(r.message);
                  return null;
                }
                return r.message;
              }}
              onEnregistre={() => router.refresh()}
            />
          </div>
          {courante ? (
            <p className="mt-2 text-xs text-muted-foreground">
              Une nouvelle signature s&apos;applique aux actions à venir. Les actions déjà signées gardent celle qu&apos;elles ont utilisée.
            </p>
          ) : null}
        </div>
      </div>
    </section>
  );
}
