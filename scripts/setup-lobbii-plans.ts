// One-time (idempotent) Stripe setup for Lobbii billing.
//   npx tsx scripts/setup-lobbii-plans.ts
// Creates the product + two prices, resolved at runtime by lookup_key —
// nothing to copy into env. Safe to re-run: existing lookup_keys are kept.

import Stripe from "stripe";

const key = process.env.STRIPE_SECRET_KEY;
if (!key) throw new Error("STRIPE_SECRET_KEY required (source partii/.env)");
const stripe = new Stripe(key);

async function ensurePrice(
  lookup: string,
  create: () => Promise<Stripe.Price>,
): Promise<Stripe.Price> {
  const existing = await stripe.prices.list({ lookup_keys: [lookup], limit: 1, active: true });
  if (existing.data[0]) {
    console.log(`✓ price ${lookup} exists: ${existing.data[0].id}`);
    return existing.data[0];
  }
  const price = await create();
  console.log(`+ created price ${lookup}: ${price.id}`);
  return price;
}

async function main() {
  // Product
  const products = await stripe.products.search({ query: `metadata['lobbii']:'plan'` });
  let product = products.data[0];
  if (!product) {
    product = await stripe.products.create({
      name: "Lobbii Pro",
      description:
        "Multiplayer backend for your games: rooms, signaling, TURN relays. 10× quotas and 25 GB relay bandwidth included per month.",
      metadata: { lobbii: "plan" },
    });
    console.log(`+ created product: ${product.id}`);
  } else {
    console.log(`✓ product exists: ${product.id}`);
  }

  await ensurePrice("lobbii_pro_monthly", () =>
    stripe.prices.create({
      product: product.id,
      lookup_key: "lobbii_pro_monthly",
      currency: "usd",
      unit_amount: 500, // $5/mo
      recurring: { interval: "month" },
      nickname: "Lobbii Pro monthly",
    }),
  );

  // Metered overage rides a Billing Meter (the modern replacement for
  // usage records): the cron emits meter events; Stripe sums per period.
  const meters = await stripe.billing.meters.list({ status: "active" });
  let meter = meters.data.find((m) => m.event_name === "lobbii_relay_gb");
  if (!meter) {
    meter = await stripe.billing.meters.create({
      display_name: "Lobbii relay bandwidth (GB)",
      event_name: "lobbii_relay_gb",
      default_aggregation: { formula: "sum" },
    });
    console.log(`+ created meter: ${meter.id}`);
  } else {
    console.log(`✓ meter exists: ${meter.id}`);
  }

  await ensurePrice("lobbii_relay_overage_gb", () =>
    stripe.prices.create({
      product: product.id,
      lookup_key: "lobbii_relay_overage_gb",
      currency: "usd",
      unit_amount: 10, // $0.10 per GB
      recurring: { interval: "month", usage_type: "metered", meter: meter.id },
      nickname: "Relay bandwidth overage (per GB)",
    }),
  );

  console.log("Done.");
}

void main();
