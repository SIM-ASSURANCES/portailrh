"use client";

import { useState } from "react";

import { Button } from "@/components/ui";

import { InvitationCreateForm } from "./InvitationCreateForm";
import { UserCreateForm } from "./UserCreateForm";

type Mode = "manuel" | "invitation";

/**
 * Bascule entre les deux méthodes de création de compte (voir CLAUDE.md
 * "Invitation par lien") : "Création manuelle" (`UserCreateForm`, existant,
 * mot de passe saisi immédiatement par l'Admin) et "Inviter par lien"
 * (`InvitationCreateForm`, nouveau, la personne finalise elle-même son mot
 * de passe). Les deux restent pleinement disponibles, jamais l'une au
 * détriment de l'autre.
 */
export function NewUserSection({ roles }: { roles: { id: string; name: string }[] }) {
  const [mode, setMode] = useState<Mode>("manuel");

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3">
        <Button type="button" variant={mode === "manuel" ? "primary" : "secondary"} onClick={() => setMode("manuel")}>
          Création manuelle
        </Button>
        <Button
          type="button"
          variant={mode === "invitation" ? "primary" : "secondary"}
          onClick={() => setMode("invitation")}
        >
          Inviter par lien
        </Button>
      </div>

      {mode === "manuel" ? <UserCreateForm roles={roles} /> : <InvitationCreateForm roles={roles} />}
    </div>
  );
}
