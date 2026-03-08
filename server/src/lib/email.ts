import nodemailer from 'nodemailer';

function createTransport() {
  // In production, use Postmark SMTP or SendGrid
  // In test/dev, use Ethereal (nodemailer test account) or a null transport
  if (process.env.NODE_ENV === 'test') {
    return nodemailer.createTransport({ jsonTransport: true });
  }

  return nodemailer.createTransport({
    host: process.env.EMAIL_SMTP_HOST,
    port: parseInt(process.env.EMAIL_SMTP_PORT ?? '587', 10),
    secure: process.env.EMAIL_SMTP_SECURE === 'true',
    auth: {
      user: process.env.EMAIL_SMTP_USER,
      pass: process.env.EMAIL_SMTP_PASS,
    },
  });
}

export async function sendPasswordResetEmail(to: string, resetUrl: string): Promise<void> {
  const transport = createTransport();
  await transport.sendMail({
    from: process.env.EMAIL_FROM ?? 'OutreachOS <noreply@outreachos.com>',
    to,
    subject: 'Reset your OutreachOS password',
    text: [
      'You requested a password reset for your OutreachOS account.',
      '',
      `Reset your password here: ${resetUrl}`,
      '',
      'This link expires in 1 hour. If you did not request a reset, ignore this email.',
    ].join('\n'),
    html: `
      <p>You requested a password reset for your OutreachOS account.</p>
      <p><a href="${resetUrl}">Reset your password</a></p>
      <p>This link expires in 1 hour. If you did not request a reset, ignore this email.</p>
    `,
  });
}
