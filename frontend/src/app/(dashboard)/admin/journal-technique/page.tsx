import Link from "next/link";

import { fcmAdmin } from "@/lib/firebase/firebaseAdmin";
import { chargerMoniteurTaches, chargerSanteConfiguration, type EtatTache } from "@/lib/moniteurTaches";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui";
import { libelleBilan, prisma, type NiveauJournal, type Prisma, type SourceJournal } from "backend";

import { LancerTacheBouton } from "./LancerTacheBouton";

export const metadata = { title: "Journal technique - Administration" };
// Les données changent à chaque exécution : jamais de page mise en cache.
export const dynamic = "force-dynamic";

const PAR_PAGE = 50;
const ONGLETS = [
  { id: "taches", label: "Moniteur des tâches" },
  { id: "incidents", label: "Incidents" },
  { id: "sante", label: "Santé de la configuration" },
] as const;
type OngletId = (typeof ONGLETS)[number]["id"];

const NIVEAUX: NiveauJournal[] = ["ERREUR", "AVERTISSEMENT"];
const SOURCES: SourceJournal[] = ["EMAIL", "PUSH", "TACHE", "IMPORT", "AUTRE"];

const formatDate = (d: Date) =>
  new Intl.DateTimeFormat("fr-FR", { dateStyle: "short", timeStyle: "medium", timeZone: "Africa/Abidjan" }).format(d);

function duree(debut: Date, fin: Date): string {
  const ms = fin.getTime() - debut.getTime();
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
}

const VARIANTE_STATUT = { SUCCES: "success", ECHEC: "danger", IGNOREE: "neutral" } as const;
const LIBELLE_STATUT = { SUCCES: "Réussie", ECHEC: "Échec", IGNOREE: "Ignorée" } as const;
const LIBELLE_DECLENCHEMENT = { PLANIFICATEUR: "Planificateur", MANUEL: "Manuel" } as const;

interface PageProps {
  searchParams: Promise<{ onglet?: string; niveau?: string; source?: string; du?: string; au?: string; page?: string }>;
}

export default async function JournalTechniquePage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const onglet: OngletId = ONGLETS.some((o) => o.id === sp.onglet) ? (sp.onglet as OngletId) : "taches";

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-8 sm:px-6">
      <PageHeader
        title="Journal technique"
        description="Ce qui échoue sans faire tomber l'application : tâches planifiées, envois d'e-mails et de notifications push, configuration."
      />
      <nav className="flex flex-wrap gap-2 border-b border-border" aria-label="Sections du journal technique">
        {ONGLETS.map((o) => (
          <Link
            key={o.id}
            href={`/admin/journal-technique?onglet=${o.id}`}
            aria-current={o.id === onglet ? "page" : undefined}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${
              o.id === onglet ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {o.label}
          </Link>
        ))}
      </nav>

      {onglet === "taches" ? <OngletTaches /> : null}
      {onglet === "incidents" ? <OngletIncidents sp={sp} /> : null}
      {onglet === "sante" ? <OngletSante /> : null}
    </div>
  );
}

async function OngletTaches() {
  const etats = await chargerMoniteurTaches();
  return (
    <div className="space-y-6">
      {etats.map((e) => (
        <CarteTache key={e.tache} etat={e} />
      ))}
    </div>
  );
}

function CarteTache({ etat }: { etat: EtatTache }) {
  const { derniere, derniereReussie } = etat;
  return (
    <div data-tache={etat.tache} className="space-y-4 rounded-2xl border border-border bg-surface p-5 shadow-elevated">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h2 className="flex flex-wrap items-center gap-2 text-lg font-bold text-foreground">
            {etat.libelle}
            {etat.enRetard ? <Badge variant="danger">En retard</Badge> : <Badge variant="success">À jour</Badge>}
          </h2>
          <p className="text-xs text-muted-foreground">{etat.tache}</p>
        </div>
        <LancerTacheBouton tache={etat.tache} />
      </div>

      <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-xs font-medium text-muted-foreground">Dernière exécution</dt>
          <dd className="mt-0.5 text-foreground">
            {derniere ? (
              <>
                {formatDate(derniere.debut)} · {LIBELLE_DECLENCHEMENT[derniere.declenchement]} · {duree(derniere.debut, derniere.fin)}
                <br />
                <Badge variant={VARIANTE_STATUT[derniere.statut]}>{LIBELLE_STATUT[derniere.statut]}</Badge>{" "}
                {derniere.statut === "SUCCES" ? libelleBilan(etat.tache, derniere.bilan) : (derniere.erreur ?? "")}
              </>
            ) : (
              "Jamais exécutée"
            )}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-medium text-muted-foreground">Dernière exécution réussie</dt>
          <dd className="mt-0.5 text-foreground">{derniereReussie ? formatDate(derniereReussie) : "—"}</dd>
        </div>
        <div>
          <dt className="text-xs font-medium text-muted-foreground">Prochaine exécution attendue</dt>
          <dd className="mt-0.5 text-foreground">{formatDate(etat.prochaine)}</dd>
        </div>
      </dl>

      <details className="rounded-md border border-border">
        <summary className="cursor-pointer px-3 py-2 text-sm font-medium text-foreground">
          Historique ({etat.historique.length} dernière{etat.historique.length > 1 ? "s" : ""} exécution{etat.historique.length > 1 ? "s" : ""})
        </summary>
        {etat.historique.length === 0 ? (
          <p className="px-3 pb-3 text-sm text-muted-foreground">Aucune exécution enregistrée.</p>
        ) : (
          <ul className="divide-y divide-border">
            {etat.historique.map((h) => (
              <li key={h.id} className="flex flex-col gap-1 px-3 py-2 text-sm sm:flex-row sm:items-center sm:justify-between">
                <span className="text-foreground">
                  {formatDate(h.debut)} · {LIBELLE_DECLENCHEMENT[h.declenchement]} · {duree(h.debut, h.fin)}
                </span>
                <span className="flex items-center gap-2">
                  <Badge variant={VARIANTE_STATUT[h.statut]}>{LIBELLE_STATUT[h.statut]}</Badge>
                  <span className="text-muted-foreground">{h.statut === "SUCCES" ? libelleBilan(etat.tache, h.bilan) : (h.erreur ?? "")}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </details>
    </div>
  );
}

async function OngletIncidents({ sp }: { sp: Awaited<PageProps["searchParams"]> }) {
  const niveau = NIVEAUX.find((n) => n === sp.niveau);
  const source = SOURCES.find((s) => s === sp.source);
  const page = Math.max(1, Number(sp.page) || 1);
  const du = /^\d{4}-\d{2}-\d{2}$/.test(sp.du ?? "") ? new Date(`${sp.du}T00:00:00`) : null;
  const au = /^\d{4}-\d{2}-\d{2}$/.test(sp.au ?? "") ? new Date(`${sp.au}T23:59:59.999`) : null;

  const where: Prisma.JournalTechniqueWhereInput = {
    ...(niveau ? { niveau } : {}),
    ...(source ? { source } : {}),
    ...(du || au ? { createdAt: { ...(du ? { gte: du } : {}), ...(au ? { lte: au } : {}) } } : {}),
  };
  const [total, lignes] = await Promise.all([
    prisma.journalTechnique.count({ where }),
    prisma.journalTechnique.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * PAR_PAGE, take: PAR_PAGE }),
  ]);
  const pages = Math.max(1, Math.ceil(total / PAR_PAGE));

  const lien = (p: number) => {
    const q = new URLSearchParams({ onglet: "incidents", page: String(p) });
    if (niveau) q.set("niveau", niveau);
    if (source) q.set("source", source);
    if (sp.du) q.set("du", sp.du);
    if (sp.au) q.set("au", sp.au);
    return `/admin/journal-technique?${q.toString()}`;
  };
  const champ = "rounded-md border border-border bg-surface px-2 py-1.5 text-sm";

  return (
    <div className="space-y-4">
      <form method="GET" className="flex flex-wrap items-end gap-3">
        <input type="hidden" name="onglet" value="incidents" />
        <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
          Niveau
          <select name="niveau" defaultValue={niveau ?? ""} className={champ}>
            <option value="">Tous</option>
            <option value="ERREUR">Erreur</option>
            <option value="AVERTISSEMENT">Avertissement</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
          Source
          <select name="source" defaultValue={source ?? ""} className={champ}>
            <option value="">Toutes</option>
            {SOURCES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
          Du
          <input type="date" name="du" defaultValue={sp.du ?? ""} className={champ} />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
          Au
          <input type="date" name="au" defaultValue={sp.au ?? ""} className={champ} />
        </label>
        <button type="submit" className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground">
          Filtrer
        </button>
      </form>

      <p className="text-sm text-muted-foreground">
        {total} incident{total > 1 ? "s" : ""} · page {page} sur {pages}
      </p>

      {lignes.length === 0 ? (
        <EmptyState icon="scroll-text" message="Aucun incident : rien à signaler sur cette sélection." />
      ) : (
        <ul className="space-y-2" data-liste="incidents">
          {lignes.map((l) => {
            const rep = (l.contexte as { repetitions?: number } | null)?.repetitions ?? 0;
            return (
              <li key={l.id} className="rounded-lg border border-border bg-surface p-3 shadow-xs">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <Badge variant={l.niveau === "ERREUR" ? "danger" : "warning"}>{l.niveau === "ERREUR" ? "Erreur" : "Avertissement"}</Badge>
                  <Badge variant="outline">{l.source}</Badge>
                  <span className="font-mono text-xs font-semibold text-foreground">{l.code}</span>
                  <span className="text-xs text-muted-foreground">{formatDate(l.createdAt)}</span>
                  {rep > 0 ? <Badge variant="neutral">+{rep} répétition{rep > 1 ? "s" : ""}</Badge> : null}
                </div>
                <p className="mt-1 break-words text-sm text-foreground">{l.message}</p>
                {l.contexte ? <p className="mt-1 break-all font-mono text-xs text-muted-foreground">{JSON.stringify(l.contexte)}</p> : null}
              </li>
            );
          })}
        </ul>
      )}

      {pages > 1 ? (
        <div className="flex justify-between text-sm">
          {page > 1 ? <Link href={lien(page - 1)} className="text-primary hover:underline">← Plus récents</Link> : <span />}
          {page < pages ? <Link href={lien(page + 1)} className="text-primary hover:underline">Plus anciens →</Link> : <span />}
        </div>
      ) : null}
    </div>
  );
}

async function OngletSante() {
  const s = await chargerSanteConfiguration(fcmAdmin !== null);
  const lignes: Array<{ nom: string; ok: boolean; aide: string }> = [
    { nom: "SMTP configuré", ok: s.smtp, aide: "Sans SMTP, aucun e-mail ne part (envois simulés)." },
    { nom: "Firebase serveur configuré", ok: s.firebaseServeur, aide: "FIREBASE_SERVICE_ACCOUNT_JSON : sans lui, aucun push ne part." },
    { nom: "Firebase navigateur configuré", ok: s.firebaseNavigateur, aide: "Clés NEXT_PUBLIC_FIREBASE_* figées dans l'image au build : sans elles, les appareils ne peuvent pas s'abonner." },
    { nom: "AUTH_URL définie", ok: s.authUrl, aide: "URL publique du portail : liens des e-mails et retour après connexion." },
    { nom: "Planificateur actif", ok: s.planificateur, aide: "PLANIFICATEUR_ACTIF=false l'arrête sur cette instance." },
  ];
  return (
    <div className="space-y-6">
      <div className="divide-y divide-border rounded-2xl border border-border bg-surface shadow-elevated">
        {lignes.map((l) => (
          <div key={l.nom} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3">
            <div>
              <p className="text-sm font-medium text-foreground">{l.nom}</p>
              <p className="text-xs text-muted-foreground">{l.aide}</p>
            </div>
            <Badge variant={l.ok ? "success" : "danger"}>{l.ok ? "Oui" : "Non"}</Badge>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Card className="p-5">
          <p className="text-xs font-medium text-muted-foreground">Notifications critiques sans e-mail envoyé (7 jours)</p>
          <p className="mt-1 text-3xl font-black tabular-nums text-foreground" data-valeur="critiques-sans-email">{s.critiquesSansEmail7j}</p>
        </Card>
        <Card className="p-5">
          <p className="text-xs font-medium text-muted-foreground">Notifications importantes ou critiques sans push envoyé (7 jours)</p>
          <p className="mt-1 text-3xl font-black tabular-nums text-foreground" data-valeur="sans-push">{s.pushSansEnvoi7j}</p>
          <p className="mt-1 text-xs text-muted-foreground">Inclut les destinataires sans appareil enregistré.</p>
        </Card>
      </div>
    </div>
  );
}
