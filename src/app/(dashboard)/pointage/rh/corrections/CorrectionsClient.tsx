"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { DataTable, type DataTableColumn, Input, Button, Badge, Card, Textarea } from "@/components/ui";
import { Search, Pencil, AlertCircle, CheckCircle2 } from "lucide-react";
import { corrigerPointageAction } from "./actions";

export type PointageCorrectionRow = {
  id: string;
  heure: string;
  type: string;
  source: string;
  estRetard: boolean;
  minutesRetard: number | null;
  motif: string | null;
  collaborateurNom: string;
  collaborateurService: string | null;
  effectueParNom: string | null;
};

interface CorrectionsClientProps {
  initialData: PointageCorrectionRow[];
  search?: string;
}

export function CorrectionsClient({ initialData, search = "" }: CorrectionsClientProps) {
  const router = useRouter();
  const [searchTerm, setSearchTerm] = useState(search);
  const [selectedPointage, setSelectedPointage] = useState<PointageCorrectionRow | null>(null);
  const [nouvelleHeure, setNouvelleHeure] = useState("");
  const [motif, setMotif] = useState("");
  
  const [visibleCount, setVisibleCount] = useState(15);
  
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    router.push(`/pointage/rh/corrections?search=${encodeURIComponent(searchTerm)}`);
  };

  const handleEdit = (pointage: PointageCorrectionRow) => {
    setSelectedPointage(pointage);
    // Format to YYYY-MM-DDThh:mm for datetime-local input
    const date = new Date(pointage.heure);
    const tzOffset = date.getTimezoneOffset() * 60000; // offset in milliseconds
    const localISOTime = (new Date(date.getTime() - tzOffset)).toISOString().slice(0, -1);
    const inputFormat = localISOTime.substring(0, 16);
    
    setNouvelleHeure(inputFormat);
    setMotif("");
    setError(null);
    setSuccess(null);
  };

  const cancelEdit = () => {
    setSelectedPointage(null);
    setError(null);
    setSuccess(null);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPointage) return;
    
    setError(null);
    setSuccess(null);

    startTransition(async () => {
      const result = await corrigerPointageAction({
        pointageId: selectedPointage.id,
        nouvelleHeure,
        motif,
      });

      if (result.status === "error") {
        setError(result.message || "Erreur lors de la correction.");
      } else if (result.status === "success") {
        setSuccess(result.message || "Pointage corrigé.");
        setTimeout(() => {
          setSelectedPointage(null);
        }, 1500);
      }
    });
  };

  const columns: DataTableColumn<PointageCorrectionRow>[] = [
    {
      key: "collaborateur",
      header: "Collaborateur",
      render: (row) => (
        <div>
          <p className="font-semibold">{row.collaborateurNom}</p>
          {row.collaborateurService && (
            <p className="text-xs text-muted-foreground">{row.collaborateurService}</p>
          )}
        </div>
      ),
    },
    {
      key: "dateHeure",
      header: "Date et Heure",
      render: (row) => {
        const date = new Date(row.heure);
        return (
          <div className="flex flex-col">
            <span className="font-medium text-foreground">
              {date.toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" })}
            </span>
            <span className="text-xs text-muted-foreground">
              {date.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}
            </span>
          </div>
        );
      },
    },
    {
      key: "type",
      header: "Type",
      render: (row) => (
        <Badge variant={row.type === "ARRIVEE" ? "info" : "neutral"}>
          {row.type === "ARRIVEE" ? "Arrivée" : "Départ"}
        </Badge>
      ),
    },
    {
      key: "statut",
      header: "Statut",
      render: (row) => {
        if (row.type === "DEPART") {
          return row.motif ? (
            <div className="space-y-1">
              <Badge variant="warning">Départ anticipé</Badge>
              <p className="text-xs text-muted-foreground italic truncate max-w-xs">{row.motif}</p>
            </div>
          ) : (
            <span className="text-xs text-muted-foreground">Normal</span>
          );
        }
        if (row.estRetard) {
          return (
            <div className="space-y-1">
              <Badge variant="danger">Retard (+{row.minutesRetard}m)</Badge>
              {row.motif && <p className="text-xs text-muted-foreground italic truncate max-w-xs">{row.motif}</p>}
            </div>
          );
        }
        return <Badge variant="success">À l&apos;heure</Badge>;
      }
    },
    {
      key: "actions",
      header: "Actions",
      render: (row) => (
        <Button variant="secondary" onClick={() => handleEdit(row)}>
          <Pencil className="size-4 mr-1" />
          Corriger
        </Button>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      {selectedPointage ? (
        <Card className="max-w-2xl mx-auto border-primary/20">
          <div className="mb-4">
            <h2 className="text-lg font-bold text-slate-900">Corriger un pointage</h2>
            <p className="text-sm text-slate-500 mt-1">
              Vous corrigez le pointage de <span className="font-bold">{selectedPointage.collaborateurNom}</span> du {new Date(selectedPointage.heure).toLocaleDateString("fr-FR")} à {new Date(selectedPointage.heure).toLocaleTimeString("fr-FR", {hour: '2-digit', minute:'2-digit'})}.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-6">
            {error && (
              <div className="flex items-center gap-2 rounded-md bg-red-50 p-3 text-red-900 border border-red-200">
                <AlertCircle className="h-5 w-5 text-red-600" />
                <div className="text-sm font-medium">{error}</div>
              </div>
            )}

            {success && (
              <div className="flex items-center gap-2 rounded-md bg-emerald-50 p-3 text-emerald-900 border border-emerald-200">
                <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                <div className="text-sm font-medium">{success}</div>
              </div>
            )}

            <div className="bg-surface p-4 rounded-md border border-border/50 text-sm">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <span className="text-muted-foreground block mb-1">Type</span>
                  <Badge variant={selectedPointage.type === "ARRIVEE" ? "info" : "neutral"}>
                    {selectedPointage.type === "ARRIVEE" ? "Arrivée" : "Départ"}
                  </Badge>
                  <p className="text-xs text-muted-foreground mt-2">Le type ne peut pas être modifié.</p>
                </div>
                <div>
                  <Input
                    label="Nouvelle Date/Heure"
                    type="datetime-local"
                    required
                    value={nouvelleHeure}
                    onChange={(e) => setNouvelleHeure(e.target.value)}
                  />
                </div>
              </div>
            </div>

            <Textarea
              label="Motif de la correction"
              required
              placeholder="Ex: Oubli de pointage, régularisation suite erreur système..."
              value={motif}
              onChange={(e) => setMotif(e.target.value)}
              rows={3}
            />

            <div className="flex justify-end gap-3 pt-4 border-t border-border">
              <Button 
                type="button" 
                variant="secondary" 
                onClick={cancelEdit}
                disabled={isPending}
              >
                Annuler
              </Button>
              <Button type="submit" disabled={isPending}>
                {isPending ? "Enregistrement..." : "Enregistrer la correction"}
              </Button>
            </div>
          </form>
        </Card>
      ) : (
        <Card className="p-6">
          <form onSubmit={handleSearch} className="flex flex-col sm:flex-row gap-3 mb-6">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
              <Input
                type="text"
                placeholder="Rechercher par nom de collaborateur..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-9 w-full"
              />
            </div>
            <Button type="submit">Rechercher</Button>
            {search && (
              <Button type="button" variant="secondary" onClick={() => { setSearchTerm(""); router.push('/pointage/rh/corrections'); }}>
                Effacer
              </Button>
            )}
          </form>

          <DataTable
            rowKey={(row) => row.id}
            columns={columns}
            data={initialData.slice(0, visibleCount)}
            emptyMessage={search ? "Aucun pointage trouvé pour ce nom." : "Aucun pointage trouvé."}
          />
          
          {visibleCount < initialData.length && (
            <div className="flex justify-center mt-6 pt-4 border-t border-border">
              <Button variant="secondary" onClick={() => setVisibleCount((prev) => prev + 15)}>
                Voir plus de pointages ({initialData.length - visibleCount} restants)
              </Button>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
