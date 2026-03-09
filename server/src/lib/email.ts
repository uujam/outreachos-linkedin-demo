import nodemailer from 'nodemailer';

// ─── Notification email constants (F-028) ────────────────────────────────────

/** Event types that also trigger a transactional email (others are in-app only) */
export const HIGH_PRIORITY_EVENTS = [
  'meeting_booked',
  'lead_replied',
  'payment_failed',
  'cap_80_percent',
  'calendly_disconnected',
] as const;

export interface NotificationEmailParams {
  to: string;
  name: string;
  eventType: string;
  title: string;
  body: string;
  linkUrl?: string;
}

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

/**
 * Send a transactional notification email via SMTP (Postmark or SendGrid SMTP relay).
 * Uses the same nodemailer transport as password reset — kept separate from Instantly.
 * Throws on failure so the caller can log and decide handling.
 */
export async function sendNotificationEmail(params: NotificationEmailParams): Promise<void> {
  const transport = createTransport();
  const dashboardBase = process.env.DASHBOARD_URL ?? 'https://app.outreachos.com';
  const ctaUrl = params.linkUrl ? `${dashboardBase}${params.linkUrl}` : dashboardBase;

  await transport.sendMail({
    from: process.env.EMAIL_FROM ?? 'OutreachOS <notifications@outreachos.com>',
    to: params.to,
    subject: params.title,
    text: [
      `Hi ${params.name},`,
      '',
      params.body,
      '',
      `View in dashboard: ${ctaUrl}`,
      '',
      '— OutreachOS',
    ].join('\n'),
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
