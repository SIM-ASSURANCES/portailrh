/**
 * Gabarit HTML de base pour tous les courriels institutionnels de SIM Assurances.
 *
 * Charte graphique officielle :
 * - Bleu institutionnel / Nuit : #0B1B3D
 * - Bleu primaire SIM : #004B9C
 * - Bleu secondaire / Ciel : #51AEE2
 * - Or / Doré d'accent : #C5A572
 * - Fond de page : #F1F5F9
 * - Carte de contenu : #FFFFFF
 *
 * Conception hybride (styles en ligne + balises <style>) pour une compatibilité
 * maximale avec tous les clients de messagerie (Outlook desktop/web, Gmail, Apple Mail, mobile).
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
<html lang="fr" xmlns="http://www.w3.org/1999/xhtml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <meta name="x-apple-disable-message-reformatting">
  <title>${title}</title>
  <!--[if mso]>
  <noscript>
    <xml>
      <o:OfficeDocumentSettings>
        <o:PixelsPerInch>96</o:PixelsPerInch>
      </o:OfficeDocumentSettings>
    </xml>
  </noscript>
  <![endif]-->
  <style>
    body {
      margin: 0 !important;
      padding: 0 !important;
      background-color: #F1F5F9 !important;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      color: #1E293B;
      line-height: 1.6;
      -webkit-font-smoothing: antialiased;
    }
    table {
      border-spacing: 0;
      border-collapse: collapse;
      mso-table-lspace: 0pt;
      mso-table-rspace: 0pt;
    }
    td {
      padding: 0;
    }
    img {
      border: 0;
      -ms-interpolation-mode: bicubic;
    }
    .wrapper {
      width: 100%;
      table-layout: fixed;
      background-color: #F1F5F9;
      padding: 30px 10px;
    }
    .main-table {
      max-width: 600px;
      margin: 0 auto;
      background-color: #FFFFFF;
      border-radius: 12px;
      overflow: hidden;
      border: 1px solid #CBD5E1;
      box-shadow: 0 10px 25px -5px rgba(11, 27, 61, 0.08);
    }
    .btn {
      display: inline-block;
      padding: 13px 28px;
      background-color: #004B9C;
      color: #FFFFFF !important;
      text-decoration: none;
      font-weight: 600;
      font-size: 15px;
      border-radius: 8px;
      box-shadow: 0 3px 8px rgba(0, 75, 156, 0.35);
      letter-spacing: 0.2px;
    }
    .btn-danger {
      background-color: #DC2626 !important;
      box-shadow: 0 3px 8px rgba(220, 38, 38, 0.35) !important;
    }
    .btn-success {
      background-color: #059669 !important;
      box-shadow: 0 3px 8px rgba(5, 150, 105, 0.35) !important;
    }
    .badge {
      display: inline-block;
      padding: 4px 12px;
      font-size: 11px;
      font-weight: 700;
      border-radius: 9999px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .badge-primary {
      background-color: #E0F2FE;
      color: #0369A1;
      border: 1px solid #BAE6FD;
    }
    .badge-success {
      background-color: #ECFDF5;
      color: #047857;
      border: 1px solid #A7F3D0;
    }
    .badge-danger {
      background-color: #FEF2F2;
      color: #B91C1C;
      border: 1px solid #FECACA;
    }
    .badge-warning {
      background-color: #FFFBEB;
      color: #B45309;
      border: 1px solid #FDE68A;
    }
    @media only screen and (max-width: 600px) {
      .wrapper {
        padding: 10px !important;
      }
      .content-padding {
        padding: 24px 20px !important;
      }
      .header-padding {
        padding: 24px 20px !important;
      }
    }
  </style>
</head>
<body style="margin: 0; padding: 0; background-color: #F1F5F9; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #1E293B;">
  ${preheader ? `
  <div style="display: none; font-size: 1px; color: #F1F5F9; line-height: 1px; max-height: 0px; max-width: 0px; opacity: 0; overflow: hidden; mso-hide: all;">
    ${preheader}
  </div>` : ""}

  <div class="wrapper" style="width: 100%; background-color: #F1F5F9; padding: 30px 10px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr>
        <td align="center">
          <table role="presentation" class="main-table" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width: 600px; width: 100%; background-color: #FFFFFF; border-radius: 12px; overflow: hidden; border: 1px solid #CBD5E1; box-shadow: 0 10px 25px -5px rgba(11, 27, 61, 0.08);">
            
            <!-- HEADER INSTITUTIONNEL AVEC BANDEAU DORÉ -->
            <tr>
              <td class="header-padding" style="background: #0B1B3D; background: linear-gradient(135deg, #0B1B3D 0%, #004B9C 100%); padding: 32px 36px; text-align: center; border-bottom: 4px solid #C5A572;">
                <!-- Logo SIM Assurances (Typographie stylisée de marque) -->
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                  <tr>
                    <td align="center">
                      <div style="display: inline-block; background: rgba(255, 255, 255, 0.08); border: 1px solid rgba(197, 165, 114, 0.4); border-radius: 8px; padding: 8px 18px; margin-bottom: 12px;">
                        <span style="font-size: 11px; font-weight: 700; letter-spacing: 2px; text-transform: uppercase; color: #C5A572;">
                          Société Ivoirienne de Micro-Assurances
                        </span>
                      </div>
                      <h1 style="color: #FFFFFF; margin: 0; font-size: 24px; font-weight: 800; letter-spacing: 1.5px;">
                        SIM ASSURANCES
                      </h1>
                      <p style="color: #51AEE2; margin: 6px 0 0 0; font-size: 13px; font-weight: 500; letter-spacing: 1px; text-transform: uppercase;">
                        Portail Collaborateur & Ressources Humaines
                      </p>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>

            <!-- CONTENU PRINCIPAL -->
            <tr>
              <td class="content-padding" style="padding: 36px 40px; background-color: #FFFFFF; font-size: 15px; line-height: 1.65; color: #1E293B;">
                ${contentHtml}
              </td>
            </tr>

            <!-- FOOTER INSTITUTIONNEL -->
            <tr>
              <td style="background-color: #0B1B3D; padding: 26px 36px; text-align: center; color: #94A3B8; font-size: 12px; line-height: 1.6; border-top: 1px solid #1E293B;">
                <p style="margin: 0 0 8px 0; color: #E2E8F0; font-weight: 600; font-size: 13px;">
                  SIM Assurances Côte d'Ivoire
                </p>
                <p style="margin: 0 0 10px 0; color: #94A3B8; font-size: 11px;">
                  Plateforme interne sécurisée — Gestion RH, Pointage & Administration
                </p>
                <div style="margin: 12px 0; border-top: 1px solid rgba(255, 255, 255, 0.1); width: 80px; display: inline-block;"></div>
                <p style="margin: 0; font-size: 11px; color: #64748B;">
                  Ce message a été expédié automatiquement par le système d'authentification et de notification du Portail SIM Assurances.<br>
                  Merci de ne pas répondre directement à ce courriel automatique.
                </p>
              </td>
            </tr>

          </table>
        </td>
      </tr>
    </table>
  </div>
</body>
</html>`;
}
