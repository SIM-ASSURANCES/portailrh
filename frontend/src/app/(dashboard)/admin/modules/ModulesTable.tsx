"use client";

import { Badge, DataTable } from "@/components/ui";

import { ModuleActiveToggle } from "./ModuleActiveToggle";

interface ModuleRow {
  id: string;
  key: string;
  label: string;
  isActive: boolean;
}

/** Voir UsersTable.tsx pour l'explication du wrapper Client Component. */
export function ModulesTable({ modules }: { modules: ModuleRow[] }) {
  return (
    <DataTable
      rowKey={(m) => m.id}
      emptyMessage="Aucun module."
      columns={[
        { key: "label", header: "Module", sortable: true, accessor: (m) => m.label },
        { key: "key", header: "Clé", accessor: (m) => m.key },
        {
          key: "isActive",
          header: "Statut",
          render: (m) => (
            <Badge variant={m.isActive ? "success" : "neutral"}>
              {m.isActive ? "Actif" : "Inactif"}
            </Badge>
          ),
        },
        {
          key: "actions",
          header: "Actions",
          render: (m) => <ModuleActiveToggle moduleId={m.id} isActive={m.isActive} />,
        },
      ]}
      data={modules}
    />
  );
}
