"use client";

import { useMemo } from "react";
import { Badge, DataTable, type DataTableColumn } from "@/components/ui";
import { Icon } from "@/components/icons";

type TypePointage = "ARRIVEE" | "DEPART";
type SourcePointage = "QR_CODE" | "ORDINATEUR" | "RH_EXCEPTIONNEL" | "GEOLOCALISATION";

export type PointageRHRow = {
  id: string;
  heure: string; // ISO string pour sérialisation sûre
  heurePrevue: string | null;
  type: TypePointage;
  source: SourcePointage;
  estRetard: boolean;
  minutesRetard: number | null;
  estDepartAnticipe?: boolean;
  motif: string | null;
  collaborateurNom: string;
  effectueParNom: string | null;
  correctionsCount: number;
  dernierMotifCorrection: string | null;
  ipAddress: string | null;
};

type GroupedPointageRow = {
  id: string;
  dateRaw: string;
  dateFormatted: string;
  collaborateurNom: string;
  arrivee: PointageRHRow | null;
  depart: PointageRHRow | null;
};

const SOURCE_LABELS: Record<SourcePointage, string> = {
  QR_CODE: "QR Code",
  ORDINATEUR: "Ordinateur",
  RH_EXCEPTIONNEL: "Saisie RH",
  GEOLOCALISATION: "Géolocalisation",
};

function renderHeure(row: PointageRHRow | null) {
  if (!row) return <span className="text-muted-foreground font-medium">-</span>;
  return (
    <div className="flex flex-col gap-0.5 text-[13px]">
      <span className="font-semibold text-foreground whitespace-nowrap">
        {new Date(row.heure).toLocaleTimeString("fr-FR", {
          hour: "2-digit",
          minute: "2-digit",
        })}
      </span>
      {row.heurePrevue && (
        <span className="text-[10px] text-muted-foreground whitespace-nowrap">
          Prévu: {row.heurePrevue}
        </span>
      )}
    </div>
  );
}

function renderStatut(row: PointageRHRow | null) {
  if (!row) return <span className="text-muted-foreground font-medium">-</span>;
  if (row.type === "DEPART") {
    if (row.estDepartAnticipe) {
      return (
        <div className="space-y-0.5 max-w-[120px]">
          <Badge variant="primary" className="text-[10px] px-1.5 py-0 leading-tight">Départ anticipé</Badge>
          {row.motif && (
            <p className="text-[10px] text-muted-foreground italic truncate" title={row.motif}>{row.motif}</p>
          )}
        </div>
      );
    }
    if (row.motif) {
      return (
        <div className="space-y-0.5 max-w-[120px]">
          <Badge variant="info" className="text-[10px] px-1.5 py-0 leading-tight">Normal</Badge>
          <p className="text-[10px] text-muted-foreground italic truncate" title={row.motif}>{row.motif}</p>
        </div>
      );
    }
    return <span className="text-xs text-muted-foreground">Normal</span>;
  }
  
  if (row.estRetard) {
    return (
      <div className="space-y-0.5 max-w-[120px]">
        <Badge variant="primary" className="text-[10px] px-1.5 py-0 leading-tight">
          Retard (+{row.minutesRetard ?? 0} min)
        </Badge>
        {row.motif ? (
          <p className="text-[10px] text-muted-foreground italic truncate" title={row.motif}>
            {row.motif}
          </p>
        ) : null}
      </div>
    );
  }

  if (row.motif) {
    return (
      <div className="space-y-0.5 max-w-[120px]">
        <Badge variant="info" className="text-[10px] px-1.5 py-0 leading-tight">À l&apos;heure</Badge>
        <p className="text-[10px] text-muted-foreground italic truncate" title={row.motif}>
          {row.motif}
        </p>
      </div>
    );
  }
  
  return <Badge variant="info" className="text-[10px] px-1.5 py-0 leading-tight">À l&apos;heure</Badge>;
}

function renderSource(row: PointageRHRow | null) {
  if (!row) return <span className="text-muted-foreground font-medium">-</span>;
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[11px] font-medium text-foreground whitespace-nowrap">
        {row.source === "GEOLOCALISATION" ? (
          <span className="inline-flex items-center gap-0.5 text-blue-600 dark:text-blue-400">
            <span>📍</span> GPS
          </span>
        ) : (
          SOURCE_LABELS[row.source] ?? row.source
        )}
      </span>
      {row.ipAddress && (
        <span className="text-[9px] text-muted-foreground font-mono truncate max-w-[90px]" title={row.ipAddress}>
          IP: {row.ipAddress}
        </span>
      )}
      {row.source === "RH_EXCEPTIONNEL" && row.effectueParNom ? (
        <span className="text-[10px] text-muted-foreground truncate max-w-[90px]" title={row.effectueParNom}>
          Par: {row.effectueParNom}
        </span>
      ) : null}
      {row.correctionsCount > 0 ? (
        <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-primary" title={row.dernierMotifCorrection ?? undefined}>
          <Icon name="pencil" className="size-2.5" />
          Corrigé
        </span>
      ) : null}
    </div>
  );
}

function heureCourte(row: PointageRHRow | null) {
  return row ? new Date(row.heure).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }) : null;
}

/**
 * Liste mobile (< md) pensée pour un grand nombre de lignes : un en-tête par jour, puis UNE ligne par collaborateur
 * (nom à gauche, arrivée → départ à droite) ; une seconde ligne seulement pour un retard ou un départ anticipé.
 * Source, adresse IP, heures prévues, motifs et corrections restent consultables sur ordinateur.
 */
function PointagesRHListeMobile({ groupes }: { groupes: GroupedPointageRow[] }) {
  if (groupes.length === 0) {
    return <p className="py-6 text-center text-sm text-muted-foreground">Aucun pointage trouvé pour ces critères.</p>;
  }
  const jours: { cle: string; libelle: string; lignes: GroupedPointageRow[] }[] = [];
  for (const g of groupes) {
    const dernier = jours[jours.length - 1];
    if (dernier && dernier.cle === g.dateFormatted) {
      dernier.lignes.push(g);
    } else {
      jours.push({
        cle: g.dateFormatted,
        libelle: new Date(g.dateRaw).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" }),
        lignes: [g],
      });
    }
  }
  return (
    <div className="space-y-3">
      {jours.map((jour) => (
        <section key={jour.cle}>
          <h3 className="border-b border-border pb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            {jour.libelle}
          </h3>
          <ul className="divide-y divide-border">
            {jour.lignes.map((g) => {
              const retard = g.arrivee?.estRetard ?? false;
              const anticipe = g.depart?.estDepartAnticipe ?? false;
              return (
                <li key={g.id} className="py-2">
                  <div className="flex items-center justify-between gap-3">
                    <span className="min-w-0 truncate text-sm font-medium text-foreground">{g.collaborateurNom}</span>
                    <span className="shrink-0 text-sm tabular-nums">
                      <span className={retard ? "font-bold text-primary" : "font-semibold text-foreground"}>{heureCourte(g.arrivee) ?? "—"}</span>
                      <span className="mx-1 text-muted-foreground">→</span>
                      <span className={anticipe ? "font-bold text-primary" : "font-semibold text-foreground"}>{heureCourte(g.depart) ?? "—"}</span>
                    </span>
                  </div>
                  {retard || anticipe ? (
                    <p className="mt-0.5 flex flex-wrap gap-x-3 text-[11px] font-semibold text-primary">
                      {retard ? <span>Retard +{g.arrivee?.minutesRetard ?? 0} min</span> : null}
                      {anticipe ? <span>Départ anticipé</span> : null}
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}

export function PointagesRHTables({ pointages }: { pointages: PointageRHRow[] }) {
  const groupedData = useMemo(() => {
    const map = new Map<string, GroupedPointageRow>();

    pointages.forEach((p) => {
      const d = new Date(p.heure);
      const dateStr = d.toLocaleDateString("fr-FR", { year: "2-digit", month: "2-digit", day: "2-digit" });
      const key = `${dateStr}-${p.collaborateurNom}`;

      if (!map.has(key)) {
        map.set(key, {
          id: key,
          dateRaw: p.heure,
          dateFormatted: dateStr,
          collaborateurNom: p.collaborateurNom,
          arrivee: null,
          depart: null,
        });
      }

      const group = map.get(key)!;
      if (p.type === "ARRIVEE") {
        if (!group.arrivee || new Date(p.heure) < new Date(group.arrivee.heure)) {
          // Prendre la première arrivée (la plus ancienne) de la journée
          group.arrivee = p;
        }
      } else {
        if (!group.depart || new Date(p.heure) > new Date(group.depart.heure)) {
          // Prendre le dernier départ de la journée
          group.depart = p;
        }
      }
    });

    return Array.from(map.values());
  }, [pointages]);

  const columns: DataTableColumn<GroupedPointageRow>[] = [
    {
      key: "date",
      header: "Date",
      sortable: true,
      accessor: (row) => row.dateRaw,
      render: (row) => (
        <span className="text-[13px] font-medium text-foreground whitespace-nowrap">
          {row.dateFormatted}
        </span>
      ),
    },
    {
      key: "collaborateur",
      header: "Collaborateur",
      sortable: true,
      accessor: (row) => row.collaborateurNom,
      render: (row) => (
        <span className="text-[13px] font-bold text-foreground">
          {row.collaborateurNom}
        </span>
      ),
    },
    {
      key: "arrivee_heure",
      header: "Heure (Arr.)",
      render: (row) => renderHeure(row.arrivee),
    },
    {
      key: "arrivee_statut",
      header: "Statut (Arr.)",
      render: (row) => renderStatut(row.arrivee),
    },
    {
      key: "arrivee_source",
      header: "Source (Arr.)",
      render: (row) => renderSource(row.arrivee),
    },
    {
      key: "depart_heure",
      header: "Heure (Dép.)",
      render: (row) => renderHeure(row.depart),
    },
    {
      key: "depart_statut",
      header: "Statut (Dép.)",
      render: (row) => renderStatut(row.depart),
    },
    {
      key: "depart_source",
      header: "Source (Dép.)",
      render: (row) => renderSource(row.depart),
    },
  ];

  return (
    <>
      <div className="md:hidden">
        <PointagesRHListeMobile groupes={groupedData} />
      </div>
      <div className="hidden overflow-x-auto md:block">
        <div className="min-w-[800px]">
          <DataTable
            rowKey={(r) => r.id}
            columns={columns}
            data={groupedData}
            emptyMessage="Aucun pointage trouvé pour ces critères."
          />
        </div>
      </div>
    </>
  );
}
