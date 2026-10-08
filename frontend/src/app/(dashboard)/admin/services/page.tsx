import { ServicesSansResponsableBanniere } from "@/components/admin/ServicesSansResponsableBanniere";
import { PageHeader } from "@/components/ui";
import { getServicesSansResponsable, prisma } from "backend";

import { ServiceCreateForm } from "./ServiceCreateForm";
import { ServicesTable } from "./ServicesTable";

export default async function AdminServicesPage() {
  const [services, actifs, sansResponsable] = await Promise.all([
    prisma.service.findMany({
      include: {
        _count: { select: { users: true } },
        responsable: { select: { id: true, fullName: true, email: true } },
      },
      orderBy: { name: "asc" },
    }),
    // Responsables possibles : tout compte actif, membre du service ou non (un compte en attente d'activation ne
    // peut pas valider). Un même compte peut être responsable de plusieurs services.
    prisma.user.findMany({
      where: { isActive: true },
      orderBy: { fullName: "asc" },
      select: { id: true, fullName: true, email: true, service: { select: { name: true } } },
    }),
    getServicesSansResponsable(prisma),
  ]);
  const utilisateurs = actifs.map((u) => ({ id: u.id, fullName: u.fullName, email: u.email, serviceNom: u.service?.name ?? null }));

  return (
    <div className="mx-auto max-w-5xl space-y-8 px-6 py-10">
      <PageHeader
        title="Services"
        description="Gérer les services de l'entreprise, leur responsable et l'affectation des utilisateurs (dans Utilisateurs)."
      />

      <ServicesSansResponsableBanniere services={sansResponsable} />

      <section className="space-y-4">
        <h2 className="text-xl font-bold text-foreground">Ajouter un service</h2>
        <ServiceCreateForm
          utilisateurs={utilisateurs.map((u) => ({ id: u.id, label: `${u.fullName} — ${u.serviceNom ?? "sans service"}` }))}
        />
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-bold text-foreground">Services existants</h2>
        <ServicesTable services={services} utilisateurs={utilisateurs} />
      </section>
    </div>
  );
}
