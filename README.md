# The Household Ledger — Cloudflare Worker

A home inventory + paint-color tracker with photo auto-fill, live price lookups, and web-sourced reference photos — ready to deploy standalone on Cloudflare Workers.

## What's inside

- `public/index.html` — the whole app (Items ledger + Paint colors, UI + logic). Data is saved to the browser's `localStorage`, so it persists per browser/device.
- `src/worker.js` — a Worker that serves the static site and exposes two server-side endpoints so your Anthropic API key never touches the browser:
  - `POST /api/vision-analyze` — reads a photo (item nameplate or paint label) and returns structured fields. Takes `{ kind: 'item' | 'paint', mediaType, base64Data, categories?, paintTypes? }`.
  - `POST /api/web-lookup` — searches the web for either a current replacement price or a reference product photo. Takes `{ kind: 'price' | 'reference-image', query }`.
- `wrangler.toml` — Worker configuration (static assets + entry point).

## Prerequisites

- A Cloudflare account (free tier is fine)
- [Node.js](https://nodejs.org/) installed locally
- An Anthropic API key from [platform.claude.com](https://platform.claude.com) — only needed for the AI-powered features (photo auto-fill on items and paint labels, tint formula reading, live price lookup, reference photo lookup). Everything else (adding, editing, searching, attachments) works without it.

## Deploy steps

1. **Install Wrangler** (Cloudflare's CLI), from inside this folder:
   ```
   npm install
   ```

2. **Log in to Cloudflare:**
   ```
   npx wrangler login
   ```
   This opens a browser window to authorize Wrangler against your account.

3. **Add your Anthropic API key as a secret:**
   ```
   npx wrangler secret put ANTHROPIC_API_KEY
   ```
   Paste your key when prompted. It's stored encrypted on Cloudflare, not in this repo.

4. **Deploy:**
   ```
   npx wrangler deploy
   ```
   Wrangler will print a URL like `https://household-ledger.<your-subdomain>.workers.dev` — that's your live app.

## Trying it locally first (optional)

```
cp .dev.vars.example .dev.vars
# edit .dev.vars and paste in your real key
npx wrangler dev
```
This runs the app at `http://localhost:8787` before you deploy anything.

## Notes

- Data lives in each visitor's browser (`localStorage`), not in a shared database. If you open the app on a different device or browser, you'll start with an empty ledger there. Say the word if you'd like it upgraded to a shared Cloudflare KV or D1 store so the same data follows you across devices.
- If you skip the `ANTHROPIC_API_KEY` secret, the app still works fine for manual entries — any AI-powered step will fail gracefully with a message, and you can fill in the form yourself.
- Photos and file attachments are stored as compressed thumbnails (or, for non-image files under 3MB, raw base64) inside `localStorage`. There's no separate file storage to configure, but very large ledgers could approach browser storage limits.
- Reference photos pulled from the web are just a link to wherever the model found them — if a retailer blocks hotlinking or the link goes dead, the image just won't render; nothing breaks.
- If you're aiming to publish this to the Google Play Store as a Trusted Web Activity later, this deployment is the required first step — Play requires a live HTTPS PWA before any of that packaging work can start.
