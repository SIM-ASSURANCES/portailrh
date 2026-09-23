"use client";

import { useState, useMemo } from "react";
import { format, formatDistanceToNow } from "date-fns";
import { fr } from "date-fns/locale";
import {
  Bell,
  BellOff,
  Search,
  Download,
  Smartphone,
  Monitor,
  Tablet,
  Globe,
  CheckCircle2,
  Clock,
  Filter,
} from "lucide-react";
import { parseUserAgent } from "@/lib/utils/userAgentParser";

export interface UserPushData {
  id: string;
  fullName: string;
  email: string;
  isActive: boolean;
  isPending: boolean;
  role: { id: string; name: string };
  service: { id: string; name: string } | null;
  fcmTokens: Array<{
    id: string;
    userAgent: string | null;
    createdAt: string | Date;
    updatedAt: string | Date;
  }>;
}

interface NotificationMonitoringProps {
  users: UserPushData[];
  services: Array<{ id: string; name: string }>;
}

type PushFilter = "all" | "active" | "inactive";

export function NotificationMonitoring({ users, services }: NotificationMonitoringProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedService, setSelectedService] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<PushFilter>("all");

  // Métriques globales calculées
  const metrics = useMemo(() => {
    const totalUsers = users.length;
    const activeUsers = users.filter((u) => u.isActive);
    const withPush = users.filter((u) => u.fcmTokens.length > 0);
    const withoutPush = users.filter((u) => u.fcmTokens.length === 0);
    const totalDevices = users.reduce((acc, u) => acc + u.fcmTokens.length, 0);

    const activeUsersCount = activeUsers.length;
    const activeWithPushCount = activeUsers.filter((u) => u.fcmTokens.length > 0).length;
    const adoptionRate = activeUsersCount > 0 ? Math.round((activeWithPushCount / activeUsersCount) * 100) : 0;

    return {
      totalUsers,
      withPushCount: withPush.length,
      withoutPushCount: withoutPush.length,
      totalDevices,
      adoptionRate,
    };
  }, [users]);

  // Filtrage de la liste
  const filteredUsers = useMemo(() => {
    return users.filter((user) => {
      // 1. Filtre par recherche
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase().trim();
        const matchesName = user.fullName.toLowerCase().includes(query);
        const matchesEmail = user.email.toLowerCase().includes(query);
        const matchesRole = user.role.name.toLowerCase().includes(query);
        const matchesService = user.service?.name.toLowerCase().includes(query);
        if (!matchesName && !matchesEmail && !matchesRole && !matchesService) {
          return false;
        }
      }

      // 2. Filtre par statut push
      if (statusFilter === "active" && user.fcmTokens.length === 0) return false;
      if (statusFilter === "inactive" && user.fcmTokens.length > 0) return false;

      // 3. Filtre par service
      if (selectedService !== "all" && user.service?.id !== selectedService) {
        return false;
      }

      return true;
    });
  }, [users, searchQuery, statusFilter, selectedService]);

  // Export CSV
  const handleExportCsv = () => {
    const headers = [
      "Collaborateur",
      "Email",
      "Statut Compte",
      "Service",
      "Rôle",
      "Notifications Push",
      "Nombre d'appareils",
      "Détail des terminaux",
      "Dernière synchronisation",
    ];

    const rows = filteredUsers.map((user) => {
      const hasPush = user.fcmTokens.length > 0;
      const deviceNames = user.fcmTokens
        .map((t) => parseUserAgent(t.userAgent).label)
        .join(" | ");

      const lastDate = hasPush
        ? format(new Date(user.fcmTokens[0].updatedAt), "yyyy-MM-dd HH:mm")
        : "N/A";

      return [
        `"${user.fullName.replace(/"/g, '""')}"`,
        `"${user.email.replace(/"/g, '""')}"`,
        user.isActive ? (user.isPending ? "En attente" : "Actif") : "Désactivé",
        `"${(user.service?.name ?? "Non assigné").replace(/"/g, '""')}"`,
        `"${user.role.name.replace(/"/g, '""')}"`,
        hasPush ? "Activé" : "Non configuré",
        user.fcmTokens.length,
        `"${deviceNames.replace(/"/g, '""')}"`,
        lastDate,
      ].join(";");
    });

    const csvContent = "\uFEFF" + [headers.join(";"), ...rows].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute(
      "download",
      `monitoring-notifications-sim-${format(new Date(), "yyyy-MM-dd")}.csv`
    );
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="space-y-6">
      {/* 1. EN-TÊTE DE LA SECTION DE MONITORING */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-border/80 pb-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="grid size-7 place-items-center rounded-lg bg-primary/10 text-primary">
              <Bell className="size-4" />
            </span>
            <h2 className="text-base font-bold text-foreground tracking-tight">
              Observabilité des Notifications Push
            </h2>
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            Supervisez en temps réel le taux d&apos;acceptation des alertes par les collaborateurs et leurs terminaux actifs.
          </p>
        </div>

        <button
          type="button"
          onClick={handleExportCsv}
          className="inline-flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-1.5 text-xs font-medium text-foreground shadow-xs hover:bg-muted transition-colors self-start sm:self-auto"
        >
          <Download className="size-3.5 text-muted-foreground" />
          <span>Exporter (CSV)</span>
        </button>
      </div>

      {/* 2. GRILLE DES KPIS */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {/* Taux d'adoption */}
        <div className="rounded-xl border border-border bg-surface p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">Taux d&apos;adoption</span>
            <span className="rounded-md bg-primary/10 px-2 py-0.5 text-[11px] font-bold text-primary">
              {metrics.adoptionRate}%
            </span>
          </div>
          <div className="mt-2 text-2xl font-bold tracking-tight text-foreground">
            {metrics.adoptionRate}%
          </div>
          {/* Barre de progression fine */}
          <div className="mt-3 h-1.5 w-full rounded-full bg-slate-100 overflow-hidden">
            <div
              className="h-full bg-primary rounded-full transition-all duration-500 ease-out"
              style={{ width: `${metrics.adoptionRate}%` }}
            />
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">
            Sur les comptes collaborateurs actifs
          </p>
        </div>

        {/* Abonnés Actifs */}
        <div className="rounded-xl border border-border bg-surface p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">Notifications actives</span>
            <CheckCircle2 className="size-4 text-emerald-600" />
          </div>
          <div className="mt-2 text-2xl font-bold tracking-tight text-foreground">
            {metrics.withPushCount}
            <span className="text-xs font-normal text-muted-foreground ml-1.5">
              / {metrics.totalUsers} collaborateurs
            </span>
          </div>
          <p className="mt-3 text-[11px] text-muted-foreground">
            Joignables immédiatement par push natif
          </p>
        </div>

        {/* En attente / Non configurés */}
        <div className="rounded-xl border border-border bg-surface p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">Non configurés</span>
            <BellOff className="size-4 text-amber-600" />
          </div>
          <div className="mt-2 text-2xl font-bold tracking-tight text-foreground">
            {metrics.withoutPushCount}
          </div>
          <p className="mt-3 text-[11px] text-muted-foreground">
            En attente d&apos;autorisation ou sans connexion
          </p>
        </div>

        {/* Terminaux Enregistrés */}
        <div className="rounded-xl border border-border bg-surface p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">Terminaux enregistrés</span>
            <Smartphone className="size-4 text-primary" />
          </div>
          <div className="mt-2 text-2xl font-bold tracking-tight text-foreground">
            {metrics.totalDevices}
          </div>
          <p className="mt-3 text-[11px] text-muted-foreground">
            Navigateurs desktop et mobiles synchronisés
          </p>
        </div>
      </div>

      {/* 3. BARRE DE FILTRES ET DE RECHERCHE */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between rounded-xl border border-border bg-slate-50/50 p-3">
        {/* Onglets de filtrage par statut */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 lg:pb-0">
          <button
            type="button"
            onClick={() => setStatusFilter("all")}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
              statusFilter === "all"
                ? "bg-surface text-foreground font-semibold shadow-xs border border-border"
                : "text-muted-foreground hover:bg-muted/70 hover:text-foreground"
            }`}
          >
            Tous ({users.length})
          </button>
          <button
            type="button"
            onClick={() => setStatusFilter("active")}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
              statusFilter === "active"
                ? "bg-surface text-foreground font-semibold shadow-xs border border-border"
                : "text-muted-foreground hover:bg-muted/70 hover:text-foreground"
            }`}
          >
            Activé ({metrics.withPushCount})
          </button>
          <button
            type="button"
            onClick={() => setStatusFilter("inactive")}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
              statusFilter === "inactive"
                ? "bg-surface text-foreground font-semibold shadow-xs border border-border"
                : "text-muted-foreground hover:bg-muted/70 hover:text-foreground"
            }`}
          >
            Non configuré ({metrics.withoutPushCount})
          </button>
        </div>

        {/* Recherche et filtre par service */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
          {/* Sélecteur de service */}
          <div className="relative min-w-[160px]">
            <select
              value={selectedService}
              onChange={(e) => setSelectedService(e.target.value)}
              className="w-full appearance-none rounded-lg border border-border bg-surface px-3 py-1.5 pr-8 text-xs font-medium text-foreground shadow-xs hover:bg-muted focus:outline-none focus:ring-2 focus:ring-primary/20"
              aria-label="Filtrer par service"
            >
              <option value="all">Tous les services</option>
              {services.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            <Filter className="pointer-events-none absolute right-2.5 top-2 size-3 text-muted-foreground" />
          </div>

          {/* Champ de recherche */}
          <div className="relative min-w-[220px]">
            <Search className="pointer-events-none absolute left-2.5 top-2 size-3.5 text-muted-foreground" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Rechercher par nom, email..."
              className="w-full rounded-lg border border-border bg-surface py-1.5 pl-8 pr-3 text-xs placeholder:text-muted-foreground/70 focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
          </div>
        </div>
      </div>

      {/* 4. TABLEAU DE SUPERVISION DES UTILISATEURS */}
      <div className="rounded-xl border border-border bg-surface shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-border bg-slate-50/70 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
              <tr>
                <th scope="col" className="px-4 py-3">
                  Collaborateur
                </th>
                <th scope="col" className="px-4 py-3">
                  Service & Rôle
                </th>
                <th scope="col" className="px-4 py-3">
                  Statut Push
                </th>
                <th scope="col" className="px-4 py-3">
                  Terminaux Détectés
                </th>
                <th scope="col" className="px-4 py-3 text-right">
                  Dernière Synchro
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {filteredUsers.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-12 text-center text-muted-foreground">
                    <p className="text-sm font-medium">Aucun résultat trouvé</p>
                    <p className="text-xs mt-1">
                      Modifiez votre recherche ou réinitialisez les filtres sélectionnés.
                    </p>
                  </td>
                </tr>
              ) : (
                filteredUsers.map((user) => {
                  const hasPush = user.fcmTokens.length > 0;
                  const sortedTokens = [...user.fcmTokens].sort(
                    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
                  );
                  const lastToken = sortedTokens[0];

                  return (
                    <tr
                      key={user.id}
                      className="hover:bg-muted/40 transition-colors"
                    >
                      {/* Collaborateur */}
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <div className="grid size-8 place-items-center rounded-full bg-primary/10 text-xs font-bold text-primary shrink-0">
                            {user.fullName
                              .split(" ")
                              .map((n) => n[0])
                              .slice(0, 2)
                              .join("")
                              .toUpperCase()}
                          </div>
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="font-semibold text-foreground truncate">
                                {user.fullName}
                              </span>
                              {!user.isActive && (
                                <span className="rounded bg-red-50 px-1.5 py-0.2 text-[9px] font-medium text-red-700 border border-red-200/60">
                                  Désactivé
                                </span>
                              )}
                              {user.isPending && (
                                <span className="rounded bg-amber-50 px-1.5 py-0.2 text-[9px] font-medium text-amber-800 border border-amber-200/60">
                                  En attente
                                </span>
                              )}
                            </div>
                            <p className="text-[11px] text-muted-foreground truncate">
                              {user.email}
                            </p>
                          </div>
                        </div>
                      </td>

                      {/* Service & Rôle */}
                      <td className="px-4 py-3">
                        <div className="space-y-0.5">
                          <p className="font-medium text-foreground">
                            {user.service?.name ?? "Non assigné"}
                          </p>
                          <p className="text-[11px] text-muted-foreground">
                            {user.role.name}
                          </p>
                        </div>
                      </td>

                      {/* Statut Push */}
                      <td className="px-4 py-3">
                        {hasPush ? (
                          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-0.5 text-[11px] font-medium text-emerald-700 border border-emerald-200/60">
                            <span className="size-1.5 rounded-full bg-emerald-500" />
                            <span>Activé ({user.fcmTokens.length})</span>
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] font-medium text-slate-600 border border-slate-200/60">
                            <span className="size-1.5 rounded-full bg-slate-400" />
                            <span>Non configuré</span>
                          </span>
                        )}
                      </td>

                      {/* Terminaux Détectés */}
                      <td className="px-4 py-3">
                        {hasPush ? (
                          <div className="flex flex-wrap gap-1.5">
                            {user.fcmTokens.map((token) => {
                              const parsed = parseUserAgent(token.userAgent);
                              return (
                                <span
                                  key={token.id}
                                  className="inline-flex items-center gap-1 rounded-md bg-slate-100/80 px-2 py-0.5 text-[10px] text-slate-700 border border-slate-200/50"
                                  title={token.userAgent ?? "Agent inconnu"}
                                >
                                  {parsed.icon === "smartphone" ? (
                                    <Smartphone className="size-3 text-muted-foreground" />
                                  ) : parsed.icon === "tablet" ? (
                                    <Tablet className="size-3 text-muted-foreground" />
                                  ) : parsed.icon === "monitor" ? (
                                    <Monitor className="size-3 text-muted-foreground" />
                                  ) : (
                                    <Globe className="size-3 text-muted-foreground" />
                                  )}
                                  <span>{parsed.label}</span>
                                </span>
                              );
                            })}
                          </div>
                        ) : (
                          <span className="text-[11px] text-muted-foreground/60 italic">
                            Aucun appareil relié
                          </span>
                        )}
                      </td>

                      {/* Dernière Synchronisation */}
                      <td className="px-4 py-3 text-right text-muted-foreground">
                        {lastToken ? (
                          <span
                            className="inline-flex items-center gap-1 text-[11px]"
                            title={format(new Date(lastToken.updatedAt), "d MMMM yyyy HH:mm", {
                              locale: fr,
                            })}
                          >
                            <Clock className="size-3" />
                            <span>
                              {formatDistanceToNow(new Date(lastToken.updatedAt), {
                                addSuffix: true,
                                locale: fr,
                              })}
                            </span>
                          </span>
                        ) : (
                          <span className="text-[11px] text-muted-foreground/50">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
