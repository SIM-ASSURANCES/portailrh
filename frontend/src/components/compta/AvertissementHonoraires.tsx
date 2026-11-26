/** Risque R1 (plan GC) : les deux modules calculent les honoraires ; en tête de CHAQUE écran de rémunération, jusqu'à la décision. */
export const MESSAGE_AVERTISSEMENT_R1_HONORAIRES =
  "Le module Encaissements calcule aussi les honoraires. Avant la mise en service, un seul des deux doit faire foi.";
/** GC-9d n'est pas fait : les deux bordereaux d'exemple demandés par le cahier n'ont pas encore été fournis (C-29). */
export const MESSAGE_BORDEREAUX_EN_ATTENTE = "Bordereaux des partenaires : en attente des modèles de fichiers";

export function AvertissementHonoraires() {
  return (
    <>
      <div role="note" data-avertissement-r1 className="rounded-lg border border-warning/40 bg-warning-bg px-4 py-3 text-sm text-warning">
        <strong className="font-bold">Attention.</strong> {MESSAGE_AVERTISSEMENT_R1_HONORAIRES}
      </div>
      <p data-bordereaux-en-attente className="rounded-lg border border-border bg-surface px-4 py-3 text-sm text-muted-foreground">
        {MESSAGE_BORDEREAUX_EN_ATTENTE}
      </p>
    </>
  );
}
