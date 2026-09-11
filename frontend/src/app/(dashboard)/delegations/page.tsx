import { redirect } from "next/navigation";

import { PageHeader } from "@/components/ui";
import { getSession } from "@/lib/auth";
import { prisma } from "backend";

import { DelegationForm } from "./DelegationForm";

const MODULES_DELEGABLES = ["tresorerie", "pointage"] as const;

/**
 * Écran de délégation individuelle de permissions (voir CLAUDE.md
 * "Délégation individuelle de permissions") : accessible à quiconque
 * possède, via son PROPRE rôle (`session.rolePermissions`, jamais
 * `session.permissions` — voir `getSession()`), au moins une permission des
 * branches Trésorerie ou Pointage RH. Permet d'accorder à un compte
 * utilisateur déjà existant l'un de ces droits précis, sans jamais créer de
 * compte ni dépasser ce que le donneur possède lui-même.
 *
 * Gardée ici (page) ET revérifiée dans chaque Server Action
 * (`accorderDelegationAction`) — jamais uniquement le masquage du lien de
 * navigation, même principe que partout ailleurs dans le portail.
 */
export default async function DelegationsPage() {
  const session = await getSession();
  const peutDeleguer = session?.rolePermissions.some(
    (key) => key.startsWith("treso.") || key.startsWith("pointage.")
  );

  if (!session || !peutDeleguer) {
    redirect("/?error=acces_refuse_delegations");
  }

  const [permissionsEligibles, utilisateurs, delegationsAccordees] = await Promise.all([
    // Uniquement les permissions que CE donneur possède lui-même via son
    // rôle — jamais toutes les permissions du module : une case ne doit
    // jamais apparaître pour un droit que le donneur n'a pas (plafonnement
    // dès l'affichage, en plus de la revérification serveur).
    prisma.permission.findMany({
      where: {
        key: { in: session.rolePermissions },
        module: { key: { in: [...MODULES_DELEGABLES] } },
      },
      include: { module: true },
      orderBy: [{ module: { label: "asc" } }, { label: "asc" }],
    }),
    // Tout compte actif et activé (mot de passe déjà défini — voir CLAUDE.md
    // "Invitation par lien"), à l'exclusion du donneur lui-même, DONT LE
    // RÔLE porte `peutEtreBeneficiaireDelegation: true` — jamais une
    // comparaison sur le nom du rôle ("Collaborateur"), même principe que
    // `estAdmin` ("estAdmin remplace le nom de rôle"). Voir CLAUDE.md
    // "Délégation individuelle de permissions" pour le resserrement de
    // cette règle (initialement trop large : tout compte actif).
    prisma.user.findMany({
      where: {
        isActive: true,
        passwordHash: { not: null },
        id: { not: session.user.id },
        role: { peutEtreBeneficiaireDelegation: true },
      },
      select: { id: true, fullName: true, email: true },
      orderBy: { fullName: "asc" },
    }),
    // Délégations actives déjà accordées PAR ce donneur précis (jamais
    // celles accordées par un autre donneur au même bénéficiaire).
    prisma.permissionDelegation.findMany({
      where: { donneurId: session.user.id, estActive: true },
      select: { id: true, beneficiaireId: true, permissionId: true },
    }),
  ]);

  const permissionsParModule = new Map<string, { label: string; permissions: typeof permissionsEligibles }>();
  for (const permission of permissionsEligibles) {
    const entry = permissionsParModule.get(permission.module.key) ?? {
      label: permission.module.label,
      permissions: [],
    };
    entry.permissions.push(permission);
    permissionsParModule.set(permission.module.key, entry);
  }

  return (
    <div className="mx-auto max-w-4xl space-y-8 px-6 py-10">
      <PageHeader
        title="Déléguer des accès"
        description="Accorder à un compte déjà existant l'un de vos propres droits Trésorerie ou Pointage RH — jamais plus que ce que vous possédez vous-même."
      />

      <DelegationForm
        utilisateurs={utilisateurs}
        modules={Array.from(permissionsParModule.entries()).map(([key, value]) => ({
          key,
          label: value.label,
          permissions: value.permissions.map((p) => ({ id: p.id, key: p.key, label: p.label })),
        }))}
        delegationsAccordees={delegationsAccordees}
      />
    </div>
  );
}
