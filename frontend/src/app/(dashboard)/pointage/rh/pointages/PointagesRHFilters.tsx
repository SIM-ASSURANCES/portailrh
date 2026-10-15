"use client";

import { useState } from "react";
import { Button, Input, Select } from "@/components/ui";
import { Icon } from "@/components/icons";

export interface PointagesRHFiltersInitial {
  du?: string;
  au?: string;
  type?: string;
  userId?: string;
}

export function PointagesRHFilters({
  initial,
  users,
}: {
  initial: PointagesRHFiltersInitial;
  users: { id: string; fullName: string }[];
}) {
  const [du, setDu] = useState(initial.du ?? "");
  const [au, setAu] = useState(initial.au ?? "");
  const [userId, setUserId] = useState(initial.userId ?? "");
  // Mobile : panneau replié par défaut (la liste prime), ouvert si des filtres sont déjà appliqués.
  const nbFiltresActifs = [initial.du, initial.au, initial.userId, initial.type && initial.type !== "ALL" ? initial.type : ""].filter(Boolean).length;
  const [ouvert, setOuvert] = useState(nbFiltresActifs > 0);

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

  const userOptions = [
    { value: "", label: "Tous les collaborateurs" },
    ...users.map((u) => ({ value: u.id, label: u.fullName })),
  ];

  return (
    <div className="space-y-3 md:space-y-0 md:rounded-xl md:border md:border-border md:bg-surface md:p-5 md:shadow-xs">
      <button
        type="button"
        onClick={() => setOuvert((o) => !o)}
        aria-expanded={ouvert}
        className="flex w-full items-center justify-between rounded-lg border border-border bg-surface px-3 py-2 text-sm font-medium text-foreground md:hidden"
      >
        <span className="inline-flex items-center gap-2">
          <Icon name="calendar" className="size-4 text-primary" />
          Filtres
          {nbFiltresActifs > 0 ? (
            <span className="rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-bold leading-none text-primary-foreground">{nbFiltresActifs}</span>
          ) : null}
        </span>
        <Icon name="chevron-down" className={`size-4 text-muted-foreground transition-transform ${ouvert ? "rotate-180" : ""}`} />
      </button>

      <div className={`${ouvert ? "block" : "hidden"} space-y-3 md:block md:space-y-4`}>
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

      <form method="get" className="grid grid-cols-2 items-end gap-3 lg:grid-cols-5">
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
          name="userId"
          label="Collaborateur"
          value={userId}
          onChange={(e) => setUserId(e.target.value)}
          options={userOptions}
        />
        </div>
        <div className="col-span-2 lg:col-span-1">
        <Select
          name="type"
          label="Type de pointage"
          defaultValue={initial.type ?? "ALL"}
          options={[
            { value: "ALL", label: "Tous les pointages" },
            { value: "ARRIVEE", label: "Arrivées uniquement" },
            { value: "DEPART", label: "Départs uniquement" },
            { value: "RETARD", label: "Retards uniquement" },
          ]}
        />
        </div>
        <div className="col-span-2 flex gap-2 lg:col-span-1">
          <Button type="submit" variant="primary" className="flex-1">
            Filtrer
          </Button>
          <a
            href="/pointage/rh/pointages"
            className="inline-flex items-center justify-center rounded-lg border border-border bg-surface px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            title="Réinitialiser les filtres"
          >
            <Icon name="rotate-ccw" className="size-4" />
          </a>
        </div>
      </form>
      </div>
    </div>
  );
}
