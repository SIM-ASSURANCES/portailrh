import { prisma } from "backend";
import { PageHeader } from "@/components/ui";
import {
  NotificationMonitoring,
  type UserPushData,
} from "@/components/admin/NotificationMonitoring";

export default async function AdminNotificationsPage() {
  const [usersRaw, services] = await Promise.all([
    prisma.user.findMany({
      include: {
        role: true,
        service: true,
        fcmTokens: {
          orderBy: { updatedAt: "desc" },
        },
      },
      orderBy: { fullName: "asc" },
    }),
    prisma.service.findMany({
      orderBy: { name: "asc" },
    }),
  ]);

  const users: UserPushData[] = usersRaw.map((u) => ({
    id: u.id,
    fullName: u.fullName,
    email: u.email,
    isActive: u.isActive,
    isPending: !u.passwordHash,
    role: { id: u.role.id, name: u.role.name },
    service: u.service ? { id: u.service.id, name: u.service.name } : null,
    fcmTokens: u.fcmTokens.map((t) => ({
      id: t.id,
      userAgent: t.userAgent,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
    })),
  }));

  return (
    <div className="mx-auto max-w-6xl space-y-8 px-4 sm:px-6 py-8">
      <PageHeader
        title="Adoption des Notifications Push"
        description="Supervisez en temps réel le taux d'acceptation des alertes par les collaborateurs et leurs terminaux actifs."
      />

      <section className="rounded-2xl border border-border/80 bg-surface p-5 sm:p-6 shadow-xs">
        <NotificationMonitoring users={users} services={services} />
      </section>
    </div>
  );
}
