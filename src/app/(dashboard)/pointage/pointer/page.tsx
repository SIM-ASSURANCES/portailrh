import { getSession } from "@/lib/auth";
import {prisma} from "@/lib/prisma";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui/PageHeader";
import { timeToMinutes, getMessageDepart } from "@/lib/pointage-utils";
import { SmartPointage, PointageMode } from "../SmartPointage";
import { QRCodeDownload } from "@/components/ui";

export default async function PointagePage({ searchParams }: { searchParams: Promise<{ source?: string }> }) {
  const session = await getSession();
  if (!session) redirect("/login");

  const { source } = await searchParams;
  const isQR = source === "QR_CODE";

  // 1. Définir les bornes de la journée en cours
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

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
  const heureLimiteArrivee = parametrage?.heureDebutMatin || "07:45";
  const heureLimiteDepart = parametrage?.heureFinApresMidi || "16:45";

  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  const limiteArriveeMinutes = timeToMinutes(heureLimiteArrivee);
  const limiteDepartMinutes = timeToMinutes(heureLimiteDepart);

  // 4. Analyser le mode à appliquer
  let mode: PointageMode = "TERMINE";
  let typePointage: "ARRIVEE" | "DEPART" = "ARRIVEE";
  let messageAuto = "";

  if (pointagesDuJour.length === 0) {
    typePointage = "ARRIVEE";
    if (currentMinutes <= limiteArriveeMinutes) {
      mode = "AUTO_ARRIVEE";
      messageAuto = "Félicitations pour votre ponctualité ! Arrivée validée.";
    } else {
      mode = "RETARD_ARRIVEE";
    }
  } else if (pointagesDuJour.length === 1) {
    typePointage = "DEPART";
    if (currentMinutes >= limiteDepartMinutes) {
      mode = "AUTO_DEPART";
      messageAuto = getMessageDepart();
    } else {
      mode = "ANTICIPE_DEPART";
    }
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <PageHeader 
        title="Pointage Collaborateur" 
        description="Enregistrement de votre présence."
      />
      
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="flex flex-col gap-6">
          <h3 className="text-lg font-bold text-foreground">Votre pointage</h3>
          <SmartPointage 
            mode={mode} 
            messageAuto={messageAuto} 
            type={typePointage}
            source={isQR ? "QR_CODE" : "ORDINATEUR"}
          />
        </div>
        
        <div className="flex flex-col gap-6">
          <h3 className="text-lg font-bold text-foreground">Code QR du pointage</h3>
          <QRCodeDownload />
        </div>
      </div>
    </div>
  );
}
