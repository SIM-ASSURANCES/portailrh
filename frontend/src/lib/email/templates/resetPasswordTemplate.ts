import { baseEmailLayout } from "./baseEmailLayout";

export function generateResetPasswordEmail({
  fullName,
  resetUrl,
  expiresInMinutes = 60,
}: {
  fullName: string;
  resetUrl: string;
  expiresInMinutes?: number;
}): { subject: string; html: string; text: string } {
  const subject = "Réinitialisation de votre mot de passe — Portail SIM Assurances";

  const expiryText =
    expiresInMinutes >= 60
      ? `${Math.round(expiresInMinutes / 60)} heure${Math.round(expiresInMinutes / 60) > 1 ? "s" : ""}`
      : `${expiresInMinutes} minute${expiresInMinutes > 1 ? "s" : ""}`;

  const contentHtml = `
    <h2 style="color: #0F172A; margin-top: 0; font-size: 19px;">Bonjour ${fullName},</h2>
    
    <p>Nous avons reçu une demande de réinitialisation du mot de passe associé à votre compte sur le <strong>Portail SIM Assurances</strong>.</p>
    
    <p>Pour définir un nouveau mot de passe et sécuriser l'accès à votre espace, veuillez cliquer sur le bouton ci-dessous :</p>
    
    <div style="text-align: center; margin: 28px 0;">
      <a href="${resetUrl}" class="btn" target="_blank">
        Réinitialiser mon mot de passe
      </a>
    </div>

    <div class="card" style="border-left: 4px solid #F59E0B; background-color: #FFFBEB;">
      <p style="margin: 0; font-size: 13px; color: #92400E;">
        <strong>⏳ Information de sécurité importante :</strong><br>
        Ce lien de réinitialisation est strictement personnel, à usage unique et <strong>expirera dans ${expiryText}</strong>.<br>
        Une fois le mot de passe modifié, toutes vos sessions actives sur d'autres appareils seront automatiquement déconnectées.
      </p>
    </div>

    <p style="font-size: 13px; color: #64748B;">
      Si le bouton ne fonctionne pas, copiez et collez l'adresse suivante dans votre navigateur :<br>
      <a href="${resetUrl}" style="color: #004B9C; word-break: break-all;">${resetUrl}</a>
    </p>

    <hr style="border: none; border-top: 1px solid #E2E8F0; margin: 28px 0;" />

    <p style="font-size: 12px; color: #94A3B8; margin-bottom: 0;">
      Si vous n'êtes pas à l'origine de cette demande, vous pouvez ignorer ce message en toute sécurité : votre compte reste protégé et votre mot de passe actuel ne sera pas modifié.
    </p>
  `;

  const html = baseEmailLayout({
    title: subject,
    preheader: `Lien de réinitialisation de mot de passe (valable ${expiryText}).`,
    contentHtml,
  });

  const text = `Bonjour ${fullName},

Nous avons reçu une demande de réinitialisation de mot de passe pour votre compte sur le Portail SIM Assurances.

Pour réinitialiser votre mot de passe, ouvrez le lien suivant dans votre navigateur (valable ${expiryText}) :
${resetUrl}

Si vous n'avez pas demandé cette réinitialisation, veuillez ignorer cet email.

SIM Assurances CI
`;

  return { subject, html, text };
}
