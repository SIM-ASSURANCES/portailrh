"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useRouter } from "next/navigation";

import { MENTION_SIGNATURE_INTERNE } from "backend/client";

import { enregistrerSignatureAction } from "@/app/(dashboard)/profil/signatureActions";

import { Contexte, type ValeurSignature } from "./contexteBase";
import { SignaturePad } from "./SignaturePad";

export function FournisseurSignature({ aSignature: aSignatureServeur, children }: { aSignature: boolean; children: ReactNode }) {
  const router = useRouter();
  const [creee, setCreee] = useState(false);
  const [ouvert, setOuvert] = useState(false);
  const resolution = useRef<((ok: boolean) => void) | null>(null);

  const fermer = useCallback((ok: boolean) => {
    setOuvert(false);
    resolution.current?.(ok);
    resolution.current = null;
  }, []);

  const demanderSignature = useCallback(
    () =>
      new Promise<boolean>((resolve) => {
        resolution.current = resolve;
        setOuvert(true);
      }),
    []
  );

  const valeur = useMemo<ValeurSignature>(
    () => ({ aSignature: aSignatureServeur || creee, demanderSignature }),
    [aSignatureServeur, creee, demanderSignature]
  );

  return (
    <Contexte.Provider value={valeur}>
      {children}
      {ouvert ? (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-labelledby="titre-signature" data-dialogue-signature>
          <div className="w-full max-w-xl space-y-4 rounded-xl bg-white p-5 shadow-elevated-lg">
            <div>
              <h2 id="titre-signature" className="text-lg font-bold text-foreground">
                Créez votre signature
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Dessinez votre signature une seule fois, à la souris ou au doigt. Elle sera ensuite appliquée à chaque action qui doit être signée :
                vous n&apos;aurez plus qu&apos;un clic à faire. Vous pourrez la modifier depuis « Mon profil ».
              </p>
            </div>
            <SignaturePad
              libelleEnregistrer="Enregistrer ma signature et continuer"
              onEnregistrer={async (dataUrl) => {
                const r = await enregistrerSignatureAction(dataUrl);
                return r.status === "success" ? null : r.message;
              }}
              onEnregistre={() => {
                setCreee(true);
                fermer(true);
                router.refresh();
              }}
            />
            <p className="text-xs text-muted-foreground">{MENTION_SIGNATURE_INTERNE}</p>
            <button type="button" className="text-sm font-medium text-muted-foreground underline" onClick={() => fermer(false)}>
              Annuler
            </button>
          </div>
        </div>
      ) : null}
    </Contexte.Provider>
  );
}
