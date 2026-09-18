import { baseEmailLayout } from "./baseEmailLayout";

interface AccountStatusEmailParams {
  fullName: string;
  email: string;
  isActive: boolean;
  actionUrl?: string;
  motif?: string | null;
}

/**
 * Génère le courriel notifiant un collaborateur de l'activation ou de la désactivation
 * de son compte utilisateur sur le Portail SIM Assurances.
 */
export function generateAccountStatusEmail({
  fullName,
  email,
  isActive,
  actionUrl,
  motif,
}: AccountStatusEmailParams): { subject: string; html: string; text: string } {
  const loginUrl = actionUrl || "http://localhost:3000/login";

  if (isActive) {
    const subject = "Votre compte Portail SIM Assurances a été réactivé";

    const contentHtml = `
      <div style="margin-bottom: 24px;">
        <span class="badge badge-success" style="display: inline-block; padding: 4px 14px; font-size: 11px; font-weight: 700; border-radius: 9999px; text-transform: uppercase; background-color: #ECFDF5; color: #047857; border: 1px solid #A7F3D0;">
          ✓ Compte Actif
        </span>
      </div>

      <h2 style="color: #0B1B3D; margin-top: 0; margin-bottom: 16px; font-size: 20px; font-weight: 700;">
        Bonjour ${fullName},
      </h2>

      <p style="color: #334155; font-size: 15px; margin: 0 0 16px 0;">
        Nous vous informons que votre compte utilisateur sur le <strong>Portail SIM Assurances</strong> vient d'être réactivé par l'administration des Ressources Humaines.
      </p>

      <div style="background-color: #F8FAFC; border: 1px solid #E2E8F0; border-left: 4px solid #059669; border-radius: 8px; padding: 18px 20px; margin: 24px 0;">
        <h4 style="margin: 0 0 8px 0; color: #065F46; font-size: 14px; font-weight: 700;">
          Vos accès sont de nouveau opérationnels :
        </h4>
        <ul style="margin: 0; padding-left: 18px; font-size: 14px; color: #334155; line-height: 1.6;">
          <li>Pointage quotidien de présence (horaires réglementaires 07h45 / 16h45).</li>
          <li>Gestion des demandes d'achats, trésorerie et avances de caisse.</li>
          <li>Accès aux dossiers, documents et services internes de votre département.</li>
        </ul>
      </div>

      <div style="text-align: center; margin: 32px 0;">
        <a href="${loginUrl}" class="btn btn-success" style="display: inline-block; padding: 13px 28px; background-color: #059669; color: #FFFFFF !important; text-decoration: none; font-weight: 600; font-size: 15px; border-radius: 8px; box-shadow: 0 3px 8px rgba(5, 150, 105, 0.35);">
          Accéder à mon espace collaborateur
        </a>
      </div>

      <p style="font-size: 13px; color: #64748B; margin-top: 24px; border-top: 1px solid #E2E8F0; padding-top: 18px;">
        Si vous éprouvez la moindre difficulté pour vous reconnecter avec vos identifiants habituels (<code>${email}</code>), vous pouvez utiliser le lien « Mot de passe oublié » sur la page de connexion ou contacter le service RH / informatique.
      </p>
    `;

    const html = baseEmailLayout({
      title: subject,
      preheader: `Votre compte utilisateur sur le Portail SIM Assurances a été réactivé.`,
      contentHtml,
    });

    const text = `Bonjour ${fullName},

Votre compte utilisateur sur le Portail SIM Assurances (${email}) a été réactivé avec succès.
Tous vos accès métier (pointage, trésorerie, documents) sont à nouveau opérationnels.

Vous pouvez vous connecter dès à présent à l'adresse suivante :
${loginUrl}

SIM Assurances Côte d'Ivoire
Direction des Ressources Humaines
`;

    return { subject, html, text };
  } else {
    // Cas : Compte désactivé / suspendu
    const subject = "Notification relative à votre accès au Portail SIM Assurances";

    const contentHtml = `
      <div style="margin-bottom: 24px;">
        <span class="badge badge-danger" style="display: inline-block; padding: 4px 14px; font-size: 11px; font-weight: 700; border-radius: 9999px; text-transform: uppercase; background-color: #FEF2F2; color: #B91C1C; border: 1px solid #FECACA;">
          Accès Suspendu
        </span>
      </div>

      <h2 style="color: #0B1B3D; margin-top: 0; margin-bottom: 16px; font-size: 20px; font-weight: 700;">
        Bonjour ${fullName},
      </h2>

      <p style="color: #334155; font-size: 15px; margin: 0 0 16px 0;">
        Nous vous informons que votre accès au <strong>Portail SIM Assurances</strong> a été temporairement suspendu par l'administration.
      </p>

      <div style="background-color: #FFF7ED; border: 1px solid #FFEDD5; border-left: 4px solid #EA580C; border-radius: 8px; padding: 18px 20px; margin: 24px 0;">
        <h4 style="margin: 0 0 8px 0; color: #9A3412; font-size: 14px; font-weight: 700;">
          Conséquences sur vos connexions :
        </h4>
        <p style="margin: 0; font-size: 14px; color: #7C2D12; line-height: 1.6;">
          Vous ne pouvez plus ouvrir de session sur le portail d'entreprise jusqu'à nouvel ordre. Toutes vos sessions actives antérieures ont été déconnectées par mesure de sécurité.
        </p>
        ${motif ? `<p style="margin: 10px 0 0 0; font-size: 13px; color: #9A3412;"><strong>Motif :</strong> ${motif}</p>` : ""}
      </div>

      <div style="background-color: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 8px; padding: 18px 20px; margin: 20px 0;">
        <h4 style="margin: 0 0 8px 0; color: #0B1B3D; font-size: 14px; font-weight: 700;">
          Besoin d'informations complémentaires ?
        </h4>
        <p style="margin: 0; font-size: 13px; color: #475569; line-height: 1.6;">
          Si vous pensez qu'il s'agit d'une erreur ou si vous avez des questions concernant cette décision, nous vous invitons à vous rapprocher directement de la <strong>Direction des Ressources Humaines</strong> de SIM Assurances ou de votre responsable hiérarchique.
        </p>
      </div>

      <p style="font-size: 12px; color: #94A3B8; margin-top: 24px; border-top: 1px solid #E2E8F0; padding-top: 18px;">
        Identifiant du compte concerné : <code>${email}</code>
      </p>
    `;

    const html = baseEmailLayout({
      title: subject,
      preheader: `Votre accès au Portail SIM Assurances a été suspendu par l'administration.`,
      contentHtml,
    });

    const text = `Bonjour ${fullName},

Nous vous informons que votre accès au Portail SIM Assurances (${email}) a été suspendu par l'administration.
Toutes vos sessions actives antérieures ont été déconnectées par mesure de sécurité.

Si vous avez des questions, veuillez contacter la Direction des Ressources Humaines de SIM Assurances.

SIM Assurances Côte d'Ivoire
Direction des Ressources Humaines
`;

    return { subject, html, text };
  }
}
