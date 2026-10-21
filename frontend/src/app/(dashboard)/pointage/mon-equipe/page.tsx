import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { format } from "date-fns";

import { Badge, Card, EmptyState, PageHeader, StatCard } from "@/components/ui";
import type { BadgeVariant } from "@/components/ui";
import { VARIANTE_STATUT_JUSTIFICATION } from "@/components/pointage/justificationStatut";
import { getSession } from "@/lib/auth";
import { chargerEquipeResponsable } from "@/lib/equipe";
import { compteurMenuJustificationsSession } from "@/lib/justificationsPointage";
import { chargerPresenceJour } from "@/lib/presenceJour";
import { etatJourMembre, getReportingAgrégé, getSyntheseEquipe, periodeEquipe, type CodeEtatJour } from "backend";

export const metadata = { title: "Mon équipe - Pointage" };
export const dynamic = "force-dynamic";

const VARIANTE_ETAT: Record<CodeEtatJour, BadgeVariant> = {
  A_L_HEURE: "success",
  EN_RETARD: "warning",
  PARTI_EN_AVANCE: "warning",
  ABSENCE_AUTORISEE: "info",
  ABSENT: "danger",
  PAS_ENCORE_POINTE: "neutral",
  NON_OUVRE: "neutral",
};

const heure = (iso?: string) => (iso ? format(new Date(iso), "HH:mm") : "—");

export default async function MonEquipePage({ searchParams }: { searchParams: Promise<{ du?: string; au?: string }> }) {
  const session = await getSession();
  if (!session) redirect("/login");

  // Accès : responsable ACTUEL d'au moins un service — revérifié ici, jamais seulement par le menu.
  const equipe = await chargerEquipeResponsable(session.user.id);
  if (equipe.services.length === 0) notFound();

  const sp = await searchParams;
  const periode = periodeEquipe(sp.du, sp.au, new Date());
  const ids = equipe.membres.map((m) => m.id);
  const filtres = { dateDebut: periode.du, dateFin: periode.au, userIds: ids };

  // Mêmes lectures que la page « Présence » de la RH et que le reporting RH, restreintes à l'équipe (aucun second calcul).
  const [jour, aggregats, synthese, aDecider] = await Promise.all([
    chargerPresenceJour(new Date(), ids),
    ids.length > 0 ? getReportingAgrégé(filtres) : Promise.resolve([]),
    ids.length > 0 ? getSyntheseEquipe(filtres) : Promise.resolve(new Map()),
    compteurMenuJustificationsSession(session),
  ]);

  const presentParId = new Map(jour.presents.map((p) => [p.userId, p]));
  const absentsIds = new Set(jour.absents.map((a) => a.userId));
  const autorisesIds = new Set(jour.autorises.map((a) => a.userId));
  const aggParId = new Map(aggregats.map((a) => [a.id, a]));

  const lignesJour = equipe.membres.map((m) => {
    const p = presentParId.get(m.id);
    const etat = etatJourMembre({
      aArrive: !!p?.arrivee,
      estRetard: !!p?.estRetard,
      minutesRetard: p?.minutesRetard ?? null,
      departAnticipe: !!p?.departAnticipe,
      absenceAutorisee: autorisesIds.has(m.id),
      absent: absentsIds.has(m.id),
      jourNonOuvre: jour.isJourNonOuvre,
    });
    return { membre: m, p, etat };
  });
  const compte = (code: CodeEtatJour) => lignesJour.filter((l) => l.etat.code === code).length;

  const champ = "rounded-md border border-border bg-surface px-2 py-1.5 text-sm";

  return (
    <div className="mx-auto max-w-6xl space-y-8 px-4 py-6 sm:px-6 sm:py-8">
      <PageHeader
        title="Mon équipe"
        description={`Pointage des membres de ${equipe.services.map((s) => s.name).join(", ")}.`}
      />

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard icon="users" tone="info" label="Membres" value={equipe.membres.length} />
        <StatCard icon="clock" tone="info" label="En retard aujourd'hui" value={compte("EN_RETARD")} />
        <StatCard icon="x-circle" tone="info" label="Absents aujourd'hui" value={compte("ABSENT")} />
        <StatCard
          icon="check-circle"
          tone="info"
          label="Justifications à décider"
          value={aDecider ?? 0}
          href="/pointage/justifications"
        />
      </div>

      {equipe.membres.length === 0 ? (
        <EmptyState icon="users" message="Aucun membre à suivre dans vos services." />
      ) : (
        <>
          <section className="space-y-3" data-section="aujourdhui">
            <h2 className="text-lg font-semibold text-foreground">Aujourd&apos;hui</h2>
            <Card className="overflow-x-auto p-0">
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead className="border-b border-border text-xs text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-medium">Membre</th>
                    <th className="px-3 py-2 font-medium">État</th>
                    <th className="px-3 py-2 font-medium">Arrivée</th>
                    <th className="px-3 py-2 font-medium">Départ</th>
                    <th className="px-3 py-2 font-medium">Justification</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {lignesJour.map(({ membre, p, etat }) => {
                    const j = p?.justificationDepart ?? p?.justification;
                    return (
                      <tr key={membre.id} data-membre={membre.id}>
                        <td className="px-3 py-2 font-medium text-foreground">{membre.fullName}</td>
                        <td className="px-3 py-2">
                          <Badge variant={VARIANTE_ETAT[etat.code]}>{etat.libelle}</Badge>
                          {etat.code === "PARTI_EN_AVANCE" && p?.estRetard ? (
                            <Badge variant="warning" className="ml-1">
                              En retard · {p.minutesRetard} min
                            </Badge>
                          ) : null}
                        </td>
                        <td className="px-3 py-2 tabular-nums">{heure(p?.arrivee)}</td>
                        <td className="px-3 py-2 tabular-nums">{heure(p?.depart)}</td>
                        <td className="px-3 py-2">
                          {j?.statut ? <Badge variant={VARIANTE_STATUT_JUSTIFICATION[j.statut]}>{j.libelle}</Badge> : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </Card>
          </section>

          <section className="space-y-3" data-section="periode">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <h2 className="text-lg font-semibold text-foreground">Sur la période</h2>
              <form method="GET" className="flex flex-wrap items-end gap-3">
                <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
                  Du
                  <input type="date" name="du" defaultValue={periode.du} className={champ} />
                </label>
                <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
                  Au
                  <input type="date" name="au" defaultValue={periode.au} className={champ} />
                </label>
                <button type="submit" className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground">
                  Filtrer
                </button>
              </form>
            </div>
            <Card className="overflow-x-auto p-0">
              <table className="w-full min-w-[720px] text-left text-sm">
                <thead className="border-b border-border text-xs text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-medium">Membre</th>
                    <th className="px-3 py-2 text-right font-medium">Retards</th>
                    <th className="px-3 py-2 text-right font-medium">Minutes</th>
                    <th className="px-3 py-2 text-right font-medium">Départs anticipés</th>
                    <th className="px-3 py-2 text-right font-medium">Absences</th>
                    <th className="px-3 py-2 text-right font-medium">Rejetées / non justifiées</th>
                    <th className="px-3 py-2 font-medium" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {equipe.membres.map((m) => {
                    const a = aggParId.get(m.id);
                    const s = synthese.get(m.id);
                    return (
                      <tr key={m.id} data-membre-periode={m.id}>
                        <td className="px-3 py-2 font-medium text-foreground">{m.fullName}</td>
                        <td className="px-3 py-2 text-right tabular-nums" data-col="retards">{a?.joursRetard ?? 0}</td>
                        <td className="px-3 py-2 text-right tabular-nums" data-col="minutes">{a?.minutesRetard ?? 0}</td>
                        <td className="px-3 py-2 text-right tabular-nums" data-col="departs">{s?.departsAnticipes ?? 0}</td>
                        <td className="px-3 py-2 text-right tabular-nums" data-col="absences">{a?.absences ?? 0}</td>
                        <td className="px-3 py-2 text-right tabular-nums" data-col="refusees">{s?.justificationsRefuseesOuNonJustifiees ?? 0}</td>
                        <td className="px-3 py-2 text-right">
                          <Link
                            href={`/pointage/mon-equipe/${m.id}?du=${periode.du}&au=${periode.au}`}
                            className="text-primary hover:underline"
                          >
                            Historique
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </Card>
          </section>
        </>
      )}
    </div>
  );
}
