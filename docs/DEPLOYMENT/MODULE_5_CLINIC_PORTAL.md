# Module 5 — Clinic portal

The Next.js staff portal in `clinic-app/`. Appointments, search, staff,
services, settings, and the owner's summary.

## Configuration required

Four variables, all **server-side only**:

| Variable | Required | Purpose |
|---|---|---|
| `SUPABASE_URL` | yes | `https://<ref>.supabase.co` |
| `SUPABASE_ANON_KEY` | yes | Public key. Verified to have no privileges on any table. |
| `DEFAULT_CLINIC_ID` | yes | The clinic this deployment serves |
| `PORTAL_SESSION_SECRET` | yes | Signs the session cookie. Any long random string. |

None is a `NEXT_PUBLIC_` variable, and that is deliberate on two counts.

The clinic id used to be `NEXT_PUBLIC_DEFAULT_CLINIC_ID`, prefilling a field on
the sign-in form. That shipped it to the browser and let anyone type a
different clinic's id over it. The server supplies it now and the field is
gone.

`PORTAL_SESSION_SECRET` is the newer of the four and there is no default: the
app throws `PORTAL_SESSION_SECRET is not configured` and nobody can sign in.
That is on purpose. The session cookie used to be plain base64, so anyone could
rewrite `role` to `CLINIC_OWNER` and the header would greet them as one, with
the manager-only links on show. It now carries an HMAC-SHA256 signature that
`readSession` verifies before believing a word of it.

Generate one per deployment and never commit it:

```powershell
-join ((1..48) | ForEach-Object { 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'[(Get-Random -Maximum 62)] })
```

Two consequences worth knowing before you set it. **Changing it signs everyone
out** — every cookie already issued fails verification — so rotate it when a
signed-out estate is acceptable. And **every instance behind a load balancer
needs the same value**, or a session minted by one is rejected by the next.
Local and production can differ freely; they simply do not share sessions.

Because nothing is inlined at build time, **one image serves any clinic** and
the same artefact can be promoted from staging to production unchanged.

The browser never talks to Supabase directly. Every call is proxied through
Next route handlers, so the portal JWT sits in an httpOnly cookie that scripts
cannot read, and CORS does not apply to the browser at all — but
`ALLOWED_ORIGINS` on the edge functions must still list this portal's origin.

## Running it locally

```powershell
cd clinic-app
npm install
Copy-Item .env.example .env.local   # then fill it in
npm run dev                          # http://localhost:3001
```

Changing `next.config.mjs` or `tailwind.config.ts` is **not** picked up by
restarting the dev server. Delete `.next` first.

Never run `npm run build` while `npm run dev` is running: they share `.next`
and the production build corrupts the dev server's chunks. The symptom is
`Cannot find module './543.js'` and server actions silently doing nothing.

## The Docker image

`clinic-app/Dockerfile` is a three-stage build producing a runtime image with
no build tooling, no source, and no `node_modules` beyond what Next traced as
actually reachable.

```powershell
cd clinic-app
docker build -t clinic-portal:latest .
```

Run it with the configuration supplied at run time:

```powershell
docker run -d --name clinic-portal -p 3001:3001 `
    -e SUPABASE_URL="https://<ref>.supabase.co" `
    -e SUPABASE_ANON_KEY="<anon key>" `
    -e DEFAULT_CLINIC_ID="<clinic uuid>" `
    -e PORTAL_SESSION_SECRET="<random string>" `
    clinic-portal:latest
```

Or with a file, which keeps the key out of your shell history:

```powershell
docker run -d --name clinic-portal -p 3001:3001 --env-file clinic-app/.env.local clinic-portal:latest
```

| Detail | Value |
|---|---|
| Base | `node:22-alpine` |
| Listens on | `3001`, `HOSTNAME=0.0.0.0` |
| Runs as | `nextjs` (uid 1001), not root |
| Healthcheck | `GET /login` every 30s |

`/login` is the healthcheck target because it is the one route that renders
without a session or a database call. It answers even when Supabase is
unreachable — which is the point. This checks the container is alive, not that
the whole system is well.

`.dockerignore` excludes `.env*`. A file copied into a layer stays in the image
history even if a later step deletes it, so anyone who can pull the image can
read it.

### Reproducible builds

There is no `clinic-app/package-lock.json` in the repository. The Dockerfile
runs `npm ci` when one is present and `npm install` when it is not, so the
build works either way — but without a lockfile two builds of the same commit
can resolve different versions. To fix that:

```powershell
cd clinic-app
npm install --package-lock-only
```

Commit the result.

### This image has not been built on a Windows container host

The Dockerfile targets Linux. A Docker daemon in Windows-containers mode, or a
host without WSL, cannot build or run it and will fail on the `node:22-alpine`
pull. Build it on Linux, on a CI runner, or on Docker Desktop with Linux
containers enabled.

What *has* been verified on Windows is everything the image does at run time:
`npm run build` produces `.next/standalone/server.js`, and that server — staged
by hand exactly as the runner stage stages it, with `.next/static` copied in —
serves `/login` with `200`, redirects `/summary` to sign-in with `307`, and
serves its stylesheet. The remaining untested step is the container layer
itself.

## Deploying elsewhere

The app is a standard standalone Next build, so anywhere that runs a Node
process or an OCI image will do: a container host, Vercel, Fly, Render, or a
VM behind nginx. The only requirements are the three variables above and that
the edge functions' `ALLOWED_ORIGINS` includes wherever it ends up.

## Verifying

```powershell
cd clinic-app
npx tsc --noEmit    # no output means success
npm run build
```

After deploying, sign in and load `/summary`. It is the page that touches the
most: auth, the clinic's timezone, and an aggregate query.
