# Deployment runbook

## Team quotas and vice-captains

Apply `supabase/migrations/20261025052909_team_allocation.sql` before deploying the team allocation feature. The new tables remain private to the backend. Leaders can choose an available confirmed student or an existing team member as vice-captain; choosing an available student consumes a team place. Changing or clearing the role keeps the previous student in the team. Moving or removing a member clears their vice-captain role.

To configure Code Sastra's planned 13 teams, first preview `node scripts/configure-first-year-allocation.js code-sastra-2026 13 74`, then add `--apply`. The command checks the confirmed first-year count and refuses to overwrite a different plan or redistribute existing members. It saves a random ordering of nine quotas of six and four quotas of five. Existing teams receive a slot, and newly created teams automatically claim the remaining slots. Allocation stays random within each quota; remaining places are reserved when needed. A first-year leader counts toward their team's quota. After allocation, academic year changes require organizer assistance so participants cannot bypass the saved quota.

Verify with `node --test test/integration/team-allocation.test.js`; its temporary 13-team event, 74 first-years, registrations, sessions and users are cleaned up afterward. The test does not modify Code Sastra's memberships.

**Status:** Vercel and Render deployment configuration is prepared, but nothing has been deployed yet. The UPI workflow requires the receiving account details and QR to be checked before production use.

## Vercel frontend

The Vercel project root is `app/`; `app/vercel.json` installs from its lockfile, runs the static build, and publishes `app/dist`. In Vercel, import this repository and set **Root Directory** to `app`. Add the public build variable `API_BASE_URL` in Preview and Production, pointing to the Render API with `/api` at the end, for example `https://coding-club-api.onrender.com/api`. The build intentionally fails on Vercel if this HTTPS URL is missing or malformed. This URL is embedded in the browser bundle and must never contain a secret.

## Render backend

Create a Render Blueprint from the repository root using `render.yaml`. It defines the Docker API service and a cron service that runs the email outbox worker every five minutes. The shared environment group generates `JWT_SECRET` and `WORKER_SECRET`; keep these values private. At first Blueprint setup, provide the requested per-service values:

- `DATABASE_URL`: the existing Supabase **session pooler** connection string.
- `CORS_ORIGINS`: the exact Vercel production origin, plus any explicitly trusted preview/custom domains, comma-separated. Do not use `*`.
- `APP_URL`: the exact HTTPS Vercel production origin, used for password reset links.
- `UPI_VPA`: the organizer's receiving UPI ID, which must match the supplied QR.
- `RESEND_API_KEY` and `MAIL_FROM`: a Resend API key and verified sender identity.
- `SUPABASE_SECRET_KEY`: the server-side `sb_secret_...` key for public image uploads.

The cron service needs the same database URL and CORS value, plus the Resend key and sender. The blueprint does not run migrations automatically; the existing Coding Club Supabase project already has the required migrations. The API health check is `/api/health`. The expected public API origin for the name in `render.yaml` is `https://coding-club-api.onrender.com`; confirm Render’s assigned hostname before setting `API_BASE_URL`.

Render’s current default for a new web or cron service is the `0.5c-512mb` plan when `plan` is omitted. Check the service plan and cost in Render before applying the Blueprint. The scheduled mailer is a separate cron service.

1. Use Node 22 or newer; dependencies and `package-lock.json` are present. Use `npm ci` for reproducible installs.
2. Set `DATABASE_URL` to the **session pooler** connection string from Coding Club Supabase; use TLS-verified PostgreSQL connectivity (the bundled CA is loaded for Supabase hosts). Set a random `JWT_SECRET` of at least 32 characters and `CORS_ORIGINS` to the trusted application origin.
3. Migrations 001, 002, and 003 are already applied to the existing Coding Club project. Run them in order only when provisioning a new database. Back up before schema changes.
4. Apply `sql/004_manual_upi_verification.sql` after migrations 001–003 before enabling paid registrations. Test using mock evidence only; never treat screenshots/OCR as proof of bank credit. An authorized admin must verify each credited transaction in the receiving account.
5. To send notifications, verify your sender domain with Resend, set `RESEND_API_KEY` and `MAIL_FROM`, and arrange a secure scheduler to execute `npm run worker` regularly. Mail is queued without these credentials; it is *not delivered*.
6. Never publish DB credentials, private JWT secret, or worker secret. Run behind HTTPS ingress with request limits and an appropriate network egress policy. Configure logs and alerting.
7. Build: `npm ci && npm test && npm run lint:syntax`; then with staging configuration, run `npm start` and `npm run smoke`. Run `npm run test:integration` against development/staging to check HTTP workflows and concurrency against real PostgreSQL; test fixtures are cleaned up.
8. Enforce admin onboarding manually by approving a chosen account: `UPDATE club.users SET role='ADMIN' WHERE email='<verified-admin-email>';` run only after verifying ownership. Do not expose self-service admin assignment.
9. Add automated backups, restore drills, monitoring, and secrets rotation. This runbook is not a security certification.

## Real photo/image upload (October 2026)

The `coding-club-media` Supabase Storage bucket was created in the existing Coding Club project; this is intentionally **public-read**, because event banners and staff photos are public website content. Do not upload private IDs, receipts, sensitive participant photos or confidential documents to this bucket.

Set `SUPABASE_URL` and `SUPABASE_SECRET_KEY` (`sb_secret_...`) in **server-side** environment only. Under an authenticated ADMIN bearer token, send `multipart/form-data` with field `image` to:

`POST /api/admin/images/events/:eventUuid` (sets `events.banner`)
`POST /api/admin/images/faculty/:facultyUuid` (sets `faculty.photo`)
`POST /api/admin/images/team/:studentTeamUuid` (sets `student_team.photo`)

JPEG/PNG/WebP/AVIF uploads up to 8 MiB are decoded and re-encoded as resized WebP (no metadata), written under a random immutable object path, and updated in PostgreSQL. Use only photographs you have permission to publish; obtain consent for identifiable student/faculty photographs. The returned JSON includes the public CDN URL.

The backend does not bundle actual photographs. No user image files were present at build time. It does not provide cleanup of superseded objects or asynchronous antivirus inspection; plan media retention and image-abuse tests before production.

**Required staging acceptance**: install dependencies with a trusted npm registry, execute `npm ci`, start server against your private pooler URL, check `/api/health`, register/login, create a draft event, upload sample image, exercise UPI proof submission and manual approval with mock evidence, leader+team spin including concurrent calls, and verify email outbox delivery. Do not ask participants to pay until the QR/VPA are confirmed and staging checks pass.
