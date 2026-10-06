import { PageHeader } from "@/components/ui";
import { getServicesSansResponsable, prisma } from "backend";

import { ServiceCreateForm } from "./ServiceCreateForm";
import { ServicesTable } from "./ServicesTable";

export default async function AdminServicesPage() {
  const [services, utilisateurs, sansResponsable] = await Promise.all([
    prisma.service.findMany({
      include: {
        _count: { select: { users: true } },
      },
      orderBy: { name: "asc" },
    }),
    // Responsables possibles : tout compte actif, membre du service ou non (un compte en attente d'activation ne
    // peut pas valider). Le service de chacun est affiché à côté de son nom pour choisir en connaissance de cause.
    prisma.user
      .findMany({
        where: { isActive: true },
        orderBy: { fullName: "asc" },
        select: { id: true, fullName: true, service: { select: { name: true } } },
      })
      .then((us) => us.map((u) => ({ id: u.id, label: `${u.fullName} — ${u.service?.name ?? "sans service"}` }))),
    getServicesSansResponsable(prisma),
  ]);

  return (
    <div className="mx-auto max-w-5xl space-y-8 px-6 py-10">
      <PageHeader
        title="Services"
        description="Gérer les services de l'entreprise, leur responsable et l'affectation des utilisateurs (dans Utilisateurs)."
      />

      {sansResponsable.length > 0 ? (
        <p role="alert" className="rounded-md bg-warning-bg px-4 py-3 text-sm text-warning">
          {sansResponsable.length === 1 ? "Service sans responsable" : "Services sans responsable"} :{" "}
          <span className="font-semibold">{sansResponsable.map((s) => s.name).join(", ")}</span>. Leurs membres ne
          peuvent pas créer de demande tant qu&apos;un responsable n&apos;est pas désigné.
        </p>
      ) : null}

      <section className="space-y-4">
        <h2 className="text-xl font-bold text-foreground">Ajouter un service</h2>
        <ServiceCreateForm utilisateurs={utilisateurs} />
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-bold text-foreground">Services existants</h2>
        <ServicesTable services={services} utilisateurs={utilisateurs} />
      </section>
    </div>
  );
}
