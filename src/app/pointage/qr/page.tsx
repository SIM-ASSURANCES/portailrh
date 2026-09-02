import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";


export default async function QRCodeDestinationPage() {
  const session = await getSession();

  // S'il n'est pas connecté, on redirige vers le login avec le callback
  if (!session) {
    redirect("/login?callbackUrl=/pointage/pointer?source=QR_CODE");
  }

  // 3. Sinon, rediriger vers l'écran de pointage en mode QR
  redirect("/pointage/pointer?source=QR_CODE");
}