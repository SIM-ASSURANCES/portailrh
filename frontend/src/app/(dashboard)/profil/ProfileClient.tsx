"use client";

import { useState, useRef, useTransition } from "react";
import Image from "next/image";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Icon, type IconName } from "@/components/icons";
import { updateProfilePhoto, updatePassword } from "./actions";
import { Badge, PageHeader, DataTable, type DataTableColumn } from "@/components/ui";

// ─── Types ───────────────────────────────────────────────────────────────────

interface ConnexionEntry {
  id: string;
  ipAddress: string;
  createdAt: string;
  detail: string;
}

interface ProfileClientProps {
  user: {
    id: string;
    fullName: string;
    email: string;
    photoUrl: string | null;
  };
  role: string;
  service: string | null;
  membreDepuis: string | null;
  selectedMonth: string;
  showPointageStats: boolean;
  showTresoStats: boolean;
  nbRetardsMois: number;
  nbAbsencesMois: number;
  nbDemandesEnCours: number;
  dernieresConnexions: ConnexionEntry[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const ROLE_VARIANT: Record<string, "primary" | "info" | "warning" | "success" | "neutral" | "danger"> = {
  Admin: "danger",
  RH: "primary",
  Finance: "success",
  DG: "warning",
  Collaborateur: "info",
};

function getBadgeVariant(role: string): "primary" | "info" | "warning" | "success" | "neutral" | "danger" | "outline" {
  return ROLE_VARIANT[role] ?? "neutral";
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatMembreDepuis(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
}

// ─── Session history columns ───────────────────────────────────────────────

const sessionColumns: DataTableColumn<ConnexionEntry>[] = [
  {
    key: "ipAddress",
    header: "Adresse IP",
    render: (row) => (
      <span className="font-mono text-sm text-foreground">{row.ipAddress}</span>
    ),
  },
  {
    key: "createdAt",
    header: "Date & Heure",
    render: (row) => (
      <span className="text-sm text-muted-foreground">{formatDate(row.createdAt)}</span>
    ),
  },
  {
    key: "detail",
    header: "Statut",
    render: () => (
      <Badge variant="success">Réussie</Badge>
    ),
  },
];

// ─── MiniCard Component ──────────────────────────────────────────────────────

function MiniCard({
  icon,
  label,
  value,
  tone = "neutral",
  href,
}: {
  icon: IconName;
  label: string;
  value: React.ReactNode;
  tone?: "info" | "success" | "warning" | "neutral" | "danger" | "primary";
  href?: string;
}) {
  const toneClasses = {
    info: "text-info bg-info/10 border-info/20",
    success: "text-success bg-success/10 border-success/20",
    warning: "text-warning bg-warning/10 border-warning/20",
    danger: "text-danger bg-danger/10 border-danger/20",
    neutral: "text-muted-foreground bg-muted/50 border-border",
    primary: "text-primary bg-primary/10 border-primary/20",
  };

  const Content = () => (
    <div className={`flex items-center gap-3 p-3 rounded-xl border transition-colors ${toneClasses[tone]} hover:bg-opacity-80`}>
      <div className={`flex items-center justify-center size-10 rounded-full bg-background/50 shadow-sm`}>
        <Icon name={icon} className="size-5" />
      </div>
      <div className="flex-1">
        <p className="text-xs font-semibold uppercase tracking-wider opacity-80">{label}</p>
        <p className="text-xl font-bold leading-tight">{value}</p>
      </div>
    </div>
  );

  if (href) {
    return (
      <Link href={href} className="block hover:-translate-y-0.5 transition-transform">
        <Content />
      </Link>
    );
  }

  return <Content />;
}

// ─── Main Component ───────────────────────────────────────────────────────────

type Tab = "overview" | "security";

export function ProfileClient({
  user,
  role,
  service,
  membreDepuis,
  selectedMonth,
  showPointageStats,
  showTresoStats,
  nbRetardsMois,
  nbAbsencesMois,
  nbDemandesEnCours,
  dernieresConnexions,
}: ProfileClientProps) {
  const [photoUrl, setPhotoUrl] = useState(user.photoUrl);
  const [isUploading, setIsUploading] = useState(false);
  const [activeTab, setActiveTab] = useState<Tab>("overview");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const handleMonthChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const params = new URLSearchParams(searchParams);
    params.set("mois", e.target.value);
    router.push(`${pathname}?${params.toString()}`);
  };

  // Password form
  const [currentPass, setCurrentPass] = useState("");
  const [newPass, setNewPass] = useState("");
  const [confirmPass, setConfirmPass] = useState("");
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // ── Photo upload ────────────────────────────────────────────────────────────

  const handlePhotoClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    const formData = new FormData();
    formData.append("file", file);

    try {
      const res = await fetch("/api/upload-photo", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      if (data.success) {
        setPhotoUrl(data.url); // Mise à jour immédiate côté client
        await updateProfilePhoto(data.url);
      } else {
        alert(data.error || "Erreur lors de l'upload");
      }
    } catch {
      alert("Erreur de connexion");
    } finally {
      setIsUploading(false);
      // Reset input so same file can be re-selected
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  // ── Password update ─────────────────────────────────────────────────────────

  const handlePasswordSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setMessage(null);

    if (newPass !== confirmPass) {
      setMessage({ type: "error", text: "Les nouveaux mots de passe ne correspondent pas." });
      return;
    }
    if (newPass.length < 8) {
      setMessage({ type: "error", text: "Le mot de passe doit contenir au moins 8 caractères." });
      return;
    }

    startTransition(async () => {
      try {
        await updatePassword(currentPass, newPass);
        setMessage({ type: "success", text: "Votre mot de passe a été modifié avec succès." });
        setCurrentPass("");
        setNewPass("");
        setConfirmPass("");
      } catch (err) {
        setMessage({
          type: "error",
          text: err instanceof Error ? err.message : "Une erreur est survenue.",
        });
      }
    });
  };

  const initials = user.fullName
    .split(" ")
    .map((n) => n[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      <PageHeader
        title="Mon Profil"
        description="Gérez vos informations et vos paramètres de sécurité."
      />

      <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
        {/* ── Colonne gauche : Identité ─────────────────────────────────────── */}
        <div className="md:col-span-1">
          <div className="relative overflow-hidden rounded-2xl border border-border bg-surface p-6 shadow-elevated flex flex-col items-center text-center gap-4">
            {/* Filet de tête coloré */}
            <span className="absolute inset-x-0 top-0 h-[3px] bg-primary" aria-hidden="true" />

            {/* Avatar */}
            <div className="relative mt-2">
              <div
                className="relative size-24 overflow-hidden rounded-full border-4 border-white shadow-md bg-primary group cursor-pointer"
                onClick={handlePhotoClick}
                title="Cliquer pour changer la photo"
              >
                {photoUrl ? (
                  <Image src={photoUrl} alt={`Photo de profil de ${user.fullName}`} fill sizes="96px" className="object-cover" />
                ) : (
                  <div className="grid size-full place-items-center text-2xl font-bold text-primary-foreground">
                    {initials}
                  </div>
                )}
                {/* Overlay hover */}
                <div className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                  <Icon name="camera" className="size-6 text-white" />
                </div>
              </div>

              {/* Spinner upload */}
              {isUploading && (
                <div className="absolute inset-0 flex items-center justify-center bg-white/70 rounded-full">
                  <Icon name="loader" className="size-6 animate-spin text-primary" />
                </div>
              )}
              <input
                type="file"
                ref={fileInputRef}
                className="hidden"
                accept="image/*"
                onChange={handleFileChange}
              />
            </div>

            {/* Nom & Rôle */}
            <div className="space-y-1.5">
              <h2 className="text-xl font-bold text-foreground leading-tight">{user.fullName}</h2>
              <Badge variant={getBadgeVariant(role)}>{role}</Badge>
              {service && (
                <p className="text-sm text-muted-foreground mt-1">{service}</p>
              )}
              {membreDepuis && (
                <p className="text-xs text-muted-foreground">
                  Membre depuis {formatMembreDepuis(membreDepuis)}
                </p>
              )}
            </div>

            {/* Séparateur */}
            <div className="w-full border-t border-border" />

            {/* Actions */}
            <div className="w-full space-y-2">
              <button
                type="button"
                onClick={handlePhotoClick}
                disabled={isUploading}
                className="w-full inline-flex items-center justify-center gap-2 rounded-lg border border-border bg-transparent px-4 py-2 text-sm font-medium text-foreground shadow-sm hover:bg-muted transition-colors duration-150 disabled:opacity-50 disabled:pointer-events-none"
              >
                <Icon name="camera" className="size-4" />
                {isUploading ? "Envoi en cours..." : "Modifier la photo"}
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("security")}
                className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm hover:bg-primary/90 transition-colors duration-150"
              >
                <Icon name="lock" className="size-4" />
                Changer le mot de passe
              </button>
            </div>
          </div>
        </div>

        {/* ── Colonne droite : Onglets ─────────────────────────────────────── */}
        <div className="md:col-span-2 space-y-4">
          {/* Onglets */}
          <div className="flex gap-1 rounded-xl border border-border bg-muted/40 p-1">
            {(["overview", "security"] as Tab[]).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`flex-1 rounded-lg px-4 py-2 text-sm font-semibold transition-all duration-200 ${
                  activeTab === tab
                    ? "bg-surface text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <span className="inline-flex items-center gap-1.5">
                  <Icon
                    name={tab === "overview" ? "user" : "lock"}
                    className="size-4"
                  />
                  {tab === "overview" ? "Vue d'ensemble" : "Sécurité"}
                </span>
              </button>
            ))}
          </div>

          {/* ── Onglet Vue d'ensemble ────────────────────────────────────────── */}
          {activeTab === "overview" && (
            <div className="space-y-5">
              {/* Informations professionnelles */}
              <section className="rounded-2xl border border-border bg-surface p-6 shadow-elevated space-y-4">
                <h3 className="flex items-center gap-2 text-base font-bold text-foreground">
                  <Icon name="briefcase" className="size-4 text-primary" />
                  Informations professionnelles
                </h3>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {/* Email */}
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Email</p>
                    <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm text-foreground">
                      <Icon name="mail" className="size-4 text-muted-foreground shrink-0" />
                      <span className="truncate">{user.email}</span>
                    </div>
                  </div>

                  {/* Service */}
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Service</p>
                    <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm text-foreground">
                      <Icon name="building" className="size-4 text-muted-foreground shrink-0" />
                      <span>{service ?? <span className="text-muted-foreground italic">Non renseigné</span>}</span>
                    </div>
                  </div>

                  {/* Rôle */}
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Rôle applicatif</p>
                    <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm">
                      <Icon name="shield" className="size-4 text-muted-foreground shrink-0" />
                      <Badge variant={getBadgeVariant(role)}>{role}</Badge>
                    </div>
                  </div>

                  {/* Statut compte */}
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Statut du compte</p>
                    <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm">
                      <Icon name="circle-check" className="size-4 text-success shrink-0" />
                      <Badge variant="success">Actif</Badge>
                    </div>
                  </div>
                </div>
              </section>

              {/* Activité du mois — uniquement si pertinent */}
              {(showPointageStats || showTresoStats) && (
                <section className="rounded-2xl border border-border bg-surface p-6 shadow-elevated space-y-4">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <h3 className="flex items-center gap-2 text-base font-bold text-foreground">
                      <Icon name="chart-bar" className="size-4 text-primary" />
                      Mon activité
                    </h3>
                    <input
                      type="month"
                      value={selectedMonth}
                      onChange={handleMonthChange}
                      className="text-sm rounded-lg border border-border px-3 py-1.5 bg-background text-foreground shadow-sm focus:ring-2 focus:ring-primary focus:outline-none"
                    />
                  </div>
                  
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                    {showPointageStats && (
                      <>
                        <MiniCard
                          icon="clock"
                          label="Retards"
                          value={nbRetardsMois}
                          tone={nbRetardsMois > 0 ? "warning" : "success"}
                          href="/pointage/historique"
                        />
                        <MiniCard
                          icon="calendar-x"
                          label="Absences"
                          value={nbAbsencesMois}
                          tone={nbAbsencesMois > 0 ? "danger" : "success"}
                          href="/pointage/historique"
                        />
                      </>
                    )}
                    {showTresoStats && (
                      <MiniCard
                        icon="wallet"
                        label="Demandes en cours"
                        value={nbDemandesEnCours}
                        tone={nbDemandesEnCours > 0 ? "info" : "neutral"}
                        href="/treso/demandes"
                      />
                    )}
                  </div>
                </section>
              )}

              {/* Historique des connexions */}
              <section className="rounded-2xl border border-border bg-surface p-6 shadow-elevated space-y-4">
                <h3 className="flex items-center gap-2 text-base font-bold text-foreground">
                  <Icon name="shield" className="size-4 text-primary" />
                  Dernières connexions
                </h3>
                {dernieresConnexions.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Aucun historique disponible.</p>
                ) : (
                  <DataTable
                    columns={sessionColumns}
                    data={dernieresConnexions}
                    rowKey={(r) => r.id}
                  />
                )}
              </section>
            </div>
          )}

          {/* ── Onglet Sécurité ──────────────────────────────────────────────── */}
          {activeTab === "security" && (
            <section className="rounded-2xl border border-border bg-surface p-6 shadow-elevated space-y-6">
              <div>
                <h3 className="flex items-center gap-2 text-base font-bold text-foreground">
                  <Icon name="lock" className="size-4 text-primary" />
                  Changer le mot de passe
                </h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  Pour votre sécurité, choisissez un mot de passe fort (min. 8 caractères, majuscule, chiffre et caractère spécial).
                </p>
              </div>

              <form onSubmit={handlePasswordSubmit} className="space-y-4 max-w-md">
                {message && (
                  <div
                    className={`flex items-start gap-2 rounded-lg p-3 text-sm ${
                      message.type === "success"
                        ? "bg-success-bg text-success border border-success-border"
                        : "bg-danger-bg text-danger border border-danger-border"
                    }`}
                  >
                    <Icon
                      name={message.type === "success" ? "circle-check" : "circle-x"}
                      className="size-4 mt-0.5 shrink-0"
                    />
                    {message.text}
                  </div>
                )}

                <div>
                  <label className="block text-sm font-medium text-foreground mb-1.5">
                    Mot de passe actuel
                  </label>
                  <input
                    type="password"
                    value={currentPass}
                    onChange={(e) => setCurrentPass(e.target.value)}
                    className="block w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm text-foreground shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                    placeholder="••••••••"
                    required
                    autoComplete="current-password"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-foreground mb-1.5">
                    Nouveau mot de passe
                  </label>
                  <input
                    type="password"
                    value={newPass}
                    onChange={(e) => setNewPass(e.target.value)}
                    className="block w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm text-foreground shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                    placeholder="••••••••"
                    required
                    minLength={8}
                    autoComplete="new-password"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-foreground mb-1.5">
                    Confirmer le mot de passe
                  </label>
                  <input
                    type="password"
                    value={confirmPass}
                    onChange={(e) => setConfirmPass(e.target.value)}
                    className="block w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm text-foreground shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                    placeholder="••••••••"
                    required
                    minLength={8}
                    autoComplete="new-password"
                  />
                </div>

                <div className="flex items-center justify-between pt-2">
                  <a href="/forgot-password" className="text-sm text-primary hover:underline">
                    Mot de passe oublié ?
                  </a>
                  <button
                    type="submit"
                    disabled={isPending}
                    className="inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground shadow-sm hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50 disabled:pointer-events-none transition-colors duration-150"
                  >
                    {isPending && <Icon name="loader" className="size-4 animate-spin" />}
                    {isPending ? "Modification..." : "Mettre à jour"}
                  </button>
                </div>
              </form>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
