import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";

import { getSession, isAdmin } from "@/lib/auth";

/**
 * Layout du Socle Portail (écrans authentifiés). Toute route placée dans ce
 * groupe hérite de l'en-tête institutionnel et nécessite une session valide
 * — redirection vers /login sinon.
 */
export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }

  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex items-center bg-primary px-6 py-4">
        {/* Zone de protection : le logo dispose de son propre espace (py-4
            du header + pr-6 ci-dessous) sans aucun élément collé dessus,
            conformément aux règles d'usage de la charte. */}
        <div className="pr-6">
          <Image
            src="/logo-sim-blanc.webp"
            alt="SIM Assurances"
            width={216}
            height={32}
            priority
          />
        </div>
        <nav className="flex items-center gap-4 text-sm text-primary-foreground">
          <Link href="/" className="hover:underline">
            Tableau de bord
          </Link>
          {isAdmin(session) ? (
            <Link href="/admin" className="hover:underline">
              Administration
            </Link>
          ) : null}
        </nav>
        <div className="ml-auto flex items-center gap-3 text-sm text-primary-foreground">
          <span className="font-medium">{session.user.fullName}</span>
          <span className="rounded-full bg-white/15 px-2.5 py-0.5 text-xs">{session.role}</span>
        </div>
      </header>
      <main className="flex-1 bg-background">{children}</main>
    </div>
  );
}
