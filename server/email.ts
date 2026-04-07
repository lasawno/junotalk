import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

const FROM_EMAIL = "JunoTalk <hello@junotalk.app>";

function getAppUrl(): string {
  if (process.env.REPLIT_DEPLOYMENT_URL) {
    return `https://${process.env.REPLIT_DEPLOYMENT_URL}`;
  }
  if (process.env.REPLIT_DEV_DOMAIN) {
    return `https://${process.env.REPLIT_DEV_DOMAIN}`;
  }
  return "https://junotalk.app";
}

function getWelcomeEmailHtml(firstName: string, email: string): string {
  const appUrl = getAppUrl();
  const logoUrl = `${appUrl}/logo.png`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Welcome to JunoTalk!</title>
</head>
<body style="margin:0;padding:0;background-color:#f4f7f6;font-family:'Segoe UI',Tahoma,Geneva,Verdana,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f7f6;padding:40px 20px;">
    <tr>
      <td align="center">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08);">
          
          <!-- Header with Logo -->
          <tr>
            <td style="background:linear-gradient(135deg,#1e4e8c 0%,#2563A8 50%,#1e4e8c 100%);padding:36px 40px 28px;text-align:center;">
              <img src="${logoUrl}" alt="JunoTalk Logo" width="72" height="72" style="display:block;margin:0 auto 16px;border-radius:16px;border:2px solid rgba(255,255,255,0.25);" />
              <h1 style="margin:0 0 6px;font-size:26px;font-weight:700;color:#ffffff;letter-spacing:-0.5px;">Welcome to JunoTalk!</h1>
              <p style="margin:0;font-size:13px;color:rgba(255,255,255,0.85);letter-spacing:1px;text-transform:uppercase;">Connect Beyond Language</p>
            </td>
          </tr>

          <!-- Greeting -->
          <tr>
            <td style="padding:32px 40px 0;">
              <h2 style="margin:0 0 14px;font-size:20px;font-weight:600;color:#1a1a2e;">Hi ${firstName},</h2>
              <p style="margin:0 0 16px;font-size:15px;line-height:1.7;color:#4a4a5a;">
                We're glad you're here! JunoTalk is built to help you have real conversations with anyone, anywhere, no matter what language they speak. Video calls get live translated captions, and chat messages are automatically translated in real time.
              </p>
              <p style="margin:0 0 24px;font-size:15px;line-height:1.7;color:#4a4a5a;">
                Your account is all set up. Here's a quick look at what's waiting for you:
              </p>
            </td>
          </tr>

          <!-- Features -->
          <tr>
            <td style="padding:0 40px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="padding:14px 16px;background-color:#edf2f8;border-radius:8px;">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <td width="40" valign="top" style="padding-right:12px;font-size:20px;">&#127909;</td>
                        <td>
                          <p style="margin:0 0 2px;font-size:14px;font-weight:600;color:#1a1a2e;">1-on-1 Video Calls</p>
                          <p style="margin:0;font-size:13px;color:#6a6a7a;line-height:1.5;">Private video calls with real-time translated captions in your preferred language.</p>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
                <tr><td style="height:10px;"></td></tr>
                <tr>
                  <td style="padding:14px 16px;background-color:#edf2f8;border-radius:8px;">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <td width="40" valign="top" style="padding-right:12px;font-size:20px;">&#128172;</td>
                        <td>
                          <p style="margin:0 0 2px;font-size:14px;font-weight:600;color:#1a1a2e;">Translated Chat</p>
                          <p style="margin:0;font-size:13px;color:#6a6a7a;line-height:1.5;">Send messages that are automatically translated for your chat partner in real time.</p>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
                <tr><td style="height:10px;"></td></tr>
                <tr>
                  <td style="padding:14px 16px;background-color:#edf2f8;border-radius:8px;">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <td width="40" valign="top" style="padding-right:12px;font-size:20px;">&#127760;</td>
                        <td>
                          <p style="margin:0 0 2px;font-size:14px;font-weight:600;color:#1a1a2e;">5 Supported Languages</p>
                          <p style="margin:0;font-size:13px;color:#6a6a7a;line-height:1.5;">English, Spanish, French, Chinese (Mandarin), and Hindi, with more on the way.</p>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
                <tr><td style="height:10px;"></td></tr>
                <tr>
                  <td style="padding:14px 16px;background-color:#edf2f8;border-radius:8px;">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <td width="40" valign="top" style="padding-right:12px;font-size:20px;">&#128274;</td>
                        <td>
                          <p style="margin:0 0 2px;font-size:14px;font-weight:600;color:#1a1a2e;">Private & Secure</p>
                          <p style="margin:0;font-size:13px;color:#6a6a7a;line-height:1.5;">Rooms are protected by unique 6-digit codes. Your conversations stay private.</p>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Getting Started -->
          <tr>
            <td style="padding:28px 40px 0;">
              <h3 style="margin:0 0 12px;font-size:16px;font-weight:600;color:#1a1a2e;">Get Started in 3 Steps</h3>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="padding:8px 0;">
                    <p style="margin:0;font-size:14px;color:#4a4a5a;line-height:1.6;">
                      <span style="display:inline-block;width:24px;height:24px;background-color:#2563A8;color:#fff;border-radius:50%;text-align:center;line-height:24px;font-size:12px;font-weight:700;margin-right:10px;">1</span>
                      Create a room and share the 6-digit code with a friend
                    </p>
                  </td>
                </tr>
                <tr>
                  <td style="padding:8px 0;">
                    <p style="margin:0;font-size:14px;color:#4a4a5a;line-height:1.6;">
                      <span style="display:inline-block;width:24px;height:24px;background-color:#2563A8;color:#fff;border-radius:50%;text-align:center;line-height:24px;font-size:12px;font-weight:700;margin-right:10px;">2</span>
                      Set your preferred language in Settings
                    </p>
                  </td>
                </tr>
                <tr>
                  <td style="padding:8px 0;">
                    <p style="margin:0;font-size:14px;color:#4a4a5a;line-height:1.6;">
                      <span style="display:inline-block;width:24px;height:24px;background-color:#2563A8;color:#fff;border-radius:50%;text-align:center;line-height:24px;font-size:12px;font-weight:700;margin-right:10px;">3</span>
                      Start a video call or chat. Translations happen automatically
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Call to Action Button -->
          <tr>
            <td style="padding:28px 40px 0;text-align:center;">
              <a href="${appUrl}" target="_blank" style="display:inline-block;padding:14px 36px;background-color:#2563A8;color:#ffffff;text-decoration:none;font-size:16px;font-weight:600;border-radius:8px;letter-spacing:0.3px;">Open JunoTalk</a>
              <p style="margin:12px 0 0;font-size:13px;color:#9a9aaa;">or visit ${appUrl}</p>
            </td>
          </tr>

          <!-- Account Info -->
          <tr>
            <td style="padding:28px 40px 0;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f8f9fa;border-radius:8px;border:1px solid #e9ecef;">
                <tr>
                  <td style="padding:16px 20px;">
                    <p style="margin:0 0 4px;font-size:12px;font-weight:600;color:#6a6a7a;text-transform:uppercase;letter-spacing:0.5px;">Your Account</p>
                    <p style="margin:0 0 2px;font-size:14px;color:#1a1a2e;font-weight:500;">${firstName}</p>
                    <p style="margin:0;font-size:13px;color:#6a6a7a;">${email}</p>
                  </td>
                  <td style="padding:16px 20px;text-align:right;" valign="middle">
                    <span style="display:inline-block;padding:4px 12px;background-color:#d6e3f2;color:#2563A8;border-radius:20px;font-size:12px;font-weight:600;">Active</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:32px 40px 36px;">
              <hr style="border:none;border-top:1px solid #e9ecef;margin:0 0 24px;" />
              <p style="margin:0 0 8px;font-size:13px;color:#9a9aaa;text-align:center;">
                You're receiving this because you signed up for JunoTalk.
              </p>
              <p style="margin:0;font-size:13px;color:#9a9aaa;text-align:center;">
                &copy; ${new Date().getFullYear()} JunoTalk. Connect Beyond Language
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function getWelcomeEmailText(firstName: string): string {
  const appUrl = getAppUrl();

  return `Welcome to JunoTalk!

Hi ${firstName},

We're glad you're here! JunoTalk is built to help you have real conversations with anyone, anywhere, no matter what language they speak. Video calls get live translated captions, and chat messages are automatically translated in real time.

Your account is all set up. Here's what's waiting for you:

- 1-on-1 Video Calls: Private video calls with real-time translated captions in your preferred language.
- Translated Chat: Send messages that are automatically translated for your chat partner in real time.
- 5 Supported Languages: English, Spanish, French, Chinese (Mandarin), and Hindi.
- Private & Secure: Rooms are protected by unique 6-digit codes. Your conversations stay private.

Get Started in 3 Steps:
1. Create a room and share the 6-digit code with a friend
2. Set your preferred language in Settings
3. Start a video call or chat. Translations happen automatically

Open JunoTalk: ${appUrl}

- The JunoTalk Team
Connect Beyond Language

(c) ${new Date().getFullYear()} JunoTalk`;
}

function getVerifyEmailHtml(firstName: string, code: string): string {
  const appUrl = getAppUrl();
  const logoUrl = `${appUrl}/logo.png`;
  const digits = code.split("");
  const digitBoxes = digits.map(d =>
    `<td style="width:44px;height:52px;text-align:center;vertical-align:middle;background:#1a2a4a;border:2px solid rgba(96,165,250,0.4);border-radius:10px;font-size:28px;font-weight:700;color:#60a5fa;font-family:monospace;letter-spacing:0;">${d}</td>`
  ).join('<td style="width:8px;"></td>');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Verify your JunoTalk account</title>
</head>
<body style="margin:0;padding:0;background-color:#f4f7f6;font-family:'Segoe UI',Tahoma,Geneva,Verdana,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f7f6;padding:40px 20px;">
    <tr>
      <td align="center">
        <table role="presentation" width="520" cellpadding="0" cellspacing="0" style="background-color:#0d1117;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.3);">
          <tr>
            <td style="background:linear-gradient(135deg,#1e4e8c 0%,#2563A8 50%,#1e4e8c 100%);padding:32px 40px 24px;text-align:center;">
              <img src="${logoUrl}" alt="JunoTalk" width="60" height="60" style="display:block;margin:0 auto 12px;border-radius:14px;border:2px solid rgba(255,255,255,0.2);" />
              <h1 style="margin:0;font-size:22px;font-weight:700;color:#ffffff;letter-spacing:-0.3px;">Verify your account</h1>
            </td>
          </tr>
          <tr>
            <td style="padding:32px 40px 12px;">
              <p style="margin:0 0 8px;font-size:15px;color:#c9d1d9;">Hi ${firstName},</p>
              <p style="margin:0 0 28px;font-size:15px;line-height:1.6;color:#8b949e;">Enter this 6-digit code to verify your JunoTalk account. It expires in 10 minutes.</p>
              <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto 28px;">
                <tr>${digitBoxes}</tr>
              </table>
              <p style="margin:0 0 8px;font-size:13px;color:#6e7681;text-align:center;">Didn't request this? You can safely ignore this email.</p>
            </td>
          </tr>
          <tr>
            <td style="padding:0 40px 32px;">
              <hr style="border:none;border-top:1px solid #21262d;margin:0 0 20px;" />
              <p style="margin:0;font-size:12px;color:#484f58;text-align:center;">&copy; ${new Date().getFullYear()} JunoTalk &mdash; Connect Beyond Language</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

export async function sendVerificationEmail(email: string, firstName: string, code: string): Promise<boolean> {
  if (!process.env.RESEND_API_KEY) return false;
  try {
    const { error } = await resend.emails.send({
      from: FROM_EMAIL,
      to: [email],
      subject: `${code} is your JunoTalk verification code`,
      html: getVerifyEmailHtml(firstName, code),
      text: `Hi ${firstName},\n\nYour JunoTalk verification code is: ${code}\n\nIt expires in 10 minutes. If you didn't request this, you can ignore this email.\n\n— The JunoTalk Team`,
    });
    if (error) { console.error("[Email] Verification email failed:", error.name, error.message); return false; }
    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[Email] Verification email error:", msg);
    return false;
  }
}

export async function sendWelcomeEmail(email: string, firstName: string): Promise<boolean> {
  if (!process.env.RESEND_API_KEY) {
    return false;
  }

  try {
    const { data, error } = await resend.emails.send({
      from: FROM_EMAIL,
      to: [email],
      subject: "Welcome to JunoTalk!",
      html: getWelcomeEmailHtml(firstName, email),
      text: getWelcomeEmailText(firstName),
    });

    if (error) {
      console.error("[Email] Failed to send welcome email:", error.name, error.message);
      return false;
    }

    return true;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("[Email] Error sending welcome email:", msg);
    return false;
  }
}
