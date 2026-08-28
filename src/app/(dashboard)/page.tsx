import { PageHeader } from "@/components/ui";
import { getSession } from "@/lib/auth";

export default async function DashboardHomePage() {
  const session = await getSession();

  return (
    <div className="mx-auto max-w-4xl space-y-8 px-6 py-10">
      <PageHeader
        title={`Bonjour, ${session?.user.fullName ?? ""}`}
        description="Portail interne SIM Assurances — module Trésorerie à venir."
      />
    </div>
  );
}
