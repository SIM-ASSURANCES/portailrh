import { redirect } from "next/navigation";

import { formaterDateCpt, formaterMontantCpt } from "@/components/compta/libellesProduction";
import { PageHeader, StatCard } from "@/components/ui";
import { getSession, hasPermission } from "@/lib/auth";
import { LIBELLE_METHODE_RATTACHEMENT_CPT, LIBELLE_NIVEAU_PREUVE_CPT, prisma, type Prisma } from "backend";

import { EncaissementsSansProposition } from "./EncaissementsSansProposition";
import { LancerRapprochementBouton } from "./LancerRapprochementBouton";
import { TableRattachements, type LigneRattachementCpt } from "./TableRattachements";

const LIGNES_MAX = 100;
const SANS_PROPOSITION_MAX = 50;

const A_CONFIRMER: Prisma.CptRattachementWhereInput = { statut: "PROPOSE", niveauPreuve: { not: "PREUVE" } };
const A_VALIDER: Prisma.CptRattachementWhereInput = { OR: [{ statut: "CONFIRME" }, { statut: "PROPOSE", niveauPreuve: "PREUVE" }] };
const SANS_PROPOSITION: Prisma.CptEncaissementWhereInput = {
  typeFlux: "ENCAISSEMENT",
  statut: "A_RATTACHER",
  resteARattacher: { gt: 0 },
  rattachements: { none: { statut: { in: ["PROPOSE", "CONFIRME"] } } },
};

/**
 * Rattachements (lot GC-5d, docs/PLAN_GESTION_COMPTA.md) : le moteur propose, le commercial confirme avec le reçu (étape 1), le RFCRH
 * valide ou rejette (étape 2). Seul un rattachement VALIDÉ rend la prime payée. Lecture : `cpt.consulter` (layout, revérifiée ici) ;
 * chaque action est reverifiée côté serveur par sa propre permission, les boutons masqués ne sont qu'un confort.
 */
export default async function RattachementsPage() {
  const session = await getSession();
  if (!session || !hasPermission(session, "cpt.consulter")) redirect("/?error=acces_refuse_compta");

  const peutConfirmer = hasPermission(session, "cpt.confirmer_rattachement");
  const peutValider = hasPermission(session, "cpt.valider_rattachement");
  const peutIdentifier = hasPermission(session, "cpt.identifier_encaissement") && peutConfirmer;
  const peutClasser = hasPermission(session, "cpt.classer_pas_une_prime");
  const peutLancer = hasPermission(session, "cpt.identifier_encaissement") || peutValider || hasPermission(session, "cpt.importer_releves");

  const inclusion = {
    encaissement: { select: { reference: true, dateValeur: true, payeur: true } },
    echeance: { select: { rang: true, contrat: { select: { numPolice: true, client: { select: { nom: true } } } } } },
    confirmePar: { select: { fullName: true } },
  } as const;

  const [nbSansProposition, nbAConfirmer, nbAValider, aConfirmer, aValider, sansProposition] = await Promise.all([
    prisma.cptEncaissement.count({ where: SANS_PROPOSITION }),
    prisma.cptRattachement.count({ where: A_CONFIRMER }),
    prisma.cptRattachement.count({ where: A_VALIDER }),
    prisma.cptRattachement.findMany({ where: A_CONFIRMER, orderBy: [{ creeAt: "asc" }, { id: "asc" }], take: LIGNES_MAX, include: inclusion }),
    prisma.cptRattachement.findMany({ where: A_VALIDER, orderBy: [{ creeAt: "asc" }, { id: "asc" }], take: LIGNES_MAX, include: inclusion }),
    prisma.cptEncaissement.findMany({
      where: SANS_PROPOSITION,
      orderBy: [{ dateValeur: "asc" }, { reference: "asc" }],
      take: SANS_PROPOSITION_MAX,
      select: { id: true, reference: true, dateValeur: true, payeur: true, telephone: true, montant: true, resteARattacher: true },
    }),
  ]);

  const enLigne = (r: (typeof aConfirmer)[number]): LigneRattachementCpt => ({
    id: r.id,
    groupe: r.groupe,
    encaissement: r.encaissement.reference,
    dateValeur: formaterDateCpt(r.encaissement.dateValeur),
    payeur: r.encaissement.payeur ?? "—",
    police: r.echeance.contrat.numPolice,
    client: r.echeance.contrat.client.nom,
    rang: r.echeance.rang,
    montant: formaterMontantCpt(r.montant),
    methode: LIBELLE_METHODE_RATTACHEMENT_CPT[r.methode],
    niveau: LIBELLE_NIVEAU_PREUVE_CPT[r.niveauPreuve],
    justification: r.justification,
    recu: r.recuReference ?? (r.recuPieceId ? "pièce jointe" : null),
    confirmePar: r.confirmePar?.fullName ?? null,
  });

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-6 sm:px-6 sm:py-10">
      <PageHeader
        title="Rattachements"
        description="Le moteur propose, le commercial confirme avec le reçu, le RFCRH valide : seule une validation rend une prime payée."
        actions={peutLancer ? <LancerRapprochementBouton /> : undefined}
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard icon="wallet" label="Encaissements sans proposition" value={nbSansProposition.toLocaleString("fr-FR")} tone={nbSansProposition > 0 ? "warning" : "success"} />
        <StatCard icon="check-circle" label="Propositions à confirmer" value={nbAConfirmer.toLocaleString("fr-FR")} tone={nbAConfirmer > 0 ? "warning" : "success"} />
        <StatCard icon="shield-check" label="Rattachements à valider" value={nbAValider.toLocaleString("fr-FR")} tone={nbAValider > 0 ? "warning" : "success"} />
      </div>

      <section className="space-y-3" data-rattachements-a-confirmer>
        <h2 className="text-base font-bold text-foreground">À confirmer par le commercial (étape 1)</h2>
        <p className="text-sm text-muted-foreground">Déductions et propositions probables : confirmez avec la référence du reçu.</p>
        <TableRattachements mode="confirmer" rows={aConfirmer.map(enLigne)} peutAgir={peutConfirmer} />
        {nbAConfirmer > LIGNES_MAX && <p className="text-xs text-muted-foreground">Les {LIGNES_MAX} plus anciennes sont affichées.</p>}
      </section>

      <section className="space-y-3" data-rattachements-a-valider>
        <h2 className="text-base font-bold text-foreground">À valider par le RFCRH (étape 2)</h2>
        <p className="text-sm text-muted-foreground">Preuves directes et propositions confirmées. Le compte qui a confirmé ne peut pas valider.</p>
        <TableRattachements mode="valider" rows={aValider.map(enLigne)} peutAgir={peutValider} />
        {nbAValider > LIGNES_MAX && <p className="text-xs text-muted-foreground">Les {LIGNES_MAX} plus anciens sont affichés.</p>}
      </section>

      <section className="space-y-3" data-rattachements-sans-proposition>
        <h2 className="text-base font-bold text-foreground">Encaissements sans proposition</h2>
        <p className="text-sm text-muted-foreground">Aucune méthode n&apos;a trouvé de contrat : identifiez-les à la main, ou classez-les « pas une prime » avec un motif.</p>
        <EncaissementsSansProposition
          peutIdentifier={peutIdentifier}
          peutClasser={peutClasser}
          rows={sansProposition.map((e) => ({
            id: e.id,
            reference: e.reference,
            dateValeur: formaterDateCpt(e.dateValeur),
            payeur: e.payeur ?? "—",
            telephone: e.telephone ?? "",
            montant: formaterMontantCpt(e.montant),
            reste: formaterMontantCpt(e.resteARattacher),
            resteBrut: e.resteARattacher.toString(),
          }))}
        />
        {nbSansProposition > SANS_PROPOSITION_MAX && <p className="text-xs text-muted-foreground">Les {SANS_PROPOSITION_MAX} plus anciens sont affichés.</p>}
      </section>
    </div>
  );
}
