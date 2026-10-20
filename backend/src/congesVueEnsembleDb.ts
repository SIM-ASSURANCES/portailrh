// Congés — requête de la vue d'ensemble DG/RH et de l'export Excel (module simplifié, 2026-10-20).
// Ne lit jamais la session : l'appelant vérifie le droit (`conges.consulter_tous` ou `conges.valider_rh` sur le rôle).
// Sans pagination, renvoie TOUTES les lignes (aucun plafond silencieux).

import type { Prisma } from "./generated/prisma/client";
import type { NatureConge, StatutDemandeConge } from "./generated/prisma/enums";
import type { StatutCircuitConge } from "./circuitConge";
import { colonneDateDepuisJourCivil, jourCivilDepuisColonneDate, type JourCivil } from "./congesCalcul";
import type { Db } from "./congesDb";

export interface FiltresCongesRequete {
  du: JourCivil;
  au: JourCivil;
  statuts?: readonly StatutCircuitConge[];
  serviceId?: string | null;
  nature?: NatureConge | null;
  /** Si vrai, filtre `dateDebut` dans `[du, au]` au lieu du chevauchement de période (utilisé pour l'onglet « À venir »). */
  debutDansPeriode?: boolean;
}

export interface PaginationCongesVueEnsemble {
  /** Numéro de page (1-indexé). */
  page?: number;
  /** Nombre de lignes par page (défaut 50). */
  taille?: number;
  parPage?: number;
  skip?: number;
  take?: number;
}

export interface DemandeVueEnsemble {
  id: string;
  reference: string;
  nature: NatureConge;
  motif: string;
  dateDebut: JourCivil;
  dateFin: JourCivil;
  nbJoursOuvres: number;
  statut: StatutCircuitConge;
  etapeResponsableRequise: boolean;
  saisieParRH: boolean;
  motifRejet: string | null;
  motifModification: string | null;
  motifAnnulation: string | null;
  observationRH: string | null;
  userId: string;
  user: {
    id: string;
    fullName: string;
    service: { id: string; name: string } | null;
  };
  creePar: { fullName: string };
  approuvePar: { fullName: string } | null;
  approuveAt: Date | null;
  validePar: { fullName: string } | null;
  valideAt: Date | null;
  annulePar: { fullName: string } | null;
  annuleAt: Date | null;
  createdAt: Date;
}

export async function listerCongesVueEnsemble(
  db: Db,
  filtres: FiltresCongesRequete,
  pagination?: PaginationCongesVueEnsemble
): Promise<{ lignes: DemandeVueEnsemble[]; total: number }> {
  const debutCol = colonneDateDepuisJourCivil(filtres.du);
  const finCol = colonneDateDepuisJourCivil(filtres.au);

  const where: Prisma.DemandeCongeWhereInput = {
    ...(filtres.debutDansPeriode
      ? { dateDebut: { gte: debutCol, lte: finCol } }
      : {
          dateDebut: { lte: finCol },
          dateFin: { gte: debutCol },
        }),
    ...(filtres.statuts && filtres.statuts.length > 0
      ? { statut: { in: [...filtres.statuts] as StatutDemandeConge[] } }
      : {}),
    ...(filtres.nature ? { nature: filtres.nature } : {}),
    ...(filtres.serviceId ? { user: { serviceId: filtres.serviceId } } : {}),
  };

  const orderBy: Prisma.DemandeCongeOrderByWithRelationInput[] = [
    { dateDebut: "asc" },
    { reference: "asc" },
  ];

  const select = {
    id: true,
    reference: true,
    nature: true,
    motif: true,
    dateDebut: true,
    dateFin: true,
    nbJoursOuvres: true,
    statut: true,
    etapeResponsableRequise: true,
    saisieParRH: true,
    motifRejet: true,
    motifModification: true,
    motifAnnulation: true,
    observationRH: true,
    userId: true,
    user: {
      select: {
        id: true,
        fullName: true,
        service: { select: { id: true, name: true } },
      },
    },
    creePar: { select: { fullName: true } },
    approuvePar: { select: { fullName: true } },
    approuveAt: true,
    validePar: { select: { fullName: true } },
    valideAt: true,
    annulePar: { select: { fullName: true } },
    annuleAt: true,
    createdAt: true,
  } satisfies Prisma.DemandeCongeSelect;

  const take = pagination ? (pagination.take ?? pagination.taille ?? pagination.parPage ?? 50) : undefined;
  const page = pagination?.page !== undefined ? Math.max(1, Math.floor(pagination.page)) : 1;
  const skip =
    pagination && take !== undefined
      ? pagination.skip !== undefined
        ? Math.max(0, Math.floor(pagination.skip))
        : (page - 1) * take
      : undefined;

  if (take === undefined) {
    const rows = await db.demandeConge.findMany({ where, orderBy, select });
    const lignes = rows.map((d) => ({
      ...d,
      statut: d.statut as StatutCircuitConge,
      dateDebut: jourCivilDepuisColonneDate(d.dateDebut),
      dateFin: jourCivilDepuisColonneDate(d.dateFin),
    }));
    return { lignes, total: lignes.length };
  }

  const [rows, total] = await Promise.all([
    db.demandeConge.findMany({ where, orderBy, select, skip, take }),
    db.demandeConge.count({ where }),
  ]);

  const lignes = rows.map((d) => ({
    ...d,
    statut: d.statut as StatutCircuitConge,
    dateDebut: jourCivilDepuisColonneDate(d.dateDebut),
    dateFin: jourCivilDepuisColonneDate(d.dateFin),
  }));

  return { lignes, total };
}

