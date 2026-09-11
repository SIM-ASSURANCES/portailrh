"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Select } from "@/components/ui";

import { accorderDelegationAction, revoquerDelegationAction } from "./actions";

interface UtilisateurOption {
  id: string;
  fullName: string;
  email: string;
}

interface PermissionOption {
  id: string;
  key: string;
  label: string;
}

interface ModuleGroup {
  key: string;
  label: string;
  permissions: PermissionOption[];
}

interface DelegationAccordee {
  id: string;
  beneficiaireId: string;
  permissionId: string;
}

export function DelegationForm({
  utilisateurs,
  modules,
  delegationsAccordees,
}: {
  utilisateurs: UtilisateurOption[];
  modules: ModuleGroup[];
  delegationsAccordees: DelegationAccordee[];
}) {
  const [beneficiaireId, setBeneficiaireId] = useState("");

  const delegationParPermission = new Map(
    delegationsAccordees
      .filter((d) => d.beneficiaireId === beneficiaireId)
      .map((d) => [d.permissionId, d.id])
  );

  return (
    <div className="space-y-6">
      <Select
        label="Compte bénéficiaire"
        placeholder="Choisir un utilisateur..."
        options={utilisateurs.map((u) => ({ value: u.id, label: `${u.fullName} (${u.email})` }))}
        value={beneficiaireId}
        onChange={(e) => setBeneficiaireId(e.target.value)}
      />

      {!beneficiaireId ? (
        <p className="text-sm text-muted-foreground">
          Choisissez un utilisateur pour voir et accorder les accès disponibles.
        </p>
      ) : modules.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Vous ne possédez vous-même aucun droit Trésorerie ou Pointage RH délégable.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
          {modules.map((module_) => (
            <div key={module_.key} className="space-y-2 rounded-lg border border-border p-4">
              <h3 className="text-sm font-semibold text-foreground">{module_.label}</h3>
              <div className="space-y-1">
                {module_.permissions.map((permission) => (
                  <DelegationCheckbox
                    key={`${beneficiaireId}-${permission.id}`}
                    beneficiaireId={beneficiaireId}
                    permissionId={permission.id}
                    label={permission.label}
                    initialDelegationId={delegationParPermission.get(permission.id)}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function DelegationCheckbox({
  beneficiaireId,
  permissionId,
  label,
  initialDelegationId,
}: {
  beneficiaireId: string;
  permissionId: string;
  label: string;
  initialDelegationId?: string;
}) {
  const [checked, setChecked] = useState(!!initialDelegationId);
  const [delegationId, setDelegationId] = useState(initialDelegationId);
  const [isPending, startTransition] = useTransition();

  function handleChange(next: boolean) {
    // Optimiste, revenu en arrière en cas de refus serveur (voir plus bas) —
    // jamais la seule autorité, juste un retour visuel immédiat.
    setChecked(next);

    startTransition(async () => {
      if (next) {
        const result = await accorderDelegationAction(beneficiaireId, permissionId);
        if (result.status === "success") {
          toast.success(result.message);
          setDelegationId(result.delegationId);
        } else {
          toast.error(result.message);
          setChecked(false);
        }
        return;
      }

      if (!delegationId) {
        setChecked(false);
        return;
      }

      const result = await revoquerDelegationAction(delegationId);
      if (result.status === "success") {
        toast.success(result.message);
        setDelegationId(undefined);
      } else {
        toast.error(result.message);
        setChecked(true);
      }
    });
  }

  return (
    <label className="flex items-center gap-2 text-sm text-foreground">
      <input
        type="checkbox"
        checked={checked}
        disabled={isPending}
        onChange={(e) => handleChange(e.target.checked)}
        className="h-4 w-4 rounded border-border accent-primary"
      />
      {label}
    </label>
  );
}
