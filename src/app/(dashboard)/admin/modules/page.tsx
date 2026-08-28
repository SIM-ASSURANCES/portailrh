import { PageHeader } from "@/components/ui";
import { prisma } from "@/lib/prisma";

import { ModulesTable } from "./ModulesTable";

export default async function AdminModulesPage() {
  const modules = await prisma.module.findMany({ orderBy: { label: "asc" } });

  return (
    <div className="mx-auto max-w-4xl space-y-8 px-6 py-10">
      <PageHeader
        title="Modules"
        description="Un module désactivé disparaît immédiatement du dashboard de tous les utilisateurs."
      />

      <ModulesTable modules={modules} />
    </div>
  );
}
