"use client";

import { useState } from "react";

import { Badge, DataTable } from "@/components/ui";

import { RegenererInvitationButton } from "./RegenererInvitationButton";
import { UserActiveToggle } from "./UserActiveToggle";
import { UserDeleteButton } from "./UserDeleteButton";
import { UserResponsableToggle, type ServiceAvecResponsable } from "./UserResponsableToggle";
import { UserRoleSelect } from "./UserRoleSelect";
import { UserServiceSelect } from "./UserServiceSelect";

interface UserRow {
  id: string;
  fullName: string;
  email: string;
  isActive: boolean;
  role: { id: string; name: string };
  service: { id: string; name: string } | null;
  /** Invitation par lien pas encore finalisée (voir CLAUDE.md "Invitation par lien"). */
  isPending: boolean;
  /** Services dont ce compte est le responsable (membre ou non). */
  responsabilites: string[];
}

/**
 * Wrapper Client Component autour de DataTable : les `columns` (accessor/
 * render sont des fonctions) ne peuvent pas être construites dans la page
 * Server Component puis passées à un Client Component — elles doivent être
 * définies ici, côté client, qui ne reçoit que les données (sérialisables).
 */
export function UsersTable({
  users,
  roles,
  services,
}: {
  users: UserRow[];
  roles: { id: string; name: string }[];
  services: ServiceAvecResponsable[];
}) {
  const [responsablesSeulement, setResponsablesSeulement] = useState(false);
  const serviceParId = new Map(services.map((s) => [s.id, s]));
  const lignes = responsablesSeulement ? users.filter((u) => u.responsabilites.length > 0) : users;

  return (
    <div className="space-y-3">
      <label className="inline-flex items-center gap-2 text-sm text-foreground">
        <input
          type="checkbox"
          checked={responsablesSeulement}
          onChange={(e) => setResponsablesSeulement(e.target.checked)}
        />
        Responsables seulement
      </label>
      <DataTable
        rowKey={(u) => u.id}
        emptyMessage={responsablesSeulement ? "Aucun responsable de service." : "Aucun utilisateur."}
        columns={[
          {
            key: "fullName",
            header: "Nom",
            sortable: true,
            accessor: (u) => u.fullName,
          },
          { key: "email", header: "Email", sortable: true, accessor: (u) => u.email },
          {
            key: "role",
            header: "Rôle",
            render: (u) => (
              <div className="min-w-[120px]">
                <UserRoleSelect userId={u.id} roleId={u.role.id} roles={roles} />
              </div>
            ),
          },
          {
            key: "service",
            header: "Service",
            render: (u) => (
              <div className="max-w-[190px] space-y-1.5">
                {u.responsabilites.length > 0 ? (
                  <div className="flex flex-wrap gap-1" data-badges-responsable>
                    {u.responsabilites.map((nom) => (
                      <Badge key={nom} variant="info">
                        Responsable · {nom}
                      </Badge>
                    ))}
                  </div>
                ) : null}
                <UserServiceSelect userId={u.id} currentServiceId={u.service?.id || null} services={services} />
                {!u.isPending && u.isActive ? (
                  <UserResponsableToggle userId={u.id} service={u.service ? (serviceParId.get(u.service.id) ?? null) : null} />
                ) : null}
              </div>
            ),
          },
          {
            key: "isActive",
            header: "Statut",
            render: (u) =>
              u.isPending ? (
                <Badge variant="warning">Invitation envoyée</Badge>
              ) : (
                <Badge variant={u.isActive ? "success" : "neutral"}>{u.isActive ? "Actif" : "Inactif"}</Badge>
              ),
          },
          {
            key: "actions",
            header: "Actions",
            render: (u) =>
              u.isPending ? (
                <RegenererInvitationButton userId={u.id} />
              ) : (
                <div className="flex flex-wrap items-center gap-2">
                  <UserActiveToggle userId={u.id} isActive={u.isActive} />
                  <UserDeleteButton userId={u.id} />
                </div>
              ),
          },
        ]}
        data={lignes}
      />
    </div>
  );
}
