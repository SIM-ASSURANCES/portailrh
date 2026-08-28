"use client";

import { Badge, DataTable } from "@/components/ui";

import { UserActiveToggle } from "./UserActiveToggle";

interface UserRow {
  id: string;
  fullName: string;
  email: string;
  isActive: boolean;
  role: { name: string };
}

/**
 * Wrapper Client Component autour de DataTable : les `columns` (accessor/
 * render sont des fonctions) ne peuvent pas être construites dans la page
 * Server Component puis passées à un Client Component — elles doivent être
 * définies ici, côté client, qui ne reçoit que les données (sérialisables).
 */
export function UsersTable({ users }: { users: UserRow[] }) {
  return (
    <DataTable
      rowKey={(u) => u.id}
      emptyMessage="Aucun utilisateur."
      columns={[
        { key: "fullName", header: "Nom", sortable: true, accessor: (u) => u.fullName },
        { key: "email", header: "Email", sortable: true, accessor: (u) => u.email },
        { key: "role", header: "Rôle", accessor: (u) => u.role.name },
        {
          key: "isActive",
          header: "Statut",
          render: (u) => (
            <Badge variant={u.isActive ? "success" : "neutral"}>
              {u.isActive ? "Actif" : "Inactif"}
            </Badge>
          ),
        },
        {
          key: "actions",
          header: "Actions",
          render: (u) => <UserActiveToggle userId={u.id} isActive={u.isActive} />,
        },
      ]}
      data={users}
    />
  );
}
