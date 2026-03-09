/**
 * B-015 — Stripe checkout + B-016 webhook + B-017 billing portal.
 *
 * POST /api/stripe/checkout          — create a Checkout Session (F-015)
 * GET  /api/stripe/portal            — create a Customer Portal session (F-016)
 * POST /api/stripe/webhook           — handle Stripe events (raw body required)
 *
 * Checkout success lands on /checkout/success?session_id={CHECKOUT_SESSION_ID}
 * Checkout cancel  lands on /checkout/cancel
 */
import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import bcrypt from 'bcrypt';
import Stripe from 'stripe';
import { requireAuth, AuthRequest } from '../middleware/requireAuth';
import { prisma } from '../lib/prisma';
import { getStripe, STRIPE_PRICES, STRIPE_PRICES_ANNUAL } from '../lib/stripe';
import { getQueues } from '../queues';
import { sendPasswordResetEmail } from '../lib/email';

const router = Router();

const PLAN_NAMES: Record<string, 'Starter' | 'Growth' | 'Enterprise'> = {
  starter: 'Starter',
  growth: 'Growth',
};

// ─── POST /api/stripe/checkout ────────────────────────────────────────────────
// Public — no auth required. Accepts prospect details; account is created after
// payment succeeds via the checkout.session.completed webhook.

router.post('/stripe/checkout', async (req: Request, res: Response) => {
  const { plan, billing = 'monthly', email, name, companyName } = req.body as {
    plan?: string;
    billing?: 'monthly' | 'annual';
    email?: string;
    name?: string;
    companyName?: string;
  };

  if (!plan || !PLAN_NAMES[plan]) {
    res.status(400).json({ error: 'plan must be one of: starter, growth' });
    return;
  }
  if (!email || !name || !companyName) {
    res.status(400).json({ error: 'email, name, and companyName are required' });
    return;
  }

  const priceId = billing === 'annual'
    ? STRIPE_PRICES_ANNUAL[plan]
    : STRIPE_PRICES[plan];

  if (!priceId) {
    res.status(503).json({ error: `Stripe price ID for "${plan}/${billing}" is not configured` });
    return;
  }

  const stripe = getStripe();

  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    line_items: [{ price: priceId, quantity: 1 }],
    customer_email: email,
    // Store prospect details in metadata so the webhook can create the account
    metadata: { plan, billing, email, name, companyName },
    success_url: `${process.env.APP_URL ?? 'http://localhost:3000'}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${process.env.APP_URL ?? 'http://localhost:3000'}/checkout/cancel`,
    subscription_data: {
      metadata: { plan, billing, email, name, companyName },
    },
  });

  res.status(200).json({ url: session.url });
});

// ─── GET /api/stripe/portal ───────────────────────────────────────────────────

router.get('/stripe/portal', requireAuth, async (req: AuthRequest, res: Response) => {
  const clientId = req.user!.sub;

  const subscription = await prisma.subscription.findUnique({
    where: { clientId },
    select: { stripeCustomerId: true },
  });

  if (!subscription?.stripeCustomerId) {
    res.status(404).json({ error: 'No active subscription found' });
    return;
  }

  const stripe = getStripe();
  const session = await stripe.billingPortal.sessions.create({
    customer: subscription.stripeCustomerId,
    return_url: `${process.env.APP_URL ?? 'http://localhost:3000'}/dashboard.html`,
  });

  res.status(200).json({ url: session.url });
});

// ─── POST /api/stripe/webhook ─────────────────────────────────────────────────

router.post('/stripe/webhook', async (req: Request, res: Response) => {
  const sig = req.headers['stripe-signature'] as string;
  const secret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!secret) {
    res.status(500).json({ error: 'Webhook secret not configured' });
    return;
  }

  let event: Stripe.Event;
  try {
    const stripe = getStripe();
    // req.body is a Buffer when the raw body parser is used (wired via express.raw in app.ts)
    event = stripe.webhooks.constructEvent(req.body as Buffer, sig, secret);
  } catch (err) {
    res.status(400).json({ error: `Webhook signature verification failed: ${(err as Error).message}` });
    return;
  }

  try {
    await handleStripeEvent(event);
  } catch (err) {
    console.error('[Stripe webhook] Handler error:', err);
    // Still return 200 to prevent Stripe retrying — we log and alert separately
  }

  res.status(200).json({ received: true });
});

// ─── Event handler ────────────────────────────────────────────────────────────

async function handleStripeEvent(event: Stripe.Event): Promise<void> {
  switch (event.type) {
    case 'checkout.session.completed':
      await handleCheckoutCompleted(event.data.object as Stripe.Checkout.Session);
      break;
    case 'invoice.paid':
      await handleInvoicePaid(event.data.object as Stripe.Invoice);
      break;
    case 'invoice.payment_failed':
      await handlePaymentFailed(event.data.object as Stripe.Invoice);
      break;
    case 'customer.subscription.updated':
      await handleSubscriptionUpdated(event.data.object as Stripe.Subscription);
      break;
    case 'customer.subscription.deleted':
      await handleSubscriptionDeleted(event.data.object as Stripe.Subscription);
      break;
    default:
      break;
  }
}

async function handleCheckoutCompleted(session: Stripe.Checkout.Session): Promise<void> {
  const plan = session.metadata?.plan;
  const email = session.metadata?.email;
  const name = session.metadata?.name;
  const companyName = session.metadata?.companyName;

  if (!plan || !email || !name || !companyName) return;

  const planName = PLAN_NAMES[plan] ?? 'Starter';
  const customerId = session.customer as string;
  const subscriptionId = session.subscription as string;
  const now = new Date();
  const periodEnd = new Date(now.getTime() + 30 * 86400_000);

  // Create the user account if it doesn't already exist (idempotent)
  const randomPassword = crypto.randomBytes(24).toString('hex');
  const hashedPassword = await bcrypt.hash(randomPassword, 10);

  const user = await prisma.user.upsert({
    where: { email },
    create: { email, name, companyName, hashedPassword, role: 'client' },
    update: {}, // never overwrite an existing account's details
  });

  // Create / update the subscription record
  await prisma.subscription.upsert({
    where: { clientId: user.id },
    create: {
      clientId: user.id,
      planName,
      status: 'active',
      stripeCustomerId: customerId,
      stripeSubscriptionId: subscriptionId,
      leadsUsedThisPeriod: 0,
      currentPeriodStart: now,
      currentPeriodEnd: periodEnd,
    },
    update: {
      planName,
      status: 'active',
      stripeCustomerId: customerId,
      stripeSubscriptionId: subscriptionId,
      currentPeriodStart: now,
      currentPeriodEnd: periodEnd,
    },
  });

  // Generate a "set your password" token valid for 24 hours
  const rawToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  await prisma.passwordResetToken.create({
    data: {
      clientId: user.id,
      tokenHash,
      expiresAt: new Date(Date.now() + 24 * 3600_000),
    },
  });

  const appUrl = process.env.APP_URL ?? 'http://localhost:4000';
  const setPasswordUrl = `${appUrl}/reset-password?token=${rawToken}`;

  // Send welcome + set-password email (non-fatal if SMTP not configured)
  try {
    await sendPasswordResetEmail(email, setPasswordUrl);
  } catch (err) {
    console.error('[Checkout] Failed to send welcome email:', err);
  }

  // Also queue an in-app welcome notification
  try {
    const queues = getQueues();
    await queues.notifications.add(
      'send-notification',
      {
        clientId: user.id,
        eventType: 'welcome',
        title: 'Welcome to OutreachOS',
        message: `Your ${planName} plan is now active. Check your email to set your password.`,
        priority: 'high',
      },
      { attempts: 3 }
    );
  } catch {
    // Non-fatal
  }
}

async function handleInvoicePaid(invoice: Stripe.Invoice): Promise<void> {
  const customerId = invoice.customer as string;
  if (!customerId) return;

  // Reset lead count on successful invoice (new billing period)
  await prisma.subscription.updateMany({
    where: { stripeCustomerId: customerId },
    data: { status: 'active', leadsUsedThisPeriod: 0 },
  });

  // Log invoice record
  const sub = await prisma.subscription.findFirst({ where: { stripeCustomerId: customerId } });
  if (sub) {
    await prisma.invoice.upsert({
      where: { stripeInvoiceId: invoice.id },
      create: {
        clientId: sub.clientId,
        subscriptionId: sub.id,
        stripeInvoiceId: invoice.id,
        amount: invoice.amount_paid,
        status: 'paid',
        invoiceDate: new Date(invoice.created * 1000),
        pdfDownloadUrl: invoice.invoice_pdf ?? null,
      },
      update: { status: 'paid', amount: invoice.amount_paid },
    });
  }
}

async function handlePaymentFailed(invoice: Stripe.Invoice): Promise<void> {
  const customerId = invoice.customer as string;
  if (!customerId) return;

  await prisma.subscription.updateMany({
    where: { stripeCustomerId: customerId },
    data: { status: 'past_due' },
  });

  const sub = await prisma.subscription.findFirst({ where: { stripeCustomerId: customerId } });
  if (sub) {
    try {
      const queues = getQueues();
      await queues.notifications.add(
        'send-notification',
        {
          clientId: sub.clientId,
          eventType: 'payment_failed',
          title: 'Payment failed',
          message: 'We could not process your latest payment. Please update your billing details.',
          priority: 'high',
        },
        { attempts: 3 }
      );
    } catch {
      // Non-fatal
    }
  }
}

async function handleSubscriptionUpdated(stripeSub: Stripe.Subscription): Promise<void> {
  const customerId = stripeSub.customer as string;
  const status: 'active' | 'past_due' | 'cancelled' | 'unpaid' =
    stripeSub.status === 'active' ? 'active'
    : stripeSub.status === 'past_due' ? 'past_due'
    : stripeSub.status === 'canceled' ? 'cancelled'
    : 'unpaid';

  await prisma.subscription.updateMany({
    where: { stripeCustomerId: customerId },
    data: { status },
  });
}

async function handleSubscriptionDeleted(stripeSub: Stripe.Subscription): Promise<void> {
  const customerId = stripeSub.customer as string;
  await prisma.subscription.updateMany({
    where: { stripeCustomerId: customerId },
    data: { status: 'cancelled' },
  });
}

export default router;
