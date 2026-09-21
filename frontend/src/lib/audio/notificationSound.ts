/**
 * Lecteur sonore de notification via l'API Web Audio native.
 * Synthétise un carillon professionnel discret et mélodieux ("ding-dong"),
 * sans dépendance à des fichiers audio externes ou risque d'erreur 404.
 */

let audioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;

  try {
    const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return null;

    if (!audioCtx) {
      audioCtx = new AudioContextClass();
    }

    if (audioCtx.state === "suspended") {
      audioCtx.resume().catch(() => {
        // Autoplay policy might block resume until user gesture
      });
    }

    return audioCtx;
  } catch {
    return null;
  }
}

/**
 * Joue un carillon de notification.
 * @param priority "CRITIQUE" | "IMPORTANT" | "INFO"
 */
export function playNotificationSound(priority: "CRITIQUE" | "IMPORTANT" | "INFO" = "INFO"): void {
  const ctx = getAudioContext();
  if (!ctx) return;

  try {
    const now = ctx.currentTime;

    // Pour CRITIQUE : motif d'alerte en 3 temps plus marqué
    // Pour IMPORTANT / INFO : carillon harmonieux doux en 2 temps (523Hz -> 659Hz)
    const notes =
      priority === "CRITIQUE"
        ? [
            { freq: 659.25, time: 0.0, duration: 0.15 }, // E5
            { freq: 523.25, time: 0.15, duration: 0.15 }, // C5
            { freq: 783.99, time: 0.3, duration: 0.35 },  // G5
          ]
        : [
            { freq: 587.33, time: 0.0, duration: 0.18 },  // D5
            { freq: 880.0, time: 0.16, duration: 0.4 },   // A5
          ];

    for (const note of notes) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = "sine";
      osc.frequency.setValueAtTime(note.freq, now + note.time);

      // Volume doux avec enveloppe Attack / Decay
      const peakVolume = priority === "CRITIQUE" ? 0.25 : 0.18;
      gain.gain.setValueAtTime(0.0001, now + note.time);
      gain.gain.exponentialRampToValueAtTime(peakVolume, now + note.time + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + note.time + note.duration);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(now + note.time);
      osc.stop(now + note.time + note.duration + 0.05);
    }
  } catch (err) {
    console.warn("[Audio] Impossible de jouer le son de notification:", err);
  }
}
