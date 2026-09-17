"use client";

import { useState } from "react";
import { Badge, Button, DataTable } from "@/components/ui";
import type { AdminFeedbackEntry } from "backend";
import { ModererFeedbackDialog } from "./ModererFeedbackDialog";

interface AdminFeedbackTableProps {
  feedbacks: AdminFeedbackEntry[];
}

export function AdminFeedbackTable({ feedbacks }: AdminFeedbackTableProps) {
  const [selectedFeedbackId, setSelectedFeedbackId] = useState<string | null>(null);

  return (
    <>
      <DataTable
        data={feedbacks}
        rowKey={(row) => row.id}
        emptyMessage="Aucun message ne correspond aux critères sélectionnés."
        columns={[
          {
            key: "submittedAt",
            header: "Date",
            sortable: true,
            accessor: (row) => new Date(row.submittedAt).getTime(),
            render: (row) => (
              <span className="text-xs text-muted-foreground whitespace-nowrap">
                {new Date(row.submittedAt).toLocaleDateString("fr-FR", {
                  day: "2-digit",
                  month: "2-digit",
                  year: "numeric",
                })}
              </span>
            ),
          },
          {
            key: "type",
            header: "Type",
            sortable: true,
            accessor: (row) => row.type,
            render: (row) => (
              <Badge variant={row.type === "COLLABORATION" ? "warning" : "info"}>
                {row.type === "COLLABORATION" ? "Collaboration" : "Conditions de travail"}
              </Badge>
            ),
          },
          {
            key: "source",
            header: "Origine",
            sortable: true,
            accessor: (row) => row.source,
            render: (row) => (
              <Badge variant={row.source === "PUBLIC" ? "info" : "neutral"}>
                {row.source === "PUBLIC" ? "Public" : "Interne"}
              </Badge>
            ),
          },
          {
            key: "recipient",
            header: "Destinataire",
            accessor: (row) => row.recipientPseudo ?? "",
            render: (row) => (
              <span className="text-xs font-mono text-muted-foreground">
                {row.recipientPseudo ?? "—"}
              </span>
            ),
          },
          {
            key: "content",
            header: "Contenu",
            render: (row) => (
              <div className="max-w-md py-1">
                <p className="line-clamp-2 text-sm text-foreground whitespace-pre-wrap">
                  {row.content}
                </p>
                {row.isModerated && row.motifModeration && (
                  <p className="mt-1 text-xs text-destructive">
                    <span className="font-semibold">Motif :</span> {row.motifModeration}
                  </p>
                )}
              </div>
            ),
          },
          {
            key: "statut",
            header: "Statut",
            sortable: true,
            accessor: (row) => (row.isModerated ? 1 : 0),
            render: (row) => (
              <Badge variant={row.isModerated ? "danger" : "success"}>
                {row.isModerated ? "Modéré" : "Actif"}
              </Badge>
            ),
          },
          {
            key: "actions",
            header: "Actions",
            render: (row) => {
              if (row.isModerated) {
                return (
                  <span className="text-xs italic text-muted-foreground">
                    Retiré {row.moderatedByNom ? `par ${row.moderatedByNom}` : ""}
                  </span>
                );
              }
              return (
                <Button
                  type="button"
                  variant="danger"
                  className="px-2 py-1 text-xs"
                  onClick={() => setSelectedFeedbackId(row.id)}
                >
                  Modérer
                </Button>
              );
            },
          },
        ]}
      />

      {selectedFeedbackId && (
        <ModererFeedbackDialog
          feedbackId={selectedFeedbackId}
          onSuccess={() => setSelectedFeedbackId(null)}
          onCancel={() => setSelectedFeedbackId(null)}
        />
      )}
    </>
  );
}
