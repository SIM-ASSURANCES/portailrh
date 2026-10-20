"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { SIGNATURE_CADRE_HAUTEUR, SIGNATURE_CADRE_LARGEUR } from "backend/client";

import { Button } from "@/components/ui";

interface SignaturePadProps {
  /** Envoie l'image au serveur ; renvoie un message d'erreur, ou `null` si l'enregistrement a réussi. */
  onEnregistrer: (dataUrl: string) => Promise<string | null>;
  libelleEnregistrer?: string;
  /** Appelé après un enregistrement réussi. */
  onEnregistre?: () => void;
}

/**
 * Cadre de dessin de la signature (souris, stylet ou doigt). `touch-action: none` : le doigt dessine sans faire défiler la page.
 * L'image envoyée est un PNG transparent de 600 × 200 ; le serveur la revalide entièrement (rien n'est cru du navigateur).
 */
export function SignaturePad({ onEnregistrer, libelleEnregistrer = "Enregistrer", onEnregistre }: SignaturePadProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dessin = useRef<{ actif: boolean; x: number; y: number; id: number | null }>({ actif: false, x: 0, y: 0, id: null });
  const [aTrace, setATrace] = useState(false);
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  const contexte = useCallback(() => {
    const ctx = canvasRef.current?.getContext("2d");
    if (ctx) {
      ctx.lineWidth = 3;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.strokeStyle = "#111111";
      ctx.fillStyle = "#111111";
    }
    return ctx;
  }, []);

  useEffect(() => {
    contexte();
  }, [contexte]);

  function point(e: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current!;
    const r = canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - r.left) * canvas.width) / r.width,
      y: ((e.clientY - r.top) * canvas.height) / r.height,
    };
  }

  function debut(e: React.PointerEvent<HTMLCanvasElement>) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    e.preventDefault();
    const ctx = contexte();
    if (!ctx) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = point(e);
    dessin.current = { actif: true, x: p.x, y: p.y, id: e.pointerId };
    // Un simple appui laisse un point.
    ctx.beginPath();
    ctx.arc(p.x, p.y, 1.5, 0, Math.PI * 2);
    ctx.fill();
    setATrace(true);
    setErreur(null);
  }

  function trait(e: React.PointerEvent<HTMLCanvasElement>) {
    const d = dessin.current;
    if (!d.actif || d.id !== e.pointerId) return;
    e.preventDefault();
    const ctx = contexte();
    if (!ctx) return;
    const p = point(e);
    ctx.beginPath();
    ctx.moveTo(d.x, d.y);
    // Courbe lissée vers le milieu du segment.
    ctx.quadraticCurveTo(d.x, d.y, (d.x + p.x) / 2, (d.y + p.y) / 2);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    d.x = p.x;
    d.y = p.y;
  }

  function fin(e: React.PointerEvent<HTMLCanvasElement>) {
    if (dessin.current.id === e.pointerId) dessin.current = { actif: false, x: 0, y: 0, id: null };
  }

  function effacer() {
    const canvas = canvasRef.current;
    canvas?.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
    setATrace(false);
    setErreur(null);
  }

  async function enregistrer() {
    const canvas = canvasRef.current;
    if (!canvas || !aTrace) return;
    setEnvoi(true);
    setErreur(null);
    try {
      const message = await onEnregistrer(canvas.toDataURL("image/png"));
      if (message) setErreur(message);
      else {
        effacer();
        onEnregistre?.();
      }
    } catch {
      setErreur("L'enregistrement de la signature a échoué. Réessayez.");
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <div className="space-y-3" data-signature-pad>
      <div className="rounded-lg border-2 border-dashed border-border bg-white">
        <canvas
          ref={canvasRef}
          width={SIGNATURE_CADRE_LARGEUR}
          height={SIGNATURE_CADRE_HAUTEUR}
          aria-label="Cadre de signature : dessinez votre signature à la souris ou au doigt"
          data-signature-canvas
          className="block h-auto w-full cursor-crosshair select-none rounded-lg"
          style={{ touchAction: "none", aspectRatio: `${SIGNATURE_CADRE_LARGEUR} / ${SIGNATURE_CADRE_HAUTEUR}` }}
          onPointerDown={debut}
          onPointerMove={trait}
          onPointerUp={fin}
          onPointerCancel={fin}
          onContextMenu={(e) => e.preventDefault()}
        />
      </div>
      {erreur ? (
        <p role="alert" className="text-sm font-medium text-danger" data-signature-erreur>
          {erreur}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="secondary" onClick={effacer} disabled={envoi || !aTrace}>
          Effacer
        </Button>
        <Button type="button" onClick={enregistrer} disabled={!aTrace} loading={envoi}>
          {libelleEnregistrer}
        </Button>
      </div>
    </div>
  );
}
