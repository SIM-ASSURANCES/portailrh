"use client";

import { useEffect, useState } from "react";
import { Bell, BellOff, X } from "lucide-react";
import { registerFcmToken } from "@/lib/notifications/fcmClient";
import { toast } from "sonner";

const ONE_HOUR_MS = 60 * 60 * 1000;
const STORAGE_KEY = "sim_push_prompt_dismissed_at";

export function PushPermissionPrompt() {
  const [isVisible, setIsVisible] = useState(false);
  const [isActivating, setIsActivating] = useState(false);

  useEffect(() => {
    // Vérification de la compatibilité du navigateur
    if (typeof window === "undefined" || !("Notification" in window)) {
      return;
    }

    // Si déjà autorisé ou bloqué définitivement par le navigateur
    if (Notification.permission === "granted" || Notification.permission === "denied") {
      return;
    }

    // Vérifier la règle de relance après 1 heure
    const dismissedAt = localStorage.getItem(STORAGE_KEY);
    if (dismissedAt) {
      const elapsed = Date.now() - parseInt(dismissedAt, 10);
      if (elapsed < ONE_HOUR_MS) {
        return;
      }
    }

    // Afficher la proposition
    const timer = setTimeout(() => {
      setIsVisible(true);
    }, 1500);

    return () => clearTimeout(timer);
  }, []);

  const handleDismiss = () => {
    setIsVisible(false);
    localStorage.setItem(STORAGE_KEY, Date.now().toString());
  };

  const handleActivate = async () => {
    setIsActivating(true);
    try {
      const token = await registerFcmToken();
      if (token) {
        toast.success("Notifications push activées !", {
          description: "Vous recevrez désormais les alertes prioritaires même portail fermé.",
        });
        localStorage.removeItem(STORAGE_KEY);
        setIsVisible(false);
      } else {
        if (Notification.permission === "denied") {
          toast.error("Notifications bloquées", {
            description: "Vous avez bloqué les notifications dans votre navigateur. Vous pouvez les réactiver dans les paramètres de votre navigateur.",
          });
        }
        handleDismiss();
      }
    } catch {
      handleDismiss();
    } finally {
      setIsActivating(false);
    }
  };

  if (!isVisible) return null;

  return (
    <aside
      aria-label="Demande d'activation des notifications push"
      className="fixed bottom-6 right-6 z-50 max-w-md w-[calc(100vw-3rem)] animate-in fade-in slide-in-from-bottom-5 duration-300"
    >
      <div className="bg-card text-card-foreground border border-border/80 shadow-2xl rounded-xl p-5 backdrop-blur-md bg-white/95 dark:bg-slate-900/95">
        <div className="flex items-start gap-4">
          <div className="p-2.5 bg-primary/10 text-primary rounded-xl shrink-0">
            <Bell className="w-6 h-6 animate-pulse" />
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-2">
              <h4 className="text-sm font-semibold text-foreground">
                Alertes en temps réel
              </h4>
              <button
                type="button"
                onClick={handleDismiss}
                className="text-muted-foreground hover:text-foreground p-1 rounded-md transition-colors"
                aria-label="Fermer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
              Activez les notifications push pour être averti instantanément des décisions de la Direction, validations et rappels de pointage, même quand le portail est fermé.
            </p>

            <div className="flex items-center gap-2 mt-4">
              <button
                type="button"
                onClick={handleActivate}
                disabled={isActivating}
                className="inline-flex items-center justify-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition shadow-sm disabled:opacity-50"
              >
                {isActivating ? (
                  "Activation..."
                ) : (
                  <>
                    <Bell className="w-3.5 h-3.5" /> Activer
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={handleDismiss}
                className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/60 transition"
              >
                <BellOff className="w-3.5 h-3.5" /> Plus tard
              </button>
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
}
