import { prisma, timeToMinutes } from "backend";

export interface TopbarAlertData {
  id: string;
  message: string;
  shortMessage?: string;
  href?: string;
  variant: "danger" | "warning" | "info" | "success";
  pulse?: boolean;
}

export async function getTopbarAlert(
  userId: string,
  canPointer: boolean
): Promise<TopbarAlertData | null> {
  const now = new Date();
  const dayOfWeek = now.getDay(); // 0 = Dimanche, 5 = Vendredi, 6 = Samedi
  const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
  const isFriday = dayOfWeek === 5;

  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

  const startOfTomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const endOfTomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 23, 59, 59, 999);

  // 1. Détection des jours fériés (aujourd'hui et demain)
  const [jourFerieAujourdhui, jourFerieDemain] = await Promise.all([
    prisma.jourFerie.findFirst({
      where: { date: { gte: startOfDay, lte: endOfDay } },
    }),
    prisma.jourFerie.findFirst({
      where: { date: { gte: startOfTomorrow, lte: endOfTomorrow } },
    }),
  ]);

  // 2. Si le collaborateur a la permission de pointer et que ce n'est pas le week-end
  if (canPointer && !isWeekend && !jourFerieAujourdhui) {
    const pointages = await prisma.pointage.findMany({
      where: {
        userId,
        heure: { gte: startOfDay, lte: endOfDay },
      },
      orderBy: { heure: "asc" },
    });

    const hasArrivee = pointages.some((p) => p.type === "ARRIVEE");
    const hasDepart = pointages.some((p) => p.type === "DEPART");

    const parametrage = await prisma.parametrageHoraire.findFirst({
      where: { isActive: true },
    });
    const heureLimiteDepart = parametrage?.heureFinApresMidi || "16:45";
    const currentMinutes = now.getHours() * 60 + now.getMinutes();
    const departMinutes = timeToMinutes(heureLimiteDepart);

    // 1. Rappel amical : à partir de 30 minutes avant l'heure de départ
    if (hasArrivee && !hasDepart && currentMinutes >= departMinutes - 30 && currentMinutes < departMinutes) {
      const minutesRestantes = departMinutes - currentMinutes;
      let contexte = "";
      if (jourFerieDemain) {
        contexte = ` (Demain férié : ${jourFerieDemain.libelle})`;
      } else if (isFriday) {
        contexte = " (Bientôt le week-end !)";
      }

      return {
        id: "fin_journee_proche",
        message: `Fin de journée dans ${minutesRestantes} minute${minutesRestantes > 1 ? "s" : ""} !${contexte}`,
        shortMessage: `Fin dans ${minutesRestantes} min`,
        href: "/pointage/pointer",
        variant: "warning",
        pulse: false,
      };
    }

    // 2. Alerte rouge : l'utilisateur a pointé son arrivée, n'a pas encore pointé son départ,
    // et l'heure de départ réglementaire est atteinte ou dépassée
    if (hasArrivee && !hasDepart && currentMinutes >= departMinutes) {
      let contexte = "";
      if (jourFerieDemain) {
        contexte = ` (Demain férié : ${jourFerieDemain.libelle})`;
      } else if (isFriday) {
        contexte = " (Avant le week-end !)";
      }

      return {
        id: "depart_non_pointe",
        message: `Départ non pointé !${contexte}`,
        shortMessage: "Départ non pointé !",
        href: "/pointage/pointer",
        variant: "danger",
        pulse: true,
      };
    }
  }

  // 3. Alerte d'information pour jour férié demain ou aujourd'hui
  if (jourFerieDemain) {
    return {
      id: "jour_ferie_demain",
      message: `Demain est un jour férié : ${jourFerieDemain.libelle}`,
      shortMessage: `Férié demain : ${jourFerieDemain.libelle}`,
      variant: "info",
    };
  }

  if (jourFerieAujourdhui) {
    return {
      id: "jour_ferie_aujourdhui",
      message: `Aujourd'hui est férié : ${jourFerieAujourdhui.libelle}`,
      shortMessage: `Férié : ${jourFerieAujourdhui.libelle}`,
      variant: "info",
    };
  }

  return null;
}
