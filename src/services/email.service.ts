import nodemailer from 'nodemailer';

const GMAIL_USER = process.env.GMAIL_USER;
const GMAIL_APP_PASSWORD = process.env.GMAIL_APP_PASSWORD;

const transporter = GMAIL_USER && GMAIL_APP_PASSWORD
  ? nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: GMAIL_USER,
        pass: GMAIL_APP_PASSWORD,
      },
    })
  : null;

console.log('[email] Gmail user:', GMAIL_USER ?? 'NOT SET');
console.log('[email] Transporter ready:', transporter ? 'yes' : 'no — emails will be logged to console only');

export function generateVerificationCode(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

export async function sendVerificationEmail(email: string, code: string, type: 'verification' | 'password-reset' = 'verification'): Promise<void> {
  if (!transporter) {
    console.warn(`[DEV] ${type === 'password-reset' ? 'Password reset token' : 'Verification code'} for ${email}: ${code}`);
    return;
  }

  const isPasswordReset = type === 'password-reset';
  const subject = isPasswordReset ? 'Reset your password - PostDownloader' : 'Verify your email - PostDownloader';
  const title = isPasswordReset ? 'Password Reset' : 'Email Verification';
  const description = isPasswordReset ? 'Your password reset token is:' : 'Your verification code is:';

  await transporter.sendMail({
    from: `PostDownloader <${GMAIL_USER}>`,
    to: email,
    subject,
    html: `
      <div style="font-family: system-ui, -apple-system, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px; color: #18181b;">
        <h2 style="margin-bottom: 16px;">${title}</h2>
        <p style="margin-bottom: 12px;">${description}</p>
        <div style="background: #f4f4f5; border-radius: 8px; padding: 24px; text-align: center; margin: 20px 0;">
          <h1 style="letter-spacing: 10px; font-size: 40px; font-family: monospace; margin: 0;">${code}</h1>
        </div>
        <p style="font-size: 14px; color: #71717a;">This code expires in 15 minutes.</p>
        <p style="font-size: 14px; color: #71717a;">If you did not request this, please ignore this email.</p>
      </div>
    `,
  });

  console.log('[email] Verification email sent to', email);
}
