"use client";

import { useState } from "react";
import { format } from "date-fns";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui";
import { Icon, type IconName } from "@/components/icons";
import { VARIANTE_STATUT_JUSTIFICATION } from "@/components/pointage/justificationStatut";
import type { EtatPlageConge, JustificationAffichee } from "backend";

export interface PresenceData {
  userId: string;
  fullName: string;
  email: string;
  arriveeId?: string;
  arrivee?: string;
  arriveePrevue?: string | null;
  depart?: string;
  departPrevu?: string | null;
  estRetard?: boolean;
  minutesRetard?: number | null;
  motif?: string | null;
  /** Source du pointage d'arrivée (pour le badge géoloc) */
  sourceArrivee?: string | null;
  /** Distance au bureau en mètres (si pointage géolocalisé) */
  geoDistance?: number | null;
  /** Pointage V2, lot 7 : justification du retard (statut réel, motif, décidée par). */
  justification?: JustificationAffichee;
  /** Justification d'un départ anticipé, le cas échéant. */
  justificationDepart?: JustificationAffichee;
  /** Le départ pointé est un départ anticipé. */
  departAnticipe?: boolean;
  /** Absence autorisée couvrant la journée (« En congé (CNG-…) », « Congé en attente de validation (CNG-…) »…). */
  absenceAutorisee?: string;
  /** T08 : état du congé qui couvre la journée (`null` : pas un congé). */
  etatConge?: EtatPlageConge | null;
  /** T08 (R13) : arrivée pointée un jour de congé validé. */
  pointeEnConge?: boolean;
}

/** T08 (R13) : arrivée pointée un jour de congé validé, enregistrée normalement mais signalée. */
function BadgePointeEnConge({ visible }: { visible?: boolean }) {
  if (!visible) return null;
  return (
    <span data-pointe-en-conge>
      <Badge variant="warning" className="text-[10px]">
        Pointé pendant un congé
      </Badge>
    </span>
  );
}

const VARIANTE_ETAT_CONGE: Record<EtatPlageConge, "success" | "warning" | "neutral"> = {
  EN_CONGE: "success",
  EN_ATTENTE: "warning",
  PROTEGE: "neutral",
};

function BadgeJustification({ j }: { j?: JustificationAffichee }) {
  if (!j?.statut) return null;
  return (
    <Badge variant={VARIANTE_STATUT_JUSTIFICATION[j.statut]} className="text-[10px]">
      {j.libelle}
    </Badge>
  );
}

interface PresenceTabsProps {
  presents: PresenceData[];
  retards: PresenceData[];
  absents: PresenceData[];
  autorises: PresenceData[];
  manquants: PresenceData[];
}

type TabType = "presents" | "retards" | "absents" | "autorises" | "manquants";

/**
 * Liste compacte (mobile, < md), sans conteneur : une ligne par collaborateur (nom à gauche, valeur clé à droite) et une
 * seconde ligne discrète seulement quand il y a du détail (heures, justification, motif). Mêmes données que le tableau.
 */
function PresenceListeMobile({ data, tab }: { data: PresenceData[]; tab: TabType }) {
  if (data.length === 0) {
    return <p className="py-6 text-center text-sm text-muted-foreground">Aucun collaborateur dans cette liste.</p>;
  }
  const heure = (iso?: string) => (iso ? format(new Date(iso), "HH:mm") : null);
  return (
    <ul className="divide-y divide-border">
      {data.map((item) => {
        const arrivee = heure(item.arrivee);
        const depart = heure(item.depart);
        const aDesHeures = tab === "presents" || tab === "retards";
        const droite =
          tab === "retards" ? (
            <span className="font-bold text-primary tabular-nums">{item.minutesRetard ?? 0} min</span>
          ) : tab === "presents" ? (
            <span className="font-semibold tabular-nums text-foreground">
              {arrivee ?? "-"}
              {depart ? ` → ${depart}` : ""}
            </span>
          ) : tab === "autorises" ? (
            <span className="text-xs text-muted-foreground" data-etat-conge={item.etatConge ?? undefined}>
              {item.etatConge ? (
                <Badge variant={VARIANTE_ETAT_CONGE[item.etatConge]} className="text-[10px]">
                  {item.absenceAutorisee}
                </Badge>
              ) : (
                item.absenceAutorisee
              )}
            </span>
          ) : null;
        const details: React.ReactNode[] = [];
        if (tab === "retards") {
          details.push(
            <span key="h" className="tabular-nums">
              Arrivée {arrivee ?? "-"}
              {item.arriveePrevue ? ` (prévu ${item.arriveePrevue})` : ""}
              {depart ? ` · départ ${depart}` : ""}
            </span>,
          );
        }
        if (aDesHeures && item.justification?.statut) {
          details.push(
            <span key="j" className="inline-flex items-center gap-1">
              <BadgeJustification j={item.justification} />
              {item.justification.decideePar ? <span>par {item.justification.decideePar}</span> : null}
            </span>,
          );
        }
        if (aDesHeures && item.justificationDepart?.statut) {
          details.push(
            <span key="jd" className="inline-flex items-center gap-1">
              Départ : <BadgeJustification j={item.justificationDepart} />
            </span>,
          );
        }
        if (aDesHeures && item.pointeEnConge) details.push(<BadgePointeEnConge key="c" visible />);
        if (tab === "retards" && item.motif) {
          details.push(
            <span key="m" className="max-w-full truncate italic">
              Motif : {item.motif}
            </span>,
          );
        }
        return (
          <li key={item.userId} className="py-2.5">
            <div className="flex items-center justify-between gap-3">
              <p className="flex min-w-0 items-center gap-1.5 text-sm font-medium text-foreground">
                <span className="truncate">{item.fullName}</span>
                {item.sourceArrivee === "GEOLOCALISATION" ? (
                  <span className="shrink-0 rounded-full border border-primary/20 bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                    📍{item.geoDistance != null ? ` ${item.geoDistance}m` : " GPS"}
                  </span>
                ) : null}
              </p>
              {droite ? <div className="shrink-0 text-sm">{droite}</div> : null}
            </div>
            {details.length > 0 ? (
              <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">{details}</p>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

export function PresenceTabs({ presents, retards, absents, autorises, manquants }: PresenceTabsProps) {
  const [activeTab, setActiveTab] = useState<TabType>("presents");

  const tabs = [
    { id: "presents", label: "Présents", count: presents.length, icon: "check-circle" },
    { id: "retards", label: "Retardataires", count: retards.length, icon: "clock" },
    { id: "absents", label: "Absents", count: absents.length, icon: "x-circle" },
    { id: "autorises", label: "Absence autorisée", count: autorises.length, icon: "calendar" },
    { id: "manquants", label: "Manquants", count: manquants.length, icon: "help-circle" },
  ] as const;

  const renderContent = () => {
    let data: PresenceData[] = [];
    if (activeTab === "presents") data = presents;
    if (activeTab === "retards") data = retards;
    if (activeTab === "absents") data = absents;
    if (activeTab === "autorises") data = autorises;
    if (activeTab === "manquants") data = manquants;

    return (
      <>
      <div className="rounded-2xl border border-border bg-surface px-4 shadow-xs md:hidden">
        <PresenceListeMobile data={data} tab={activeTab} />
      </div>
      <Card className="hidden overflow-hidden md:block">
      <div className="overflow-x-auto">
        <table className="w-full text-xs text-left">
          <thead className="bg-muted text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">Collaborateur</th>
              {(activeTab === "presents" || activeTab === "retards") && (
                <th className="px-3 py-2 font-medium text-right">Heure d&apos;arrivée</th>
              )}
              {activeTab === "retards" && (
                <th className="px-3 py-2 font-medium text-right">Retard</th>
              )}
              {activeTab === "retards" && (
                <th className="px-3 py-2 font-medium text-right">Justification</th>
              )}
              {activeTab === "retards" && (
                <th className="px-3 py-2 font-medium text-right">Motif</th>
              )}
              {activeTab === "autorises" && (
                <th className="px-3 py-2 font-medium text-right">Absence autorisée</th>
              )}
              {(activeTab === "presents" || activeTab === "retards") && (
                <th className="px-3 py-2 font-medium text-right">Heure de départ</th>
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {data.map((item) => (
              <tr key={item.userId} className="hover:bg-muted/50 transition-colors">
                <td className="px-3 py-2">
                  <div className="flex items-center gap-1.5">
                    <div className="font-medium text-foreground">{item.fullName}</div>
                    <BadgePointeEnConge visible={(activeTab === "presents" || activeTab === "retards") && item.pointeEnConge} />
                    {item.sourceArrivee === "GEOLOCALISATION" && (
                      <span
                        title={item.geoDistance != null ? `Géolocalisé — ${item.geoDistance}m du bureau` : "Pointage géolocalisé"}
                        className="inline-flex items-center gap-0.5 rounded-full bg-blue-500/10 px-1.5 py-0.5 text-[10px] font-medium text-blue-600 dark:text-blue-400 border border-blue-500/20 cursor-default"
                      >
                        📍{item.geoDistance != null ? ` ${item.geoDistance}m` : " GPS"}
                      </span>
                    )}
                  </div>
                  <div className="text-[10px] text-muted-foreground">{item.email}</div>
                </td>
                {(activeTab === "presents" || activeTab === "retards") && (
                  <td className="px-3 py-2 text-right tabular-nums">
                    {item.arrivee ? (
                      <div className="flex flex-col items-end">
                        <span className="font-medium text-foreground text-[13px]">{format(new Date(item.arrivee), "HH:mm")}</span>
                        <span className="text-[10px] text-muted-foreground">Prévu : {item.arriveePrevue || "-"}</span>
                      </div>
                    ) : (
                      <span className="text-muted-foreground">-</span>
                    )}
                  </td>
                )}
                {activeTab === "retards" && (
                  <td className="px-3 py-2 text-right text-primary font-bold text-[13px]">
                    {item.minutesRetard} min
                  </td>
                )}
                {activeTab === "retards" && (
                  <td className="px-3 py-2 text-right" data-justification>
                    {item.justification?.statut ? (
                      <div className="flex flex-col items-end gap-0.5">
                        <BadgeJustification j={item.justification} />
                        {item.justification.decideePar ? (
                          <span className="text-[10px] text-muted-foreground">par {item.justification.decideePar}</span>
                        ) : null}
                      </div>
                    ) : (
                      <span className="text-muted-foreground">-</span>
                    )}
                  </td>
                )}
                {activeTab === "autorises" && (
                  <td className="px-3 py-2 text-right text-[11px] text-muted-foreground" data-etat-conge={item.etatConge ?? undefined}>
                    {item.etatConge ? (
                      <Badge variant={VARIANTE_ETAT_CONGE[item.etatConge]} className="text-[10px]">
                        {item.absenceAutorisee}
                      </Badge>
                    ) : (
                      item.absenceAutorisee
                    )}
                  </td>
                )}
                {activeTab === "retards" && (
                  <td className="px-3 py-2 text-right">
                    {item.motif ? (
                      <span className="truncate max-w-[150px] inline-block italic text-muted-foreground text-[11px]" title={item.motif}>
                        {item.motif}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">-</span>
                    )}
                  </td>
                )}
                {(activeTab === "presents" || activeTab === "retards") && (
                  <td className="px-3 py-2 text-right tabular-nums">
                    {item.depart ? (
                      <div className="flex flex-col items-end">
                        <span className="font-medium text-foreground text-[13px]">{format(new Date(item.depart), "HH:mm")}</span>
                        <span className="text-[10px] text-muted-foreground">Prévu : {item.departPrevu || "-"}</span>
                        <BadgeJustification j={item.justificationDepart} />
                      </div>
                    ) : (
                      <span className="text-muted-foreground">-</span>
                    )}
                  </td>
                )}
              </tr>
            ))}
            {data.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                  Aucun collaborateur dans cette liste.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      </Card>
      </>
    );
  };

  return (
    <div className="space-y-3 md:space-y-6">
      <div className="-mx-4 flex space-x-1 overflow-x-auto border-b border-border px-4 pb-1 md:mx-0 md:space-x-2 md:px-0 md:pb-2">
        {tabs.map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as TabType)}
              className={`flex shrink-0 items-center gap-2 whitespace-nowrap px-3 py-1.5 text-xs font-medium rounded-t-lg transition-colors border-b-2 md:px-4 md:py-2 md:text-sm ${isActive
                ? "border-primary text-primary bg-primary/5"
                : "border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/50"
                }`}
            >
              <Icon name={tab.icon as IconName} className="hidden size-4 md:block" />
              {tab.label}
              <span className="ml-1 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-bold text-muted-foreground md:ml-1.5 md:px-2 md:text-xs">
                {tab.count}
              </span>
            </button>
          );
        })}
      </div>
      {renderContent()}
    </div>
  );
}

