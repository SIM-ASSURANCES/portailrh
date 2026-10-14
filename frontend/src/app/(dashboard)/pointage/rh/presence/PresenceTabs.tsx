"use client";

import { useState } from "react";
import { format } from "date-fns";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui";
import { Icon, type IconName } from "@/components/icons";
import { VARIANTE_STATUT_JUSTIFICATION } from "@/components/pointage/justificationStatut";
import type { JustificationAffichee } from "backend";

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
  /** Absence autorisée couvrant la journée (« Congé 00:00–23:59 »). */
  absenceAutorisee?: string;
}

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
                  <td className="px-3 py-2 text-right text-[11px] text-muted-foreground">{item.absenceAutorisee}</td>
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
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex space-x-2 border-b border-border overflow-x-auto pb-2">
        {tabs.map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as TabType)}
              className={`flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-t-lg transition-colors border-b-2 ${isActive
                ? "border-primary text-primary bg-primary/5"
                : "border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/50"
                }`}
            >
              <Icon name={tab.icon as IconName} className="size-4" />
              {tab.label}
              <span className="ml-1.5 rounded-full bg-muted px-2 py-0.5 text-xs font-bold text-muted-foreground">
                {tab.count}
              </span>
            </button>
          );
        })}
      </div>
      <Card className="overflow-hidden">
        {renderContent()}
      </Card>
    </div>
  );
}

