// import { getSession } from "@/lib/auth";
// import { prisma } from "@/lib/prisma";
// import { redirect } from "next/navigation";

// export default async function PointageQrPage() {
//   const destination = "/pointage?source=QR_CODE";
//   const session = await getSession();

//   if (!session) {
//     redirect(`/login?callbackUrl=${encodeURIComponent(destination)}`);
//   }

//   await prisma.historiqueEntry.create({
//     data: {
//       entity: "PointageQR",
//       entityId: session.user.id,
//       action: "SCAN",
//       detail: JSON.stringify({ destination, source: "QR_CODE" }),
//       userId: session.user.id,
//     },
//   });

//   redirect(destination);
// }
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