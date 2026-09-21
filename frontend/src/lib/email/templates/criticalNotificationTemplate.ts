import { baseEmailLayout } from "./baseEmailLayout";

interface CriticalNotificationEmailParams {
  recipientName: string;
  titre: string;
  message: string;
  lien?: string | null;
  category?: string;
}

export function generateCriticalNotificationEmail({
  recipientName,
  titre,
  message,
  lien,
  category = "SIM Assurances",
}: CriticalNotificationEmailParams): { subject: string; html: string; text: string } {
  const subject = `[ALERTE] ${titre} — SIM Assurances`;

  const appUrl = process.env.NEXTAUTH_URL || process.env.AUTH_URL || "http://localhost:3000";
  const actionUrl = lien ? (lien.startsWith("http") ? lien : `${appUrl}${lien}`) : appUrl;

  const contentHtml = `
    <div style="margin-bottom: 24px;">
      <span style="display: inline-block; padding: 4px 12px; background-color: #FEE2E2; color: #DC2626; border-radius: 12px; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px;">
        Priorité Haute • ${category}
      </span>
    </div>

    <h2 style="color: #0B1B3D; font-size: 20px; font-weight: 700; margin-top: 0; margin-bottom: 16px;">
      Bonjour ${recipientName},
    </h2>

    <p style="color: #334155; font-size: 15px; line-height: 1.6; margin-bottom: 20px;">
      Une notification prioritaire vous concerne sur le portail d'entreprise :
    </p>

    <div style="background-color: #F8FAFC; border-left: 4px solid #DC2626; padding: 16px 20px; border-radius: 0 8px 8px 0; margin-bottom: 28px;">
      <h3 style="margin: 0 0 8px 0; color: #0F172A; font-size: 16px; font-weight: 600;">
        ${titre}
      </h3>
      <p style="margin: 0; color: #475569; font-size: 14px; line-height: 1.5; white-space: pre-line;">
        ${message}
      </p>
    </div>

    <div style="text-align: center; margin-bottom: 28px;">
      <a href="${actionUrl}" style="display: inline-block; background-color: #004B9C; color: #FFFFFF; text-decoration: none; padding: 12px 28px; border-radius: 6px; font-weight: 600; font-size: 14px;">
        Accéder au portail
      </a>
    </div>

    <p style="color: #64748B; font-size: 13px; margin: 0;">
      Si vous n'êtes pas à l'origine de cette demande ou si vous avez des questions, veuillez contacter la Direction ou les Ressources Humaines.
    </p>
  `;

  const html = baseEmailLayout({
    title: subject,
    preheader: message.slice(0, 120),
    contentHtml,
  });

  const text = `
Bonjour ${recipientName},

[ALERTE PRIORITAIRE - ${category}]
${titre}

${message}

Lien d'accès : ${actionUrl}

--
SIM Assurances
  `.trim();

  return { subject, html, text };
}
