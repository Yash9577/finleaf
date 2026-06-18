/**
 * FinLeaf — Stripe Subscription Backend
 * ======================================
 * Node.js / Express server that handles:
 *   1. Creating Stripe customers
 *   2. Attaching payment methods
 *   3. Creating subscriptions with a 7-day free trial
 *   4. Webhook events (subscription cancelled, payment failed, etc.)
 *
 * SETUP:
 *   npm install express stripe dotenv cors
 *   node stripe-server.js
 */

require('dotenv').config();
const express  = require('express');
const Stripe   = require('stripe');
const cors     = require('cors');

const app    = express();
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

/* ── MIDDLEWARE ── */
// Raw body needed for Stripe webhook signature verification
app.use('/webhook', express.raw({ type: 'application/json' }));
app.use(express.json());
app.use(cors({ origin: process.env.FRONTEND_URL || 'http://localhost:3000' }));
app.use(express.static('.')); // Serve index.html from same folder

/* ================================================================
   POST /create-subscription
   Called by the checkout modal in index.html
================================================================ */
app.post('/create-subscription', async (req, res) => {
  const { email, name, paymentMethodId, priceId } = req.body;

  if (!email || !name || !paymentMethodId || !priceId) {
    return res.status(400).json({ error: 'Missing required fields.' });
  }

  try {
    /* 1. Create or retrieve customer */
    const existing = await stripe.customers.list({ email, limit: 1 });
    let customer;
    if (existing.data.length > 0) {
      customer = existing.data[0];
    } else {
      customer = await stripe.customers.create({ email, name });
    }

    /* 2. Attach payment method to customer */
    await stripe.paymentMethods.attach(paymentMethodId, { customer: customer.id });
    await stripe.customers.update(customer.id, {
      invoice_settings: { default_payment_method: paymentMethodId }
    });

    /* 3. Create subscription with 7-day free trial */
    const subscription = await stripe.subscriptions.create({
      customer:       customer.id,
      items:          [{ price: priceId }],
      trial_period_days: 7,
      payment_settings: {
        payment_method_types: ['card'],
        save_default_payment_method: 'on_subscription',
      },
      expand: ['latest_invoice.payment_intent'],
    });

    const invoice = subscription.latest_invoice;
    const paymentIntent = invoice?.payment_intent;

    /* 4. Handle 3D Secure / additional authentication if needed */
    if (paymentIntent?.status === 'requires_action') {
      return res.json({
        subscriptionId: subscription.id,
        clientSecret:   paymentIntent.client_secret,
        requiresAction: true,
      });
    }

    /* 5. Send welcome email (add your email provider here) */
    // await sendWelcomeEmail(email, name); // see bottom of file

    res.json({
      subscriptionId: subscription.id,
      customerId:     customer.id,
      status:         subscription.status,
    });

  } catch (err) {
    console.error('Subscription error:', err.message);
    res.status(400).json({ error: err.message });
  }
});

/* ================================================================
   GET /customer-portal
   Lets subscribers manage/cancel their plan via Stripe's hosted UI
================================================================ */
app.post('/customer-portal', async (req, res) => {
  const { customerId } = req.body;
  try {
    const session = await stripe.billingPortal.sessions.create({
      customer:   customerId,
      return_url: process.env.FRONTEND_URL || 'http://localhost:3000',
    });
    res.json({ url: session.url });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/* ================================================================
   POST /webhook
   Handles Stripe events (subscription cancelled, payment failed, etc.)
   Set your webhook URL in: https://dashboard.stripe.com/webhooks
   Add endpoint: https://yoursite.com/webhook
   Events to listen for:
     - customer.subscription.deleted
     - customer.subscription.updated
     - invoice.payment_failed
     - invoice.payment_succeeded
================================================================ */
app.post('/webhook', async (req, res) => {
  const sig     = req.headers['stripe-signature'];
  const secret  = process.env.STRIPE_WEBHOOK_SECRET;
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, secret);
  } catch (err) {
    console.error('Webhook signature failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  switch (event.type) {

    case 'customer.subscription.created':
    case 'customer.subscription.updated': {
      const sub = event.data.object;
      console.log(`Subscription ${sub.id} is now: ${sub.status}`);
      // Update your database here — mark user as Pro
      break;
    }

    case 'customer.subscription.deleted': {
      const sub = event.data.object;
      console.log(`Subscription ${sub.id} cancelled for customer ${sub.customer}`);
      // Revoke Pro access in your database
      // Keep downloaded templates (honour your promise!)
      break;
    }

    case 'invoice.payment_succeeded': {
      const invoice = event.data.object;
      console.log(`Payment succeeded: ${invoice.id} — $${(invoice.amount_paid / 100).toFixed(2)}`);
      // Send receipt email, renew access
      break;
    }

    case 'invoice.payment_failed': {
      const invoice = event.data.object;
      console.warn(`Payment FAILED: ${invoice.id} — customer ${invoice.customer}`);
      // Send payment failure email, flag account
      break;
    }

    case 'customer.subscription.trial_will_end': {
      const sub = event.data.object;
      console.log(`Trial ending soon for subscription ${sub.id}`);
      // Send "your trial ends in 3 days" email
      break;
    }

    default:
      console.log(`Unhandled event: ${event.type}`);
  }

  res.json({ received: true });
});

/* ── START SERVER ── */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`FinLeaf server running on http://localhost:${PORT}`);
});

/*
 * ── OPTIONAL: SEND WELCOME EMAIL ──────────────────────────────────
 * Uncomment and install your preferred email provider:
 *   npm install @sendgrid/mail       (SendGrid — recommended)
 *   npm install nodemailer           (SMTP / Gmail)
 *
 * async function sendWelcomeEmail(email, name) {
 *   const sgMail = require('@sendgrid/mail');
 *   sgMail.setApiKey(process.env.SENDGRID_API_KEY);
 *   await sgMail.send({
 *     to: email,
 *     from: 'hello@finleaf.ca',
 *     subject: 'Welcome to FinLeaf Pro!',
 *     html: `<h2>Hi ${name},</h2>
 *            <p>Your 7-day free trial has started. Download your templates here:</p>
 *            <a href="${process.env.PRO_DOWNLOAD_URL}">Download Pro Templates →</a>`
 *   });
 * }
 */
