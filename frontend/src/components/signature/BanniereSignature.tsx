"use client";

import { useSignature } from "./contexteBase";

/** Bandeau affiché aux comptes qui signent des actions mais n'ont pas encore enregistré leur signature. */
export function BanniereSignature({ visible }: { visible: boolean }) {
  const { aSignature, demanderSignature } = useSignature();
  if (!visible || aSignature) return null;
  return (
    <div role="status" data-banniere-signature className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-warning/40 bg-warning-bg px-4 py-3 text-sm text-warning">
      <p className="font-medium">
        Vous n&apos;avez pas encore enregistré votre signature. Elle est nécessaire pour valider, régler, clôturer ou décider.
      </p>
      <button type="button" className="rounded-lg bg-primary px-3 py-1.5 text-sm font-semibold text-primary-foreground hover:bg-primary-hover" onClick={() => void demanderSignature()}>
        Créer ma signature
      </button>
    </div>
  );
}
