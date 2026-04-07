import { Resend } from 'resend';

const resend = process.env.RESEND_API_KEY
  ? new Resend(process.env.RESEND_API_KEY)
  : null;

const FROM_EMAIL = process.env.RESEND_FROM_EMAIL || 'noreply@yourdomain.com';

export function generateVerificationCode(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

export async function sendVerificationEmail(email: string, code: string, type: 'verification' | 'password-reset' = 'verification'): Promise<void> {
  if (!resend) {
    console.warn(`[DEV] ${type === 'password-reset' ? 'Password reset token' : 'Verification code'} for ${email}: ${code}`);
    return;
  }

  const isPasswordReset = type === 'password-reset';
  const subject = isPasswordReset ? 'Reset your password - PostDownloader' : 'Verify your email - PostDownloader';
  const title = isPasswordReset ? 'Password Reset' : 'Email Verification';
  const description = isPasswordReset ? 'Your password reset token is:' : 'Your verification code is:';
  const expiry = isPasswordReset ? '15 minutes' : '15 minutes';

  await resend.emails.send({
    from: FROM_EMAIL,
    to: email,
    subject,
    html: `
      <h2>${title}</h2>
      <p>${description}</p>
      <h1 style="letter-spacing: 8px; font-size: 36px; text-align: center; font-family: monospace;">${code}</h1>
      <p>This ${isPasswordReset ? 'token' : 'code'} expires in ${expiry}.</p>
      <p>If you did not request this, please ignore this email.</p>
    `,
  });
}
