/**
 * Gabarit HTML de base pour tous les courriels institutionnels de SIM Assurances.
 * Charte graphique : Bleu institutionnel (#0B1B3D), Bleu primaire (#004B9C), Or (#C5A572).
 * Responsive et compatible avec tous les clients de messagerie (Outlook, Gmail, Apple Mail).
 */
export function baseEmailLayout({
  title,
  preheader,
  contentHtml,
}: {
  title: string;
  preheader?: string;
  contentHtml: string;
}): string {
  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <style>
    body {
      margin: 0;
      padding: 0;
      background-color: #F8FAFC;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      color: #1E293B;
      line-height: 1.6;
    }
    .container {
      max-width: 600px;
      margin: 30px auto;
      background: #FFFFFF;
      border-radius: 12px;
      overflow: hidden;
      border: 1px solid #E2E8F0;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05);
    }
    .header {
      background: linear-gradient(135deg, #0B1B3D 0%, #004B9C 100%);
      padding: 30px 40px;
      text-align: center;
      border-bottom: 4px solid #C5A572;
    }
    .header h1 {
      color: #FFFFFF;
      margin: 0;
      font-size: 22px;
      font-weight: 700;
      letter-spacing: 0.5px;
    }
    .header p {
      color: #E2E8F0;
      margin: 6px 0 0 0;
      font-size: 13px;
      text-transform: uppercase;
      letter-spacing: 1px;
    }
    .content {
      padding: 36px 40px;
    }
    .footer {
      background-color: #F1F5F9;
      padding: 24px 40px;
      text-align: center;
      font-size: 12px;
      color: #64748B;
      border-top: 1px solid #E2E8F0;
    }
    .footer p {
      margin: 4px 0;
    }
    .btn {
      display: inline-block;
      padding: 14px 28px;
      background: #004B9C;
      color: #FFFFFF !important;
      text-decoration: none;
      font-weight: 600;
      font-size: 15px;
      border-radius: 8px;
      margin: 20px 0;
      text-align: center;
      box-shadow: 0 2px 6px rgba(0, 75, 156, 0.3);
    }
    .card {
      background-color: #F8FAFC;
      border: 1px solid #E2E8F0;
      border-radius: 8px;
      padding: 18px 20px;
      margin: 20px 0;
    }
    .module-box {
      border-left: 4px solid #004B9C;
      background-color: #F8FAFC;
      padding: 14px 18px;
      margin-bottom: 16px;
      border-radius: 0 8px 8px 0;
    }
    .badge {
      display: inline-block;
      padding: 3px 10px;
      font-size: 11px;
      font-weight: 700;
      border-radius: 20px;
      background-color: #E0E7FF;
      color: #3730A3;
      text-transform: uppercase;
    }
  </style>
</head>
<body>
  ${preheader ? `<div style="display:none;font-size:1px;color:#F8FAFC;line-height:1px;max-height:0px;max-width:0px;opacity:0;overflow:hidden;">${preheader}</div>` : ""}
  <div class="container">
    <div class="header">
      <h1>SIM ASSURANCES</h1>
      <p>Portail d'Entreprise & Intranet</p>
    </div>
    <div class="content">
      ${contentHtml}
    </div>
    <div class="footer">
      <p><strong>SIM Assurances CI</strong> — Plateforme Interne de Gestion Sécurisée</p>
      <p>Ce message a été généré automatiquement par le Portail RH. Merci de ne pas y répondre directement.</p>
    </div>
  </div>
</body>
</html>`;
}
