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
import Stripe from 'stripe';
import { requireAuth, AuthRequest } from '../middleware/requireAuth';
import { prisma } from '../lib/prisma';
import { getStripe, STRIPE_PRICES, STRIPE_PRICES_ANNUAL } from '../lib/stripe';
import { getQueues } from '../queues';

const router = Router();

const PLAN_NAMES: Record<string, 'Starter' | 'Growth' | 'Enterprise'> = {
  starter: 'Starter',
  growth: 'Growth',
};

// ─── POST /api/stripe/checkout ────────────────────────────────────────────────

router.post('/stripe/checkout', requireAuth, async (req: AuthRequest, res: Response) => {
  const clientId = req.user!.sub;
  const { plan, billing = 'monthly' } = req.body as { plan?: string; billing?: 'monthly' | 'annual' };

  if (!plan || !PLAN_NAMES[plan]) {
    res.status(400).json({ error: 'plan must be one of: starter, growth' });
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

  const user = await prisma.user.findUnique({ where: { id: clientId }, select: { email: true, name: true } });
  if (!user) {
    res.status(404).json({ error: 'User not found' });
    return;
  }

  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    line_items: [{ price: priceId, quantity: 1 }],
    customer_email: user.email,
    metadata: { clientId, plan, billing },
    success_url: `${process.env.APP_URL ?? 'http://localhost:3000'}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${process.env.APP_URL ?? 'http://localhost:3000'}/checkout/cancel`,
    subscription_data: {
      metadata: { clientId, plan, billing },
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
  const clientId = session.metadata?.clientId;
  const plan = session.metadata?.plan;

  if (!clientId || !plan) return;

  const planName = PLAN_NAMES[plan] ?? 'Starter';
  const customerId = session.customer as string;
  const subscriptionId = session.subscription as string;

  const now = new Date();
  const periodEnd = new Date(now.getTime() + 30 * 86400_000);

  await prisma.subscription.upsert({
    where: { clientId },
    create: {
      clientId,
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

  // Queue welcome email notification
  try {
    const queues = getQueues();
    await queues.notifications.add(
      'send-notification',
      {
        clientId,
        eventType: 'welcome',
        title: 'Welcome to OutreachOS',
        message: `Your ${planName} plan is now active. Let's get started.`,
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
