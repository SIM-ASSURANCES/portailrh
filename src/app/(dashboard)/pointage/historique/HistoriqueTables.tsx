"use client";

import { Badge, DataTable, type DataTableColumn } from "@/components/ui";
import { Icon } from "@/components/icons";

type TypePointage = "ARRIVEE" | "DEPART";
type SourcePointage = "QR_CODE" | "ORDINATEUR" | "RH_EXCEPTIONNEL";
type StatutAbsence = "A_CONTROLER" | "CONFIRMEE" | "JUSTIFIEE";

export type PointageRow = {
  id: string;
  heure: string; // ISO string pour sérialisation sûre
  type: TypePointage;
  source: SourcePointage;
  estRetard: boolean;
  minutesRetard: number | null;
  motif: string | null;
  effectueParNom: string | null;
  correctionsCount: number;
  dernierMotifCorrection: string | null;
};

export type AbsenceRow = {
  id: string;
  date: string; // ISO string
  statut: StatutAbsence;
  motif: string | null;
  controleParNom: string | null;
};

const SOURCE_LABELS: Record<SourcePointage, string> = {
  QR_CODE: "QR Code (Mobile)",
  ORDINATEUR: "Ordinateur (Bureau)",
  RH_EXCEPTIONNEL: "Saisie RH",
};

const STATUT_ABSENCE_LABELS: Record<StatutAbsence, string> = {
  A_CONTROLER: "À contrôler",
  CONFIRMEE: "Absence confirmée",
  JUSTIFIEE: "Justifiée",
};

export function PointagesTable({ pointages }: { pointages: PointageRow[] }) {
  const columns: DataTableColumn<PointageRow>[] = [
    {
      key: "date",
      header: "Date",
      sortable: true,
      accessor: (row) => row.heure,
      render: (row) => (
        <span className="font-medium text-foreground">
          {new Date(row.heure).toLocaleDateString("fr-FR", {
            weekday: "short",
            day: "2-digit",
            month: "short",
            year: "numeric",
          })}
        </span>
      ),
    },
    {
      key: "heure",
      header: "Heure",
      sortable: true,
      accessor: (row) => row.heure,
      render: (row) => (
        <span className="font-bold text-foreground">
          {new Date(row.heure).toLocaleTimeString("fr-FR", {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
          })}
        </span>
      ),
    },
    {
      key: "type",
      header: "Type",
      sortable: true,
      accessor: (row) => row.type,
      render: (row) => (
        <Badge variant={row.type === "ARRIVEE" ? "primary" : "info"}>
          {row.type === "ARRIVEE" ? "Arrivée" : "Départ"}
        </Badge>
      ),
    },
    {
      key: "retard",
      header: "Statut / Retard",
      render: (row) => {
        if (row.type === "DEPART") {
          return row.motif ? (
            <div className="space-y-1">
              <Badge variant="primary">Départ anticipé</Badge>
              <p className="text-xs text-muted-foreground italic truncate max-w-xs">{row.motif}</p>
            </div>
          ) : (
            <span className="text-xs text-muted-foreground">Normal</span>
          );
        }
        if (row.estRetard) {
          return (
            <div className="space-y-1">
              <Badge variant="primary">
                Retard (+{row.minutesRetard ?? 0} min)
              </Badge>
              {row.motif ? (
                <p className="text-xs text-muted-foreground italic truncate max-w-xs" title={row.motif}>
                  Motif : {row.motif}
                </p>
              ) : null}
            </div>
          );
        }
        if (row.motif) {
          return (
            <div className="space-y-1">
              <Badge variant="info">À l&apos;heure</Badge>
              <p className="text-xs text-muted-foreground italic truncate max-w-xs" title={row.motif}>
                Motif : {row.motif}
              </p>
            </div>
          );
        }
        return <Badge variant="info">À l&apos;heure</Badge>;
      },
    },
    {
      key: "source",
      header: "Source / Mode",
      render: (row) => (
        <div className="flex flex-col gap-0.5">
          <span className="text-xs font-medium text-foreground">
            {SOURCE_LABELS[row.source] ?? row.source}
          </span>
          {row.source === "RH_EXCEPTIONNEL" && row.effectueParNom ? (
            <span className="text-[11px] text-muted-foreground">
              Par : {row.effectueParNom}
            </span>
          ) : null}
          {row.correctionsCount > 0 ? (
            <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-primary" title={row.dernierMotifCorrection ?? undefined}>
              <Icon name="pencil" className="size-3" />
              Corrigé par RH
            </span>
          ) : null}
        </div>
      ),
    },
  ];

  return (
    <DataTable
      rowKey={(r) => r.id}
      columns={columns}
      data={pointages}
      emptyMessage="Aucun pointage trouvé pour la période sélectionnée."
    />
  );
}

export function AbsencesTable({ absences }: { absences: AbsenceRow[] }) {
  const columns: DataTableColumn<AbsenceRow>[] = [
    {
      key: "date",
      header: "Date de l'absence",
      sortable: true,
      accessor: (row) => row.date,
      render: (row) => (
        <span className="font-semibold text-foreground">
          {new Date(row.date).toLocaleDateString("fr-FR", {
            weekday: "long",
            day: "2-digit",
            month: "long",
            year: "numeric",
          })}
        </span>
      ),
    },
    {
      key: "statut",
      header: "Statut",
      sortable: true,
      accessor: (row) => row.statut,
      render: (row) => {
        const variant =
          row.statut === "JUSTIFIEE"
            ? "info"
            : row.statut === "CONFIRMEE"
              ? "primary"
              : "neutral";
        return <Badge variant={variant}>{STATUT_ABSENCE_LABELS[row.statut]}</Badge>;
      },
    },
    {
      key: "motif",
      header: "Motif / Justification",
      render: (row) => (
        <span className="text-sm text-foreground">
          {row.motif ? row.motif : <span className="italic text-muted-foreground">Non renseigné</span>}
        </span>
      ),
    },
    {
      key: "controlePar",
      header: "Contrôlé par",
      render: (row) => (
        <span className="text-xs text-muted-foreground">
          {row.controleParNom ? row.controleParNom : "En attente RH"}
        </span>
      ),
    },
  ];

  return (
    <DataTable
      rowKey={(r) => r.id}
      columns={columns}
      data={absences}
      emptyMessage="Aucune absence enregistrée sur cette période."
    />
  );
}
