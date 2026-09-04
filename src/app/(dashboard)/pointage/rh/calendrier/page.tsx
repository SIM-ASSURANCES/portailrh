import { Suspense } from "react";
import { getJoursFeries } from "./actions";
import { CalendrierClient } from "./CalendrierClient"; // Force TS refresh
import { PageHeader } from "@/components/ui";

export const metadata = {
  title: "Jours Fériés | SIM-Portail",
};

export default async function CalendrierPage() {
  const joursFeries = await getJoursFeries();

  return (
    <div className="mx-auto max-w-6xl space-y-8 px-4 py-6 sm:px-6 sm:py-8 font-sans">
      <PageHeader
        title="Jours Fériés"
        description="Gestion des jours fériés pour le calcul correct des absences et présences."
        backHref="/pointage/rh"
        backLabel="Retour à la Boîte à Outils"
      />

      <Suspense fallback={<div className="h-64 bg-slate-50 rounded-lg animate-pulse" />}>
        <CalendrierClient initialJoursFeries={joursFeries} />
      </Suspense>
    </div>
  );
}
