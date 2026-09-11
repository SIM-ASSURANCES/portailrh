"use client";

import { useState } from "react";
import { Button } from "@/components/ui";
import { RefreshCw } from "lucide-react";
import { recoverAbsencesAction } from "./actions";
import { toast } from "sonner";

interface RecoverAbsencesButtonProps {
  dateStr: string;
  isEndOfDayPassed: boolean;
}

export function RecoverAbsencesButton({ dateStr, isEndOfDayPassed }: RecoverAbsencesButtonProps) {
  const [isLoading, setIsLoading] = useState(false);

  const handleRecover = async () => {
    if (!isEndOfDayPassed) return;
    
    setIsLoading(true);
    try {
      const result = await recoverAbsencesAction(dateStr);
      if (result.status === "success") {
        toast.success(result.message);
      } else {
        toast.error(result.message);
      }
    } catch (error) {
      console.error(error);
      toast.error("Une erreur est survenue.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div title={!isEndOfDayPassed ? "L'heure de fin de journée n'est pas encore passée" : "Récupérer les absences pour cette journée"}>
      <Button
        variant="secondary"
        onClick={handleRecover}
        disabled={!isEndOfDayPassed || isLoading}
        className="flex items-center gap-2"
      >
        <RefreshCw className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
        <span>Récupérer les absences</span>
      </Button>
    </div>
  );
}
