"use client";

import { useState } from "react";
import { format } from "date-fns";
import { Card } from "@/components/ui/Card";
import { Icon } from "@/components/icons";

export interface PresenceData {
  userId: string;
  fullName: string;
  email: string;
  arrivee?: string;
  arriveePrevue?: string | null;
  depart?: string;
  departPrevu?: string | null;
  estRetard?: boolean;
  minutesRetard?: number | null;
}

interface PresenceTabsProps {
  presents: PresenceData[];
  retards: PresenceData[];
  absents: PresenceData[];
  manquants: PresenceData[];
}

type TabType = "presents" | "retards" | "absents" | "manquants";

export function PresenceTabs({ presents, retards, absents, manquants }: PresenceTabsProps) {
  const [activeTab, setActiveTab] = useState<TabType>("presents");

  const tabs = [
    { id: "presents", label: "Présents", count: presents.length, icon: "check-circle" },
    { id: "retards", label: "Retardataires", count: retards.length, icon: "clock" },
    { id: "absents", label: "Absents", count: absents.length, icon: "x-circle" },
    { id: "manquants", label: "Manquants", count: manquants.length, icon: "help-circle" },
  ] as const;

  const renderContent = () => {
    let data: PresenceData[] = [];
    if (activeTab === "presents") data = presents;
    if (activeTab === "retards") data = retards;
    if (activeTab === "absents") data = absents;
    if (activeTab === "manquants") data = manquants;

    return (
      <div className="overflow-x-auto">
        <table className="w-full text-sm text-left">
          <thead className="bg-muted text-muted-foreground">
            <tr>
              <th className="px-4 py-3 font-medium">Collaborateur</th>
              {(activeTab === "presents" || activeTab === "retards") && (
                <th className="px-4 py-3 font-medium text-right">Heure d'arrivée</th>
              )}
              {activeTab === "retards" && (
                <th className="px-4 py-3 font-medium text-right">Retard</th>
              )}
              {(activeTab === "presents" || activeTab === "retards") && (
                <th className="px-4 py-3 font-medium text-right">Heure de départ</th>
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {data.map((item) => (
              <tr key={item.userId} className="hover:bg-muted/50 transition-colors">
                <td className="px-4 py-3">
                  <div className="font-medium text-foreground">{item.fullName}</div>
                  <div className="text-xs text-muted-foreground">{item.email}</div>
                </td>
                {(activeTab === "presents" || activeTab === "retards") && (
                  <td className="px-4 py-3 text-right tabular-nums">
                    {item.arrivee ? (
                      <div className="flex flex-col items-end">
                        <span className="font-medium text-foreground">{format(new Date(item.arrivee), "HH:mm")}</span>
                        <span className="text-[10px] text-muted-foreground">Prévu : {item.arriveePrevue || "-"}</span>
                      </div>
                    ) : (
                      <span className="text-muted-foreground">-</span>
                    )}
                  </td>
                )}
                {activeTab === "retards" && (
                  <td className="px-4 py-3 text-right text-amber-600 font-bold">
                    {item.minutesRetard} min
                  </td>
                )}
                {(activeTab === "presents" || activeTab === "retards") && (
                  <td className="px-4 py-3 text-right tabular-nums">
                    {item.depart ? (
                      <div className="flex flex-col items-end">
                        <span className="font-medium text-foreground">{format(new Date(item.depart), "HH:mm")}</span>
                        <span className="text-[10px] text-muted-foreground">Prévu : {item.departPrevu || "-"}</span>
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
                <td colSpan={4} className="px-4 py-8 text-center text-muted-foreground">
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
              className={`flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-t-lg transition-colors border-b-2 ${
                isActive
                  ? "border-primary text-primary bg-primary/5"
                  : "border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/50"
              }`}
            >
              <Icon name={tab.icon as any} className="size-4" />
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
