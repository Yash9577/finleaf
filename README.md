# FinLeaf — Setup & Deployment Guide

## Files in this package
- `index.html` — Your full website (ready to deploy)
- `stripe-server.js` — Backend that handles subscriptions
- `.env.example` — Environment variables template
- `package.json` — Node.js dependencies

---

## Step 1 — Set up Stripe (15 min)

1. Create a free account at https://dashboard.stripe.com
2. Go to **Developers → API Keys** and copy your keys into `.env`
3. Go to **Products → Add product**:
   - Name: "FinLeaf Pro"
   - Add two prices:
     - Monthly: **$12.00 CAD** / month, recurring
     - Annual: **$96.00 CAD** / year, recurring
4. Copy the Price IDs (start with `price_...`) into `.env`
5. Go to **Developers → Webhooks → Add endpoint**:
   - URL: `https://yourdomain.com/webhook`
   - Events: `customer.subscription.*`, `invoice.payment_*`
   - Copy the webhook signing secret into `.env`

---

## Step 2 — Run locally

```bash
npm install
cp .env.example .env
# Fill in your .env values
node stripe-server.js
# Visit http://localhost:3000
```

Test cards (use in test mode):
- ✅ Success: `4242 4242 4242 4242`
- 🔐 3D Secure: `4000 0025 0000 3155`
- ❌ Decline: `4000 0000 0000 9995`

---

## Step 3 — Deploy online (choose one)

### Option A — Railway (easiest, ~5 min)
1. Push this folder to a GitHub repo
2. Go to https://railway.app → New Project → Deploy from GitHub
3. Add your `.env` variables in the Railway dashboard
4. Railway gives you a live URL automatically

### Option B — Render (free tier available)
1. Push to GitHub
2. Go to https://render.com → New Web Service
3. Connect your repo, set start command: `node stripe-server.js`
4. Add environment variables in the Render dashboard

### Option C — Vercel + separate backend
- Deploy `index.html` on Vercel (free, instant)
- Deploy `stripe-server.js` on Railway or Render separately
- Update `FRONTEND_URL` in your `.env`

---

## Step 4 — Connect your download files

1. Upload your Excel kit to Dropbox, Google Drive, or Amazon S3
2. Get a shareable direct download link
3. In `index.html`, replace:
   ```
   YOUR_FREE_TEMPLATE_DOWNLOAD_URL
   ```
   with your actual link
4. In `.env`, add:
   ```
   FREE_TEMPLATE_DOWNLOAD_URL=https://...
   PRO_DOWNLOAD_URL=https://...
   ```

---

## Step 5 — Go live checklist

- [ ] Switch Stripe from **Test mode → Live mode** (toggle in Stripe dashboard)
- [ ] Replace `pk_test_...` with `pk_live_...` in `index.html`
- [ ] Replace `sk_test_...` with `sk_live_...` in `.env`
- [ ] Update webhook endpoint to live URL
- [ ] Test a real $1 transaction before launching
- [ ] Register for GST/HST if you expect to earn over $30,000 CAD/year
- [ ] Add Privacy Policy and Terms of Service pages
- [ ] Set up a custom domain (e.g. finleaf.ca)

---

## Revenue estimate

| Plan    | Price      | 10 customers | 50 customers | 100 customers |
|---------|------------|-------------|--------------|---------------|
| Monthly | $12 CAD/mo | $120/mo     | $600/mo      | $1,200/mo     |
| Annual  | $96 CAD/yr | $960/yr     | $4,800/yr    | $9,600/yr     |

---

## Need help?
Email: hello@finleaf.ca
