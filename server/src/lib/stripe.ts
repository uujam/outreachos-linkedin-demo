/**
 * Stripe client singleton (B-014).
 * Initialised lazily so tests can run without STRIPE_SECRET_KEY set.
 */
import Stripe from 'stripe';

let _stripe: Stripe | null = null;

export function getStripe(): Stripe {
  if (!_stripe) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) throw new Error('STRIPE_SECRET_KEY is not set');
    _stripe = new Stripe(key, { apiVersion: '2026-02-25.clover' });
  }
  return _stripe;
}

/** Map plan name → monthly Stripe Price ID (from env). */
export const STRIPE_PRICES: Record<string, string | undefined> = {
  starter: process.env.STRIPE_PRICE_STARTER,
  growth: process.env.STRIPE_PRICE_GROWTH,
};

/** Map plan name → annual Stripe Price ID (from env, optional). */
export const STRIPE_PRICES_ANNUAL: Record<string, string | undefined> = {
  starter: process.env.STRIPE_PRICE_STARTER_ANNUAL,
  growth: process.env.STRIPE_PRICE_GROWTH_ANNUAL,
};
