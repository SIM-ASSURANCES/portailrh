import { prisma } from "@/lib/prisma";
import { getSession, hasPermission } from "@/lib/auth";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { PageHeader, QRCodeDownload } from "@/components/ui";
import { PointageForm } from "./PointageForm";
import { detectPointageDevice, getClientIp, isOfficeIpAllowed } from "@/lib/pointage-utils";

export default async function PointagePage({
  searchParams,
}: {
  searchParams: Promise<{ source?: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!hasPermission(session, "pointage.pointer")) redirect("/?error=acces_refuse");

  const requestHeaders = await headers();
  const device = detectPointageDevice(requestHeaders.get("user-agent") ?? "");
  const clientIp = getClientIp(requestHeaders);
  console.log("Client IP:", clientIp); // Log the client IP for debugging
  const officeNetworkAllowed = isOfficeIpAllowed(clientIp, process.env.ALLOWED_OFFICE_IPS ?? "");

  if (device === "ORDINATEUR" && !officeNetworkAllowed) {
    return (
      <div className="container mx-auto max-w-lg p-6 text-center">
        <PageHeader title="Pointage indisponible" description="Accès sécurisé du portail SIM Assurances" />
        <p className="mt-6 rounded-md border border-danger-border bg-danger-bg p-4 text-sm text-danger">
          Le pointage depuis un ordinateur est autorisé uniquement depuis les locaux de l&apos;entreprise.
        </p>
      </div>
    );
  }

  const config = await prisma.parametrageHoraire.findFirst({ where: { isActive: true } });
  if (!config) {
    return (
      <div className="container mx-auto max-w-lg p-6 text-center">
        <p className="font-bold text-sim-red">Le paramétrage des horaires RH est absent ou inactif.</p>
      </div>
    );
  }

  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const endOfToday = new Date();
  endOfToday.setHours(23, 59, 59, 999);
  const todayPointages = await prisma.pointage.findMany({
    where: { userId: session.user.id, heure: { gte: startOfToday, lte: endOfToday } },
    orderBy: { heure: "asc" },
  });

  const resolvedParams = await searchParams;
  const qrUrl = `${process.env.NEXT_PUBLIC_BASE_URL || "http://192.168.1.98:3000"}/pointage/qr`;

  return (
    <div className="container mx-auto max-w-xl px-4 py-8 font-sans">
      <PageHeader title="Pointage Quotidien" description="SIM Assurances — Enregistrement de votre temps de présence" />
      
      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        {/* Colonne gauche : Formulaire de pointage */}
        <div>
          <h3 className="mb-4 text-lg font-bold text-foreground">Votre pointage</h3>
          <PointageForm
            config={config}
            todayPointages={todayPointages}
            isQrSource={resolvedParams.source === "QR_CODE"}
            device={device}
          />
        </div>

        {/* Colonne droite : QR Code */}
        <div className="flex flex-col gap-6">
          <div>
            <h3 className="mb-4 text-lg font-bold text-foreground">Code QR du pointage</h3>
            <QRCodeDownload
              url={qrUrl}
              fileName="pointage-sim-assurances"
              title="Pointage par QR"
              description="Scannez ce code pour accéder à votre écran de pointage"
              size={200}
            />
          </div>
        </div>
      </div>
    </div>
  );
}