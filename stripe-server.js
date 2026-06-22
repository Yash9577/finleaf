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
const sgMail   = require('@sendgrid/mail');

const app    = express();
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

if (process.env.SENDGRID_API_KEY) {
  sgMail.setApiKey(process.env.SENDGRID_API_KEY);
}

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

    /* 5. Send welcome email with Pro download link */
    try {
      await sendWelcomeEmail(email, name);
    } catch (emailErr) {
      console.error('Welcome email failed to send:', emailErr.message);
      // Don't fail the whole request just because the email failed
    }

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

/* ================================================================
   EMAIL — Welcome email sent immediately after a successful
   subscription signup. Uses SendGrid (free tier: 100 emails/day).
================================================================ */
async function sendWelcomeEmail(email, name) {
  if (!process.env.SENDGRID_API_KEY) {
    console.warn('SENDGRID_API_KEY not set — skipping welcome email.');
    return;
  }

  const downloadUrl = process.env.PRO_DOWNLOAD_URL || '#';

  await sgMail.send({
    to: email,
    from: process.env.SENDER_EMAIL || 'hello@finleaf.ca', // must match your SendGrid verified sender
    subject: 'Welcome to FinLeaf Pro! 🎉 Here are your templates',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; color: #212529;">
        <h2 style="color: #185FA5;">Welcome to FinLeaf Pro, ${name}! 🎉</h2>
        <p>Your 7-day free trial has started. You now have access to the full template library — P&L, invoicing, GST/HST, payroll, cash flow, and budget planning.</p>
        <p style="margin: 28px 0;">
          <a href="${downloadUrl}" style="background:#185FA5; color:#fff; padding:12px 24px; border-radius:8px; text-decoration:none; font-weight:bold;">
            Download Your Pro Templates →
          </a>
        </p>
        <p>Questions? Just reply to this email — we read every message.</p>
        <p style="color:#868E96; font-size:13px; margin-top:32px;">— The FinLeaf Team</p>
      </div>
    `
  });

  console.log(`Welcome email sent to ${email}`);
}
