import { Badge, PageHeader } from "@/components/ui";
import { prisma, ensureFeedbackModuleAndPermission } from "backend";

import { PermissionToggle } from "./PermissionToggle";
import { PeutEtreBeneficiaireToggle } from "./PeutEtreBeneficiaireToggle";
import { PeutRecevoirFeedbackToggle } from "./PeutRecevoirFeedbackToggle";
import { RoleCreateForm } from "./RoleCreateForm";
import { RolesListe } from "./RolesListe";

export default async function AdminRolesPage() {
  // Garantit uniquement l'EXISTENCE du Module/Permission FeedbackApp (pour
  // que `feedbackModererPermission` ci-dessous ne soit jamais `undefined`
  // sur un environnement neuf) — ne touche jamais qui possède la
  // permission, voir CLAUDE.md "FeedbackApp" pour la régression corrigée.
  await ensureFeedbackModuleAndPermission();
  const [roles, modules] = await Promise.all([
    prisma.role.findMany({
      include: { permissions: { select: { permissionId: true } } },
      orderBy: { name: "asc" },
    }),
    prisma.module.findMany({
      // Module technique "systeme" (réinitialisation à usage unique) : jamais attribuable depuis la matrice.
      where: { key: { not: "systeme" } },
      include: { permissions: { orderBy: { label: "asc" } } },
      orderBy: { label: "asc" },
    }),
  ]);

  const standardModules = modules.filter((m) => m.key !== "feedback");
  const feedbackModule = modules.find((m) => m.key === "feedback");
  const feedbackModererPermission = feedbackModule?.permissions.find(
    (p) => p.key === "feedback.moderer"
  );
  const feedbackVoirDetailsPermission = feedbackModule?.permissions.find((p) => p.key === "feedback.voir_details");
  // Les permissions qui ont une case sur la carte d'un rôle : c'est ce que compte son en-tête (jamais les `systeme.*`).
  const idsAvecCase = new Set(
    [...standardModules.flatMap((m) => m.permissions), feedbackModererPermission, feedbackVoirDetailsPermission].flatMap((p) => (p ? [p.id] : [])),
  );

  return (
    <div className="mx-auto max-w-5xl space-y-8 px-6 py-10">
      <PageHeader
        title="Rôles"
        description="Cocher ou décocher les permissions accordées à chaque rôle, groupées par module."
      />

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-foreground">Nouveau rôle</h2>
        <RoleCreateForm />
      </section>

      <RolesListe
        roles={roles.map((role) => {
          const grantedIds = new Set(role.permissions.map((rp) => rp.permissionId));

          const corps = (
            <>
              {role.description ? (
                <p className="text-sm text-muted-foreground">{role.description}</p>
              ) : null}

              {/* estAdmin : affichage en LECTURE SEULE — ce champ ne se
                  règle plus qu'à la création du rôle (voir CLAUDE.md
                  "estAdmin figé après création"), jamais modifiable
                  ensuite. Aucune case à cocher ici, volontairement. */}
              <div className="mt-3">
                {role.estAdmin ? (
                  <>
                    <Badge variant="info">Accès administrateur</Badge>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Ce rôle a un accès total et permanent à la console
                      d&apos;administration, indépendamment des permissions
                      de module ci-dessous — non modifiable après sa
                      création (voir isAdmin() dans CLAUDE.md).
                    </p>
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground/80">
                    Accès administrateur : non accordé. Ce statut ne peut
                    être défini qu&apos;à la création d&apos;un rôle.
                  </p>
                )}
              </div>

              {/* Éligibilité comme bénéficiaire de délégation (voir
                  CLAUDE.md "Délégation individuelle de permissions") —
                  librement modifiable à tout moment, contrairement à
                  estAdmin ci-dessus (aucun risque de verrouillage
                  comparable, ce champ ne donne aucun droit par lui-même). */}
              <div className="mt-2">
                <PeutEtreBeneficiaireToggle
                  roleId={role.id}
                  defaultChecked={role.peutEtreBeneficiaireDelegation}
                />
              </div>

              {standardModules.length === 0 ? (
                <p className="mt-4 text-sm text-muted-foreground">Aucun module.</p>
              ) : (
                <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
                  {standardModules.map((module_) => (
                    <div key={module_.id} className="space-y-2">
                      <h3 className="text-sm font-medium text-muted-foreground">
                        {module_.label}
                      </h3>
                      <div className="space-y-1">
                        {module_.permissions.map((permission) => (
                          <PermissionToggle
                            key={permission.id}
                            roleId={role.id}
                            permissionId={permission.id}
                            label={permission.label}
                            defaultChecked={grantedIds.has(permission.id)}
                          />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Section dédiée FeedbackApp : éligibilité comme destinataire et droit de modération regroupés en bas */}
              <div className="mt-5 border-t border-border pt-4">
                <h3 className="text-sm font-semibold text-foreground">
                  Module FeedbackApp
                </h3>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Gestion de la réception des avis et des droits de modération pour ce rôle.
                </p>
                <div className="mt-3 grid grid-cols-1 gap-4 rounded-lg border border-border bg-surface p-4 sm:grid-cols-2">
                  <PeutRecevoirFeedbackToggle
                    roleId={role.id}
                    defaultChecked={role.peutRecevoirFeedback}
                  />
                  {feedbackModererPermission ? (
                    <PermissionToggle
                      roleId={role.id}
                      permissionId={feedbackModererPermission.id}
                      label="Peut modérer les feedbacks"
                      defaultChecked={grantedIds.has(feedbackModererPermission.id)}
                    />
                  ) : null}
                  {feedbackVoirDetailsPermission ? (
                    <PermissionToggle
                      roleId={role.id}
                      permissionId={feedbackVoirDetailsPermission.id}
                      label={feedbackVoirDetailsPermission.label}
                      defaultChecked={grantedIds.has(feedbackVoirDetailsPermission.id)}
                    />
                  ) : null}
                </div>
              </div>
            </>
          );

          return {
            id: role.id,
            nom: role.name,
            estAdmin: role.estAdmin,
            beneficiaireDelegation: role.peutEtreBeneficiaireDelegation,
            nbPermissions: [...grantedIds].filter((id) => idsAvecCase.has(id)).length,
            corps,
          };
        })}
      />
    </div>
  );
}
