"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import Image from "next/image";
import { Icon } from "@/components/icons";
import { signOutAction } from "./actions";

interface ProfileMenuProps {
  user: { fullName: string; email: string; photoUrl?: string | null };
  role: string;
}

function initials(fullName: string) {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function ProfileMenu({ user, role }: ProfileMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-3 rounded-full hover:bg-slate-100 p-1 pr-2 transition-colors focus:outline-none focus:ring-2 focus:ring-primary/50"
      >
        {user.photoUrl ? (
          <div className="relative size-10 overflow-hidden rounded-full border border-border">
            <Image 
              src={user.photoUrl} 
              alt={user.fullName} 
              fill 
              className="object-cover"
            />
          </div>
        ) : (
          <span
            className="grid size-10 shrink-0 place-items-center rounded-full bg-primary text-sm font-semibold text-primary-foreground"
            aria-hidden="true"
          >
            {initials(user.fullName)}
          </span>
        )}
        
        <div className="hidden leading-tight sm:block text-left">
          <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
            {user.fullName}
            <span className="rounded-full bg-info-bg px-2 py-0.5 text-[11px] font-medium text-info">
              {role}
            </span>
          </p>
          <p className="text-xs text-muted-foreground">{user.email}</p>
        </div>
        <Icon name="chevron-down" className={`hidden sm:block size-4 text-muted-foreground transition-transform ${isOpen ? "rotate-180" : ""}`} />
      </button>

      {isOpen && (
        <div className="absolute right-0 top-full mt-2 w-56 origin-top-right rounded-xl border border-border bg-white py-2 shadow-elevated-lg ring-1 ring-black/5 animate-in fade-in slide-in-from-top-2">
          <Link
            href="/profil"
            onClick={() => setIsOpen(false)}
            className="flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-foreground hover:bg-slate-50 transition-colors"
          >
            <Icon name="user" className="size-4 text-muted-foreground" />
            Mon profil
          </Link>
          <div className="my-1 h-px bg-border" />
          <form action={signOutAction}>
            <button
              type="submit"
              className="flex w-full items-center gap-2 px-4 py-2.5 text-sm font-medium text-danger hover:bg-danger/5 transition-colors text-left"
            >
              <Icon name="log-out" className="size-4" />
              Se déconnecter
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
