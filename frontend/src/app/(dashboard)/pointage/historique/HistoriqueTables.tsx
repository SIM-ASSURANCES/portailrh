"use client";

import { Badge, DataTable, type DataTableColumn } from "@/components/ui";
import { Icon } from "@/components/icons";

type TypePointage = "ARRIVEE" | "DEPART";
type SourcePointage = "QR_CODE" | "ORDINATEUR" | "RH_EXCEPTIONNEL";
type StatutAbsence = "A_CONTROLER" | "CONFIRMEE" | "JUSTIFIEE";

export type PointageRow = {
  id: string;
  heure: string; // ISO string pour sérialisation sûre
  heurePrevue: string | null;
  type: TypePointage;
  source: SourcePointage;
  estRetard: boolean;
  minutesRetard: number | null;
  motif: string | null;
  effectueParNom: string | null;
  correctionsCount: number;
  dernierMotifCorrection: string | null;
  isOriginal?: boolean;
  groupId?: string;
  sortTime?: string;
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
      accessor: (row) => row.sortTime || row.heure,
      render: (row) => (
        <span className={`font-medium ${row.isOriginal ? 'text-muted-foreground line-through' : 'text-foreground'}`}>
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
      accessor: (row) => row.sortTime || row.heure,
      render: (row) => (
        <div className="flex flex-col">
          <span className={`font-bold ${row.isOriginal ? 'text-muted-foreground line-through' : 'text-foreground'}`}>
            {new Date(row.heure).toLocaleTimeString("fr-FR", {
              hour: "2-digit",
              minute: "2-digit",
              second: "2-digit",
            })}
          </span>
          {row.heurePrevue && (
            <span className="text-[11px] text-muted-foreground mt-0.5">
              Prévu : {row.heurePrevue}
            </span>
          )}
        </div>
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
        if (row.isOriginal) {
          return <span className="text-xs text-muted-foreground italic">Pointage modifié</span>;
        }
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
          <span className={`text-xs font-medium ${row.isOriginal ? 'text-muted-foreground' : 'text-foreground'}`}>
            {SOURCE_LABELS[row.source] ?? row.source}
          </span>
          {row.isOriginal && (
            <Badge variant="outline" className="w-fit text-[10px] mt-1">Valeur d&apos;origine</Badge>
          )}
          {row.source === "RH_EXCEPTIONNEL" && row.effectueParNom ? (
            <span className="text-[11px] text-muted-foreground">
              Par : {row.effectueParNom}
            </span>
          ) : null}
          {row.correctionsCount > 0 && !row.isOriginal ? (
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
      rowClassName={(row) => {
        if (row.groupId) {
          if (row.isOriginal) {
            // Style de l'original (en haut) : pas de bordure basse, fond légèrement distinct
            return "bg-muted/30 border-b-0";
          }
          // Style de la correction (en bas) : pas de bordure haute (écraser divide-y), fond légèrement distinct
          return "bg-muted/30 !border-t-0";
        }
        return "";
      }}
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
