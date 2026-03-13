import { Resend } from 'resend';

let resend: Resend;

function getResendClient(): Resend {
  if (!resend) {
    resend = new Resend(process.env.RESEND_API_KEY);
  }
  return resend;
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export async function sendPasswordResetEmail(
  email: string,
  firstName: string,
  resetUrl: string
): Promise<void> {
  const fromEmail = process.env.RESEND_FROM_EMAIL || 'COD Admin <no-reply@codadminpro.com>';

  await getResendClient().emails.send({
    from: fromEmail,
    to: email,
    subject: 'Reset your password - COD Admin',
    html: `
      <p>Hi ${escapeHtml(firstName)},</p>
      <p>We received a request to reset your password. Click the link below to set a new password:</p>
      <p><a href="${escapeHtml(resetUrl)}">${escapeHtml(resetUrl)}</a></p>
      <p>This link will expire in 15 minutes.</p>
      <p>If you didn't request a password reset, you can safely ignore this email.</p>
      <p>— COD Admin Team</p>
    `,
  });
}
