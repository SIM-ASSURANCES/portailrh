import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession, hasPermission } from "@/lib/auth";
import { prisma } from "backend";
import { PageHeader } from "@/components/ui";
import { PointagesRHFilters } from "./PointagesRHFilters";
import { PointagesRHTables, type PointageRHRow } from "./PointagesRHTables";
import { Icon } from "@/components/icons";

export const metadata = {
  title: "Tous les pointages - Portail SIM Assurances",
};

interface PointagesRHPageProps {
  searchParams: Promise<{
    du?: string;
    au?: string;
    type?: string;
    userId?: string;
    page?: string;
  }>;
}

/** Lignes par page (mesuré : 30 000 pointages affichés d'un coup mettaient plus de 40 s à charger). */
const TAILLE_PAGE = 200;

export default async function PointagesRHPage({ searchParams }: PointagesRHPageProps) {
  const session = await getSession();
  if (!session) redirect("/login");
  
  // Vérification de la permission pour consulter tous les pointages
  if (!hasPermission(session, "pointage.consulter_tous") && !hasPermission(session, "pointage.voir_dashboard_rh")) {
     redirect("/?error=acces_refuse");
  }

  const { du, au, type, userId, page: pageBrute } = await searchParams;
  const page = Math.max(1, Math.floor(Number(pageBrute)) || 1);

  // Construction des bornes de dates
  let dateDebut: Date | undefined = undefined;
  let dateFin: Date | undefined = undefined;

  if (du) {
    const d = new Date(du);
    d.setHours(0, 0, 0, 0);
    dateDebut = d;
  }

  if (au) {
    const d = new Date(au);
    d.setHours(23, 59, 59, 999);
    dateFin = d;
  }

  // Filtre Prisma pour les Pointages
  const pointageWhere: Record<string, unknown> = {};

  if (userId) {
    pointageWhere.userId = userId;
  }

  if (dateDebut || dateFin) {
    pointageWhere.heure = {
      ...(dateDebut ? { gte: dateDebut } : {}),
      ...(dateFin ? { lte: dateFin } : {}),
    };
  }

  if (type === "ARRIVEE") {
    pointageWhere.type = "ARRIVEE";
  } else if (type === "DEPART") {
    pointageWhere.type = "DEPART";
  } else if (type === "RETARD") {
    pointageWhere.estRetard = true;
  }

  // Récupération des données
  const [pointagesDb, total, usersDb] = await Promise.all([
    prisma.pointage.findMany({
      where: pointageWhere,
      orderBy: [{ heure: "desc" }, { id: "asc" }],
      skip: (page - 1) * TAILLE_PAGE,
      take: TAILLE_PAGE,
      include: {
        user: { select: { fullName: true } },
        effectuePar: { select: { fullName: true } },
        corrections: {
          orderBy: { createdAt: "desc" },
          take: 1,
        },
      },
    }),
    prisma.pointage.count({ where: pointageWhere }),
    prisma.user.findMany({
      where: { isActive: true },
      select: { id: true, fullName: true },
      orderBy: { fullName: "asc" },
    }),
  ]);

  // Formatage sérialisable des lignes de pointage
  const pointages: PointageRHRow[] = pointagesDb.map((p) => ({
    id: p.id,
    heure: p.heure.toISOString(),
    heurePrevue: p.heurePrevue,
    type: p.type,
    source: p.source,
    estRetard: p.estRetard,
    minutesRetard: p.minutesRetard,
    estDepartAnticipe: p.estDepartAnticipe,
    motif: p.motif,
    collaborateurNom: p.user.fullName,
    effectueParNom: p.effectuePar?.fullName ?? null,
    correctionsCount: p.corrections.length,
    dernierMotifCorrection: p.corrections[0]?.motif ?? null,
    ipAddress: p.ipAddress ?? null,
  }));

  const pagesTotal = Math.max(1, Math.ceil(total / TAILLE_PAGE));
  const lienPage = (n: number) => {
    const params = new URLSearchParams();
    if (du) params.set("du", du);
    if (au) params.set("au", au);
    if (type) params.set("type", type);
    if (userId) params.set("userId", userId);
    params.set("page", String(Math.min(Math.max(1, n), pagesTotal)));
    return `/pointage/rh/pointages?${params.toString()}`;
  };

  return (
    <div className="mx-auto max-w-6xl space-y-3 px-4 py-2 font-sans sm:px-6 md:space-y-6 md:py-8">
      <div className="hidden md:block">
        <PageHeader
          title="Consultation des pointages"
          description="Vue globale de tous les pointages (arrivées, départs) de l'ensemble des collaborateurs."
          backHref="/pointage/rh"
          backLabel="Retour à la Boîte à Outils"
        />
      </div>
      {/* Mobile : titre compact en gras, sans description. */}
      <h1 className="text-xl font-black tracking-tight text-foreground md:hidden">Tous les pointages</h1>

      <PointagesRHFilters
        initial={{ du, au, type, userId }}
        users={usersDb}
      />

      <div className="space-y-2 rounded-2xl border border-border bg-surface p-3 shadow-xs md:space-y-3 md:p-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Icon name="file-text" className="size-4 text-primary md:size-5" />
            <h2 className="text-sm font-bold text-foreground md:text-base">
              Pointages ({total})
            </h2>
          </div>
          {pointages.length > 0 ? (
            <span className="hidden text-xs text-muted-foreground md:inline">
              Trié par date décroissante
            </span>
          ) : null}
        </div>

        <PointagesRHTables pointages={pointages} />

        {total > TAILLE_PAGE ? (
          <nav className="flex items-center justify-between gap-3 pt-2 text-sm" aria-label="Pagination des pointages">
            <Link
              href={lienPage(page - 1)}
              className={`rounded-md border border-border px-4 py-2 ${page <= 1 ? "pointer-events-none opacity-50" : ""}`}
              aria-disabled={page <= 1}
            >
              Précédent
            </Link>
            <span className="text-muted-foreground">
              Page {page} / {pagesTotal} — lignes {(page - 1) * TAILLE_PAGE + 1} à {Math.min(page * TAILLE_PAGE, total)} sur {total}
            </span>
            <Link
              href={lienPage(page + 1)}
              className={`rounded-md border border-border px-4 py-2 ${page >= pagesTotal ? "pointer-events-none opacity-50" : ""}`}
              aria-disabled={page >= pagesTotal}
            >
              Suivant
            </Link>
          </nav>
        ) : null}
      </div>
    </div>
  );
}
