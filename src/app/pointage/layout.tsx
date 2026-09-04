import { AutoRefresh } from "@/components/ui/AutoRefresh";

export default function PointageExternalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      {/* Rafraîchit les pages externes de pointage (ex: QR code) en temps réel via SSE */}
      <AutoRefresh />
      {children}
    </>
  );
}
