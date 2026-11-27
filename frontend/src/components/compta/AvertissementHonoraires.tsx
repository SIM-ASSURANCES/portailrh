/** R1 tranché le 2026-11-27 (registre C-41) : mention en tête de CHAQUE écran de rémunération. */
export const MESSAGE_REFERENCE_HONORAIRES = "Gestion Compta est la référence pour les honoraires et la rémunération des partenaires.";
/** GC-9d n'est pas fait : les deux bordereaux d'exemple demandés par le cahier n'ont pas encore été fournis (C-29). */
export const MESSAGE_BORDEREAUX_EN_ATTENTE = "Bordereaux des partenaires : en attente des modèles de fichiers";

export function AvertissementHonoraires() {
  return (
    <>
      <p data-reference-compta className="rounded-lg border border-border bg-info-bg px-4 py-3 text-sm text-info">
        {MESSAGE_REFERENCE_HONORAIRES}
      </p>
      <p data-bordereaux-en-attente className="rounded-lg border border-border bg-surface px-4 py-3 text-sm text-muted-foreground">
        {MESSAGE_BORDEREAUX_EN_ATTENTE}
      </p>
    </>
  );
}
