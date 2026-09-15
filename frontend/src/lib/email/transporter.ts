import { prisma } from "backend";

export interface SendEmailOptions {
  to: string;
  subject: string;
  html: string;
  text?: string;
  userId?: string;
}

export interface SendEmailResult {
  success: boolean;
  simulated: boolean;
  message?: string;
  error?: string;
}

/**
 * Service d'envoi d'emails universel pour SIM Assurances.
 *
 * Mode Hybride :
 * 1. Si `SMTP_HOST` est configuré dans `.env` : expédie le courriel réel via SMTP (TLS/SSL).
 * 2. Si `SMTP_HOST` n'est PAS configuré (ex: en dev ou avant réception des accès réseau) :
 *    - Ne plante JAMAIS le serveur.
 *    - Affiche le mail formaté dans la console avec le lien direct cliquable.
 *    - Crée une notification interne dans le portail (si `userId` fourni) pour tester le parcours en 1 clic.
 */
export async function sendEmail({
  to,
  subject,
  html,
  text,
  userId,
}: SendEmailOptions): Promise<SendEmailResult> {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || 587);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const from = process.env.SMTP_FROM || `"SIM Assurances" <${user || "portail@sim-assurances.ci"}>`;
  const isSecure = process.env.SMTP_SECURE === "true" || port === 465;

  // Extraction d'un éventuel lien d'action pour affichage pratique en console dev
  const linkMatch = html.match(/href="([^"]*(?:reset-password|invitation|login)[^"]*)"/i);
  const actionLink = linkMatch ? linkMatch[1] : null;

  // ─────────────────────────────────────────────────────────────────────────
  // A. Si aucun serveur SMTP n'est configuré -> Mode Simulation Développement
  // ─────────────────────────────────────────────────────────────────────────
  if (!host || !user || !pass) {
    console.log("\n" + "=".repeat(78));
    console.log("📨 [SIMULATION EMAIL SIM ASSURANCES — AUCUN SERVEUR SMTP CONFIGURÉ]");
    console.log("=".repeat(78));
    console.log(`À           : ${to}`);
    console.log(`Sujet       : ${subject}`);
    if (actionLink) {
      console.log(`🔗 LIEN REÇU : ${actionLink}`);
    }
    console.log("-".repeat(78));
    console.log("💡 Pour envoyer de vrais courriels, renseignez les variables SMTP dans .env :");
    console.log("   SMTP_HOST=... | SMTP_PORT=587 | SMTP_USER=... | SMTP_PASS=...");
    console.log("=".repeat(78) + "\n");

    // Enregistrement d'une notification dans le portail si l'utilisateur existe
    if (userId && actionLink) {
      try {
        await prisma.notification.create({
          data: {
            userId,
            titre: subject,
            message: `[Email simulé en dev] Cliquez pour ouvrir le lien : ${actionLink}`,
            lien: actionLink.replace(/^https?:\/\/[^/]+/, ""),
          },
        });
      } catch {
        // Silencieux si l'utilisateur n'est pas encore persisté ou inexistant
      }
    }

    return {
      success: true,
      simulated: true,
      message: "Email simulé dans la console serveur (SMTP non configuré).",
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // B. Envoi réel via Nodemailer
  // ─────────────────────────────────────────────────────────────────────────
  try {
    // Import dynamique pour éviter tout blocage au build si nodemailer n'est pas encore installé
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const nodemailer: any = await import("nodemailer").catch(() => null);

    if (!nodemailer) {
      console.warn("⚠️ Le module 'nodemailer' n'est pas installé. Exécutez 'npm install' pour activer l'envoi réel.");
      return {
        success: true,
        simulated: true,
        message: "Module nodemailer absent, email simulé.",
      };
    }

    const transporter = nodemailer.createTransport({
      host,
      port,
      secure: isSecure,
      auth: {
        user,
        pass,
      },
      tls: {
        // Tolérance pour les certificats auto-signés d'entreprise si nécessaire
        rejectUnauthorized: process.env.NODE_ENV === "production",
      },
    });

    await transporter.sendMail({
      from,
      to,
      subject,
      text: text || html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(),
      html,
    });

    return {
      success: true,
      simulated: false,
      message: `Email envoyé avec succès à ${to}.`,
    };
  } catch (error) {
    console.error("❌ Erreur lors de l'envoi de l'email via SMTP:", error);
    return {
      success: false,
      simulated: false,
      error: error instanceof Error ? error.message : "Erreur inconnue lors de l'envoi.",
    };
  }
}
