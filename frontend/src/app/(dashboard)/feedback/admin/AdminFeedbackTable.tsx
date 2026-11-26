"use client";

import { useState } from "react";
import { Badge, Button, DataTable } from "@/components/ui";
import type { AdminFeedbackEntry } from "backend";
import { DetailFeedbackDialog } from "./DetailFeedbackDialog";
import { ModererFeedbackDialog } from "./ModererFeedbackDialog";

interface AdminFeedbackTableProps {
  feedbacks: AdminFeedbackEntry[];
  /** `feedback.voir_details` : `destinataire` est alors un nom réel, et la colonne devient triable. */
  voirDetails: boolean;
}

/** Clé de tri d'un nom : sans accents ni casse (« Éric » se classe à E). */
const cleTri = (nom: string) => nom.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();

export function AdminFeedbackTable({ feedbacks, voirDetails }: AdminFeedbackTableProps) {
  const [selectedFeedbackId, setSelectedFeedbackId] = useState<string | null>(null);
  const [detail, setDetail] = useState<AdminFeedbackEntry | null>(null);

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
            sortable: voirDetails,
            accessor: (row) => (voirDetails && row.destinataire ? cleTri(row.destinataire) : null),
            render: (row) => (
              <span
                data-destinataire
                className={voirDetails ? "text-sm text-foreground" : "text-xs font-mono text-muted-foreground"}
              >
                {row.destinataire ?? "—"}
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
            render: (row) => (
              <div className="flex flex-wrap items-center gap-2">
                <Button type="button" variant="secondary" className="px-2 py-1 text-xs" onClick={() => setDetail(row)}>
                  Voir
                </Button>
                {row.isModerated ? (
                  <span className="text-xs italic text-muted-foreground">
                    Retiré {row.moderatedByNom ? `par ${row.moderatedByNom}` : ""}
                  </span>
                ) : (
                  <Button
                    type="button"
                    variant="danger"
                    className="px-2 py-1 text-xs"
                    onClick={() => setSelectedFeedbackId(row.id)}
                  >
                    Modérer
                  </Button>
                )}
              </div>
            ),
          },
        ]}
      />

      {detail && <DetailFeedbackDialog feedback={detail} onClose={() => setDetail(null)} />}

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
