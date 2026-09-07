import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { ProfileForm } from "./ProfileForm";

export const metadata = {
  title: "Mon Profil | SIM Assurances",
};

export default async function ProfilPage() {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight text-foreground">
          Mon Profil
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Gérez vos informations personnelles et vos paramètres de sécurité.
        </p>
      </div>

      <ProfileForm user={session.user} role={session.role} />
    </div>
  );
}
