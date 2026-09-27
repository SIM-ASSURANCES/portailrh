import { redirect } from "next/navigation";

import { PageHeader } from "@/components/ui";
import { getSession, hasPermission } from "@/lib/auth";

/** Accueil du module Encaissements (en construction). Garde revérifiée ici, indépendamment du layout. */
export default async function EncaissementsAccueilPage() {
  const session = await getSession();
  if (!session || !hasPermission(session, "enc.consulter")) {
    redirect("/?error=acces_refuse_encaissements");
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-4 py-6 sm:px-6 sm:py-10">
      <PageHeader
        title="Encaissements, taxes et commissions"
        description="Contrats, versements échelonnés, taxes, commissions et honoraires."
      />
      <p className="rounded-lg border border-border bg-surface p-5 text-sm text-muted-foreground">
        Module en construction.
      </p>
    </div>
  );
}
