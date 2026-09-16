# Module 6 — Landing site

The public marketing page in `landing/`. Independent of everything else: it
holds no credentials, talks to no API, and cannot break the clinic if it is
down.

## Configuration required

Every value has a working default in `landing/lib/site.ts`, so the site builds
without any of these — but it builds with placeholder contact details, which is
worse than failing because it looks finished.

| Variable | Default | What it is |
|---|---|---|
| `NEXT_PUBLIC_BRAND_NAME` | `SlotWA` | Name shown throughout |
| `NEXT_PUBLIC_TAGLINE` | `Hosted WhatsApp booking for clinics` | Headline |
| `NEXT_PUBLIC_CITY` | `India` | Where you operate |
| `NEXT_PUBLIC_WHATSAPP_NUMBER` | `919876543210` | **The call-to-action opens a chat with this.** A placeholder here sends every enquiry to a stranger. |
| `NEXT_PUBLIC_CONTACT_EMAIL` | `hello@example.com` | Contact address |
| `NEXT_PUBLIC_CONTACT_NAME` | `Your Name` | Who replies |

These are `NEXT_PUBLIC_`, and this is a static export, so they are **inlined at
build time**. Changing one means rebuilding and re-uploading; there is no
running process to restart. Unlike the clinic portal, one build of this site
serves one set of details.

## What it builds

`next.config.mjs` sets `output: "export"`, so `npm run build` emits a static
site to `landing/out/` — plain HTML, CSS and JavaScript with no Node process at
run time.

```powershell
cd landing
npm install
npm run build      # writes landing/out/
```

Set the variables above before building, or the defaults are baked in:

```powershell
$env:NEXT_PUBLIC_WHATSAPP_NUMBER = "919876500000"
$env:NEXT_PUBLIC_BRAND_NAME = "Wellsun"
npm run build
```

## Deploying

Upload `landing/out/` to any static host: Netlify, Cloudflare Pages, GitHub
Pages, S3 with CloudFront, or an nginx document root.

`trailingSlash: true` is set, which matters for hosts that serve
`/pricing/index.html` rather than `/pricing.html`. If links 404 after deploying,
that setting and the host's URL handling disagree.

Images are `unoptimized`, because Next's image optimiser needs a server and a
static export has none.

## Verifying

```powershell
cd landing
npm run build
npx serve out      # or any static file server
```

Check the WhatsApp call-to-action opens a chat with the right number. It is
inlined at build time from `NEXT_PUBLIC_WHATSAPP_NUMBER`, and the default is a
placeholder, so this is the one thing on the page that is silently wrong if you
forget it.
