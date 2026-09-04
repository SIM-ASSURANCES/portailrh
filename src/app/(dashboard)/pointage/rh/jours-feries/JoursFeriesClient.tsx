"use client";

import { useState } from "react";
import { format } from "date-fns";
import { fr } from "date-fns/locale";
import { Calendar, Plus, Trash2, Wand2 } from "lucide-react";
import { toast } from "sonner";
import Holidays from "date-holidays";

import { ajouterJoursFeriesBatch, supprimerJourFerie } from "./actions";

type JourFerieDb = {
  id: string;
  date: Date;
  libelle: string;
};

export function JoursFeriesClient({ initialJoursFeries }: { initialJoursFeries: JourFerieDb[] }) {
  const [jours, setJours] = useState<JourFerieDb[]>(initialJoursFeries);
  const [loading, setLoading] = useState(false);
  const [newDate, setNewDate] = useState("");
  const [newLibelle, setNewLibelle] = useState("");

  const handleGenerate = async () => {
    setLoading(true);
    try {
      const annee = new Date().getFullYear();
      const hd = new Holidays("CI"); // Côte d'Ivoire
      const holidays = hd.getHolidays(annee);

      const batch = holidays.map(h => ({
        date: new Date(h.date),
        libelle: h.name
      }));

      const res = await ajouterJoursFeriesBatch(batch);
      if (res.status === "success") {
        toast.success(res.message);
        // Force refresh by reloading to get fresh data from server
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

  const handleDelete = async (id: string) => {
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
    <div className="space-y-6">
      {/* Barre d'action */}
      <div className="flex flex-col sm:flex-row gap-4 justify-between bg-white p-4 rounded-xl shadow-sm border border-slate-200">
        <form onSubmit={handleAddManual} className="flex flex-wrap gap-3 items-end">
          <div className="space-y-1">
            <label className="text-xs font-medium text-slate-500">Date</label>
            <input 
              type="date" 
              required
              value={newDate}
              onChange={e => setNewDate(e.target.value)}
              className="block w-full rounded-md border-slate-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm px-3 py-2 border"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-slate-500">Libellé</label>
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
            className="inline-flex items-center justify-center rounded-md bg-indigo-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 disabled:opacity-50"
          >
            <Plus className="h-4 w-4 mr-2" />
            Ajouter manuellement
          </button>
        </form>

        <div className="flex items-end">
          <button 
            onClick={handleGenerate}
            disabled={loading}
            className="inline-flex items-center justify-center rounded-md bg-white px-3 py-2 text-sm font-semibold text-slate-900 shadow-sm ring-1 ring-inset ring-slate-300 hover:bg-slate-50 disabled:opacity-50"
          >
            <Wand2 className="h-4 w-4 mr-2 text-indigo-500" />
            Générer l'année courante (CI)
          </button>
        </div>
      </div>

      {/* Liste des jours fériés */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200">
            <thead className="bg-slate-50">
              <tr>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">
                  Date
                </th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">
                  Libellé
                </th>
                <th scope="col" className="relative px-6 py-3">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-slate-200">
              {jours.length === 0 ? (
                <tr>
                  <td colSpan={3} className="px-6 py-12 text-center text-slate-500">
                    <Calendar className="mx-auto h-12 w-12 text-slate-300 mb-3" />
                    <p>Aucun jour férié enregistré.</p>
                  </td>
                </tr>
              ) : (
                jours.map((jour) => (
                  <tr key={jour.id} className="hover:bg-slate-50">
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-slate-900">
                      {format(new Date(jour.date), "EEEE d MMMM yyyy", { locale: fr })}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-500">
                      {jour.libelle}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                      <button 
                        onClick={() => handleDelete(jour.id)}
                        disabled={loading}
                        className="text-red-600 hover:text-red-900 bg-red-50 p-2 rounded-lg hover:bg-red-100 transition-colors"
                        title="Supprimer"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
