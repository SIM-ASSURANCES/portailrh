"use client";

import { useTransition, useState, useEffect } from "react";
import { Select } from "@/components/ui";
import { updateUserServiceAction } from "./actions";
import { toast } from "sonner";

export function UserServiceSelect({
  userId,
  currentServiceId,
  services,
}: {
  userId: string;
  currentServiceId: string | null;
  services: { id: string; name: string }[];
}) {
  const [isPending, startTransition] = useTransition();
  const [value, setValue] = useState(currentServiceId || "");

  // Si currentServiceId change de l'extérieur
  useEffect(() => {
    setValue(currentServiceId || "");
  }, [currentServiceId]);

  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newServiceId = e.target.value === "" ? null : e.target.value;
    setValue(e.target.value);

    startTransition(async () => {
      const res = await updateUserServiceAction(userId, newServiceId);
      if (res.status === "error") {
        toast.error(res.message);
        setValue(currentServiceId || ""); // Rollback UI
      } else if (res.status === "success" && res.message) {
        toast.success(res.message);
      }

    });
  };

  return (
    <Select
      name={`service-${userId}`}
      options={[
        { value: "", label: "Aucun service" },
        ...services.map((s) => ({ value: s.id, label: s.name })),
      ]}
      value={value}
      onChange={handleChange}
      disabled={isPending}
      className="max-w-[180px]"
    />
  );
}
