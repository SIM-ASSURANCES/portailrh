"use client";

import { Badge, DataTable, type DataTableColumn } from "@/components/ui";
import { Icon } from "@/components/icons";

type TypePointage = "ARRIVEE" | "DEPART";
type SourcePointage = "QR_CODE" | "ORDINATEUR" | "RH_EXCEPTIONNEL";

export type PointageRHRow = {
  id: string;
  heure: string; // ISO string pour sérialisation sûre
  type: TypePointage;
  source: SourcePointage;
  estRetard: boolean;
  minutesRetard: number | null;
  motif: string | null;
  collaborateurNom: string;
  effectueParNom: string | null;
  correctionsCount: number;
  dernierMotifCorrection: string | null;
};

const SOURCE_LABELS: Record<SourcePointage, string> = {
  QR_CODE: "QR Code",
  ORDINATEUR: "Ordinateur",
  RH_EXCEPTIONNEL: "Saisie RH",
};

export function PointagesRHTables({ pointages }: { pointages: PointageRHRow[] }) {
  const columns: DataTableColumn<PointageRHRow>[] = [
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
      key: "collaborateur",
      header: "Collaborateur",
      sortable: true,
      accessor: (row) => row.collaborateurNom,
      render: (row) => (
        <span className="font-bold text-foreground">
          {row.collaborateurNom}
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
        <Badge variant={row.type === "ARRIVEE" ? "info" : "neutral"}>
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
              <Badge variant="warning">Départ anticipé</Badge>
              <p className="text-xs text-muted-foreground italic truncate max-w-xs">{row.motif}</p>
            </div>
          ) : (
            <span className="text-xs text-muted-foreground">Normal</span>
          );
        }
        if (row.estRetard) {
          return (
            <div className="space-y-1">
              <Badge variant="danger">
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
              <Badge variant="success">À l&apos;heure</Badge>
              <p className="text-xs text-muted-foreground italic truncate max-w-xs" title={row.motif}>
                Motif : {row.motif}
              </p>
            </div>
          );
        }
        return <Badge variant="success">À l&apos;heure</Badge>;
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
            <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-warning" title={row.dernierMotifCorrection ?? undefined}>
              <Icon name="pencil" className="size-3" />
              Corrigé
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
      emptyMessage="Aucun pointage trouvé pour ces critères."
    />
  );
}
