import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

const fromEmail = process.env.RESEND_FROM_EMAIL || 'COD Admin <no-reply@codadminpro.com>';

export async function sendPasswordResetEmail(
  email: string,
  firstName: string,
  resetUrl: string
): Promise<void> {
  await resend.emails.send({
    from: fromEmail,
    to: email,
    subject: 'Reset your password - COD Admin',
    html: `
      <p>Hi ${firstName},</p>
      <p>We received a request to reset your password. Click the link below to set a new password:</p>
      <p><a href="${resetUrl}">${resetUrl}</a></p>
      <p>This link will expire in 15 minutes.</p>
      <p>If you didn't request a password reset, you can safely ignore this email.</p>
      <p>— COD Admin Team</p>
    `,
  });
}
