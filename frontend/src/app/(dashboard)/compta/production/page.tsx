import { redirect } from "next/navigation";

import {
  formaterDateCpt,
  formaterDateHeureCpt,
  formaterMontantCpt,
  LIBELLE_STATUT_CONTRAT_CPT,
  libelleAnomalieProduction,
} from "@/components/compta/libellesProduction";
import { Button, Input, PageHeader, StatCard } from "@/components/ui";
import { getSession, hasPermission } from "@/lib/auth";
import { prisma, rechercherCpt } from "backend";

import { AnomaliesProduction } from "./AnomaliesProduction";
import { ImportProductionCptForm } from "./ImportProductionCptForm";

const LIGNES_CONTRATS = 50;
const LIGNES_IMPORTS = 20;
const LIGNES_ANOMALIES = 50;

/** Lit un champ texte ou numérique d'un JSON libre (bilan d'import, détail d'anomalie) sans jamais supposer sa forme. */
function champ(json: unknown, cle: string): string | number | null {
  if (typeof json !== "object" || json === null || Array.isArray(json)) return null;
  const v = (json as Record<string, unknown>)[cle];
  return typeof v === "string" || typeof v === "number" ? v : null;
}

/**
 * Production (lot GC-3f, docs/PLAN_GESTION_COMPTA.md) : dépôt du bordereau, historique des imports, contrats enregistrés et
 * anomalies à traiter. Lecture : `cpt.consulter` (layout, revérifiée ici). Import : `cpt.importer_production`, revérifiée par
 * `importerProductionCptAction` et par la route de dépôt — le formulaire masqué n'est qu'un confort.
 */
export default async function ProductionPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const session = await getSession();
  if (!session || !hasPermission(session, "cpt.consulter")) {
    redirect("/?error=acces_refuse_compta");
  }
  const peutImporter = hasPermission(session, "cpt.importer_production");
  // Même droit que `traiterAnomaliesCptAction` (qui le revérifie) : importer le bordereau OU saisir un contrat.
  const peutTraiterAnomalies = peutImporter || hasPermission(session, "cpt.saisir_contrat");

  const { q: saisie } = await searchParams;
  const q = (typeof saisie === "string" ? saisie : "").replace(/\s+/g, " ").trim().slice(0, 120);
  const trouves = q ? await rechercherCpt(prisma, q, { entite: "CONTRAT", limite: 500 }) : null;
  const filtreContrats = trouves ? { id: { in: trouves.map((t) => t.entiteId) } } : {};

  const [nbContrats, nbImports, nbAnomalies, contrats, imports, anomalies] = await Promise.all([
    prisma.cptContrat.count(),
    prisma.cptImport.count({ where: { type: "PRODUCTION" } }),
    prisma.cptAnomalie.count({ where: { statut: "A_TRAITER", import: { type: "PRODUCTION" } } }),
    prisma.cptContrat.findMany({
      where: filtreContrats,
      orderBy: [{ creeAt: "desc" }, { numPolice: "asc" }],
      take: LIGNES_CONTRATS,
      include: { client: { select: { nom: true } }, produit: { select: { code: true } }, partenaireApporteur: { select: { nom: true } } },
    }),
    prisma.cptImport.findMany({
      where: { type: "PRODUCTION" },
      orderBy: { creeAt: "desc" },
      take: LIGNES_IMPORTS,
      include: { creePar: { select: { fullName: true } }, fichier: { select: { nomOrigine: true } } },
    }),
    prisma.cptAnomalie.findMany({ where: { statut: "A_TRAITER", import: { type: "PRODUCTION" } }, orderBy: { creeAt: "desc" }, take: LIGNES_ANOMALIES }),
  ]);

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-6 sm:px-6 sm:py-10">
      <PageHeader
        title="Production"
        description="Bordereaux de production, contrats enregistrés et anomalies à traiter."
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard icon="file-text" label="Contrats enregistrés" value={nbContrats.toLocaleString("fr-FR")} tone="info" />
        <StatCard icon="wallet" label="Imports de production" value={nbImports.toLocaleString("fr-FR")} tone="info" />
        <StatCard
          icon="alert-triangle"
          label="Anomalies à traiter"
          value={nbAnomalies.toLocaleString("fr-FR")}
          tone={nbAnomalies > 0 ? "warning" : "success"}
        />
      </div>

      {peutImporter && <ImportProductionCptForm />}

      <section className="space-y-3" data-production-contrats>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 className="text-base font-bold text-foreground">
            Contrats {q ? `trouvés pour « ${q} »` : "récents"}
          </h2>
          <form method="get" className="flex items-end gap-2">
            <Input name="q" label="Rechercher un contrat" defaultValue={q} placeholder="Police, client, apporteur, produit, référence…" />
            <Button type="submit" variant="secondary">
              Rechercher
            </Button>
          </form>
        </div>
        {contrats.length === 0 ? (
          <p className="rounded-lg border border-border bg-muted/40 px-4 py-6 text-center text-sm text-muted-foreground" data-production-vide>
            {q ? "Aucun contrat ne correspond à cette recherche." : "Aucun contrat enregistré : importez un bordereau de production."}
          </p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-border bg-card shadow-elevated">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="border-b border-border bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-3 py-2">Police</th>
                  <th className="px-3 py-2">Client</th>
                  <th className="px-3 py-2">Produit</th>
                  <th className="px-3 py-2">Apporteur</th>
                  <th className="px-3 py-2">Période</th>
                  <th className="px-3 py-2 text-right">Prime TTC</th>
                  <th className="px-3 py-2">Statut</th>
                </tr>
              </thead>
              <tbody>
                {contrats.map((c) => (
                  <tr key={c.id} className="border-b border-border last:border-0" data-contrat-police={c.numPolice}>
                    <td className="whitespace-nowrap px-3 py-2 font-semibold text-foreground">{c.numPolice}</td>
                    <td className="px-3 py-2">{c.client.nom}</td>
                    <td className="px-3 py-2">{c.produit.code}</td>
                    <td className="px-3 py-2">{c.partenaireApporteur?.nom ?? "—"}</td>
                    <td className="whitespace-nowrap px-3 py-2">
                      {formaterDateCpt(c.dateEffet)} → {formaterDateCpt(c.dateEcheance)}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right font-semibold tabular-nums">{formaterMontantCpt(c.primeTtc)}</td>
                    <td className="px-3 py-2">{LIBELLE_STATUT_CONTRAT_CPT[c.statut] ?? c.statut}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {contrats.length === LIGNES_CONTRATS && (
          <p className="text-xs text-muted-foreground">
            Les {LIGNES_CONTRATS} premiers contrats sont affichés : précisez la recherche pour en retrouver un autre.
          </p>
        )}
      </section>

      <section className="space-y-3" data-production-anomalies>
        <h2 className="text-base font-bold text-foreground">Anomalies à traiter</h2>
        <AnomaliesProduction
          peutTraiter={peutTraiterAnomalies}
          rows={anomalies.map((a) => ({
            id: a.id,
            type: a.type,
            libelle: libelleAnomalieProduction(a.type),
            numPolice: String(champ(a.detail, "numPolice") ?? "—"),
            ligne: String(champ(a.detail, "numeroLigne") ?? "—"),
            message: String(champ(a.detail, "message") ?? "—"),
            date: formaterDateHeureCpt(a.creeAt),
          }))}
        />
      </section>

      <section className="space-y-3" data-production-imports>
        <h2 className="text-base font-bold text-foreground">Historique des imports</h2>
        {imports.length === 0 ? (
          <p className="rounded-lg border border-border bg-muted/40 px-4 py-6 text-center text-sm text-muted-foreground">Aucun import pour l&apos;instant.</p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-border bg-card shadow-elevated">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="border-b border-border bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-3 py-2">Date</th>
                  <th className="px-3 py-2">Fichier</th>
                  <th className="px-3 py-2">Par</th>
                  <th className="px-3 py-2 text-right">Lignes</th>
                  <th className="px-3 py-2 text-right">Contrats créés</th>
                  <th className="px-3 py-2 text-right">Rejetées</th>
                  <th className="px-3 py-2 text-right">Anomalies</th>
                </tr>
              </thead>
              <tbody>
                {imports.map((i) => (
                  <tr key={i.id} className="border-b border-border last:border-0">
                    <td className="whitespace-nowrap px-3 py-2">{formaterDateHeureCpt(i.creeAt)}</td>
                    <td className="px-3 py-2">{i.fichier.nomOrigine ?? "—"}</td>
                    <td className="px-3 py-2">{i.creePar.fullName}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{champ(i.bilan, "lignesLues") ?? "—"}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{champ(i.bilan, "contratsCrees") ?? "—"}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{champ(i.bilan, "lignesRejetees") ?? "—"}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{champ(i.bilan, "anomaliesCreees") ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
