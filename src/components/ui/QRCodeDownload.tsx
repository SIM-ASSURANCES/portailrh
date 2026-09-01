// "use client";

// import { useRef } from "react";
// import { QRCodeCanvas } from "qrcode.react";
// import { Button, Card } from "@/components/ui";
// import { Icon } from "@/components/icons";

// export interface QRCodeDownloadProps {
//   url: string;
//   fileName?: string;
//   title?: string;
//   description?: string;
//   size?: number;
// }

// export function QRCodeDownload({
//   url,
//   fileName = "qr-code",
//   title = "Code QR",
//   description = "Scannez ce code pour accéder au service",
//   size = 256,
// }: QRCodeDownloadProps) {
//   const qrRef = useRef<HTMLDivElement>(null);

//   const handleDownload = async () => {
//     if (!qrRef.current) return;

//     const canvas = qrRef.current.querySelector("canvas") as HTMLCanvasElement;
//     if (!canvas) return;

//     const link = document.createElement("a");
//     link.href = canvas.toDataURL("image/png");
//     link.download = `${fileName}.png`;
//     link.click();
//   };

//   return (
//     <Card className="flex flex-col items-center justify-center gap-6 p-6">
//       <div className="text-center">
//         <h3 className="text-lg font-bold text-foreground">{title}</h3>
//         <p className="mt-1 text-sm text-muted-foreground">{description}</p>
//       </div>

//       <div
//         ref={qrRef}
//         className="rounded-lg border-4 border-sim-blue-dark bg-white p-4"
//       >
//         <QRCodeCanvas
//           value={url}
//           size={size}
//           level="H"
//           includeMargin
//           fgColor="#004B9C"
//           bgColor="#FFFFFF"
//         />
//       </div>

//       <div className="flex flex-col gap-2 w-full sm:flex-row">
//         <Button
//           variant="primary"
//           onClick={handleDownload}
//           className="flex-1 gap-2"
//         >
//           <Icon name="download" className="size-5" />
//           Télécharger
//         </Button>
//         <Button
//           variant="secondary"
//           onClick={() => {
//             const text = `Lien de pointage : ${url}`;
//             navigator.clipboard.writeText(text);
//           }}
//           className="flex-1 gap-2"
//         >
//           <Icon name="copy" className="size-5" />
//           Copier le lien
//         </Button>
//       </div>

//       <p className="text-xs text-center text-muted-foreground">
//         URL : <span className="font-mono text-xs break-all">{url}</span>
//       </p>
//     </Card>
//   );
// }

"use client";

import { useEffect, useRef, useState } from "react";
import { QRCodeCanvas } from "qrcode.react";
import { Button } from "./Button";
import { Card } from "./Card";
import { Icon } from "@/components/icons";

export function QRCodeDownload() {
  const qrRef = useRef<HTMLCanvasElement>(null);
  const [qrUrl, setQrUrl] = useState<string>("");
  const [isMounted, setIsMounted] = useState(false);

  // Hydration safe : récupère l'URL réseau du serveur après le mount
  useEffect(() => {
    const fetchNetworkUrl = async () => {
      try {
        const response = await fetch("/api/network-config");
        const data = await response.json();
        const networkUrl = data.networkUrl || window.location.origin;
        setQrUrl(`${networkUrl}/pointage/qr`);
      } catch (error) {
        console.error("Failed to fetch network config, using localhost:", error);
        setQrUrl(`${window.location.origin}/pointage/qr`);
      }
      setIsMounted(true);
    };

    fetchNetworkUrl();
  }, []);

  const downloadQR = () => {
    const canvas = qrRef.current;
    if (!canvas) return;
    
    // Convertit le Canvas en image téléchargeable
    const pngUrl = canvas.toDataURL("image/png").replace("image/png", "image/octet-stream");
    const downloadLink = document.createElement("a");
    downloadLink.href = pngUrl;
    downloadLink.download = "QR_Code_Pointage_SIM_Assurances.png";
    document.body.appendChild(downloadLink);
    downloadLink.click();
    document.body.removeChild(downloadLink);
  };

  // Ne rend rien tant qu'on n'est pas monté côté client
  if (!isMounted) return null; 

  return (
    <Card className="p-8 flex flex-col items-center space-y-6 max-w-sm mx-auto animate-fade-in-up">
      <div className="text-center">
        <h2 className="text-xl font-bold text-primary">QR Code d&apos;entrée</h2>
        <p className="text-sm text-muted-foreground mt-2">
          À imprimer sur support physique et placer à l&apos;entrée des locaux.
        </p>
      </div>
      
      {/* Fond blanc forcé pour garantir le contraste au scan, même sur thème sombre */}
      <div className="bg-white p-4 rounded-xl shadow-sm border border-border">
        <QRCodeCanvas 
          id="qrCode" 
          value={qrUrl} 
          size={200} 
          level={"H"} // Correction d'erreur élevée (robuste si le QR est un peu abîmé)
          includeMargin={true}
          ref={qrRef}
        />
      </div>

      <Button onClick={downloadQR} className="w-full gap-2">
        <Icon name="download" className="size-5" />
        Télécharger pour impression
      </Button>
    </Card>
  );
}