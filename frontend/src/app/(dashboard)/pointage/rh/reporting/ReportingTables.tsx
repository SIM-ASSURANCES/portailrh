"use client";

import { DataTable, Badge } from "@/components/ui";
import { VARIANTE_STATUT_JUSTIFICATION } from "@/components/pointage/justificationStatut";
import type { StatutJustificationPointage } from "backend";

type AgregeData = {
  id: string;
  fullName: string;
  service: string | null;
  joursTravailles: number;
  presences: number;
  absences: number;
  joursRetard: number;
  minutesRetard: number;
  /** T08 : jours ouvrés de congé validé ; ne comptent jamais comme des absences. */
  joursConge: number;
  /** T08 (R13) : jours de congé validé où une arrivée a été pointée. */
  joursPointesEnConge: number;
};

type DetailsData = {
  id: string;
  collaborateur: string;
  service: string | null;
  date: Date;
  heurePrevue: string | null;
  heureReelle: Date;
  minutesRetard: number | null;
  /** Pointage V2, lot 7 : statut réel de la justification (`null` pour un ancien pointage) et son libellé. */
  justificationStatut: StatutJustificationPointage | null;
  justification: string;
  motif: string | null;
  decideePar: string | null;
};

export function ReportingSummaryTable({ data }: { data: AgregeData[] }) {
  return (
    <DataTable
      rowKey={(r) => r.id}
      columns={[
        { key: "collaborateur", header: "Collaborateur", accessor: (r) => r.fullName },
        { key: "service", header: "Service", accessor: (r) => r.service || "-" },
        { 
          key: "joursTravailles", 
          header: "Jours travaillés", 
          accessor: (r) => r.joursTravailles 
        },
        { 
          key: "presences", 
          header: "Présences", 
          accessor: (r) => r.presences 
        },
        { 
          key: "absences", 
          header: "Absences", 
          accessor: (r) => r.absences 
        },
        { 
          key: "joursRetard", 
          header: "Jours de retard", 
          accessor: (r) => r.joursRetard 
        },
        { 
          key: "minutesRetard", 
          header: "Minutes de retard", 
          accessor: (r) => r.minutesRetard 
        },
        { key: "joursConge", header: "Jours de congé", accessor: (r) => r.joursConge },
        {
          key: "joursPointesEnConge",
          header: "Pointé pendant un congé",
          accessor: (r) => r.joursPointesEnConge,
          render: (r) =>
            r.joursPointesEnConge > 0 ? <Badge variant="warning">{r.joursPointesEnConge} jour(s)</Badge> : "0",
        },
      ]}
      data={data}
    />
  );
}

/** Détail des retards ou des départs anticipés (sans colonne de minutes : l'avance n'est pas enregistrée au pointage). */
export function ReportingDetailsTable({
  data,
  avecMinutesRetard = true,
}: {
  data: DetailsData[];
  avecMinutesRetard?: boolean;
}) {
  return (
    <DataTable
      rowKey={(r) => r.id}
      columns={[
        { 
          key: "date", 
          header: "Date", 
          accessor: (r) => r.date,
          render: (r) => new Date(r.date).toLocaleDateString("fr-FR")
        },
        { key: "collaborateur", header: "Collaborateur", accessor: (r) => r.collaborateur },
        { 
          key: "heurePrevue", 
          header: "Heure prévue", 
          accessor: (r) => r.heurePrevue || "-" 
        },
        { 
          key: "heureReelle", 
          header: "Heure réelle", 
          accessor: (r) => r.heureReelle,
          render: (r) => new Date(r.heureReelle).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })
        },
        ...(avecMinutesRetard
          ? [
              {
                key: "minutesRetard",
                header: "Minutes",
                accessor: (r: DetailsData) => r.minutesRetard,
                render: (r: DetailsData) => <Badge variant="primary">{r.minutesRetard} min</Badge>,
              },
            ]
          : []),
        {
          key: "justification",
          header: "Justification",
          accessor: (r) => r.justification,
          render: (r) =>
            r.justificationStatut ? (
              <Badge variant={VARIANTE_STATUT_JUSTIFICATION[r.justificationStatut]}>{r.justification}</Badge>
            ) : (
              "—"
            ),
        },
        { key: "motif", header: "Motif", accessor: (r) => r.motif || "-" },
        { key: "decideePar", header: "Décidée par", accessor: (r) => r.decideePar || "-" },
      ]}
      data={data}
    />
  );
}
