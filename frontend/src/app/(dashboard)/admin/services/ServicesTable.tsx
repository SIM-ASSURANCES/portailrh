"use client";

import { Badge, DataTable, type DataTableColumn } from "@/components/ui";
import { ServiceDeleteButton } from "./ServiceDeleteButton";
import { ServiceResponsablePicker, type UtilisateurActif } from "./ServiceResponsablePicker";

type ServiceData = {
  id: string;
  name: string;
  description: string | null;
  responsable: { id: string; fullName: string; email: string } | null;
  _count: { users: number };
};

export function ServicesTable({
  services,
  utilisateurs,
}: {
  services: ServiceData[];
  utilisateurs: UtilisateurActif[];
}) {
  const columns: DataTableColumn<ServiceData>[] = [
    {
      key: "name",
      header: "Nom",
      accessor: (s) => s.name,
    },
    {
      key: "description",
      header: "Description",
      accessor: (s) => s.description,
      render: (s) => s.description || <span className="text-muted-foreground italic">Aucune</span>,
    },
    {
      key: "responsable",
      header: "Responsable",
      render: (s) =>
        s.responsable ? (
          <div data-responsable-service={s.name}>
            <p className="font-medium text-foreground">{s.responsable.fullName}</p>
            <p className="text-xs text-muted-foreground">{s.responsable.email}</p>
          </div>
        ) : (
          <Badge variant="danger">Aucun responsable</Badge>
        ),
    },
    {
      key: "users_count",
      header: "Membres",
      accessor: (s) => s._count.users.toString(),
    },
    {
      key: "actions",
      header: "Actions",
      render: (s) => (
        <div className="flex flex-wrap items-start gap-2">
          <ServiceResponsablePicker
            serviceId={s.id}
            serviceNom={s.name}
            responsableActuel={s.responsable ? { id: s.responsable.id, fullName: s.responsable.fullName } : null}
            utilisateurs={utilisateurs}
          />
          <ServiceDeleteButton id={s.id} disabled={s._count.users > 0} />
        </div>
      ),
    },
  ];

  return <DataTable columns={columns} data={services} rowKey={(s) => s.id} />;
}
