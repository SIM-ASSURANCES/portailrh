"use client";

import { useRef } from "react";
import { QRCodeCanvas } from "qrcode.react";
import { Button, Card } from "@/components/ui";
import { Icon } from "@/components/icons";

export interface QRCodeDownloadProps {
  url: string;
  fileName?: string;
  title?: string;
  description?: string;
  size?: number;
}

export function QRCodeDownload({
  url,
  fileName = "qr-code",
  title = "Code QR",
  description = "Scannez ce code pour accéder au service",
  size = 256,
}: QRCodeDownloadProps) {
  const qrRef = useRef<HTMLDivElement>(null);

  const handleDownload = async () => {
    if (!qrRef.current) return;

    const canvas = qrRef.current.querySelector("canvas") as HTMLCanvasElement;
    if (!canvas) return;

    const link = document.createElement("a");
    link.href = canvas.toDataURL("image/png");
    link.download = `${fileName}.png`;
    link.click();
  };

  return (
    <Card className="flex flex-col items-center justify-center gap-6 p-6">
      <div className="text-center">
        <h3 className="text-lg font-bold text-foreground">{title}</h3>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      </div>

      <div
        ref={qrRef}
        className="rounded-lg border-4 border-sim-blue-dark bg-white p-4"
      >
        <QRCodeCanvas
          value={url}
          size={size}
          level="H"
          includeMargin
          fgColor="#004B9C"
          bgColor="#FFFFFF"
        />
      </div>

      <div className="flex flex-col gap-2 w-full sm:flex-row">
        <Button
          variant="primary"
          onClick={handleDownload}
          className="flex-1 gap-2"
        >
          <Icon name="download" className="size-5" />
          Télécharger
        </Button>
        <Button
          variant="secondary"
          onClick={() => {
            const text = `Lien de pointage : ${url}`;
            navigator.clipboard.writeText(text);
          }}
          className="flex-1 gap-2"
        >
          <Icon name="copy" className="size-5" />
          Copier le lien
        </Button>
      </div>

      <p className="text-xs text-center text-muted-foreground">
        URL : <span className="font-mono text-xs break-all">{url}</span>
      </p>
    </Card>
  );
}
