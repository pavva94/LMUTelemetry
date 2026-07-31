# Railway Setup: LMU Team Race Engineer

This guide deploys the cloud session-code and live telemetry relay. The Windows app always connects outbound to Railway, so drivers do not need port forwarding or inbound firewall rules.

## What Is Included

- Persistent eight-character team session codes in PostgreSQL.
- A single active telemetry publisher per session.
- Explicit publisher takeover.
- Multiple Windows-app or browser viewers.
- A hosted copy of the Race Engineer frontend.
- Background desktop publishing that is independent from the visible app page.
- Persistent completed-lap summaries grouped by active driver.
- Reconnect and bounded latest-frame queues so slow viewers cannot build an unlimited telemetry backlog.

The current beta uses `TEAM_ADMIN_KEY` to protect session creation and the session code as the viewer/publisher capability. Keep the admin key private. Discord accounts, team membership, detailed telemetry bundles, and 90-day trace retention are later hardening milestones and are not required to test the live team workflow. Completed-lap summaries are already stored in PostgreSQL.

## 1. Push The Repository

Push this repository to a private GitHub repository that Railway can access. Railway must build from the repository root because `cloud/Dockerfile` copies both `cloud/` and `frontend/`.

Do not select `cloud/` as the Railway root directory.

## 2. Create The Railway Project

1. Sign in to Railway.
2. Select **New Project**.
3. Select **Deploy from GitHub repo** and choose LMUTelemetry.
4. Allow the first deployment to be created. It may initially fail because the required variables and PostgreSQL are not configured yet.
5. Open the service settings and confirm Railway detected the root `railway.json`.
6. In **Settings → Deploy → Regions**, select **EU West / Amsterdam**.
7. Keep the service at exactly **one replica**. The beta relay keeps active WebSocket rooms in memory.

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
CORS_ORIGINS=*
```

`CORS_ORIGINS=*` is intentional for the beta because installed and portable apps run from unpredictable loopback ports. The relay does not use browser cookies. Before adding account cookies, replace this with an explicit origin policy.

Never place either secret in the repository.

## 5. Configure Networking

1. Open the LMU cloud service.
2. Select **Settings → Networking → Generate Domain**.
3. Optionally attach a custom domain later.
4. Copy the HTTPS service URL, for example `https://lmu-telemetry-production.up.railway.app`.

All apps convert this HTTPS URL to `wss://` automatically for live telemetry.

## 6. Deploy And Verify

Trigger a new deployment after PostgreSQL and the variables are present.

The deployment is healthy when `https://your-service-domain/api/cloud/health` returns:

```json
{
  "ok": true,
  "service": "lmu-telemetry-cloud",
  "rooms": 0
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
5. Select **Create and copy code**.
6. Share only the generated eight-character code and Railway URL with the team. Do not share the admin key.

Session codes survive service restarts because they are stored in PostgreSQL. Active WebSocket connections reconnect after a deployment, but the current publisher must reclaim the publisher slot.

## 8. Driver Workflow In The Windows App

1. Install LMU Telemetry or extract the portable ZIP.
2. Start it and confirm Local Live telemetry works.
3. Select **Team Race Engineer**.
4. Enter the Railway URL, session code, and driver name.
5. Select **Join session**.
6. Select **Start publishing**.
7. Return to **Live Mode** if desired.

The green publishing banner remains visible in Local Live. Publishing continues while navigating between Local Live, standings, pit, strategy, profile, or Team Race Engineer. Local collection and recording do not depend on Railway.

Use **Take over active driver** only during a driver change. It disconnects the previous publisher, while all viewers stay in the same team session.

Use **Stop publishing** when leaving the car. This does not stop local telemetry recording.

## 9. Engineer And Teammate Workflow

### Windows app

1. Open **Team Race Engineer**.
2. Enter the same Railway URL, session code, and a display name.
3. Select **Join session**.
4. Do not select Start Publishing.

### Browser

1. Open the Railway service URL.
2. Open **Team Race Engineer**.
3. The Railway URL is filled automatically.
4. Enter the session code and display name.
5. Select **Join session**.

Both surfaces receive Live Dashboard, Circle Map, standings/classification, Pit Window, a live Team XY friction-circle plot, and PostgreSQL-backed completed-lap history grouped by driver. Driver Coach remains local-only.

## 10. Cost And Operations

- Start with Railway Hobby for private testing; use Pro before relying on the service for important races.
- Keep one service replica until a shared room backplane such as Redis is implemented.
- Configure a Railway usage alert and hard usage ceiling.
- Enable scheduled PostgreSQL backups.
- Watch service egress, memory, reconnect count, and deployment logs during the first long race.
- Never log telemetry frames or secret values.

The current complete compressed telemetry snapshot is about 2 KB. At 5 Hz, one four-hour viewer is approximately 146 MB before WebSocket overhead. A driver plus ten viewers remains modest for an invite-only beta, but service egress grows linearly with viewer count.

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
