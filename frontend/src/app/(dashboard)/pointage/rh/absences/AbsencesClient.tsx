"use client";

import { useState, useTransition } from "react";
import { format } from "date-fns";
import { fr } from "date-fns/locale";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/icons";
import { useRouter } from "next/navigation";
import { traiterAbsence } from "./actions";
import { StatutAbsence } from "backend/client";
import { Select } from "@/components/ui/Select";
import { Textarea } from "@/components/ui/Textarea";
import { toast } from "sonner";

type AbsenceWithUser = {
  id: string;
  date: Date;
  statut: StatutAbsence;
  motif: string | null;
  user: {
    id: string;
    fullName: string;
    email: string;
  };
  controlePar: {
    id: string;
    fullName: string;
  } | null;
};

export function AbsencesClient({
  initialAbsences,
  defaultDebut,
  defaultFin,
  nbFiltresActifs,
}: {
  initialAbsences: AbsenceWithUser[];
  defaultDebut: string;
  defaultFin: string;
  /** Nombre de bornes de période posées dans l'URL (0 = période par défaut, le mois en cours). */
  nbFiltresActifs: number;
}) {
  const router = useRouter();
  const [debut, setDebut] = useState(defaultDebut);
  const [fin, setFin] = useState(defaultFin);
  const [isPending, startTransition] = useTransition();
  const [selectedAbsence, setSelectedAbsence] = useState<AbsenceWithUser | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [nouveauStatut, setNouveauStatut] = useState<StatutAbsence>("JUSTIFIEE");
  const [motif, setMotif] = useState("");
  // Mobile : panneau de filtres replié par défaut (la liste prime), ouvert si une période est déjà appliquée.
  const [filtresOuverts, setFiltresOuverts] = useState(nbFiltresActifs > 0);

  const handleSearch = () => {
    startTransition(() => {
      router.push(`/pointage/rh/absences?debut=${debut}&fin=${fin}`);
    });
  };

  const openTraitementModal = (absence: AbsenceWithUser) => {
    setSelectedAbsence(absence);
    setNouveauStatut("JUSTIFIEE");
    setMotif("");
    setIsModalOpen(true);
  };

  const closeTraitementModal = () => {
    setIsModalOpen(false);
    setSelectedAbsence(null);
  };

  const handleTraiter = () => {
    if (!selectedAbsence) return;

    if (!motif.trim()) {
      toast.error("Le motif est obligatoire");
      return;
    }

    startTransition(async () => {
      const result = await traiterAbsence(selectedAbsence.id, nouveauStatut, motif);
      if (result.status === "success") {
        toast.success(result.message);
        closeTraitementModal();
      } else {
        toast.error(result.message);
      }
    });
  };

  return (
    <div className="space-y-3 md:space-y-6">
      <div className="md:hidden">
        <button
          type="button"
          onClick={() => setFiltresOuverts((o) => !o)}
          aria-expanded={filtresOuverts}
          className="flex w-full items-center justify-between rounded-lg border border-border bg-surface px-3 py-2 text-sm font-medium text-foreground"
        >
          <span className="inline-flex items-center gap-2">
            <Icon name="calendar" className="size-4 text-primary" />
            Filtres
            {nbFiltresActifs > 0 ? (
              <span className="rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-bold leading-none text-primary-foreground">{nbFiltresActifs}</span>
            ) : null}
          </span>
          <span className="inline-flex items-center gap-2 text-xs text-muted-foreground">
            {format(new Date(defaultDebut), "dd/MM", { locale: fr })} – {format(new Date(defaultFin), "dd/MM", { locale: fr })}
            <Icon name="chevron-down" className={`size-4 transition-transform ${filtresOuverts ? "rotate-180" : ""}`} />
          </span>
        </button>
      </div>

      <div className={`${filtresOuverts ? "grid" : "hidden"} grid-cols-2 items-end gap-3 md:flex md:flex-wrap md:gap-4 md:rounded-xl md:border md:border-border md:bg-surface md:p-4`}>
        <div className="space-y-1">
          <label className="text-sm font-medium text-slate-700">Date de début</label>
          <input
            type="date"
            value={debut}
            onChange={(e) => setDebut(e.target.value)}
            className="block w-full rounded-md border-slate-300 shadow-sm focus:border-primary focus:ring-primary sm:text-sm px-3 py-2 border"
          />
        </div>
        <div className="space-y-1">
          <label className="text-sm font-medium text-slate-700">Date de fin</label>
          <input
            type="date"
            value={fin}
            onChange={(e) => setFin(e.target.value)}
            className="block w-full rounded-md border-slate-300 shadow-sm focus:border-primary focus:ring-primary sm:text-sm px-3 py-2 border"
          />
        </div>
        <Button onClick={handleSearch} disabled={isPending} className="col-span-2 md:col-span-1">
          {isPending ? "Recherche..." : "Rechercher"}
        </Button>
      </div>

      <div className="rounded-2xl border border-border bg-surface p-3 shadow-xs md:hidden">
        <h2 className="mb-1 flex items-center gap-2 text-sm font-bold text-foreground">
          <Icon name="alert-triangle" className="size-4 text-primary" />
          Absences ({initialAbsences.length})
        </h2>
        {initialAbsences.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Aucune absence enregistrée.</p>
        ) : (
          <ul className="divide-y divide-border">
            {initialAbsences.map((absence) => (
              <li key={absence.id} className="py-2.5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-foreground">{absence.user.fullName}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">{format(new Date(absence.date), "EEE dd MMM yyyy", { locale: fr })}</p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1.5">
                    {absence.statut === "A_CONTROLER" && <Badge variant="neutral">À contrôler</Badge>}
                    {absence.statut === "JUSTIFIEE" && <Badge variant="info">Justifiée</Badge>}
                    {absence.statut === "CONFIRMEE" && <Badge variant="primary">Confirmée</Badge>}
                    {absence.statut === "A_CONTROLER" && (
                      <Button variant="secondary" onClick={() => openTraitementModal(absence)} className="px-3! py-1.5! text-xs!">
                        Traiter
                      </Button>
                    )}
                  </div>
                </div>
                {absence.motif ? (
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    <span className="italic">{absence.motif}</span>
                    {absence.controlePar ? <span> · par {absence.controlePar.fullName}</span> : null}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>

      <Card className="hidden overflow-hidden md:block">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-muted/50 text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">Date</th>
                <th className="px-4 py-3 font-medium">Collaborateur</th>
                <th className="px-4 py-3 font-medium">Statut</th>
                <th className="px-4 py-3 font-medium">Motif & Contrôle</th>
                <th className="px-4 py-3 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {initialAbsences.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                    Aucune absence enregistrée.
                  </td>
                </tr>
              ) : (
                initialAbsences.map((absence) => (
                  <tr key={absence.id} className="hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-3 whitespace-nowrap font-medium">
                      {format(new Date(absence.date), "dd MMM yyyy", { locale: fr })}
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-foreground">
                        {absence.user.fullName}
                      </div>
                      <div className="text-xs text-muted-foreground">{absence.user.email}</div>
                    </td>
                    <td className="px-4 py-3">
                      {absence.statut === "A_CONTROLER" && <Badge variant="neutral">À Contrôler</Badge>}
                      {absence.statut === "JUSTIFIEE" && <Badge variant="info">Justifiée</Badge>}
                      {absence.statut === "CONFIRMEE" && <Badge variant="primary">Absence Confirmée</Badge>}
                    </td>
                    <td className="px-4 py-3">
                      {absence.motif ? (
                        <div>
                          <p className="text-sm text-foreground line-clamp-1" title={absence.motif}>
                            {absence.motif}
                          </p>
                          {absence.controlePar && (
                            <p className="text-xs text-muted-foreground mt-0.5">
                              Par {absence.controlePar.fullName}
                            </p>
                          )}
                        </div>
                      ) : (
                        <span className="text-muted-foreground italic">-</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {absence.statut === "A_CONTROLER" && (
                        <Button
                          variant="secondary"
                          onClick={() => openTraitementModal(absence)}
                        >
                          Traiter
                        </Button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Modal Overlay */}
      {isModalOpen && selectedAbsence && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
          <Card className="w-full max-w-md p-4 shadow-xl animate-in fade-in zoom-in-95 duration-200 sm:p-6">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-bold">Traiter l&apos;absence</h3>
              <button
                onClick={closeTraitementModal}
                className="text-muted-foreground hover:text-foreground transition-colors p-1"
              >
                <Icon name="x" className="size-5" />
              </button>
            </div>

            <div className="space-y-4 mb-6">
              <div className="p-3 bg-muted rounded-lg text-sm">
                <p><strong>Collaborateur :</strong> {selectedAbsence.user.fullName}</p>
                <p><strong>Date :</strong> {format(new Date(selectedAbsence.date), "dd MMMM yyyy", { locale: fr })}</p>
              </div>

              <div className="space-y-1">
                <label className="text-sm font-medium">Nouveau statut</label>
                <Select
                  value={nouveauStatut}
                  onChange={(e) => setNouveauStatut(e.target.value as StatutAbsence)}
                  options={[
                    { value: "JUSTIFIEE", label: "Absence Justifiée (ex: Congé, Maladie)" },
                    { value: "CONFIRMEE", label: "Absence Injustifiée (Confirmée)" },
                  ]}
                />
              </div>

              <div className="space-y-1">
                <label className="text-sm font-medium">Motif <span className="text-destructive">*</span></label>
                <Textarea
                  value={motif}
                  onChange={(e) => setMotif(e.target.value)}
                  placeholder="Expliquez la raison (ex: Arrêt maladie reçu, Oubli de badge, etc.)"
                  rows={3}
                  required
                />
              </div>
            </div>

            <div className="flex justify-end gap-3">
              <Button variant="secondary" onClick={closeTraitementModal}>
                Annuler
              </Button>
              <Button onClick={handleTraiter} disabled={isPending}>
                {isPending ? "Enregistrement..." : "Confirmer"}
              </Button>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
