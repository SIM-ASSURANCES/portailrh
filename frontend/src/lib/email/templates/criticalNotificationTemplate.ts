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
    <div style="margin-bottom: 20px;">
      <span class="badge badge-danger" style="display: inline-block; padding: 3px 10px; font-size: 11px; font-weight: 700; border-radius: 4px; text-transform: uppercase; background-color: #FEF2F2; color: #DC2626; border: 1px solid #FECACA; letter-spacing: 0.4px;">
        Alerte Prioritaire • ${category}
      </span>
    </div>

    <h2 style="color: #004B9C; font-size: 18px; font-weight: 700; margin-top: 0; margin-bottom: 14px; line-height: 1.3;">
      Bonjour ${recipientName},
    </h2>

    <p style="color: #334155; font-size: 14.5px; line-height: 1.6; margin-bottom: 18px;">
      Une notification importante requiert votre attention sur le portail d'entreprise :
    </p>

    <div style="background-color: #F8FAFC; border: 1px solid #E2E8F0; border-left: 3px solid #DC2626; padding: 16px 20px; border-radius: 4px; margin-bottom: 24px;">
      <h3 style="margin: 0 0 6px 0; color: #0F172A; font-size: 15px; font-weight: 700;">
        ${titre}
      </h3>
      <p style="margin: 0; color: #475569; font-size: 13.5px; line-height: 1.55; white-space: pre-line;">
        ${message}
      </p>
    </div>

    <div style="text-align: center; margin-bottom: 26px;">
      <a href="${actionUrl}" class="btn" style="display: inline-block; background-color: #004B9C; color: #FFFFFF !important; text-decoration: none; padding: 12px 26px; border-radius: 6px; font-weight: 600; font-size: 14px; letter-spacing: 0.2px;">
        Accéder au portail
      </a>
    </div>

    <p style="color: #64748B; font-size: 12px; margin: 0; border-top: 1px solid #F1F5F9; padding-top: 14px; line-height: 1.5;">
      Si vous avez des questions ou si vous constatez une anomalie, veuillez contacter votre responsable hiérarchique ou les Ressources Humaines.
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
