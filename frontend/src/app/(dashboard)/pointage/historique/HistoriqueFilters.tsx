"use client";

import { useState } from "react";
import { Button, Input, Select } from "@/components/ui";
import { Icon } from "@/components/icons";

export interface HistoriqueFiltersInitial {
  du?: string;
  au?: string;
  type?: string;
  vue?: string;
}

export function HistoriqueFilters({ initial }: { initial: HistoriqueFiltersInitial }) {
  const [du, setDu] = useState(initial.du ?? "");
  const [au, setAu] = useState(initial.au ?? "");

  const setPreset = (preset: "today" | "week" | "month" | "all") => {
    const today = new Date();
    const todayStr = today.toISOString().split("T")[0];

    if (preset === "today") {
      setDu(todayStr);
      setAu(todayStr);
    } else if (preset === "week") {
      const startOfWeek = new Date(today);
      const day = startOfWeek.getDay();
      const diff = startOfWeek.getDate() - day + (day === 0 ? -6 : 1); // Lundi
      startOfWeek.setDate(diff);
      setDu(startOfWeek.toISOString().split("T")[0]);
      setAu(todayStr);
    } else if (preset === "month") {
      const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
      setDu(startOfMonth.toISOString().split("T")[0]);
      setAu(todayStr);
    } else if (preset === "all") {
      setDu("");
      setAu("");
    }
  };

  return (
    <div className="space-y-3 md:space-y-4 md:rounded-xl md:border md:border-border md:bg-surface md:p-5 md:shadow-xs">
      {/* Raccourcis rapides de période */}
      <div className="flex flex-wrap items-center justify-between gap-2 md:border-b md:border-border md:pb-3">
        <div className="hidden items-center gap-2 text-xs font-semibold text-muted-foreground uppercase tracking-wide md:flex">
          <Icon name="calendar" className="size-4 text-primary" />
          <span>Période rapide :</span>
        </div>
        <div className="-mx-4 flex flex-nowrap gap-1.5 overflow-x-auto px-4 pb-0.5 md:mx-0 md:flex-wrap md:overflow-visible md:px-0">
          <button
            type="button"
            onClick={() => setPreset("today")}
            className="shrink-0 whitespace-nowrap rounded-md bg-muted px-2.5 py-1 text-xs font-medium text-foreground transition-colors hover:bg-primary/10 hover:text-primary active:scale-95"
          >
            Aujourd&apos;hui
          </button>
          <button
            type="button"
            onClick={() => setPreset("week")}
            className="shrink-0 whitespace-nowrap rounded-md bg-muted px-2.5 py-1 text-xs font-medium text-foreground transition-colors hover:bg-primary/10 hover:text-primary active:scale-95"
          >
            Cette semaine
          </button>
          <button
            type="button"
            onClick={() => setPreset("month")}
            className="shrink-0 whitespace-nowrap rounded-md bg-muted px-2.5 py-1 text-xs font-medium text-foreground transition-colors hover:bg-primary/10 hover:text-primary active:scale-95"
          >
            Ce mois-ci
          </button>
          <button
            type="button"
            onClick={() => setPreset("all")}
            className="shrink-0 whitespace-nowrap rounded-md bg-muted px-2.5 py-1 text-xs font-medium text-foreground transition-colors hover:bg-primary/10 hover:text-primary active:scale-95"
          >
            Tout afficher
          </button>
        </div>
      </div>

      {/* Formulaire de filtres en GET */}
      <form method="get" className="grid grid-cols-2 items-end gap-3 lg:grid-cols-4">
        <Input
          type="date"
          name="du"
          label="Date de début"
          value={du}
          onChange={(e) => setDu(e.target.value)}
        />
        <Input
          type="date"
          name="au"
          label="Date de fin"
          value={au}
          onChange={(e) => setAu(e.target.value)}
        />
        <div className="col-span-2 lg:col-span-1">
        <Select
          name="type"
          label="Type de filtre"
          defaultValue={initial.type ?? "ALL"}
          options={[
            { value: "ALL", label: "Tous les événements" },
            { value: "ARRIVEE", label: "Arrivées uniquement" },
            { value: "DEPART", label: "Départs uniquement" },
            { value: "RETARD", label: "Retards uniquement" },
            { value: "ABSENCE", label: "Absences uniquement" },
          ]}
        />
        </div>
        <div className="col-span-2 flex gap-2 lg:col-span-1">
          <Button type="submit" variant="primary" className="flex-1">
            Filtrer
          </Button>
          <a
            href="/pointage/historique"
            className="inline-flex items-center justify-center rounded-lg border border-border bg-surface px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            title="Réinitialiser les filtres"
          >
            <Icon name="rotate-ccw" className="size-4" />
          </a>
        </div>
      </form>
    </div>
  );
}
