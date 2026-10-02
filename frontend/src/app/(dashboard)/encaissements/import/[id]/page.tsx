import { notFound, redirect } from "next/navigation";

import { Icon } from "@/components/icons";
import {
  formatDateCourte,
  formatDateHeure,
  formatFcfa,
  libelleAnalyse,
  libelleMode,
} from "@/components/encaissements/libelles";
import { Badge, Card, PageHeader, StatCard } from "@/components/ui";
import { getSession, hasPermission } from "@/lib/auth";
import { prisma } from "backend";

import { SignalementsTable, type SignalementRow } from "./SignalementsTable";

/** Plafonds d'affichage du détail (les compteurs restent exacts) : un import de 5 000 lignes peut produire autant de
 *  signalements « déjà présent », illisibles et lourds à afficher en une seule page. */
const MAX_A_TRAITER = 500;
const MAX_INFO = 200;

function paiementLisible(json: unknown): string | null {
  if (!json || typeof json !== "object") return null;
  const p = json as { datePaiement?: string | null; mode?: string | null; montant?: string | null; reference?: string | null };
  const morceaux = [
    p.datePaiement ? formatDateCourte(p.datePaiement) : null,
    p.mode ? libelleMode(p.mode) : null,
    p.montant ? formatFcfa(p.montant) : null,
    p.reference ? `réf. ${p.reference}` : null,
  ].filter(Boolean);
  return morceaux.length > 0 ? morceaux.join(" · ") : null;
}

export default async function RapportImportPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || !hasPermission(session, "enc.consulter")) {
    redirect("/?error=acces_refuse_encaissements");
  }
  const { id } = await params;

  const imp = await prisma.encImport.findFirst({
    where: { id, type: "PRODUCTION" },
    include: {
      importePar: { select: { fullName: true } },
      brancheParDefaut: { select: { libelle: true } },
      fichier: { select: { id: true } },
    },
  });
  if (!imp) notFound();

  const selectSignalement = {
    id: true,
    numPolice: true,
    analyse: true,
    niveau: true,
    detail: true,
    paiementIndique: true,
    branche: { select: { libelle: true } },
  } as const;

  // Rejets (ligne annulée rejetée, ou sans numéro de police) : tous de niveau À TRAITER, montrés à part.
  const whereRejet = { importId: id, OR: [{ analyse: "LIGNE_ANNULEE_REJETEE" as const }, { numPolice: null }] };
  const whereATraiter = { importId: id, niveau: "A_TRAITER" as const, NOT: { OR: whereRejet.OR } };
  const whereInfo = { importId: id, niveau: "INFO" as const };

  const [groupesATraiter, groupesInfo, nbRejets, rejets, aTraiter, info] = await Promise.all([
    prisma.encSignalement.groupBy({ by: ["analyse"], where: whereATraiter, _count: { _all: true } }),
    prisma.encSignalement.groupBy({ by: ["analyse"], where: whereInfo, _count: { _all: true } }),
    prisma.encSignalement.count({ where: whereRejet }),
    prisma.encSignalement.findMany({ where: whereRejet, select: selectSignalement, orderBy: { creeAt: "asc" }, take: MAX_A_TRAITER }),
    prisma.encSignalement.findMany({
      where: whereATraiter,
      select: selectSignalement,
      orderBy: [{ analyse: "asc" }, { creeAt: "asc" }],
      take: MAX_A_TRAITER,
    }),
    prisma.encSignalement.findMany({ where: whereInfo, select: selectSignalement, orderBy: [{ analyse: "asc" }, { creeAt: "asc" }], take: MAX_INFO }),
  ]);

  const enCompteurs = (groupes: { analyse: string; _count: { _all: number } }[]) =>
    groupes.map((g) => ({ analyse: g.analyse, n: g._count._all })).sort((a, b) => b.n - a.n);
  const compteursATraiter = enCompteurs(groupesATraiter);
  const compteursInfo = enCompteurs(groupesInfo);
  const total = (liste: { n: number }[]) => liste.reduce((s, c) => s + c.n, 0);
  const nbATraiterHorsRejets = total(compteursATraiter);
  const nbATraiter = nbATraiterHorsRejets + nbRejets;
  const nbInfo = total(compteursInfo);
  const nbDejaPresent = compteursInfo.find((c) => c.analyse === "DEJA_PRESENT")?.n ?? 0;

  const versRow = (s: (typeof aTraiter)[number]): SignalementRow => ({
    id: s.id,
    numPolice: s.numPolice,
    analyse: s.analyse,
    branche: s.branche?.libelle ?? null,
    paiement: paiementLisible(s.paiementIndique),
    detail: s.detail,
  });

  const peutTelecharger = hasPermission(session, "enc.importer_production") && imp.fichier !== null;

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-6 sm:px-6 sm:py-10">
      <PageHeader
        title="Rapport d'import"
        description={`${imp.nomFichier} — importé le ${formatDateHeure(imp.importeAt)} par ${imp.importePar.fullName}`}
        backHref="/encaissements/import"
        backLabel="Imports"
        actions={
          peutTelecharger ? (
            <a
              href={`/api/encaissements/pieces-jointes/${imp.fichier!.id}`}
              className="inline-flex items-center gap-2 rounded-lg border border-border bg-secondary px-4 py-2 text-sm font-semibold text-secondary-foreground transition-colors hover:bg-secondary-hover"
            >
              <Icon name="download" className="size-4" />
              Télécharger le fichier
            </a>
          ) : null
        }
      />

      <p className="text-sm text-muted-foreground">
        Branche : <span className="font-semibold text-foreground">{imp.brancheParDefaut?.libelle ?? "colonne « Branche » du fichier"}</span>
        {" · "}
        {nbATraiter > 0 ? (
          <Badge variant="warning">{nbATraiter} signalement(s) à traiter</Badge>
        ) : (
          <Badge variant="success">Aucun signalement à traiter</Badge>
        )}
      </p>

      <section aria-label="Chiffres clés" className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard icon="file-text" tone="neutral" label="Lignes du fichier" value={imp.nbLignes.toLocaleString("fr-FR")} />
        <StatCard icon="folder-tree" tone="success" label="Contrats créés" value={imp.nbContratsCrees.toLocaleString("fr-FR")} />
        <StatCard icon="refresh-cw" tone="info" label="Contrats mis à jour" value={imp.nbContratsMaj.toLocaleString("fr-FR")} />
        <StatCard icon="wallet" tone="primary" label="Paiements à confirmer" value={imp.nbPaiementsAConfirmer.toLocaleString("fr-FR")} />
        <StatCard icon="copy" tone="neutral" label="Déjà présents" value={nbDejaPresent.toLocaleString("fr-FR")} />
        <StatCard icon="alert-triangle" tone={nbATraiter > 0 ? "warning" : "neutral"} label="À traiter" value={nbATraiter.toLocaleString("fr-FR")} />
        <StatCard icon="info" tone="info" label="Pour information" value={nbInfo.toLocaleString("fr-FR")} />
        <StatCard icon="chart-bar" tone="primary" label="Total des primes TTC" value={formatFcfa(imp.totalPrimesTtc?.toString())} hint="Contrôle : somme des primes des contrats importés" />
      </section>

      {nbRejets > 0 && (
        <Card className="space-y-3 border-danger/30">
          <h2 className="flex items-center gap-2 text-base font-bold text-danger">
            <Icon name="x-circle" className="size-5" />
            Lignes rejetées ({nbRejets})
          </h2>
          <p className="text-sm text-muted-foreground">Ces lignes n&apos;ont créé ni contrat ni paiement ; le motif est indiqué pour chacune.</p>
          <SignalementsTable rows={rejets.map(versRow)} emptyMessage="Aucune ligne rejetée." />
        </Card>
      )}

      <SectionSignalements
        titre="À traiter"
        icone="alert-triangle"
        ton="warning"
        compteurs={compteursATraiter}
        rows={aTraiter.map(versRow)}
        totalAffichable={nbATraiterHorsRejets}
        plafond={MAX_A_TRAITER}
        vide="Aucun signalement à traiter."
      />

      <SectionSignalements
        titre="Pour information"
        icone="info"
        ton="info"
        compteurs={compteursInfo}
        rows={info.map(versRow)}
        totalAffichable={nbInfo}
        plafond={MAX_INFO}
        vide="Aucun signalement pour information."
      />
    </div>
  );
}

function SectionSignalements({
  titre,
  icone,
  ton,
  compteurs,
  rows,
  totalAffichable,
  plafond,
  vide,
}: {
  titre: string;
  icone: "alert-triangle" | "info";
  ton: "warning" | "info";
  compteurs: { analyse: string; n: number }[];
  rows: SignalementRow[];
  totalAffichable: number;
  plafond: number;
  vide: string;
}) {
  return (
    <section className="space-y-3">
      <h2 className={`flex items-center gap-2 text-base font-bold ${ton === "warning" ? "text-warning" : "text-info"}`}>
        <Icon name={icone} className="size-5" />
        {titre} ({totalAffichable.toLocaleString("fr-FR")})
      </h2>
      {compteurs.length > 0 && (
        <ul className="flex flex-wrap gap-2" aria-label={`Répartition par type — ${titre}`}>
          {compteurs.map((c) => (
            <li key={c.analyse}>
              <Badge variant={ton}>
                {libelleAnalyse(c.analyse)} : {c.n.toLocaleString("fr-FR")}
              </Badge>
            </li>
          ))}
        </ul>
      )}
      {totalAffichable > plafond && (
        <p className="text-xs text-muted-foreground">
          Détail limité aux {plafond} premiers signalements ; les compteurs ci-dessus restent complets.
        </p>
      )}
      <SignalementsTable rows={rows} emptyMessage={vide} />
    </section>
  );
}
