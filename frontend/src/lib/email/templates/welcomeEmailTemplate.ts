import { baseEmailLayout } from "./baseEmailLayout";

interface WelcomeEmailParams {
  fullName: string;
  email: string;
  roleName: string;
  serviceName?: string | null;
  actionUrl: string;
  isInvitation?: boolean;
}

export function generateWelcomeEmail({
  fullName,
  email,
  roleName,
  serviceName,
  actionUrl,
  isInvitation = false,
}: WelcomeEmailParams): { subject: string; html: string; text: string } {
  const subject = "Bienvenue sur le Portail SIM Assurances — Vos accès et documentation";

  // Documentation spécifique selon le rôle
  const roleLower = roleName.toLowerCase();
  const isRH = roleLower.includes("rh");
  const isFinance = roleLower.includes("finan") || roleLower.includes("caisse");
  const isDG = roleLower.includes("dg") || roleLower.includes("direction");
  const isAdmin = roleLower.includes("admin");

  const docPointage = `
    <div style="border: 1px solid #E2E8F0; border-left: 3px solid #004B9C; background-color: #F8FAFC; padding: 14px 18px; margin-bottom: 14px; border-radius: 4px;">
      <h4 style="margin: 0 0 6px 0; color: #004B9C; font-size: 13.5px; font-weight: 700;">⏱️ Module Pointage RH</h4>
      <p style="margin: 0 0 6px 0; font-size: 12.5px; color: #334155;">
        Le suivi de votre présence s'effectue quotidiennement sur le portail :
      </p>
      <ul style="margin: 0; padding-left: 18px; font-size: 12.5px; color: #475569; line-height: 1.55;">
        <li><strong>Arrivée réglementaire :</strong> Pointage attendu à partir de <strong>07h45</strong>.</li>
        <li><strong>Départ réglementaire :</strong> Pointage de fin de journée à partir de <strong>16h45</strong>.</li>
        <li><strong>Modes de pointage autorisés :</strong> Depuis votre poste sur le réseau de l'agence ou par QR code géolocalisé.</li>
        <li><strong>Gestion des retards :</strong> Tout retard exige la saisie d'un motif soumis à validation RH.</li>
      </ul>
    </div>
  `;

  const docTresorerie = `
    <div style="border: 1px solid #E2E8F0; border-left: 3px solid #51AEE2; background-color: #F8FAFC; padding: 14px 18px; margin-bottom: 14px; border-radius: 4px;">
      <h4 style="margin: 0 0 6px 0; color: #004B9C; font-size: 13.5px; font-weight: 700;">💳 Module Trésorerie & Achats</h4>
      <p style="margin: 0 0 6px 0; font-size: 12.5px; color: #334155;">
        Gestion dématérialisée des dépenses et achats professionnels :
      </p>
      <ul style="margin: 0; padding-left: 18px; font-size: 12.5px; color: #475569; line-height: 1.55;">
        <li><strong>Création de demande :</strong> Soumettez vos devis et articles avec affectation budgétaire.</li>
        <li><strong>Circuit d'approbation :</strong> Suivi en temps réel de la validation Finance et Direction Générale.</li>
        <li><strong>Règlement & Reçu :</strong> Téléchargement du bon de caisse dès confirmation du paiement.</li>
        <li><strong>Retour de caisse :</strong> Justification obligatoire des avances avec pièces justificatives.</li>
      </ul>
    </div>
  `;

  let specificRoleDoc = "";

  if (isRH) {
    specificRoleDoc = `
      <div style="border: 1px solid #E2E8F0; border-left: 3px solid #004B9C; background-color: #F8FAFC; padding: 14px 18px; margin-bottom: 14px; border-radius: 4px;">
        <h4 style="margin: 0 0 6px 0; color: #004B9C; font-size: 13.5px; font-weight: 700;">🛡️ Prérogatives Ressources Humaines (RH)</h4>
        <ul style="margin: 0; padding-left: 18px; font-size: 12.5px; color: #475569; line-height: 1.55;">
          <li><strong>Supervision des présences :</strong> Tableau de bord des collaborateurs présents, retards et absences.</li>
          <li><strong>Gestion des anomalies :</strong> Régularisation exceptionnelle des pointages et examen des motifs.</li>
          <li><strong>Calendrier :</strong> Paramétrage des jours fériés légaux et des règles de pointage.</li>
        </ul>
      </div>
    `;
  } else if (isFinance) {
    specificRoleDoc = `
      <div style="border: 1px solid #E2E8F0; border-left: 3px solid #004B9C; background-color: #F8FAFC; padding: 14px 18px; margin-bottom: 14px; border-radius: 4px;">
        <h4 style="margin: 0 0 6px 0; color: #004B9C; font-size: 13.5px; font-weight: 700;">📊 Prérogatives Finance & Trésorerie</h4>
        <ul style="margin: 0; padding-left: 18px; font-size: 12.5px; color: #475569; line-height: 1.55;">
          <li><strong>Catégorisation budgétaire :</strong> Contrôle des enveloppes et imputation analytique.</li>
          <li><strong>Décaissements :</strong> Exécution des règlements et émission des reçus officiels.</li>
          <li><strong>Clôture des avances :</strong> Réconciliation comptable des factures acquittées.</li>
        </ul>
      </div>
    `;
  } else if (isDG) {
    specificRoleDoc = `
      <div style="border: 1px solid #E2E8F0; border-left: 3px solid #004B9C; background-color: #F8FAFC; padding: 14px 18px; margin-bottom: 14px; border-radius: 4px;">
        <h4 style="margin: 0 0 6px 0; color: #004B9C; font-size: 13.5px; font-weight: 700;">🏛️ Prérogatives Direction Générale</h4>
        <ul style="margin: 0; padding-left: 18px; font-size: 12.5px; color: #475569; line-height: 1.55;">
          <li><strong>Arbitrage :</strong> Approbation finale des engagements de dépenses.</li>
          <li><strong>Clôture financière :</strong> Validation définitive de la conformité des retours de caisse.</li>
          <li><strong>Indicateurs :</strong> Tableaux de bord synthétiques de pilotage interne.</li>
        </ul>
      </div>
    `;
  } else if (isAdmin) {
    specificRoleDoc = `
      <div style="border: 1px solid #E2E8F0; border-left: 3px solid #004B9C; background-color: #F8FAFC; padding: 14px 18px; margin-bottom: 14px; border-radius: 4px;">
        <h4 style="margin: 0 0 6px 0; color: #004B9C; font-size: 13.5px; font-weight: 700;">⚙️ Prérogatives Administration</h4>
        <ul style="margin: 0; padding-left: 18px; font-size: 12.5px; color: #475569; line-height: 1.55;">
          <li><strong>Gestion des utilisateurs :</strong> Création, activation, désactivation et sécurité des accès.</li>
          <li><strong>Rôles & Permissions :</strong> Attribution granulaire des privilèges par module.</li>
          <li><strong>Sécurité & Audit :</strong> Surveillance et journalisation des flux du portail.</li>
        </ul>
      </div>
    `;
  } else {
    specificRoleDoc = `
      <div style="border: 1px solid #E2E8F0; border-left: 3px solid #004B9C; background-color: #F8FAFC; padding: 14px 18px; margin-bottom: 14px; border-radius: 4px;">
        <h4 style="margin: 0 0 6px 0; color: #004B9C; font-size: 13.5px; font-weight: 700;">👤 Vos Droits Collaborateur</h4>
        <p style="margin: 0; font-size: 12.5px; color: #475569; line-height: 1.55;">
          Vous avez accès à votre espace pour enregistrer vos pointages quotidiens, suivre vos heures et émettre vos demandes professionnelles.
        </p>
      </div>
    `;
  }

  const actionButtonText = isInvitation
    ? "Activer mon compte & Définir mon mot de passe"
    : "Accéder au Portail SIM Assurances";

  const contentHtml = `
    <div style="margin-bottom: 20px;">
      <span class="badge badge-primary" style="display: inline-block; padding: 3px 10px; font-size: 11px; font-weight: 700; border-radius: 4px; text-transform: uppercase; background-color: #EAF2FA; color: #004B9C; border: 1px solid #C5DCF4; letter-spacing: 0.4px;">
        Bienvenue
      </span>
    </div>

    <h2 style="color: #004B9C; margin-top: 0; margin-bottom: 14px; font-size: 18px; font-weight: 700; line-height: 1.3;">
      Bienvenue sur le Portail SIM Assurances !
    </h2>
    
    <p style="color: #334155; font-size: 14.5px; margin: 0 0 14px 0; line-height: 1.6;">
      Bonjour <strong>${fullName}</strong>,
    </p>
    
    <p style="color: #334155; font-size: 14.5px; margin: 0 0 18px 0; line-height: 1.6;">
      Votre compte d'accès à la plateforme interne de <strong>SIM Assurances</strong> a été créé avec succès.
    </p>
    
    <!-- CARTE RÉCAPITULATIVE DU PROFIL -->
    <div style="background-color: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 4px; padding: 18px 20px; margin: 20px 0;">
      <h3 style="margin-top: 0; margin-bottom: 12px; font-size: 13.5px; font-weight: 700; color: #004B9C;">
        Récapitulatif de votre profil :
      </h3>
      <table style="width: 100%; font-size: 13.5px; border-collapse: collapse;">
        <tr>
          <td style="padding: 5px 0; color: #64748B; width: 130px;">Nom complet :</td>
          <td style="padding: 5px 0; font-weight: 600; color: #0F172A;">${fullName}</td>
        </tr>
        <tr>
          <td style="padding: 5px 0; color: #64748B;">Identifiant (Email) :</td>
          <td style="padding: 5px 0; font-weight: 600; color: #004B9C;">${email}</td>
        </tr>
        <tr>
          <td style="padding: 5px 0; color: #64748B;">Rôle attribué :</td>
          <td style="padding: 5px 0;">
            <span style="display: inline-block; padding: 2px 8px; font-size: 11px; font-weight: 700; border-radius: 4px; background-color: #EAF2FA; color: #004B9C; border: 1px solid #C5DCF4;">
              ${roleName}
            </span>
          </td>
        </tr>
        ${serviceName ? `
        <tr>
          <td style="padding: 5px 0; color: #64748B;">Service :</td>
          <td style="padding: 5px 0; font-weight: 600; color: #0F172A;">${serviceName}</td>
        </tr>
        ` : ""}
      </table>
    </div>

    <!-- BOUTON D'ACTION PRINCIPALE -->
    <div style="text-align: center; margin: 26px 0;">
      <a href="${actionUrl}" class="btn" target="_blank" style="display: inline-block; padding: 12px 26px; background-color: #004B9C; color: #FFFFFF !important; text-decoration: none; font-weight: 600; font-size: 14px; border-radius: 6px; letter-spacing: 0.2px;">
        ${actionButtonText}
      </a>
    </div>

    ${isInvitation ? `
    <div style="background-color: #F8FAFC; border: 1px solid #E2E8F0; border-left: 3px solid #51AEE2; border-radius: 4px; padding: 14px 18px; margin: 18px 0;">
      <p style="margin: 0; font-size: 12.5px; color: #334155; line-height: 1.55;">
        <strong style="color: #004B9C;">Activation requise :</strong> Ce lien d'invitation est valable pendant 7 jours. Il vous permettra de définir votre mot de passe pour finaliser l'activation de votre compte.
      </p>
    </div>
    ` : `
    <p style="font-size: 12.5px; color: #64748B; text-align: center;">
      Vous pouvez vous connecter dès à présent avec le mot de passe initial qui vous a été transmis.
    </p>
    `}

    <h3 style="color: #004B9C; margin-top: 30px; margin-bottom: 14px; font-size: 15px; font-weight: 700; border-bottom: 1px solid #E2E8F0; padding-bottom: 6px;">
      Guide Pratique & Documentation de vos Modules
    </h3>

    ${docPointage}
    ${docTresorerie}
    ${specificRoleDoc}

    <div style="background-color: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 4px; padding: 14px 18px; margin-top: 20px;">
      <h4 style="margin: 0 0 4px 0; font-size: 12.5px; color: #004B9C; font-weight: 700;">Recommandations de sécurité :</h4>
      <p style="margin: 0; font-size: 11.5px; color: #64748B; line-height: 1.5;">
        Vos identifiants sont strictement personnels. Ne communiquez jamais votre mot de passe à un tiers. En cas d'oubli, la fonction « Mot de passe oublié » vous permet de réinitialiser vos accès à tout moment.
      </p>
    </div>
  `;

  const html = baseEmailLayout({
    title: subject,
    preheader: `Bienvenue ${fullName} — Vos accès au portail interne SIM Assurances.`,
    contentHtml,
  });

  const text = `Bienvenue sur le Portail SIM Assurances, ${fullName} !

Votre compte d'accès a été créé avec les informations suivantes :
- Nom : ${fullName}
- Email : ${email}
- Rôle : ${roleName}
${serviceName ? `- Service : ${serviceName}` : ""}

Pour accéder au portail :
${actionUrl}

Modules disponibles selon vos droits :
- Pointage RH : Pointage quotidien dès 07h45 (arrivée) et 16h45 (départ).
- Trésorerie & Achats : Création de demandes d'achat et justification des retours de caisse.

SIM Assurances Côte d'Ivoire
Direction des Ressources Humaines
`;

  return { subject, html, text };
}
