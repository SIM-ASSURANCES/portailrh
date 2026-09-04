"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  format,
  startOfMonth,
  endOfMonth,
  eachDayOfInterval,
  isSameMonth,
  isSameDay,
  addMonths,
  subMonths,
  startOfWeek,
  endOfWeek,
  isWeekend
} from "date-fns";
import { fr } from "date-fns/locale";
import { ChevronLeft, ChevronRight, Calendar as CalendarIcon } from "lucide-react";
import { getJoursFeries } from "@/app/(dashboard)/pointage/rh/calendrier/actions";

type JourFerieDb = {
  id: string;
  date: Date;
  libelle: string;
};

export function TopbarCalendar({ isRH }: { isRH?: boolean }) {
  const [isOpen, setIsOpen] = useState(false);
  const [joursFeries, setJoursFeries] = useState<JourFerieDb[]>([]);
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const popoverRef = useRef<HTMLDivElement>(null);

  const prevMonth = () => setCurrentMonth(subMonths(currentMonth, 1));
  const nextMonth = () => setCurrentMonth(addMonths(currentMonth, 1));

  // Fermer le popover quand on clique en dehors
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isOpen]);

  // Charger les jours fériés quand on ouvre le calendrier pour la première fois
  useEffect(() => {
    if (isOpen && joursFeries.length === 0 && !loading) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- déclenche un chargement asynchrone (getJoursFeries) à l'ouverture du popover, pattern standard drapeau de chargement + fetch + drapeau final (même précédent que Topbar.tsx pour un cas d'usage différent)
      setLoading(true);
      getJoursFeries().then(res => {
        setJoursFeries(res);
      }).catch(err => {
        console.error("Erreur de chargement des jours fériés", err);
      }).finally(() => {
        setLoading(false);
      });
    }
  }, [isOpen, joursFeries.length, loading]);

  const monthStart = startOfMonth(currentMonth);
  const monthEnd = endOfMonth(monthStart);
  const startDate = startOfWeek(monthStart, { weekStartsOn: 1 });
  const endDate = endOfWeek(monthEnd, { weekStartsOn: 1 });
  const days = eachDayOfInterval({ start: startDate, end: endDate });
  const weekDays = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];

  return (
    <div className="relative" ref={popoverRef}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        aria-label="Calendrier Pointage"
        className="grid size-10 place-items-center rounded-lg border border-border text-muted-foreground transition-[background-color,transform] duration-150 ease-out-strong motion-safe:active:scale-[0.95] hover:bg-muted"
      >
        <CalendarIcon className="size-5" />
      </button>

      {isOpen && (
        <div className="absolute right-0 top-12 z-50 w-80 rounded-lg border border-border bg-white shadow-xl">
          <div className="flex items-center justify-between border-b border-border px-4 py-3 bg-slate-50/50 rounded-t-lg">
            <h2 className="text-sm font-semibold text-slate-900 capitalize">
              {format(currentMonth, "MMMM yyyy", { locale: fr })}
            </h2>
            <div className="flex items-center rounded-md shadow-sm">
              <button
                onClick={prevMonth}
                className="flex items-center justify-center rounded-l-md border border-slate-300 bg-white px-2 py-1 text-slate-500 hover:bg-slate-50 hover:text-slate-900 focus:z-10"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button
                onClick={() => setCurrentMonth(new Date())}
                className="border-t border-b border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 focus:z-10"
              >
                Auj.
              </button>
              <button
                onClick={nextMonth}
                className="flex items-center justify-center rounded-r-md border border-slate-300 bg-white px-2 py-1 text-slate-500 hover:bg-slate-50 hover:text-slate-900 focus:z-10"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>

          <div className="grid grid-cols-7 border-b border-border bg-slate-50">
            {weekDays.map(day => (
              <div key={day} className="py-2 text-center text-[10px] font-semibold text-slate-500 uppercase tracking-wider">
                {day}
              </div>
            ))}
          </div>

          <div className="grid grid-cols-7 bg-slate-200 gap-px p-px">
            {days.map((day) => {
              const jourFerie = joursFeries.find(j => isSameDay(new Date(j.date), day));
              const isWknd = isWeekend(day);
              const isCurrentMonth = isSameMonth(day, currentMonth);
              const isToday = isSameDay(day, new Date());
              const dateStr = format(day, "yyyy-MM-dd");

              return (
                <div
                  key={day.toString()}
                  onClick={() => {
                    if (isRH) {
                      setIsOpen(false);
                      router.push(`/pointage/rh/presence?date=${dateStr}`);
                    }
                  }}
                  className={`
                    relative flex h-10 w-full flex-col items-center justify-center bg-white transition-colors
                    ${isRH ? 'cursor-pointer' : 'cursor-default'}
                    ${!isCurrentMonth ? 'bg-slate-50 text-slate-300' : ''} 
                    ${isWknd ? 'bg-slate-50 hover:bg-slate-100' : (isRH ? 'hover:bg-indigo-50/50' : '')}
                  `}
                  title={jourFerie ? jourFerie.libelle : (isRH ? "Voir les présences" : undefined)}
                >
                  <span className={`
                    flex h-6 w-6 items-center justify-center rounded-full text-xs font-medium
                    ${isToday ? 'bg-indigo-600 text-white' : ''}
                    ${!isToday && jourFerie ? 'text-rose-600 font-bold' : ''}
                    ${!isToday && !jourFerie && isCurrentMonth ? 'text-slate-700' : ''}
                  `}>
                    {format(day, "d")}
                  </span>
                  {jourFerie && (
                    <div className="absolute bottom-1 h-1 w-1 rounded-full bg-rose-500" />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
