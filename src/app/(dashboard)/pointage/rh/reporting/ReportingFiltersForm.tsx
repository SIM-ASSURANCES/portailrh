"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { Button, Input, Select, Card } from "@/components/ui";

type Collaborateur = {
  id: string;
  fullName: string;
};

type ReportingFiltersFormProps = {
  collaborateurs: Collaborateur[];
  services: string[];
};

export function ReportingFiltersForm({ collaborateurs, services }: ReportingFiltersFormProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const handleApply = (formData: FormData) => {
    const params = new URLSearchParams(searchParams.toString());

    const dateDebut = formData.get("dateDebut") as string;
    const dateFin = formData.get("dateFin") as string;
    const userId = formData.get("userId") as string;
    const service = formData.get("service") as string;

    if (dateDebut) params.set("dateDebut", dateDebut);
    else params.delete("dateDebut");

    if (dateFin) params.set("dateFin", dateFin);
    else params.delete("dateFin");

    if (userId) params.set("userId", userId);
    else params.delete("userId");

    if (service) params.set("service", service);
    else params.delete("service");

    startTransition(() => {
      router.push(`?${params.toString()}`);
    });
  };

  const handleReset = () => {
    startTransition(() => {
      router.push("?");
    });
  };

  return (
    <Card className="p-4 mb-6">
      <form action={handleApply} className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Input
            type="date"
            name="dateDebut"
            label="Date de début"
            defaultValue={searchParams.get("dateDebut") || ""}
          />
          <Input
            type="date"
            name="dateFin"
            label="Date de fin"
            defaultValue={searchParams.get("dateFin") || ""}
          />
          <Select
            name="userId"
            label="Collaborateur"
            placeholder="Tous les collaborateurs"
            defaultValue={searchParams.get("userId") || ""}
            options={collaborateurs.map((c) => ({ value: c.id, label: c.fullName }))}
          />
          <Select
            name="service"
            label="Service"
            placeholder="Tous les services"
            defaultValue={searchParams.get("service") || ""}
            options={services.map((s) => ({ value: s, label: s }))}
          />
        </div>
        <div className="flex gap-2 justify-end">
          <Button type="button" variant="secondary" onClick={handleReset} disabled={isPending}>
            Réinitialiser
          </Button>
          <Button type="submit" variant="primary" loading={isPending}>
            Filtrer
          </Button>
        </div>
      </form>
    </Card>
  );
}
