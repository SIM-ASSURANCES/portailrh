import { redirect } from "next/navigation";

import { PageHeader } from "@/components/ui";
import { getSession, hasPermission } from "@/lib/auth";
import { getBeneficiaireNom } from "backend";
import { prisma } from "backend";
import type { StatutDemande } from "backend";

import { ToutesLesDemandesFiltersForm } from "./ToutesLesDemandesFiltersForm";
import { ToutesLesDemandesTable } from "./ToutesLesDemandesTable";

const STATUT_VALUES = new Set<string>([
  "BROUILLON",
  "EN_ATTENTE_VALIDATION",
  "VALIDEE",
  "PARTIELLEMENT_VALIDEE",
  "VALIDEE_NON_REGLEE",
  "PARTIELLEMENT_REGLEE",
  "REGLEE",
  "REJETEE",
  "EN_ATTENTE_REGULARISATION",
  "REGULARISEE",
  "CLOTUREE",
]);

function rawString(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

/**
 * "Toutes les demandes" — complément DÉLIBÉRÉ aux listes de tâches déjà
 * existantes ("Demandes en attente de validation", "Retours en attente"),
 * jamais un remplacement (voir CLAUDE.md "Traçabilité d'une demande après
 * règlement/clôture") : ces dernières filtrent volontairement sur ce qui
 * reste À TRAITER, une demande réglée/réceptionnée ou clôturée en disparaît
 * normalement — mais jusqu'à cette tâche, aucun écran quotidien ne
 * permettait de la retrouver ensuite (seul le reporting existait, agrégé
 * par Catégorie/Objet, jamais au niveau d'une demande individuelle — voir
 * le diagnostic dans CLAUDE.md). Liste TOUTES les demandes sans filtre de
 * statut par défaut, avec recherche par référence/créateur/statut et lien
 * direct vers le détail.
 *
 * **Accès** : Responsable Finance (`treso.valider_demande`), Assistant
 * Finance (`treso.effectuer_reglement`/`treso.receptionner_retour`), DG
 * (`treso.valider_demande`) — jamais RH ni Collaborateur, cohérent avec
 * "Restreindre Déléguer des accès" et la séparation des rôles déjà en
 * place. Revérifié ici, jamais supposé acquis du simple fait d'avoir
 * passé le layout Finance partagé (qui accepte un ensemble plus large).
 */
export default async function ToutesLesDemandesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await getSession();
  const canAccess =
    !!session &&
    (hasPermission(session, "treso.valider_demande") ||
      hasPermission(session, "treso.effectuer_reglement") ||
      hasPermission(session, "treso.receptionner_retour"));
  if (!canAccess) {
    redirect("/?error=acces_refuse_toutes_les_demandes");
  }

  const rawParams = await searchParams;
  const reference = rawString(rawParams.reference);
  const createurId = rawString(rawParams.createurId);
  const statutRaw = rawString(rawParams.statut);
  const statut = statutRaw && STATUT_VALUES.has(statutRaw) ? (statutRaw as StatutDemande) : undefined;

  const [rawDemandes, createurs] = await Promise.all([
    prisma.demande.findMany({
      where: {
        ...(reference ? { reference: { contains: reference, mode: "insensitive" } } : {}),
        ...(createurId ? { createurId } : {}),
        ...(statut ? { statut } : {}),
      },
      include: { createur: true, beneficiaireUser: true },
      orderBy: { createdAt: "desc" },
    }),
    prisma.user.findMany({ orderBy: { fullName: "asc" } }),
  ]);

  const demandes = rawDemandes.map((d) => ({
    id: d.id,
    reference: d.reference,
    createurNom: d.createur.fullName,
    beneficiaireNom: getBeneficiaireNom(d),
    montant: Number(d.montant),
    createdAt: d.createdAt,
    statut: d.statut,
  }));

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-6 sm:px-6 sm:py-10">
      <PageHeader
        title="Toutes les demandes"
        description="Retrouvez n'importe quelle demande quel que soit son statut — y compris déjà réglée ou clôturée."
      />
      <ToutesLesDemandesFiltersForm
        createurs={createurs.map((c) => ({ id: c.id, label: c.fullName }))}
        initial={{ reference, createurId, statut }}
      />
      <ToutesLesDemandesTable demandes={demandes} />
    </div>
  );
}
