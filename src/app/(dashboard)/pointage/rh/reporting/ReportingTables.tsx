"use client";

import { DataTable, Badge } from "@/components/ui";

type AgregeData = {
  id: string;
  fullName: string;
  service: string | null;
  joursTravailles: number;
  presences: number;
  absences: number;
  joursRetard: number;
  minutesRetard: number;
};

type DetailsData = {
  id: string;
  collaborateur: string;
  service: string | null;
  date: Date;
  heurePrevue: string | null;
  heureReelle: Date;
  minutesRetard: number | null;
  motif: string | null;
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
      ]}
      data={data}
    />
  );
}

export function ReportingDetailsTable({ data }: { data: DetailsData[] }) {
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
        { 
          key: "minutesRetard", 
          header: "Minutes", 
          accessor: (r) => r.minutesRetard,
          render: (r) => <Badge variant="primary">{r.minutesRetard} min</Badge>
        },
        { key: "motif", header: "Motif", accessor: (r) => r.motif || "-" },
      ]}
      data={data}
    />
  );
}
