import Link from "next/link";
import { redirect } from "next/navigation";

import {
  formaterMoisCpt,
  LIBELLE_STATUT_ENCAISSEMENT_CPT,
  LIBELLE_TYPE_COMPTE_CPT,
  LIBELLE_TYPE_FLUX_CPT,
  libelleAnomalieReleve,
} from "@/components/compta/libellesEncaissements";
import { formaterDateCpt, formaterDateHeureCpt, formaterMontantCpt } from "@/components/compta/libellesProduction";
import { Badge, Button, PageHeader, Select, StatCard } from "@/components/ui";
import { getSession, hasPermission } from "@/lib/auth";
import { chargerControleMensuelReleves, prisma, texteDepuisCentimes, TYPE_RELEVE_PAR_TYPE_COMPTE, type TypeFluxCpt } from "backend";

import { AnomaliesReleves } from "./AnomaliesReleves";
import { ImportReleveCptForm } from "./ImportReleveCptForm";

const LIGNES_PAR_PAGE = 50;
const LIGNES_RELEVES = 20;
const LIGNES_ANOMALIES = 50;
const STATUTS = Object.keys(LIBELLE_STATUT_ENCAISSEMENT_CPT);
const FLUX = Object.keys(LIBELLE_TYPE_FLUX_CPT);

type Recherche = { compte?: string; statut?: string; flux?: string; page?: string };

/** Lit un champ texte ou numérique d'un JSON libre (bilan d'import, détail d'anomalie) sans jamais supposer sa forme. */
function champ(json: unknown, cle: string): string | number | null {
  if (typeof json !== "object" || json === null || Array.isArray(json)) return null;
  const v = (json as Record<string, unknown>)[cle];
  return typeof v === "string" || typeof v === "number" ? v : null;
}

/**
 * Encaissements (lot GC-4e, docs/PLAN_GESTION_COMPTA.md) : import des relevés, contrôle mensuel par compte, encaissements, historique
 * des relevés et anomalies à traiter. Lecture : `cpt.consulter` (layout, revérifiée ici). Import : `cpt.importer_releves`, revérifiée
 * par `importerReleveCptAction` et par la route de dépôt — le formulaire masqué n'est qu'un confort.
 */
export default async function EncaissementsPage({ searchParams }: { searchParams: Promise<Recherche> }) {
  const session = await getSession();
  if (!session || !hasPermission(session, "cpt.consulter")) {
    redirect("/?error=acces_refuse_compta");
  }
  const peutImporter = hasPermission(session, "cpt.importer_releves");
  // Même droit que `traiterAnomaliesReleveCptAction` (qui le revérifie).
  const peutTraiterAnomalies = peutImporter || hasPermission(session, "cpt.identifier_encaissement");

  const recherche = await searchParams;
  const comptes = await prisma.cptCompte.findMany({ orderBy: { libelle: "asc" }, select: { id: true, libelle: true, type: true, actif: true } });
  const compteFiltre = comptes.some((c) => c.id === recherche.compte) ? (recherche.compte as string) : "";
  const statutFiltre = STATUTS.includes(recherche.statut ?? "") ? (recherche.statut as string) : "";
  const fluxFiltre = FLUX.includes(recherche.flux ?? "") ? (recherche.flux as string) : "";
  const pageDemandee = Math.max(1, Math.floor(Number(recherche.page)) || 1);

  const where = {
    ...(compteFiltre ? { compteId: compteFiltre } : {}),
    ...(statutFiltre ? { statut: statutFiltre as "A_RATTACHER" | "SOLDE" | "SANS_OBJET" } : {}),
    ...(fluxFiltre ? { typeFlux: fluxFiltre as TypeFluxCpt } : {}),
  };
  const filtreAnomalies = { statut: "A_TRAITER" as const, import: { type: { not: "PRODUCTION" as const } } };

  const [aRattacher, nbReleves, controle, total, encaissements, releves, nbAnomalies, anomalies] = await Promise.all([
    prisma.cptEncaissement.aggregate({ where: { statut: "A_RATTACHER" }, _count: true, _sum: { resteARattacher: true } }),
    prisma.cptReleve.count(),
    chargerControleMensuelReleves(prisma),
    prisma.cptEncaissement.count({ where }),
    prisma.cptEncaissement.findMany({
      where,
      orderBy: [{ dateValeur: "desc" }, { reference: "desc" }],
      skip: (pageDemandee - 1) * LIGNES_PAR_PAGE,
      take: LIGNES_PAR_PAGE,
      include: { compte: { select: { libelle: true } } },
    }),
    prisma.cptReleve.findMany({
      orderBy: { creeAt: "desc" },
      take: LIGNES_RELEVES,
      include: { compte: { select: { libelle: true } }, import: { select: { creeAt: true, bilan: true, creePar: { select: { fullName: true } }, fichier: { select: { nomOrigine: true } } } } },
    }),
    prisma.cptAnomalie.count({ where: filtreAnomalies }),
    prisma.cptAnomalie.findMany({ where: filtreAnomalies, orderBy: { creeAt: "desc" }, take: LIGNES_ANOMALIES }),
  ]);

  const libelleCompte = new Map(comptes.map((c) => [c.id, c.libelle]));
  const nbEcarts = controle.filter((l) => !l.coherent).length;
  const comptesImportables = comptes
    .filter((c) => c.actif && TYPE_RELEVE_PAR_TYPE_COMPTE[c.type])
    .map((c) => ({ id: c.id, libelle: c.libelle, typeLibelle: LIBELLE_TYPE_COMPTE_CPT[c.type] ?? c.type }));
  const montant = (centimes: bigint) => formaterMontantCpt(texteDepuisCentimes(centimes));

  const nbPages = Math.max(1, Math.ceil(total / LIGNES_PAR_PAGE));
  const lien = (page: number) => {
    const p = new URLSearchParams();
    if (compteFiltre) p.set("compte", compteFiltre);
    if (statutFiltre) p.set("statut", statutFiltre);
    if (fluxFiltre) p.set("flux", fluxFiltre);
    if (page > 1) p.set("page", String(page));
    const q = p.toString();
    return `/compta/encaissements${q ? `?${q}` : ""}`;
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-6 sm:px-6 sm:py-10">
      <PageHeader title="Encaissements" description="Relevés des comptes d'encaissement, contrôle mensuel et lignes à rattacher." />

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          icon="wallet"
          label="Encaissements à rattacher"
          value={aRattacher._count.toLocaleString("fr-FR")}
          tone={aRattacher._count > 0 ? "warning" : "success"}
        />
        <StatCard icon="file-text" label="Relevés importés" value={nbReleves.toLocaleString("fr-FR")} tone="info" />
        <StatCard icon="alert-triangle" label="Écarts de contrôle mensuel" value={nbEcarts.toLocaleString("fr-FR")} tone={nbEcarts > 0 ? "danger" : "success"} />
      </div>

      {peutImporter && <ImportReleveCptForm comptes={comptesImportables} />}

      <section className="space-y-3" data-controle-mensuel>
        <h2 className="text-base font-bold text-foreground">Contrôle mensuel par compte</h2>
        <p className="text-sm text-muted-foreground">
          Pour chaque compte et chaque mois : crédits du relevé = primes rattachées + primes à rattacher + autres crédits + virements internes reçus. Un écart se traite,
          il ne se masque pas.
        </p>
        {controle.length === 0 ? (
          <p className="rounded-lg border border-border bg-muted/40 px-4 py-6 text-center text-sm text-muted-foreground" data-controle-vide>
            Aucun relevé importé : le contrôle apparaît dès le premier import.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-border bg-card shadow-elevated">
            <table className="w-full min-w-[860px] text-left text-sm">
              <thead className="border-b border-border bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-3 py-2">Mois</th>
                  <th className="px-3 py-2">Compte</th>
                  <th className="px-3 py-2 text-right">Crédits du relevé</th>
                  <th className="px-3 py-2 text-right">Primes rattachées</th>
                  <th className="px-3 py-2 text-right">À rattacher</th>
                  <th className="px-3 py-2 text-right">Autres crédits</th>
                  <th className="px-3 py-2 text-right">Virements reçus</th>
                  <th className="px-3 py-2 text-right">Écart</th>
                </tr>
              </thead>
              <tbody>
                {controle.map((l) => (
                  <tr key={`${l.compteId}|${l.periode}`} className="border-b border-border last:border-0" data-controle-ligne data-controle-coherent={l.coherent ? "oui" : "non"}>
                    <td className="whitespace-nowrap px-3 py-2 font-semibold capitalize text-foreground">{formaterMoisCpt(l.periode)}</td>
                    <td className="px-3 py-2">{libelleCompte.get(l.compteId) ?? "—"}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{montant(l.creditsReleve)}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{montant(l.primesRattachees)}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{montant(l.primesARattacher)}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{montant(l.autresCredits)}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{montant(l.virementsInternesRecus)}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                      {l.coherent ? <Badge variant="success">Concorde</Badge> : <Badge variant="danger">{montant(l.ecart)}</Badge>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="space-y-3" data-encaissements-liste>
        <h2 className="text-base font-bold text-foreground">Encaissements</h2>
        <form method="get" className="flex flex-wrap items-end gap-3">
          <div className="w-56">
            <Select
              label="Compte"
              name="compte"
              defaultValue={compteFiltre}
              placeholder="Tous les comptes"
              options={comptes.map((c) => ({ value: c.id, label: c.libelle }))}
            />
          </div>
          <div className="w-48">
            <Select
              label="Statut"
              name="statut"
              defaultValue={statutFiltre}
              placeholder="Tous les statuts"
              options={STATUTS.map((s) => ({ value: s, label: LIBELLE_STATUT_ENCAISSEMENT_CPT[s] }))}
            />
          </div>
          <div className="w-56">
            <Select label="Nature" name="flux" defaultValue={fluxFiltre} placeholder="Toutes les natures" options={FLUX.map((f) => ({ value: f, label: LIBELLE_TYPE_FLUX_CPT[f] }))} />
          </div>
          <Button type="submit" variant="secondary">
            Filtrer
          </Button>
        </form>

        {encaissements.length === 0 ? (
          <p className="rounded-lg border border-border bg-muted/40 px-4 py-6 text-center text-sm text-muted-foreground" data-encaissements-vide>
            Aucun encaissement ne correspond.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-border bg-card shadow-elevated">
            <table className="w-full min-w-[900px] text-left text-sm">
              <thead className="border-b border-border bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-3 py-2">Référence</th>
                  <th className="px-3 py-2">Date</th>
                  <th className="px-3 py-2">Compte</th>
                  <th className="px-3 py-2">Payeur</th>
                  <th className="px-3 py-2">Ligne du relevé</th>
                  <th className="px-3 py-2 text-right">Montant</th>
                  <th className="px-3 py-2">Nature</th>
                  <th className="px-3 py-2">Statut</th>
                  <th className="px-3 py-2 text-right">Reste à rattacher</th>
                </tr>
              </thead>
              <tbody>
                {encaissements.map((e) => (
                  <tr key={e.id} className="border-b border-border last:border-0" data-encaissement-reference={e.reference} data-encaissement-flux={e.typeFlux}>
                    <td className="whitespace-nowrap px-3 py-2 font-semibold text-foreground">{e.reference}</td>
                    <td className="whitespace-nowrap px-3 py-2">{formaterDateCpt(e.dateValeur)}</td>
                    <td className="px-3 py-2">{e.compte.libelle}</td>
                    <td className="px-3 py-2">
                      {e.payeur ?? "—"}
                      {e.telephone && <span className="block text-xs text-muted-foreground">{e.telephone}</span>}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2">{e.referenceReleve}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right font-semibold tabular-nums">{formaterMontantCpt(e.montant)}</td>
                    <td className="px-3 py-2">{LIBELLE_TYPE_FLUX_CPT[e.typeFlux] ?? e.typeFlux}</td>
                    <td className="px-3 py-2">
                      <Badge variant={e.statut === "A_RATTACHER" ? "warning" : e.statut === "SOLDE" ? "success" : "neutral"}>{LIBELLE_STATUT_ENCAISSEMENT_CPT[e.statut] ?? e.statut}</Badge>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{e.statut === "SANS_OBJET" ? "—" : formaterMontantCpt(e.resteARattacher)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="flex items-center justify-between gap-3 text-sm text-muted-foreground">
          <span data-encaissements-total>
            {total.toLocaleString("fr-FR")} encaissement(s) · page {Math.min(pageDemandee, nbPages)} sur {nbPages}
          </span>
          <span className="flex gap-3">
            {pageDemandee > 1 && (
              <Link href={lien(pageDemandee - 1)} className="font-semibold text-primary hover:underline">
                ← Précédente
              </Link>
            )}
            {pageDemandee < nbPages && (
              <Link href={lien(pageDemandee + 1)} className="font-semibold text-primary hover:underline">
                Suivante →
              </Link>
            )}
          </span>
        </div>
      </section>

      <section className="space-y-3" data-releves-anomalies>
        <h2 className="text-base font-bold text-foreground">
          Anomalies à traiter {nbAnomalies > 0 && <span className="text-sm font-normal text-muted-foreground">({nbAnomalies.toLocaleString("fr-FR")})</span>}
        </h2>
        <AnomaliesReleves
          peutTraiter={peutTraiterAnomalies}
          rows={anomalies.map((a) => ({
            id: a.id,
            type: a.type,
            libelle: libelleAnomalieReleve(a.type),
            reference: String(champ(a.detail, "reference") ?? "—"),
            ligne: String(champ(a.detail, "numeroLigne") ?? "—"),
            message: String(champ(a.detail, "message") ?? "—"),
            date: formaterDateHeureCpt(a.creeAt),
          }))}
        />
      </section>

      <section className="space-y-3" data-releves-historique>
        <h2 className="text-base font-bold text-foreground">Historique des relevés</h2>
        {releves.length === 0 ? (
          <p className="rounded-lg border border-border bg-muted/40 px-4 py-6 text-center text-sm text-muted-foreground">Aucun relevé importé pour l&apos;instant.</p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-border bg-card shadow-elevated">
            <table className="w-full min-w-[820px] text-left text-sm">
              <thead className="border-b border-border bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-3 py-2">Importé le</th>
                  <th className="px-3 py-2">Compte</th>
                  <th className="px-3 py-2">Mois</th>
                  <th className="px-3 py-2">Fichier</th>
                  <th className="px-3 py-2">Par</th>
                  <th className="px-3 py-2 text-right">Lignes créées</th>
                  <th className="px-3 py-2 text-right">Crédits</th>
                  <th className="px-3 py-2 text-right">Rejetées</th>
                </tr>
              </thead>
              <tbody>
                {releves.map((r) => (
                  <tr key={r.id} className="border-b border-border last:border-0">
                    <td className="whitespace-nowrap px-3 py-2">{formaterDateHeureCpt(r.import.creeAt)}</td>
                    <td className="px-3 py-2">{r.compte.libelle}</td>
                    <td className="whitespace-nowrap px-3 py-2 capitalize">{formaterMoisCpt(r.periode)}</td>
                    <td className="px-3 py-2">{r.import.fichier.nomOrigine ?? "—"}</td>
                    <td className="px-3 py-2">{r.import.creePar.fullName}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{r.nbLignes.toLocaleString("fr-FR")}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{formaterMontantCpt(r.totalCredits)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{champ(r.import.bilan, "lignesRejetees") ?? "—"}</td>
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
