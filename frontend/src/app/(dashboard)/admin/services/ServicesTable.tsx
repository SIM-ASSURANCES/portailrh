"use client";

import { DataTable, type DataTableColumn } from "@/components/ui";
import { ServiceDeleteButton } from "./ServiceDeleteButton";

type ServiceData = {
  id: string;
  name: string;
  description: string | null;
  _count: { users: number };
};

export function ServicesTable({ services }: { services: ServiceData[] }) {
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
      key: "users_count",
      header: "Collaborateurs",
      accessor: (s) => s._count.users.toString(),
    },
    {
      key: "actions",
      header: "Actions",
      render: (s) => <ServiceDeleteButton id={s.id} disabled={s._count.users > 0} />,
    },
  ];

  return <DataTable columns={columns} data={services} rowKey={(s) => s.id} />;
}
