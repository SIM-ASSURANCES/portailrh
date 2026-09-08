import { Button, PageHeader } from "@/components/ui";

import { UiPreviewDemo } from "./UiPreviewDemo";

/**
 * Page de démonstration des composants src/components/ui — outil de dev
 * uniquement, pas un écran du produit. Voir CLAUDE.md > "Page de démo UI".
 */
export default function UiPreviewPage() {
  return (
    <div className="mx-auto max-w-4xl space-y-8 px-6 py-10">
      <PageHeader
        title="UI Preview"
        description="Vitrine des composants réutilisables de src/components/ui — outil de dev, à ne pas exposer en production."
        actions={<Button variant="secondary">Exemple d&apos;action (PageHeader)</Button>}
      />
      <UiPreviewDemo />
    </div>
  );
}
