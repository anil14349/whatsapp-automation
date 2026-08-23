# Clinic WhatsApp Landing Page

Professional marketing site for your **hosted WhatsApp booking** service.  
Built with **Next.js 14**, **Tailwind CSS**, static export (works on Vercel, Replit, Netlify, GitHub Pages).

## Customize

1. Copy environment file:

```bash
cp .env.example .env.local
```

2. Edit `.env.local`:

| Variable | Example |
|----------|---------|
| `NEXT_PUBLIC_BRAND_NAME` | SlotWA |
| `NEXT_PUBLIC_CITY` | Hyderabad |
| `NEXT_PUBLIC_WHATSAPP_NUMBER` | 919876543210 |
| `NEXT_PUBLIC_CONTACT_EMAIL` | you@email.com |
| `NEXT_PUBLIC_CONTACT_NAME` | Anil |

3. Run locally:

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

## Build (static files)

```bash
npm run build
```

Output folder: **`out/`** — upload anywhere or let Vercel/Replit host it.

---

## Deploy on Vercel (recommended)

### Option A — From GitHub

1. Push repo to GitHub  
2. [vercel.com](https://vercel.com) → **Add New Project**  
3. **Root Directory:** `landing`  
4. **Environment Variables:** add all `NEXT_PUBLIC_*` from `.env.example`  
5. Deploy  

Vercel auto-detects Next.js. Static export is configured in `next.config.mjs`.

### Option B — Vercel CLI

```bash
cd landing
npm i -g vercel
vercel
```

Follow prompts. Add env vars in Vercel dashboard → Settings → Environment Variables.

---

## Deploy on Replit

1. Create **Node.js** Repl  
2. Upload the `landing/` folder or import from GitHub  
3. In Shell:

```bash
npm install
npm run dev
```

4. Click **Run** — Replit shows preview URL  

### Static deploy on Replit

```bash
npm run build
npx serve out -p 3000
```

Or use Replit **Deployments** with build command `npm run build` and output `out`.

---

## Deploy on Netlify / Cloudflare Pages

- **Build command:** `npm run build`  
- **Publish directory:** `out`  
- **Base directory:** `landing`  
- Add `NEXT_PUBLIC_*` env vars in dashboard  

---

## Project structure

```
landing/
├── app/           # Next.js pages & layout
├── components/    # UI sections
├── lib/site.ts    # Brand config from env
├── public/        # Static assets (add logo here)
├── .env.example
└── next.config.mjs  # static export enabled
```

## Add your logo

Place `logo.png` in `public/` and update `Navbar.tsx` to use `<Image src="/logo.png" ... />`.

## Troubleshooting `npm install`

If you see **`UNABLE_TO_GET_ISSUER_CERT_LOCALLY`**, npm cannot verify the registry SSL certificate (common on corporate networks / antivirus proxies):

1. **Easiest:** Deploy on [Vercel](https://vercel.com) from GitHub — Vercel runs `npm install` in the cloud (no local fix needed).
2. **Corporate proxy:** Ask IT for the root CA cert, then:
   ```bash
   npm config set cafile "C:\path\to\company-root-ca.pem"
   ```
3. **Temporary local only** (less secure): try another network (mobile hotspot) or a machine outside the restricted network.

Node is installed correctly if `node -v` works (you have v25.x). The landing page code is fine — install must succeed before `npm run dev` or `npm run build`.

## Related marketing docs

See `../marketing/` for brochure PDF copy, client one-pager, and offboarding checklist.
