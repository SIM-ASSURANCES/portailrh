import { getSession, hasPermission } from "@/lib/auth";
import {prisma} from "backend";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui/PageHeader";
import {
  choisirModeDepart,
  formatHeureLocale,
  getMessageDepart,
  horairesPointage,
  journeeCouverteParAbsence,
  reglesPointage,
  timeToMinutes,
} from "backend";
import { lireJourNonOuvre } from "@/lib/joursOuvres";
import { SmartPointage, PointageMode } from "../SmartPointage";

export default async function PointagePage({ searchParams }: { searchParams: Promise<{ source?: string }> }) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!hasPermission(session, "pointage.pointer")) redirect("/?error=acces_refuse_pointer");

  const { source } = await searchParams;
  const isQR = source === "QR_CODE";

  // 1. Définir les bornes de la journée en cours
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

  // 1b. Week-end ou jour férié : une seule règle (`estJourNonOuvre`, lot 3 bis), même source que les absences.
  const { jourNonOuvre: isJourNonOuvre, jourFerie } = await lireJourNonOuvre(now);

  // 2. Récupérer les pointages d'aujourd'hui pour le collaborateur
  const pointagesDuJour = await prisma.pointage.findMany({
    where: {
      userId: session.user.id,
      heure: { gte: startOfDay, lte: endOfDay }
    },
    orderBy: { heure: 'asc' }
  });

  // 3. Récupérer les horaires de référence (Fallback sur ceux par défaut si non paramétrés)
  const parametrage = await prisma.parametrageHoraire.findFirst({
    where: { isActive: true }
  });
  const horaires = horairesPointage(parametrage);

  // Congé ou permission couvrant toute la journée : aucun pointage attendu, jamais d'absence automatique.
  const plagesDuJour = await prisma.plageAbsenceAutorisee.findMany({
    where: { userId: session.user.id, date: { gte: startOfDay, lte: endOfDay } },
    select: { heureDebut: true, heureFin: true },
  });
  const enAbsenceAutorisee = journeeCouverteParAbsence(plagesDuJour, horaires);

  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  const limiteDepartMinutes = timeToMinutes(horaires.heureFinApresMidi);

  // 4. Analyser le mode à appliquer
  let mode: PointageMode = "TERMINE";
  let typePointage: "ARRIVEE" | "DEPART" = "ARRIVEE";
  let messageAuto = "";
  let departPossibleA: { heure: string; iso: string } | undefined;

  if (pointagesDuJour.length === 0) {
    typePointage = "ARRIVEE";
    if (isJourNonOuvre) {
      mode = "NON_OUVRABLE";
      messageAuto = jourFerie
        ? `Aujourd'hui est un jour férié (${jourFerie.libelle}). Aucun pointage obligatoire.`
        : "Aujourd'hui est un jour de repos (week-end). Aucun pointage obligatoire.";
    } else if (enAbsenceAutorisee) {
      mode = "NON_OUVRABLE";
      messageAuto = "Un congé autorisé couvre votre journée. Aucun pointage obligatoire.";
    } else if (currentMinutes >= limiteDepartMinutes) {
      mode = "ABSENCE_AUTO";
      messageAuto = "Journée terminée sans pointage. Vous avez été marqué(e) comme absent(e).";
    } else if (!reglesPointage("ARRIVEE", now, horaires, plagesDuJour, false).estRetard) {
      // Lot 3 : même règle que le serveur (tolérance incluse, permission du matin prise en compte).
      mode = "AUTO_ARRIVEE";
      messageAuto = "Félicitations pour votre ponctualité ! Arrivée validée.";
    } else {
      // En retard : enregistré automatiquement aussi, sans motif (le lien de justification suit).
      mode = "RETARD_ARRIVEE";
    }
  } else if (pointagesDuJour.length === 1) {
    typePointage = "DEPART";
    const arrivee = pointagesDuJour[0];
    // Lot 3 bis : départ automatique seulement un jour ouvré, 30 min après l'arrivée, départ non anticipé ; sinon le
    // collaborateur clique « Pointer mon départ » et confirme (jamais automatique un jour non ouvré).
    const choix = choisirModeDepart(arrivee.heure, now, horaires, plagesDuJour, isJourNonOuvre);
    mode = choix.mode;
    if (choix.mode === "AUTO_DEPART") messageAuto = getMessageDepart();
    if (choix.departPossibleA) {
      departPossibleA = { heure: formatHeureLocale(choix.departPossibleA), iso: choix.departPossibleA.toISOString() };
    }
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <PageHeader 
        title={`Pointage de ${session.user.fullName}`} 
        description="Enregistrement de votre présence."
      />
      
      <div className="flex flex-col gap-6">
        <h3 className="text-lg font-bold text-foreground">Votre pointage</h3>
        <SmartPointage 
          mode={mode} 
          messageAuto={messageAuto} 
          type={typePointage}
          source={isQR ? "QR_CODE" : "ORDINATEUR"}
          departPossibleA={departPossibleA}
          jourNonOuvre={isJourNonOuvre}
        />
      </div>
    </div>
  );
}
