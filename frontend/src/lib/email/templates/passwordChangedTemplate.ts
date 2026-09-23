import { baseEmailLayout } from "./baseEmailLayout";

interface PasswordChangedEmailParams {
  fullName: string;
  email: string;
  changedAt?: Date;
  actionUrl?: string;
  resetUrl?: string;
}

/**
 * Génère le courriel d'alerte de sécurité notifiant un collaborateur que son mot de passe
 * a été modifié ou réinitialisé avec succès sur le Portail SIM Assurances.
 */
export function generatePasswordChangedEmail({
  fullName,
  email,
  changedAt = new Date(),
  actionUrl,
  resetUrl,
}: PasswordChangedEmailParams): { subject: string; html: string; text: string } {
  const subject = "Sécurité — Votre mot de passe a bien été modifié";
  const loginUrl = actionUrl || "http://localhost:3000/login";
  const recoveryUrl = resetUrl || "http://localhost:3000/forgot-password";

  const dateFormatted = new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "full",
    timeStyle: "short",
    timeZone: "Africa/Abidjan",
  }).format(changedAt);

  const contentHtml = `
    <div style="margin-bottom: 20px;">
      <span class="badge badge-success" style="display: inline-block; padding: 3px 10px; font-size: 11px; font-weight: 700; border-radius: 4px; text-transform: uppercase; background-color: #F0FDF4; color: #15803D; border: 1px solid #BBF7D0; letter-spacing: 0.4px;">
        Sécurité du Compte
      </span>
    </div>

    <h2 style="color: #004B9C; margin-top: 0; margin-bottom: 14px; font-size: 18px; font-weight: 700; line-height: 1.3;">
      Bonjour ${fullName},
    </h2>

    <p style="color: #334155; font-size: 14.5px; margin: 0 0 14px 0; line-height: 1.6;">
      Nous vous confirmons que le mot de passe associé à votre compte sur le <strong>Portail SIM Assurances</strong> (<code>${email}</code>) a été modifié avec succès le :
    </p>

    <div style="background-color: #F8FAFC; border: 1px solid #E2E8F0; border-left: 3px solid #004B9C; border-radius: 4px; padding: 14px 18px; margin: 18px 0;">
      <p style="margin: 0; font-size: 13.5px; color: #1E293B; font-weight: 600;">
        Date & heure : <span style="color: #004B9C; font-weight: 700;">${dateFormatted} (heure d'Abidjan)</span>
      </p>
      <p style="margin: 4px 0 0 0; font-size: 12px; color: #64748B;">
        Par mesure de sécurité, toutes vos autres sessions actives ont été automatiquement déconnectées.
      </p>
    </div>

    <div style="text-align: center; margin: 26px 0;">
      <a href="${loginUrl}" class="btn" style="display: inline-block; padding: 12px 26px; background-color: #004B9C; color: #FFFFFF !important; text-decoration: none; font-weight: 600; font-size: 14px; border-radius: 6px; letter-spacing: 0.2px;">
        Se connecter au portail
      </a>
    </div>

    <!-- ALERTE SÉCURITÉ EN CAS D'ACTION NON SOLLICITÉE -->
    <div style="background-color: #FEF2F2; border: 1px solid #FECACA; border-left: 3px solid #DC2626; border-radius: 4px; padding: 16px 18px; margin: 24px 0;">
      <h4 style="margin: 0 0 6px 0; color: #991B1B; font-size: 13.5px; font-weight: 700;">
        Vous n'êtes pas à l'origine de cette modification ?
      </h4>
      <p style="margin: 0; font-size: 12.5px; color: #7F1D1D; line-height: 1.55;">
        Si vous n'avez pas demandé ce changement, votre compte est peut-être compromis :
      </p>
      <div style="margin-top: 10px;">
        <a href="${recoveryUrl}" style="color: #DC2626; font-weight: 700; font-size: 13px; text-decoration: underline;">
          → Réinitialiser mon mot de passe en urgence
        </a>
      </div>
      <p style="margin: 6px 0 0 0; font-size: 11.5px; color: #991B1B;">
        Avertissez immédiatement le support informatique ou les Ressources Humaines de SIM Assurances.
      </p>
    </div>

    <p style="font-size: 11.5px; color: #94A3B8; margin-top: 20px; border-top: 1px solid #F1F5F9; padding-top: 14px; line-height: 1.5;">
      Ce message est une notification automatique de sécurité générée pour toute mise à jour de vos identifiants d'accès.
    </p>
  `;

  const html = baseEmailLayout({
    title: subject,
    preheader: `Votre mot de passe a bien été mis à jour le ${dateFormatted}.`,
    contentHtml,
  });

  const text = `Bonjour ${fullName},

Nous vous confirmons que le mot de passe de votre compte Portail SIM Assurances (${email}) a été modifié le ${dateFormatted}.

Si vous êtes bien à l'origine de ce changement, vous pouvez vous connecter avec votre nouveau mot de passe :
${loginUrl}

ATTENTION : Si vous n'avez pas effectué cette modification, votre compte est peut-être compromis. Rendez-vous immédiatement sur la page de réinitialisation d'urgence :
${recoveryUrl}

SIM Assurances Côte d'Ivoire
Direction des Ressources Humaines & Système d'Information
`;

  return { subject, html, text };
}
