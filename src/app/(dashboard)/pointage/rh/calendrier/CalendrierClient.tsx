"use client";

import { useState } from "react";
import Link from "next/link";
import { format } from "date-fns";
import { fr } from "date-fns/locale";
import { Plus, Trash2, Wand2 } from "lucide-react";
import { toast } from "sonner";
import Holidays from "date-holidays";

import { ajouterJoursFeriesBatch, supprimerJourFerie } from "./actions";
import { Card } from "@/components/ui/Card";

type JourFerieDb = {
  id: string;
  date: Date;
  libelle: string;
};

export function CalendrierClient({ initialJoursFeries }: { initialJoursFeries: JourFerieDb[] }) {
  const [jours, setJours] = useState<JourFerieDb[]>(initialJoursFeries);
  const [loading, setLoading] = useState(false);

  // Formulaire d'ajout
  const [newDate, setNewDate] = useState("");
  const [newLibelle, setNewLibelle] = useState("");

  const handleGenerate = async () => {
    setLoading(true);
    try {
      const annee = new Date().getFullYear();
      const hd = new Holidays("CI");
      const holidays = hd.getHolidays(annee);

      const batch = holidays.map(h => ({
        date: new Date(h.date),
        libelle: h.name
      }));

      const res = await ajouterJoursFeriesBatch(batch);
      if (res.status === "success") {
        toast.success(res.message);
        window.location.reload();
      } else {
        toast.error(res.message);
      }
    } catch (err) {
      toast.error("Erreur lors de la génération");
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleAddManual = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newDate || !newLibelle) return;

    setLoading(true);
    try {
      const batch = [{
        date: new Date(newDate),
        libelle: newLibelle
      }];
      const res = await ajouterJoursFeriesBatch(batch);
      if (res.status === "success") {
        toast.success(res.message);
        setNewDate("");
        setNewLibelle("");
        window.location.reload();
      } else {
        toast.error(res.message);
      }
    } catch (err) {
      toast.error("Erreur lors de l'ajout");
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!confirm("Voulez-vous vraiment supprimer ce jour férié ?")) return;

    setLoading(true);
    try {
      const res = await supprimerJourFerie(id);
      if (res.status === "success") {
        toast.success(res.message);
        setJours(jours.filter(j => j.id !== id));
      } else {
        toast.error(res.message);
      }
    } catch (err) {
      toast.error("Erreur lors de la suppression");
    } finally {
      setLoading(false);
    }
  };



  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      {/* Panneau d'administration */}
      <Card className="p-6 bg-white shadow-sm border-border flex flex-col sm:flex-row gap-6 justify-between items-start sm:items-end">
        <form onSubmit={handleAddManual} className="flex flex-wrap gap-4 items-end w-full sm:w-auto">
          <div className="space-y-1.5 flex-1 min-w-[200px]">
            <label className="text-sm font-medium text-slate-700">Ajouter une date</label>
            <input
              type="date"
              required
              value={newDate}
              onChange={e => setNewDate(e.target.value)}
              className="block w-full rounded-md border-slate-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm px-3 py-2 border"
            />
          </div>
          <div className="space-y-1.5 flex-1 min-w-[200px]">
            <label className="text-sm font-medium text-slate-700">Libellé</label>
            <input
              type="text"
              required
              placeholder="Ex: Tabaski"
              value={newLibelle}
              onChange={e => setNewLibelle(e.target.value)}
              className="block w-full rounded-md border-slate-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm px-3 py-2 border"
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="inline-flex h-[38px] items-center justify-center rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 disabled:opacity-50"
          >
            <Plus className="h-4 w-4 sm:mr-2" />
            <span className="hidden sm:inline">Ajouter</span>
          </button>
        </form>

        <button
          onClick={handleGenerate}
          disabled={loading}
          className="inline-flex h-[38px] items-center justify-center rounded-md bg-white px-4 py-2 text-sm font-semibold text-slate-900 shadow-sm ring-1 ring-inset ring-slate-300 hover:bg-slate-50 disabled:opacity-50"
        >
          <Wand2 className="h-4 w-4 mr-2 text-indigo-500" />
          Générer {new Date().getFullYear()} (CI)
        </button>
      </Card>

      {/* Liste des Jours Fériés */}
      <Card className="overflow-hidden bg-white shadow-sm border-border">
        <div className="px-6 py-4 border-b border-border bg-slate-50/50">
          <h2 className="text-lg font-semibold text-slate-900">Jours fériés enregistrés</h2>
        </div>
        
        {jours.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground">
            Aucun jour férié enregistré pour le moment.
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {jours.map((jour) => (
              <li key={jour.id} className="flex items-center justify-between px-6 py-4 hover:bg-slate-50/50 transition-colors">
                <div className="flex flex-col">
                  <span className="font-semibold text-foreground">{jour.libelle}</span>
                  <span className="text-sm text-muted-foreground">
                    {format(new Date(jour.date), "EEEE d MMMM yyyy", { locale: fr })}
                  </span>
                </div>
                <button
                  onClick={(e) => handleDelete(jour.id, e)}
                  className="p-2 text-rose-500 hover:bg-rose-50 rounded-md transition-colors"
                  title="Supprimer ce jour férié"
                >
                  <Trash2 className="h-5 w-5" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
