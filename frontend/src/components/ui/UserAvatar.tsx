"use client";

import { useState } from "react";
import Image from "next/image";

interface UserAvatarProps {
  user: {
    fullName?: string | null;
    photoUrl?: string | null;
  };
  size?: "sm" | "md" | "lg" | "xl";
  className?: string;
  priority?: boolean;
}

const SIZE_MAP = {
  sm: { className: "size-8 text-xs", px: 32 },
  md: { className: "size-10 text-sm", px: 40 },
  lg: { className: "size-16 text-lg", px: 64 },
  xl: { className: "size-24 text-2xl", px: 96 },
};

function getInitials(name?: string | null): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function UserAvatar({
  user,
  size = "md",
  className = "",
  priority = false,
}: UserAvatarProps) {
  const [hasError, setHasError] = useState(false);
  const sizeConfig = SIZE_MAP[size];

  const photoSrc = user.photoUrl || "/default-avatar.svg";

  if (hasError) {
    return (
      <span
        className={`grid shrink-0 place-items-center rounded-full bg-primary font-semibold text-primary-foreground ${sizeConfig.className} ${className}`}
        aria-hidden="true"
      >
        {getInitials(user.fullName)}
      </span>
    );
  }

  return (
    <div
      className={`relative shrink-0 overflow-hidden rounded-full border border-border bg-slate-100 ${sizeConfig.className} ${className}`}
    >
      <Image
        src={photoSrc}
        alt={user.fullName ? `Photo de profil de ${user.fullName}` : "Photo de profil"}
        fill
        sizes={`${sizeConfig.px}px`}
        priority={priority}
        className="object-cover"
        onError={() => setHasError(true)}
      />
    </div>
  );
}
