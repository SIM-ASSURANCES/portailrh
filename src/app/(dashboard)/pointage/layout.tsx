import { AutoRefresh } from "@/components/ui/AutoRefresh";

export default function PointageDashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      {/* Rafraîchit les pages du dashboard pointage en temps réel via SSE */}
      <AutoRefresh />
      {children}
    </>
  );
}
