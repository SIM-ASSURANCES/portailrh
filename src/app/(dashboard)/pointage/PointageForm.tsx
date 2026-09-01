// "use client";

// import { useActionState, useState, useEffect } from "react";
// import { Badge, Button, Select, Textarea } from "@/components/ui";
// import { useActionFeedback } from "@/lib/hooks/useActionFeedback";
// import { IDLE_ACTION_STATE, type ActionState } from "@/lib/validation";
// import type { ParametrageHoraire, Pointage } from "@/generated/prisma/client";
// import { Icon } from "@/components/icons";
// import { enregistrerPointageAction, type PointageSuccessData } from "./actions";
// import type { PointageDevice } from "@/lib/pointage-utils";

// interface PointageFormProps {
//   config: ParametrageHoraire;
//   todayPointages: Pointage[];
//   isQrSource: boolean;
//   device: PointageDevice;
// }

// export function PointageForm({ config, todayPointages, isQrSource, device }: PointageFormProps) {
//   const [state, formAction, isPending] = useActionState<ActionState<PointageSuccessData>, FormData>(
//     enregistrerPointageAction,
//     IDLE_ACTION_STATE
//   );
//   useActionFeedback(state);
  
//   const [pointageType, setPointageType] = useState<"ARRIVEE" | "DEPART">(
//     todayPointages.some((p) => p.type === "ARRIVEE") ? "DEPART" : "ARRIVEE"
//   );
//   const [currentTime, setCurrentTime] = useState<Date | null>(() => new Date());

//   // Mettre à jour l'heure chaque seconde après hydratation
//   useEffect(() => {
//     const interval = setInterval(() => {
//       setCurrentTime(new Date());
//     }, 1000);
//     return () => clearInterval(interval);
//   }, []);

//   const hasArrival = todayPointages.some((pointage) => pointage.type === "ARRIVEE");
//   const hasDeparture = todayPointages.some((pointage) => pointage.type === "DEPART");
//   const isComplete = hasArrival && hasDeparture;
//   const successData = state.status === "success" ? state.data : undefined;
//   const recordedAt = successData?.recordedAt
//     ? new Date(successData.recordedAt).toLocaleString("fr-FR", {
//         day: "2-digit",
//         month: "2-digit",
//         year: "numeric",
//         hour: "2-digit",
//         minute: "2-digit",
//       })
//     : null;

//   const arrivalTime = todayPointages.find((p) => p.type === "ARRIVEE")?.heure;
//   const departureTime = todayPointages.find((p) => p.type === "DEPART")?.heure;

//   // Vérifier si le départ est avant l'heure prévue (uniquement après hydratation)
//   let isDepartEarlyTime = false;
//   if (currentTime) {
//     const [finHeure, finMinute] = config.heureFinApresMidi.split(":").map(Number);
//     const finDate = new Date(currentTime);
//     finDate.setHours(finHeure, finMinute, 0, 0);
//     isDepartEarlyTime = currentTime < finDate;
//   }
//   const isMotifRequiredForEarlyDeparture = pointageType === "DEPART" && isDepartEarlyTime && hasArrival;

//   return (
//     <form action={formAction} className="space-y-4">
//       {/* Banneau QR Code */}
//       {isQrSource ? (
//         <div className="flex items-center gap-3 rounded-lg bg-gradient-to-r from-sim-blue-dark to-sim-blue-light p-4 text-white shadow-md">
//           <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-white/20">
//             <Icon name="qr-code" className="size-5" />
//           </div>
//           <div>
//             <p className="font-bold text-sm">Pointage par QR code</p>
//             <p className="text-xs text-white/80">Votre présence sera enregistrée immédiatement</p>
//           </div>
//         </div>
//       ) : null}

//       {/* Statut du jour */}
//       <div className="rounded-lg border border-border bg-gradient-to-br from-surface to-muted p-4">
//         <div className="flex items-start justify-between gap-4 mb-4">
//           <div>
//             <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Aujourd&apos;hui</p>
//             <h2 className="mt-1 text-base font-bold text-foreground">Votre présence</h2>
//           </div>
//           <Badge variant={isComplete ? "success" : hasArrival ? "info" : "warning"}>
//             {isComplete ? "Complète" : hasArrival ? "Arrivée" : "En attente"}
//           </Badge>
//         </div>

//         {/* Grille Arrivée/Départ */}
//         <div className="grid grid-cols-2 gap-3">
//           <div className={`rounded-lg p-4 transition-all ${
//             arrivalTime 
//               ? "bg-success-bg border border-success-border" 
//               : "bg-muted border border-border"
//           }`}>
//             <div className="flex items-center gap-2 mb-1">
//               <Icon name="clock" className={`size-4 ${arrivalTime ? "text-success" : "text-muted-foreground"}`} />
//               <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Arrivée</p>
//             </div>
//             <p className="text-2xl font-bold text-foreground">
//               {arrivalTime?.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }) ?? "--:--"}
//             </p>
//             {arrivalTime && successData?.minutesRetard ? (
//               <p className="mt-1 text-xs text-warning">+{successData.minutesRetard} min de retard</p>
//             ) : null}
//           </div>

//           <div className={`rounded-lg p-4 transition-all ${
//             departureTime 
//               ? "bg-info-bg border border-info-border" 
//               : "bg-muted border border-border"
//           }`}>
//             <div className="flex items-center gap-2 mb-1">
//               <Icon name="log-out" className={`size-4 ${departureTime ? "text-info" : "text-muted-foreground"}`} />
//               <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Départ</p>
//             </div>
//             <p className="text-2xl font-bold text-foreground">
//               {departureTime?.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }) ?? "--:--"}
//             </p>
//           </div>
//         </div>
//       </div>

//       {/* Message de succès */}
//       {recordedAt ? (
//         <div className="flex gap-3 rounded-lg border border-success-border bg-success-bg p-4">
//           <Icon name="shield-check" className="mt-1 size-5 shrink-0 text-success" />
//           <div>
//             <p className="font-semibold text-success text-sm">Pointage enregistré</p>
//             <p className="mt-1 text-xs text-success/80">{recordedAt}</p>
//           </div>
//         </div>
//       ) : null}

//       {/* Formulaire de pointage */}
//       {!isComplete ? (
//         <div className="space-y-4 rounded-lg border border-border bg-surface p-4">
//           {/* Horaires de référence */}
//           <div className="flex gap-3 rounded-lg bg-muted p-3">
//             <Icon name="calendar" className="size-4 shrink-0 text-muted-foreground mt-0.5" />
//             <div className="text-xs text-muted-foreground">
//               <p className="font-semibold text-foreground">Horaires de référence</p>
//               <p className="mt-1">
//                 Matin : <span className="font-semibold">{config.heureDebutMatin}–{config.heureFinMatin}</span><br/>
//                 Après-midi : <span className="font-semibold">{config.heureDebutApresMidi}–{config.heureFinApresMidi}</span>
//               </p>
//             </div>
//           </div>

//           {/* Select Type */}
//           <Select 
//             name="type" 
//             label="Type de pointage"
//             required
//             options={[
//               { value: "ARRIVEE", label: "Arrivée" },
//               { 
//                 value: "DEPART", 
//                 label: `Départ${!hasArrival ? " (non disponible)" : ""}`,
//                 // On ne peut pas désactiver avec Select, donc on va gérer via onChange
//               },
//             ]} 
//             defaultValue={hasArrival ? "DEPART" : "ARRIVEE"}
//             onChange={(e) => {
//               const value = e.currentTarget.value as "ARRIVEE" | "DEPART";
//               // Empêcher la sélection de DEPART si pas d'arrivée
//               if (value === "DEPART" && !hasArrival) {
//                 e.currentTarget.value = "ARRIVEE";
//               } else {
//                 setPointageType(value);
//               }
//             }}
//           />

//           {/* Message d'alerte si pas d'arrivée */}
//           {!hasArrival && pointageType === "DEPART" ? (
//             <div className="flex gap-3 rounded-lg border border-warning-border bg-warning-bg p-3">
//               <Icon name="alert-triangle" className="size-4 shrink-0 text-warning mt-0.5" />
//               <p className="text-xs text-warning font-medium">
//                 Vous devez d&apos;abord pointer votre arrivée avant de pouvoir pointer votre départ.
//               </p>
//             </div>
//           ) : null}

//           {/* Message d'alerte si départ avant l'heure */}
//           {isMotifRequiredForEarlyDeparture ? (
//             <div className="flex gap-3 rounded-lg border border-warning-border bg-warning-bg p-3">
//               <Icon name="alert-triangle" className="size-4 shrink-0 text-warning mt-0.5" />
//               <p className="text-xs text-warning font-medium">
//                 Avant {config.heureFinApresMidi}, un motif est obligatoire pour pointer votre départ.
//               </p>
//             </div>
//           ) : null}

//           <input type="hidden" name="source" value={device === "TELEPHONE" ? "QR_CODE" : "ORDINATEUR"} />

//           {/* Motif - optionnel pour arrivée, obligatoire pour départ avant l'heure */}
//           <Textarea 
//             name="motif" 
//             label={pointageType === "DEPART" ? "Motif du départ anticipé" : "Motif du retard"}
//             required={isMotifRequiredForEarlyDeparture}
//             hint={pointageType === "DEPART" 
//               ? "Remplissez ce champ uniquement si vous quittez avant l'heure prévue."
//               : "Remplissez ce champ uniquement si votre arrivée est en retard."}
//             placeholder={pointageType === "DEPART" 
//               ? "Rendez-vous, urgence, motif personnel..."
//               : "Embouteillage, retard transport..."}
//             error={state.status === "error" ? state.fieldErrors?.motif : undefined} 
//             rows={3}
//           />

//           {/* Bouton soumettre */}
//           <Button 
//             type="submit" 
//             loading={isPending}
//             disabled={!hasArrival && pointageType === "DEPART"}
//             className="min-h-12 w-full text-base font-semibold"
//           >
//             {isQrSource ? "Confirmer mon pointage" : "Enregistrer mon pointage"}
//           </Button>
//         </div>
//       ) : (
//         <div className="rounded-lg border border-success-border bg-success-bg p-4 text-center">
//           <p className="font-semibold text-success text-sm">✓ Journée complète</p>
//           <p className="mt-1 text-xs text-success/80">Arrivée et départ enregistrés</p>
//         </div>
//       )}
//     </form>
//   );
// }
"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { Button, Textarea } from "@/components/ui";
import { enregistrerPointageAction } from "./actions";

export function PointageForm({ type, source }: { type: "ARRIVEE" | "DEPART", source: "QR_CODE" | "ORDINATEUR" }) {
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const motif = formData.get("motif") as string;

    startTransition(async () => {
      const result = await enregistrerPointageAction({ source, type, motif });
      if (result.status === "success") {
        toast.success("Pointage enregistré avec succès");
        router.refresh();
      } else if (result.status === "error") {
        toast.error(result.message || "Erreur de pointage");
      }
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Textarea 
        name="motif"
        label="Motif (obligatoire)"
        required
        rows={4}
        placeholder="Veuillez renseigner votre justification détaillée..."
      />
      <Button type="submit" loading={isPending} className="w-full">
        Valider mon {type === "ARRIVEE" ? "arrivée" : "départ"}
      </Button>
    </form>
  );
}