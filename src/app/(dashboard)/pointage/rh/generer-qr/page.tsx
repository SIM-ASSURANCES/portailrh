import { getSession, hasPermission } from "@/lib/auth";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui/PageHeader";
import { QRCodeDownload } from "@/components/ui/QRCodeDownload";

export default async function GenererQRPage() {
  const session = await getSession();
  
  // Sécurisation stricte : réservé aux RH / Admin
  if (!session || !hasPermission(session, "pointage.voir_dashboard_rh")) {
    redirect("/?error=acces_refuse");
  }

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      <PageHeader 
        title="Générateur de QR Code" 
        description="Générez et téléchargez le QR code officiel pour le pointage des collaborateurs sur mobile."
      />
      
      <div className="mt-8">
        <QRCodeDownload />
      </div>
    </div>
  );
}