# Railway Setup: LMU Team Race Engineer

This guide deploys the cloud session-code and live telemetry relay. The Windows app always connects outbound to Railway, so drivers do not need port forwarding or inbound firewall rules.

## What Is Included

- Persistent eight-character team session codes in PostgreSQL.
- A separate 192-bit invitation key, stored only as a keyed hash.
- Short-lived, single-use WebSocket tickets.
- A single active telemetry publisher per session.
- Explicit publisher takeover.
- Multiple Windows-app or browser viewers.
- A hosted copy of the Race Engineer frontend.
- Background desktop publishing that is independent from the visible app page.
- Persistent completed-lap summaries grouped by active driver.
- Reconnect and bounded latest-frame queues so slow viewers cannot build an unlimited telemetry backlog.

The public session code identifies a room but does not authorize access. Every metadata, history, viewer, and publisher request also requires the generated session access key. `TEAM_ADMIN_KEY` protects session creation and termination. Keep both kinds of key private and send invitations through a trusted private channel.

No Internet-facing service can honestly guarantee that nobody will ever break in. This release is designed to fail closed and substantially reduces the practical attack surface, but production operation still requires secret handling, updates, backups, and monitoring.

Sessions created by version 0.2.0 have no access-key verifier and are intentionally inaccessible after this update. Create new sessions after deploying 0.3.0.

## 1. Push The Repository

Push this repository to a private GitHub repository that Railway can access. Railway must build from the repository root because `cloud/Dockerfile` copies both `cloud/` and `frontend/`.

Do not select `cloud/` as the Railway root directory.

## 2. Create The Railway Project

1. Sign in to Railway.
2. Select **New Project**.
3. Select **Deploy from GitHub repo** and choose LMUTelemetry.
4. Allow the first deployment to be created. It may initially fail because the required variables and PostgreSQL are not configured yet.
5. Open the service settings and confirm Railway detected the root `railway.json`.
6. The repository's `railway.json` fixes the application service to **EU West / Amsterdam** with exactly **one replica**. Config as Code overrides the dashboard, so seeing a file-controlled value is expected.
7. Place the PostgreSQL service in **EU West / Amsterdam** as well. The beta relay keeps active WebSocket rooms in memory and must remain at one application replica.

## 3. Add PostgreSQL

1. On the Railway project canvas, select **Create → Database → PostgreSQL**.
2. Wait for PostgreSQL to finish provisioning.
3. Open the LMU cloud service, then **Variables**.
4. Add a reference variable:

```text
DATABASE_URL=${{Postgres.DATABASE_URL}}
```

Use the private `DATABASE_URL`, not `DATABASE_PUBLIC_URL`. The application creates the initial `team_sessions` table during startup.

## 4. Generate Secrets

Run this command twice in a local PowerShell window and save each resulting value:

```powershell
[Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
```

Create two independent variables:

- `TOKEN_SECRET`: signs short-lived WebSocket tickets.
- `TEAM_ADMIN_KEY`: authorizes a team lead to create and end sessions.

Add these Railway service variables:

```text
TOKEN_SECRET=first-generated-secret
TEAM_ADMIN_KEY=second-generated-secret
DEPLOYMENT_ENV=production
MAX_VIEWERS_PER_SESSION=20
```

Production startup fails if either secret is shorter than 32 characters or if `DATABASE_URL` still points to SQLite. Railway environments are detected automatically; `DEPLOYMENT_ENV=production` makes the intent explicit.

Do not set `CORS_ORIGINS` when the hosted UI is served by this same Railway service. The server separately permits only `localhost` and `127.0.0.1` origins for the installed/portable app. If a separate web frontend is added later, list only its exact HTTPS origins, separated by commas. Never use `*`.

Never place either secret in the repository.

Rotating `TOKEN_SECRET` immediately invalidates all outstanding tickets and all existing session access keys. This is useful during an incident, but the team lead must create new sessions afterward.

## 5. Configure Networking

1. Open the LMU cloud service.
2. Select **Settings → Networking → Generate Domain**.
3. Optionally attach a custom domain later.
4. Copy the HTTPS service URL, for example `https://lmu-telemetry-production.up.railway.app`.

All apps convert this HTTPS URL to `wss://` automatically for live telemetry.

Do not expose PostgreSQL through a public TCP endpoint. The application should use Railway's private database URL only.

## 6. Deploy And Verify

Trigger a new deployment after PostgreSQL and the variables are present.

The deployment is healthy when `https://your-service-domain/api/cloud/health` returns:

```json
{
  "ok": true,
  "service": "lmu-telemetry-cloud"
}
```

If deployment fails:

- Confirm the Railway service root is the repository root.
- Confirm `cloud/Dockerfile` is selected by `railway.json`.
- Confirm `DATABASE_URL` references the PostgreSQL service.
- Read deployment logs for frontend TypeScript or Python dependency errors.

## 7. Create A Team Race Session

1. Open the Railway service URL in a browser.
2. Select **Team Race Engineer** in the left navigation.
3. Expand **Create a session as team lead**.
4. Enter the Railway URL, team name, race/session name, and private `TEAM_ADMIN_KEY`.
5. Select **Create secure session**.
6. Immediately select **Copy secure invite**. The access key is returned only at creation time.
7. Share the Railway URL, eight-character code, and access key through a trusted private channel. Do not share the admin key.

Session codes survive service restarts because they are stored in PostgreSQL. Active WebSocket connections reconnect after a deployment, but the current publisher must reclaim the publisher slot.

## 8. Driver Workflow In The Windows App

1. Install LMU Telemetry or extract the portable ZIP.
2. Start it and confirm Local Live telemetry works.
3. Select **Team Race Engineer**.
4. Enter the Railway URL, session code, session access key, and driver name.
5. Select **Join session**.
6. Select **Start publishing**.
7. Return to **Live Mode** if desired.

The green publishing banner remains visible in Local Live. Publishing continues while navigating between Local Live, standings, pit, strategy, profile, or Team Race Engineer. Local collection and recording do not depend on Railway.

Use **Take over active driver** only during a driver change. It disconnects the previous publisher, while all viewers stay in the same team session.

Use **Stop publishing** when leaving the car. This does not stop local telemetry recording.

## 9. Engineer And Teammate Workflow

### Windows app

1. Open **Team Race Engineer**.
2. Enter the same Railway URL, session code, access key, and a display name.
3. Select **Join session**.
4. Do not select Start Publishing.

### Browser

1. Open the Railway service URL.
2. Open **Team Race Engineer**.
3. The Railway URL is filled automatically.
4. Enter the session code, access key, and display name.
5. Select **Join session**.

Both surfaces receive Live Dashboard, Circle Map, standings/classification, Pit Window, a live Team XY friction-circle plot, and PostgreSQL-backed completed-lap history grouped by driver. Driver Coach remains local-only.

## 10. Cost And Operations

- Start with Railway Hobby for private testing; use Pro before relying on the service for important races.
- Keep one service replica until a shared room backplane such as Redis is implemented.
- Configure a Railway usage alert and hard usage ceiling.
- Enable scheduled PostgreSQL backups.
- Watch service egress, memory, reconnect count, and deployment logs during the first long race.
- Never log telemetry frames or secret values.
- Enable two-factor authentication on Railway and the connected GitHub account.
- Keep the source repository private and restrict who can change Railway variables or trigger deployments.
- Review Railway access periodically and remove former team members.
- Deploy dependency/security updates before important events, then test with a disposable session.

The current complete compressed telemetry snapshot is about 2 KB. At 5 Hz, one four-hour viewer is approximately 146 MB before WebSocket overhead. A driver plus ten viewers remains modest for an invite-only beta, but service egress grows linearly with viewer count.

## Security Controls In This Release

- The app accepts remote connections only over HTTPS/WSS; HTTP is allowed only on localhost.
- The session access key has 192 bits of randomness and is never stored in plaintext by the cloud service.
- WebSocket tickets are HMAC-signed, expire after 60 seconds, can be connected only once, and travel in the protocol handshake rather than a loggable request URL.
- A session code alone cannot read metadata, lap history, view telemetry, publish, or force a takeover.
- Session creation and termination require a separate constant-time-checked administrator key.
- Request rates, HTTP body sizes, telemetry frame sizes, viewer messages, and viewers per room are bounded.
- Invalid JSON, non-finite numeric values, unknown message types, and oversized frames are rejected.
- Browser origins default to same-origin plus the Windows app's loopback origins.
- Production API documentation is disabled, API responses are not cached, and security headers include CSP, HSTS, frame denial, and MIME sniffing protection.
- The production container runs as an unprivileged Linux user.

The access key is saved locally by the app so it can reconnect. On a shared Windows computer, disconnect and clear browser/app storage after the event. Do not paste the admin key into chat, screenshots, issue reports, or Railway logs.

## Before Every Race

1. Confirm `/api/cloud/health` returns `ok: true`.
2. Confirm Railway shows exactly one application replica and a healthy PostgreSQL service.
3. Create a new session; do not reuse an invitation from an old race.
4. Test that a wrong access key receives HTTP 401.
5. Connect one disposable publisher and viewer, then test driver takeover.
6. Check Railway logs for repeated 401/429 responses or restart loops.
7. Confirm the PostgreSQL backup schedule and Railway usage alert.

## If A Key Leaks Or Access Looks Suspicious

1. Stop publishing and end the affected session.
2. Create a replacement session and send its new invite privately.
3. If the admin key may have leaked, rotate `TEAM_ADMIN_KEY` in Railway and redeploy.
4. If tickets or the service secret may have leaked, rotate `TOKEN_SECRET`, redeploy, and recreate every active session.
5. Review Railway deployment/access logs, GitHub account access, and project members.
6. Preserve relevant logs before their retention window expires, without copying secret values into tickets or chat.

## Local Cloud Development

From the repository root:

```powershell
$env:PYTHONPATH='.'
$env:TEAM_ADMIN_KEY='local-admin-key'
$env:TOKEN_SECRET='local-ticket-secret'
backend\.venv\Scripts\python.exe -m uvicorn cloud.main:app --host 127.0.0.1 --port 8010
```

Use `http://127.0.0.1:8010` as the cloud URL in the app.

The cloud service uses `cloud-lmu-telemetry.sqlite3` locally when `DATABASE_URL` is absent. Railway uses PostgreSQL.
