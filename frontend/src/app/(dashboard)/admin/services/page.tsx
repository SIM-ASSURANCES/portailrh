import { PageHeader } from "@/components/ui";
import { prisma } from "backend";

import { ServiceCreateForm } from "./ServiceCreateForm";
import { ServicesTable } from "./ServicesTable";

export default async function AdminServicesPage() {
  const services = await prisma.service.findMany({
    include: {
      _count: { select: { users: true } },
    },
    orderBy: { name: "asc" },
  });

  return (
    <div className="mx-auto max-w-5xl space-y-8 px-6 py-10">
      <PageHeader
        title="Services"
        description="Gérer les services de l'entreprise (ex: Commercial, Technique)."
      />

      <section className="space-y-4">
        <h2 className="text-xl font-bold text-foreground">Ajouter un service</h2>
        <ServiceCreateForm />
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-bold text-foreground">Services existants</h2>
        <ServicesTable services={services} />
      </section>
    </div>
  );
}
