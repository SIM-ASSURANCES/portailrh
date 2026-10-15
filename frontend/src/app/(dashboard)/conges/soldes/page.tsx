import { redirect } from "next/navigation";

import { Card, EmptyState, PageHeader } from "@/components/ui";
import { getSession, hasPermission } from "@/lib/auth";
import { aujourdhui, frDateColonne } from "@/lib/conges/format";
import { colonneDateDepuisJourCivil, prisma } from "backend";

import { DemandeCongeForm } from "../DemandeCongeForm";
import { AjustementSoldeForm, DateEmbaucheForm, InitialiserSoldesBouton } from "./SoldesActions";

/**
 * Soldes de congé (RH) : soldes de l'exercice en cours, dates d'embauche manquantes, ajustements tracés, congé d'office.
 * Consultation : `conges.gerer_soldes`, `conges.consulter_tous` ou l'étape RH ; les écritures revérifient leur permission.
 */
export default async function SoldesCongesPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const session = await getSession();
  if (!session) redirect("/login");
  const peutGerer = hasPermission(session, "conges.gerer_soldes");
  const estRH = session.rolePermissions.includes("conges.valider_rh");
  if (!peutGerer && !estRH && !hasPermission(session, "conges.consulter_tous")) redirect("/?error=acces_refuse_conges");

  const { q } = await searchParams;
  const recherche = (q ?? "").trim().slice(0, 80);
  const aujourdhuiDate = colonneDateDepuisJourCivil(aujourdhui());

  const [soldes, sansDate, types, collaborateurs] = await Promise.all([
    prisma.soldeConge.findMany({
      where: {
        dateDebutExercice: { lte: aujourdhuiDate },
        dateFinExercice: { gte: aujourdhuiDate },
        user: { isActive: true, ...(recherche ? { OR: [{ fullName: { contains: recherche, mode: "insensitive" } }, { email: { contains: recherche, mode: "insensitive" } }] } : {}) },
      },
      include: { user: { select: { fullName: true, service: { select: { name: true } } } }, typeConge: { select: { label: true } } },
      orderBy: [{ user: { fullName: "asc" } }, { typeConge: { label: "asc" } }],
      take: 100,
    }),
    peutGerer ? prisma.user.findMany({ where: { isActive: true, dateEmbauche: null }, select: { id: true, fullName: true }, orderBy: { fullName: "asc" }, take: 100 }) : Promise.resolve([]),
    estRH ? prisma.typeConge.findMany({ where: { isActive: true }, orderBy: [{ categorie: "asc" }, { label: "asc" }] }) : Promise.resolve([]),
    estRH ? prisma.user.findMany({ where: { isActive: true }, select: { id: true, fullName: true, service: { select: { name: true } } }, orderBy: { fullName: "asc" } }) : Promise.resolve([]),
  ]);

  return (
    <div className="space-y-8">
      <PageHeader
        title="Soldes de congé"
        description="Soldes de l'exercice en cours de chaque collaborateur. L'exercice court d'un anniversaire d'embauche au suivant."
        actions={peutGerer ? <InitialiserSoldesBouton /> : undefined}
      />

      {peutGerer && sansDate.length > 0 ? (
        <section aria-label="Dates d'embauche manquantes" className="space-y-3">
          <h2 className="text-base font-bold text-foreground">Dates d&apos;embauche à renseigner ({sansDate.length})</h2>
          <p className="text-sm text-muted-foreground">Sans date d&apos;embauche, un collaborateur ne peut pas poser de congé déduit du solde.</p>
          <ul className="grid gap-3 sm:grid-cols-2">
            {sansDate.map((u) => (
              <li key={u.id}>
                <Card className="space-y-2 p-4">
                  <p className="font-semibold text-foreground">{u.fullName}</p>
                  <DateEmbaucheForm userId={u.id} valeur="" />
                </Card>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section aria-label="Soldes" className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 className="text-base font-bold text-foreground">Soldes de l&apos;exercice en cours</h2>
          <form method="get" className="flex gap-2">
            <input
              name="q"
              defaultValue={recherche}
              placeholder="Rechercher un collaborateur"
              aria-label="Rechercher un collaborateur"
              className="rounded-lg border border-border bg-surface px-3 py-2 text-sm"
            />
            <button type="submit" className="rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground">
              Rechercher
            </button>
          </form>
        </div>
        {soldes.length === 0 ? (
          <EmptyState icon="calendar" message={recherche ? "Aucun solde ne correspond à cette recherche." : "Aucun solde ouvert pour l'exercice en cours : utilisez « Initialiser les soldes »."} />
        ) : (
          <ul className="space-y-3">
            {soldes.map((s) => (
              <li key={s.id}>
                <Card className="space-y-2 p-4 sm:p-5">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-bold text-foreground">{s.user.fullName}</p>
                      <p className="text-xs text-muted-foreground">
                        {s.user.service?.name ?? "Aucun service"} · {s.typeConge.label}
                      </p>
                    </div>
                    <p className="text-2xl font-black tabular-nums text-foreground">
                      {s.soldeRestant}
                      <span className="text-sm font-bold text-muted-foreground"> / {s.soldeInitial} j</span>
                    </p>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Exercice du {frDateColonne(s.dateDebutExercice)} au {frDateColonne(s.dateFinExercice)}
                  </p>
                  {peutGerer ? <AjustementSoldeForm soldeCongeId={s.id} /> : null}
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>

      {estRH ? (
        <section aria-label="Congé d'office" className="space-y-3">
          <details className="rounded-2xl border border-border bg-surface p-5 shadow-elevated">
            <summary className="cursor-pointer text-base font-bold text-foreground">Accorder un congé d&apos;office</summary>
            <p className="mb-4 mt-2 text-sm text-muted-foreground">
              Congé décidé par la RH sans demande préalable (congé collectif, régularisation). Le solde est débité et le collaborateur est prévenu.
            </p>
            <DemandeCongeForm
              mode="office"
              aujourdhui={aujourdhui()}
              collaborateurs={collaborateurs.map((c) => ({ id: c.id, label: c.service ? `${c.fullName} — ${c.service.name}` : c.fullName }))}
              types={types.map((t) => ({
                id: t.id,
                label: t.label,
                categorie: t.categorie,
                nbJoursDefaut: t.nbJoursDefaut,
                decompteType: t.decompteType,
                justificatifObligatoire: t.justificatifObligatoire,
                nonDeductibleSolde: t.nonDeductibleSolde,
                ancienneteMinimumMois: t.ancienneteMinimumMois,
              }))}
            />
          </details>
        </section>
      ) : null}
    </div>
  );
}
