"use client";

import Link from "next/link";

import type { StatutJustificationPointage } from "backend";
import { Badge, DataTable, type DataTableColumn } from "@/components/ui";
import { Icon } from "@/components/icons";
import { VARIANTE_STATUT_JUSTIFICATION } from "@/components/pointage/justificationStatut";

type TypePointage = "ARRIVEE" | "DEPART";
type SourcePointage = "QR_CODE" | "ORDINATEUR" | "RH_EXCEPTIONNEL" | "GEOLOCALISATION";
type StatutAbsence = "A_CONTROLER" | "CONFIRMEE" | "JUSTIFIEE";

export type PointageRow = {
  id: string;
  heure: string; // ISO string pour sérialisation sûre
  heurePrevue: string | null;
  type: TypePointage;
  source: SourcePointage;
  estRetard: boolean;
  minutesRetard: number | null;
  estDepartAnticipe?: boolean;
  motif: string | null;
  effectueParNom: string | null;
  correctionsCount: number;
  dernierMotifCorrection: string | null;
  isOriginal?: boolean;
  groupId?: string;
  sortTime?: string;
  /** Pointage V2 (lot 4) : justification du retard ou du départ anticipé, si une est demandée. */
  justification?: { statut: StatutJustificationPointage; libelle: string; peutJustifier: boolean } | null;
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
  GEOLOCALISATION: "📍 Géolocalisation GPS",
};

const STATUT_ABSENCE_LABELS: Record<StatutAbsence, string> = {
  A_CONTROLER: "À contrôler",
  CONFIRMEE: "Absence confirmée",
  JUSTIFIEE: "Justifiée",
};

const SOURCE_LABELS_COURTS: Record<SourcePointage, string> = {
  QR_CODE: "QR Code",
  ORDINATEUR: "Ordinateur",
  RH_EXCEPTIONNEL: "Saisie RH",
  GEOLOCALISATION: "GPS",
};

function dateCourte(iso: string) {
  return new Date(iso).toLocaleDateString("fr-FR", { weekday: "short", day: "2-digit", month: "short" });
}

function heureCourte(iso: string) {
  return new Date(iso).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
}

/**
 * Liste compacte (mobile, < md) : UN pointage par ligne — date · heure à gauche, type et statut à droite — et une
 * seconde ligne discrète (source, correction, justification) seulement quand elle apporte une information. Les
 * mêmes données que le tableau desktop, sans carte empilée ni conteneur.
 */
function PointagesListeMobile({ pointages }: { pointages: PointageRow[] }) {
  if (pointages.length === 0) {
    return <p className="py-6 text-center text-sm text-muted-foreground">Aucun pointage trouvé pour la période sélectionnée.</p>;
  }
  return (
    <ul className="divide-y divide-border border-y border-border">
      {pointages.map((row) => {
        const statut = row.isOriginal ? null : row.type === "DEPART" ? (
          row.estDepartAnticipe ? <Badge variant="primary">Anticipé</Badge> : null
        ) : row.estRetard ? (
          <Badge variant="primary">+{row.minutesRetard ?? 0} min</Badge>
        ) : (
          <Badge variant="info">À l&apos;heure</Badge>
        );
        const barre = row.isOriginal ? "text-muted-foreground line-through" : "text-foreground";
        return (
          <li key={row.id} className={`py-2.5 ${row.isOriginal ? "bg-muted/30" : ""}`}>
            <div className="flex items-center justify-between gap-2">
              <p className={`min-w-0 truncate text-sm ${barre}`}>
                <span className="font-medium">{dateCourte(row.heure)}</span>
                <span className="mx-1.5 text-muted-foreground">·</span>
                <span className="font-bold tabular-nums">{heureCourte(row.heure)}</span>
              </p>
              <div className="flex shrink-0 items-center gap-1.5">
                <Badge variant={row.type === "ARRIVEE" ? "primary" : "info"}>{row.type === "ARRIVEE" ? "Arrivée" : "Départ"}</Badge>
                {statut}
              </div>
            </div>
            <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-muted-foreground">
              <span>{row.isOriginal ? "Valeur d'origine (pointage modifié)" : SOURCE_LABELS_COURTS[row.source] ?? row.source}</span>
              {row.heurePrevue ? <span>Prévu {row.heurePrevue}</span> : null}
              {row.source === "RH_EXCEPTIONNEL" && row.effectueParNom ? <span>Par {row.effectueParNom}</span> : null}
              {row.correctionsCount > 0 && !row.isOriginal ? (
                <span className="inline-flex items-center gap-1 font-semibold text-primary">
                  <Icon name="pencil" className="size-3" />
                  Corrigé par RH
                </span>
              ) : null}
              {!row.isOriginal && row.justification ? (
                <span>
                  {row.justification.libelle} ·{" "}
                  <Link href={`/pointage/justifier/${row.groupId ?? row.id}`} className="font-semibold text-primary">
                    {row.justification.peutJustifier ? "Justifier" : "Voir"}
                  </Link>
                </span>
              ) : null}
              {!row.isOriginal && row.motif ? <span className="max-w-full truncate italic">Motif : {row.motif}</span> : null}
            </p>
          </li>
        );
      })}
    </ul>
  );
}

function AbsencesListeMobile({ absences }: { absences: AbsenceRow[] }) {
  if (absences.length === 0) {
    return <p className="py-6 text-center text-sm text-muted-foreground">Aucune absence enregistrée sur cette période.</p>;
  }
  return (
    <ul className="divide-y divide-border border-y border-border">
      {absences.map((row) => {
        const variant = row.statut === "JUSTIFIEE" ? "info" : row.statut === "CONFIRMEE" ? "primary" : "neutral";
        return (
          <li key={row.id} className="py-2.5">
            <div className="flex items-center justify-between gap-2">
              <p className="min-w-0 truncate text-sm font-medium text-foreground">
                {new Date(row.date).toLocaleDateString("fr-FR", { weekday: "short", day: "2-digit", month: "short" })}
              </p>
              <Badge variant={variant}>{STATUT_ABSENCE_LABELS[row.statut]}</Badge>
            </div>
            <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
              {row.motif ? row.motif : "Motif non renseigné"} · {row.controleParNom ?? "En attente RH"}
            </p>
          </li>
        );
      })}
    </ul>
  );
}

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
          if (row.estDepartAnticipe) {
            return (
              <div className="space-y-1">
                <Badge variant="primary">Départ anticipé</Badge>
                {row.motif && <p className="text-xs text-muted-foreground italic truncate max-w-xs">{row.motif}</p>}
              </div>
            );
          }
          if (row.motif) {
            return (
              <div className="space-y-1">
                <Badge variant="info">Normal</Badge>
                <p className="text-xs text-muted-foreground italic truncate max-w-xs">{row.motif}</p>
              </div>
            );
          }
          return <span className="text-xs text-muted-foreground">Normal</span>;
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
      key: "justification",
      header: "Justification",
      render: (row) => {
        if (row.isOriginal || !row.justification) return <span className="text-xs text-muted-foreground">—</span>;
        const href = `/pointage/justifier/${row.groupId ?? row.id}`;
        return (
          <div className="flex flex-col items-start gap-1">
            <Badge variant={VARIANTE_STATUT_JUSTIFICATION[row.justification.statut]}>{row.justification.libelle}</Badge>
            <Link href={href} className="text-xs font-semibold text-primary hover:underline">
              {row.justification.peutJustifier ? "Justifier" : "Voir"}
            </Link>
          </div>
        );
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
    <>
      <div className="md:hidden">
        <PointagesListeMobile pointages={pointages} />
      </div>
      <div className="hidden md:block">
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
      </div>
    </>
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
    <>
      <div className="md:hidden">
        <AbsencesListeMobile absences={absences} />
      </div>
      <div className="hidden md:block">
        <DataTable
          rowKey={(r) => r.id}
          columns={columns}
          data={absences}
          emptyMessage="Aucune absence enregistrée sur cette période."
        />
      </div>
    </>
  );
}
