import Link from "next/link";
import { redirect } from "next/navigation";

import { Button, Input, PageHeader } from "@/components/ui";
import { getSession, hasPermission } from "@/lib/auth";
import { peutVoirRemunerationCpt } from "@/lib/compta/droitsRemuneration";
import {
  champsOdooManquantsCpt,
  chronologieTauxTcaCpt,
  LIBELLE_BRANCHE_CPT,
  LIBELLE_TYPE_COMPTE_CPT,
  prisma,
  rechercherCpt,
  resumeOdooCpt,
  type EntiteMotsCpt,
  type TauxTcaLigne,
} from "backend";

import { CorrespondancesOdoo, type SectionOdoo } from "./CorrespondancesOdoo";
import {
  ClientsManager,
  ComptesManager,
  ConventionsManager,
  PartenairesManager,
  ProduitsManager,
  TauxTcaManager,
  type ConventionRow,
  type TauxRow,
} from "./ReferentielsClient";

const ONGLETS = [
  { id: "partenaires", libelle: "Partenaires" },
  { id: "clients", libelle: "Clients" },
  { id: "produits", libelle: "Produits" },
  { id: "comptes", libelle: "Comptes" },
  { id: "taux", libelle: "Taux de taxe" },
  { id: "conventions", libelle: "Conventions" },
  { id: "odoo", libelle: "Correspondances Odoo" },
] as const;

type OngletId = (typeof ONGLETS)[number]["id"];

function versIso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Référentiels du module (lot GC-2c, docs/compta-conception.md §5.3) : partenaires, clients, produits, comptes d'encaissement,
 * taux de taxe datés et conventions de rémunération. Lecture : `cpt.consulter` (layout), sauf l'onglet Conventions, qui exige
 * `cpt.consulter_remuneration` (C-36). Écriture : droits C-16 ci-dessous,
 * REVÉRIFIÉS par chaque Server Action (les formulaires masqués ne sont qu'un confort).
 */
export default async function ReferentielsPage({ searchParams }: { searchParams: Promise<{ onglet?: string; q?: string; manquantes?: string }> }) {
  const session = await getSession();
  if (!session || !hasPermission(session, "cpt.consulter")) {
    redirect("/?error=acces_refuse_compta");
  }

  const droits = {
    parametrer: hasPermission(session, "cpt.parametrer"),
    conventions: hasPermission(session, "cpt.gerer_conventions"),
    clients: hasPermission(session, "cpt.saisir_contrat") || hasPermission(session, "cpt.identifier_encaissement"),
  };

  const { onglet: demande, q: saisie, manquantes } = await searchParams;
  // Les conventions disent la rémunération des partenaires : sans la permission de la lire, l'onglet n'existe pas.
  const onglets = ONGLETS.filter((o) => o.id !== "conventions" || peutVoirRemunerationCpt(session));
  const onglet: OngletId = onglets.some((o) => o.id === demande) ? (demande as OngletId) : "partenaires";
  const aujourdhui = versIso(new Date());

  // Recherche rapide (GC-2d) : une seule requête sur l'index de mots pour les trois types de fiches ; elle filtre la liste
  // de l'onglet courant et donne le compteur des onglets Partenaires, Clients et Produits. Les onglets taux, comptes et conventions l'ignorent ; l'onglet Odoo l'applique aux partenaires, clients et produits.
  const q = (typeof saisie === "string" ? saisie : "").replace(/\s+/g, " ").trim().slice(0, 120);
  const trouves = q ? await rechercherCpt(prisma, q, { entites: ["CLIENT", "PARTENAIRE", "PRODUIT"], limite: 500 }) : null;
  const idsDe = (entite: EntiteMotsCpt): string[] | null => (trouves ? trouves.filter((t) => t.entite === entite).map((t) => t.entiteId) : null);
  const compteurs: Partial<Record<OngletId, number>> = trouves
    ? {
        partenaires: idsDe("PARTENAIRE")?.length ?? 0,
        clients: idsDe("CLIENT")?.length ?? 0,
        produits: idsDe("PRODUIT")?.length ?? 0,
      }
    : {};
  const filtreIds = (entite: EntiteMotsCpt) => {
    const ids = idsDe(entite);
    return ids ? { id: { in: ids } } : {};
  };

  let contenu: React.ReactNode;
  if (onglet === "partenaires") {
    const lignes = await prisma.cptPartenaire.findMany({ where: filtreIds("PARTENAIRE"), orderBy: [{ actif: "desc" }, { nom: "asc" }] });
    contenu = (
      <PartenairesManager
        lignes={lignes.map((p) => ({
          id: p.id,
          nom: p.nom,
          estApporteur: p.estApporteur,
          estBeneficiaire: p.estBeneficiaire,
          estGestionnaire: p.estGestionnaire,
          estClient: p.estClient,
          coordonnees: p.coordonnees,
          tiersOdoo: p.tiersOdoo,
          actif: p.actif,
        }))}
        peutEcrire={droits.parametrer}
      />
    );
  } else if (onglet === "clients") {
    const [clients, partenaires] = await Promise.all([
      prisma.cptClient.findMany({ where: filtreIds("CLIENT"), orderBy: { nom: "asc" }, take: 500, include: { partenaireOrigine: { select: { nom: true } } } }),
      prisma.cptPartenaire.findMany({ where: { actif: true }, orderBy: { nom: "asc" }, select: { id: true, nom: true } }),
    ]);
    contenu = (
      <ClientsManager
        lignes={clients.map((c) => ({
          id: c.id,
          nom: c.nom,
          telephone: c.telephone,
          pieceIdentite: c.pieceIdentite,
          partenaireOrigineId: c.partenaireOrigineId,
          partenaireOrigineNom: c.partenaireOrigine?.nom ?? null,
          tiersOdoo: c.tiersOdoo,
        }))}
        partenaires={partenaires}
        peutEcrire={droits.clients}
      />
    );
  } else if (onglet === "produits") {
    const produits = await prisma.cptProduit.findMany({ where: filtreIds("PRODUIT"), orderBy: [{ actif: "desc" }, { code: "asc" }] });
    contenu = (
      <ProduitsManager
        lignes={produits.map((p) => ({
          id: p.id,
          code: p.code,
          libelle: p.libelle,
          branche: p.branche,
          tarifReference: p.tarifReference ? p.tarifReference.toString() : null,
          compteOdoo: p.compteOdoo,
          actif: p.actif,
        }))}
        peutEcrire={droits.parametrer}
      />
    );
  } else if (onglet === "comptes") {
    const comptes = await prisma.cptCompte.findMany({ orderBy: [{ actif: "desc" }, { libelle: "asc" }] });
    contenu = (
      <ComptesManager
        lignes={comptes.map((c) => ({ id: c.id, libelle: c.libelle, type: c.type, journalOdoo: c.journalOdoo, compteOdoo: c.compteOdoo, actif: c.actif }))}
        peutEcrire={droits.parametrer}
      />
    );
  } else if (onglet === "taux") {
    const [taux, produits] = await Promise.all([
      prisma.cptTauxTca.findMany({ orderBy: [{ branche: "asc" }, { dateEffet: "desc" }] }),
      prisma.cptProduit.findMany({ where: { actif: true }, orderBy: { code: "asc" }, select: { code: true, libelle: true } }),
    ]);
    const lignes: TauxTcaLigne[] = taux.map((t) => ({
      id: t.id,
      branche: t.branche,
      produitCode: t.produitCode,
      natureContrat: t.natureContrat,
      taux: t.taux.toString(),
      dateEffet: versIso(t.dateEffet),
    }));
    // État de chaque ligne = sa place dans l'historique de SA portée (en vigueur / remplacé / à venir).
    const etats = new Map<string, TauxRow["etat"]>();
    const vues = new Set<string>();
    for (const l of lignes) {
      const cle = `${l.branche}|${l.produitCode ?? ""}|${l.natureContrat ?? ""}`;
      if (vues.has(cle)) continue;
      vues.add(cle);
      for (const c of chronologieTauxTcaCpt(lignes, l, aujourdhui)) etats.set(c.ligne.id, c.etat);
    }
    contenu = (
      <TauxTcaManager
        lignes={lignes.map((l) => ({ ...l, etat: etats.get(l.id) ?? "REMPLACE" }))}
        produits={produits}
        peutEcrire={droits.parametrer}
      />
    );
  } else if (onglet === "odoo") {
    // Correspondances Odoo (GC-2e) : les fiches à compléter d'abord ; la recherche rapide filtre partenaires, clients et produits
    // (leurs valeurs Odoo sont dans l'index de mots), pas les comptes. Les compteurs ignorent la recherche et le filtre.
    const LIMITE_ODOO = 300;
    const seulementManquantes = manquantes === "1";
    const manquantFirst = { sort: "asc", nulls: "first" } as const;
    const compteManquant = { OR: [{ journalOdoo: null }, { compteOdoo: null }] };
    const [parts, clients, produits, comptes, cPart, cClient, cProd, cCompte] = await Promise.all([
      prisma.cptPartenaire.findMany({
        where: { ...filtreIds("PARTENAIRE"), ...(seulementManquantes ? { actif: true, tiersOdoo: null } : {}) },
        orderBy: [{ tiersOdoo: manquantFirst }, { nom: "asc" }],
        take: LIMITE_ODOO + 1,
      }),
      prisma.cptClient.findMany({
        where: { ...filtreIds("CLIENT"), ...(seulementManquantes ? { tiersOdoo: null } : {}) },
        orderBy: [{ tiersOdoo: manquantFirst }, { nom: "asc" }],
        take: LIMITE_ODOO + 1,
      }),
      prisma.cptProduit.findMany({
        where: { ...filtreIds("PRODUIT"), ...(seulementManquantes ? { actif: true, compteOdoo: null } : {}) },
        orderBy: [{ compteOdoo: manquantFirst }, { code: "asc" }],
        take: LIMITE_ODOO + 1,
      }),
      prisma.cptCompte.findMany({
        where: seulementManquantes ? { actif: true, ...compteManquant } : {},
        orderBy: [{ journalOdoo: manquantFirst }, { compteOdoo: manquantFirst }, { libelle: "asc" }],
        take: LIMITE_ODOO + 1,
      }),
      Promise.all([prisma.cptPartenaire.count({ where: { actif: true } }), prisma.cptPartenaire.count({ where: { actif: true, tiersOdoo: null } })]),
      Promise.all([prisma.cptClient.count(), prisma.cptClient.count({ where: { tiersOdoo: null } })]),
      Promise.all([prisma.cptProduit.count({ where: { actif: true } }), prisma.cptProduit.count({ where: { actif: true, compteOdoo: null } })]),
      Promise.all([prisma.cptCompte.count({ where: { actif: true } }), prisma.cptCompte.count({ where: { actif: true, ...compteManquant } })]),
    ]);
    const roles = (p: (typeof parts)[number]) =>
      [p.estApporteur && "Apporteur", p.estBeneficiaire && "Bénéficiaire", p.estGestionnaire && "Gestionnaire", p.estClient && "Client"].filter(Boolean).join(", ");
    const sections: SectionOdoo[] = [
      {
        entite: "PARTENAIRE",
        resume: resumeOdooCpt(cPart[0], cPart[1]),
        tronque: parts.length > LIMITE_ODOO,
        lignes: parts.slice(0, LIMITE_ODOO).map((p) => ({
          id: p.id,
          libelle: p.nom,
          detail: roles(p),
          actif: p.actif,
          valeurs: { tiersOdoo: p.tiersOdoo ?? "" },
          manquants: champsOdooManquantsCpt("PARTENAIRE", p),
        })),
      },
      {
        entite: "CLIENT",
        resume: resumeOdooCpt(cClient[0], cClient[1]),
        tronque: clients.length > LIMITE_ODOO,
        lignes: clients.slice(0, LIMITE_ODOO).map((c) => ({
          id: c.id,
          libelle: c.nom,
          detail: c.telephone ?? "",
          actif: true,
          valeurs: { tiersOdoo: c.tiersOdoo ?? "" },
          manquants: champsOdooManquantsCpt("CLIENT", c),
        })),
      },
      {
        entite: "PRODUIT",
        resume: resumeOdooCpt(cProd[0], cProd[1]),
        tronque: produits.length > LIMITE_ODOO,
        lignes: produits.slice(0, LIMITE_ODOO).map((p) => ({
          id: p.id,
          libelle: `${p.code} — ${p.libelle}`,
          detail: LIBELLE_BRANCHE_CPT[p.branche],
          actif: p.actif,
          valeurs: { compteOdoo: p.compteOdoo ?? "" },
          manquants: champsOdooManquantsCpt("PRODUIT", p),
        })),
      },
      {
        entite: "COMPTE",
        resume: resumeOdooCpt(cCompte[0], cCompte[1]),
        tronque: comptes.length > LIMITE_ODOO,
        lignes: comptes.slice(0, LIMITE_ODOO).map((c) => ({
          id: c.id,
          libelle: c.libelle,
          detail: LIBELLE_TYPE_COMPTE_CPT[c.type],
          actif: c.actif,
          valeurs: { journalOdoo: c.journalOdoo ?? "", compteOdoo: c.compteOdoo ?? "" },
          manquants: champsOdooManquantsCpt("COMPTE", c),
        })),
      },
    ];
    const baseHref = `/compta/referentiels?onglet=odoo${q ? `&q=${encodeURIComponent(q)}` : ""}`;
    contenu = (
      <CorrespondancesOdoo
        sections={sections}
        peutEcrire={droits.parametrer}
        manquantesSeulement={seulementManquantes}
        hrefTout={baseHref}
        hrefManquantes={`${baseHref}&manquantes=1`}
      />
    );
  } else {
    const [conventions, partenaires, produits] = await Promise.all([
      prisma.cptConvention.findMany({
        orderBy: [{ dateEffet: "desc" }],
        include: { partenaire: { select: { nom: true } }, apporteur: { select: { nom: true } }, beneficiaire: { select: { nom: true } } },
      }),
      prisma.cptPartenaire.findMany({ where: { actif: true }, orderBy: { nom: "asc" }, select: { id: true, nom: true, estGestionnaire: true } }),
      prisma.cptProduit.findMany({ where: { actif: true }, orderBy: { code: "asc" }, select: { code: true, libelle: true } }),
    ]);
    const lignes: ConventionRow[] = conventions.map((c) => {
      const dateEffet = versIso(c.dateEffet);
      const dateFin = c.dateFin ? versIso(c.dateFin) : null;
      return {
        id: c.id,
        partenaireId: c.partenaireId,
        partenaireNom: c.partenaire.nom,
        produitCode: c.produitCode,
        nature: c.nature,
        taux: c.taux.toString(),
        base: c.base,
        faitGenerateur: c.faitGenerateur,
        apporteurNom: c.apporteur?.nom ?? null,
        beneficiaireNom: c.beneficiaire?.nom ?? null,
        modeReglement: c.modeReglement,
        dateEffet,
        dateFin,
        etat: dateEffet > aujourdhui ? "A_VENIR" : dateFin !== null && dateFin < aujourdhui ? "CLOSE" : "EN_COURS",
      };
    });
    contenu = <ConventionsManager lignes={lignes} partenaires={partenaires} produits={produits} peutEcrire={droits.conventions} />;
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-6 sm:px-6 sm:py-10">
      <PageHeader
        title="Référentiels"
        description="Partenaires, clients, produits, comptes d'encaissement, taux de taxe et conventions de rémunération."
      />
      <form method="get" action="/compta/referentiels" role="search" className="flex flex-wrap items-end gap-3" data-recherche-compta>
        <input type="hidden" name="onglet" value={onglet} />
        {onglet === "odoo" && manquantes === "1" && <input type="hidden" name="manquantes" value="1" />}
        <div className="min-w-0 flex-1 sm:max-w-md">
          <Input name="q" label="Recherche rapide" defaultValue={q} maxLength={120} hint="Partenaires, clients, produits : un mot ou plusieurs, début de mot suffisant." />
        </div>
        <Button type="submit">Rechercher</Button>
        {q && (
          <Link href={`/compta/referentiels?onglet=${onglet}`} className="pb-2 text-sm font-medium text-primary underline" data-recherche-effacer>
            Effacer
          </Link>
        )}
      </form>
      <nav aria-label="Référentiels" className="flex flex-wrap gap-2">
        {onglets.map((o) => (
          <Link
            key={o.id}
            href={`/compta/referentiels?onglet=${o.id}${q ? `&q=${encodeURIComponent(q)}` : ""}`}
            aria-current={o.id === onglet ? "page" : undefined}
            data-onglet-compta={o.id}
            className={`rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
              o.id === onglet ? "border-primary bg-primary text-primary-foreground" : "border-border bg-surface text-foreground hover:bg-muted"
            }`}
          >
            {o.libelle}
            {compteurs[o.id] !== undefined && <span data-compteur-onglet={o.id}> ({compteurs[o.id]})</span>}
          </Link>
        ))}
      </nav>
      {contenu}
    </div>
  );
}
