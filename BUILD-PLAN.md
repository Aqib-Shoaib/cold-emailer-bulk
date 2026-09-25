# Cold Emailer — Build Plan and Progress Tracker

> Temporary working document. Keep it current while building. After every phase is
> complete and the final acceptance check passes, ask the owner before deleting it.

## 1. Project outcome

Build a secure, single-company system whose administrators can manage contacts and knowledge,
draft personalized email with AI, schedule and send campaigns through SMTP,
receive replies through IMAP, stop sending instantly, and explain results in a
clear dashboard.

The product is complete when Phases 0–12 are marked **DONE**, their evidence is
recorded here, and the final end-to-end scenario passes.

## 2. How to use this tracker

Status values: `NOT STARTED` · `IN PROGRESS` · `BLOCKED` · `DONE`

Rules:

1. Work on one phase at a time; a later phase may not hide a broken earlier one.
2. Before a phase starts, resolve only the decisions listed for that phase.
3. A phase is `DONE` only when every acceptance checkbox passes.
4. Record commands, screenshots, test output, or notes under **Evidence**.
5. If implementation changes this plan, update the plan in the same change.
6. Never put passwords, API keys, tokens, or real recipient data in this file.

## 3. Confirmed decisions

| Decision | Choice |
|---|---|
| Product shape | Single-company, multi-user application |
| Authorization | One `SUPER_ADMIN`; all other users are `ADMIN` |
| Access difference | Only `SUPER_ADMIN` may deactivate or delete another user |
| Initial user | Seed the first and only `SUPER_ADMIN`; add later users in the admin panel |
| User provisioning | Super-admin credentials are passed to a terminal seed command through runtime environment variables; later admins are created directly in the panel with a manually entered initial password and no email invitation |
| Password recovery | Standard email recovery using a short-lived one-time passcode (OTP) |
| Primary outbound transport | SMTP |
| Primary inbound transport | IMAP |
| Mail provider | Provider-agnostic standard username/password SMTP and IMAP; host, port, TLS mode, credentials, and provider limits remain runtime settings |
| Database | PostgreSQL |
| ORM | Prisma ORM `7.10.0` stable, with matching `prisma` and `@prisma/client` versions |
| UI | Existing Next.js 16 App Router app and Tailwind CSS 4 |
| Architecture | One Next.js application and one background worker using the same code and database |
| Queue | PostgreSQL-backed jobs; no Redis until measured throughput requires it |
| Deployment | Single VPS with Docker Compose for web, worker, and PostgreSQL |
| PostgreSQL host port | `6543`, bound to VPS loopback only; containers use internal port `5432` |
| Contact volume | No product-level contact limit; actual capacity is measured and scaled operationally |
| Campaign count | No product-level campaign-count limit; the worker shares the global send allowance across due campaigns |
| Daily send cap | 2,500 messages globally across all campaigns |
| Send cadence | Randomized cycles of 40–50 messages, followed by a randomized 3–7 minute interval |
| Recipient regions | Global; no country or region restriction in the product |
| Compliance ownership | No separate legal-approval workflow; the product owner remains responsible for applicable sender, consent, privacy, and unsubscribe requirements |
| Knowledge sources | Pasted text and uploaded PDF, Word (`.doc`/`.docx`), or plain-text files; no URL ingestion |
| AI provider | Google Gemini API; encrypted API key and supported model dropdown in application settings |
| Default AI model | `gemini-3.8-flash`; other current supported Gemini text models remain selectable |

Version note (checked 2026-09-23): Tailwind's npm stable version is `4.3.3`.
Prisma's registry currently exposes an 8.0 release candidate on the CLI's
`latest` tag while the stable client is `7.10.0`; use matching stable `7.10.0`
packages. Recheck both immediately before Phase 1 installation and never mix
major or release-channel versions.

## 4. Email integration choices

| Option | Best fit | Benefits | Costs |
|---|---|---|---|
| SMTP + IMAP — selected | Broad provider support and self-hosted mail | Portable, familiar, works with most mailboxes | Credentials/app passwords, polling or IMAP IDLE, provider-specific folder behavior, weaker event metadata |
| Gmail API | Gmail/Google Workspace-only deployments | OAuth, Gmail threads/labels, history API, push notifications, no stored mailbox password | Google Cloud/OAuth setup, verification requirements, Gmail lock-in and quota handling |
| Microsoft Graph | Microsoft 365/Outlook-only deployments | OAuth, Outlook folders/conversations, subscriptions/webhooks, rich Microsoft metadata | Entra app setup, subscription renewal, Graph-specific throttling and Microsoft lock-in |

Gmail API and Microsoft Graph are deferred integrations. Add one only when the
operator needs provider-native OAuth or push events; SMTP/IMAP remains the
first complete path.

## 5. Technical boundaries

- Keep domain logic in small server modules; pages and route handlers validate,
  authenticate the user, apply the one user-management restriction, and delegate.
- Use Server Components by default and Client Components only for interaction.
- Read the relevant installed Next.js guide in `node_modules/next/dist/docs/`
  before using a Next.js API.
- Use Prisma migrations for every schema change. Never edit production data by
  hand as part of a deployment.
- The worker claims due jobs transactionally with PostgreSQL row locking and
  `SKIP LOCKED`; every send job has an idempotency key.
- Store timestamps in UTC. Convert only at UI and scheduling boundaries using
  the configured IANA timezone.
- Encrypt SMTP, IMAP, and AI secrets at rest. Never return decrypted values to
  the browser after saving.
- Keep only infrastructure bootstrap values outside the admin UI:
  `DATABASE_URL`, settings encryption key, session-signing secret, and public
  application URL. Document names only in `.env.example`.
- Aggregate dashboards in PostgreSQL, not by downloading and summing rows in
  the browser.
- Accessibility baseline: keyboard operation, visible focus, labels, useful
  validation, sufficient contrast, reduced-motion support, and non-color-only
  status indicators.
- Help baseline: every unfamiliar field has nearby helper text or a tooltip;
  destructive actions explain impact and require confirmation.

## 6. Initial data model map

This is an implementation guide, not a frozen schema. Phase 1 owns the exact
Prisma model names and constraints.

- `User`, `Session`: the seeded `SUPER_ADMIN`, panel-created `ADMIN` users, and
  revocable sessions. A database constraint permits at most one `SUPER_ADMIN`.
- `AppSettings`: one explicit, validated settings row; secrets encrypted.
- `Contact`, `ContactList`, `ContactListMember`, `ContactImport`: recipients,
  tags/custom fields, list membership, and CSV import history.
- `Suppression`: unsubscribed, bounced, complained, or manually blocked address.
- `Template`, `TemplateVersion`: reusable subject/body and immutable history.
- `KnowledgeSource`, `KnowledgeChunk`: source content, extraction status,
  searchable chunks, and provenance.
- `Campaign`, `CampaignStep`, `CampaignRecipient`: audience, schedule, sequence,
  per-recipient state, and personalization snapshot.
- `EmailMessage`: inbound/outbound message, headers, thread links, delivery state,
  and provider identifiers.
- `Job`: durable scheduled work, attempts, lease, idempotency key, and error.
- `TrackingEvent`: queued, sent, delivered-if-known, opened, clicked, replied,
  bounced, unsubscribed, failed, and skipped events.
- `AuditEvent`: security-sensitive settings and sending actions.

Key constraints:

- Normalize and uniquely index contact email addresses case-insensitively.
- A suppressed address can never be queued or sent.
- One campaign recipient can execute a step at most once.
- One provider message ID identifies one stored message.
- Deleting a contact must not corrupt historical aggregate counts.

## 7. Admin settings inventory

All settings below must be editable from `/settings`, validated on the server,
grouped into clear sections, and accompanied by help text. Secret inputs show
only whether a value is configured and allow replace/remove actions.

### Identity and application

- Company/product name, sender display name, reply-to address
- Physical mailing address and default unsubscribe footer
- Application timezone, date/time format, locale, and appearance preference
- Public tracking/unsubscribe base URL (validated against the deployment URL)

### SMTP sending

- Host, port, TLS mode, username, password, connection timeout
- Default From address, Reply-To, HELO name when required
- Test-connection and send-test-email actions
- Maximum messages per minute/hour/day, randomized batch-size range, and randomized batch-interval range
- Retry count/backoff, quiet days, quiet hours, and timezone

### IMAP receiving

- Host, port, TLS mode, username, password, mailbox/folder
- Poll interval, look-back window, processed/archive folder behavior
- Test-connection and sync-now actions

### Safety and campaign defaults

- Global sending kill switch with reason
- Default campaign pause switch and per-campaign pause/resume
- Maximum campaign audience, start delay, and daily cap; campaign concurrency is worker-managed
- Duplicate-send window, bounce threshold, reply-stop rule, and unsubscribe-stop rule
- Required review-before-send and test-recipient address

### AI drafting

- Provider, API endpoint when supported, API key, model
- Temperature/creativity, maximum output length, timeout, retry limit
- Default tone, language, signature, forbidden claims/phrases
- Knowledge-result limit and maximum context budget
- Require human approval before queueing AI output

The selected AI provider is Google Gemini. The API endpoint is fixed in code so
the encrypted API key cannot be sent to an arbitrary configured host; the model
is selected from the current supported allowlist in application settings.

### Tracking and privacy

- Open tracking enabled/disabled and accuracy warning
- Click tracking enabled/disabled
- Retention period for raw events and inbound message bodies
- Contact deletion/anonymization behavior
- Cookie/privacy notice text if tracking requires it in the deployment region

### Notifications and maintenance

- Notification recipient email
- Alerts for failed connection, repeated send failures, high bounce rate,
  campaign completion, and worker inactivity
- Alert cooldown, job retention, audit retention, and log verbosity

Infrastructure-only values remain outside the panel because changing them from
the running application can lock it out of its database or encryption keys.

## 8. Phase tracker

### Phase 0 — Decisions and measurable limits

**Status:** DONE

**Goal:** Freeze the minimum business and operational rules needed to build
without guessing.

**Decide and record:**

- ~~Deployment target and process manager for the web app and worker~~ — Single
  VPS with Docker Compose
- ~~Initial user creation~~ — seed the first and only `SUPER_ADMIN`; create
  later `ADMIN` users from the admin panel
- ~~Initial super-admin credentials~~ — passed to the seed command through
  runtime environment variables and never written to a file
- ~~Admin invitation method~~ — create directly in the panel; send no invitation email
- ~~New-admin initial password~~ — creator enters it in the panel and shares it manually
- ~~First-login password change~~ — not required
- ~~Password-reset method~~ — short-lived OTP sent to the user's email address
- ~~Expected contacts, messages/day, and simultaneous campaigns~~ — no configured
  contact or campaign-count limit; 2,500 messages/day globally, with randomized
  40–50 message cycles separated by 3–7 minutes
- ~~Sending domain/mailbox and provider limits~~ — provider selection is deferred;
  standard username/password SMTP and IMAP settings remain configurable, and
  the chosen provider's limits must be entered before sending is enabled
- ~~Required jurisdictions and legal review owner~~ — recipients may be global;
  there is no separate legal-approval workflow, and the product owner remains
  responsible for applicable sender, consent, privacy, and unsubscribe rules
- ~~AI provider~~ — Google Gemini API, with `gemini-3.8-flash` as the default
- ~~Knowledge source types needed at launch~~ — pasted text plus uploaded PDF,
  Word (`.doc`/`.docx`), and plain-text files; no URL ingestion

**Acceptance:**

- [x] Every item except the explicitly deferred AI choice has an owner-approved answer.
- [x] Mail integration is provider-agnostic; a live test mailbox is required before production acceptance, not development.
- [x] A disposable non-production PostgreSQL database is available and clean migrations pass.
- [x] No real campaign can send from the development environment.

**Evidence:** 2026-09-24 — Owner approved no product-level contact or campaign
count limit, a 2,500-message global daily cap, randomized 40–50 message send
cycles, and randomized 3–7 minute intervals between cycles. Settings defaults,
range validation, and the build plan were aligned with the decision. The owner
also approved provider-agnostic username/password SMTP and IMAP; provider,
mailbox, domain, and provider-specific limits remain deployment-time settings
rather than an implementation blocker. Recipients may be global with no
country filter or separate legal-approval workflow; required sender identity,
suppression, privacy, and unsubscribe safeguards remain product requirements.
Launch knowledge ingestion is limited to pasted text, PDF, Word, and plain-text
files; URL ingestion is explicitly excluded. Phase 0 decisions are complete;
the default kill switch and absent send worker prevent development campaigns.

---

### Phase 1 — Foundation, database, and quality checks

**Status:** DONE

**Goal:** A deployable shell with PostgreSQL, Prisma, validation, and repeatable
checks before product features begin.

**Build:**

- Install matching stable Prisma packages and PostgreSQL driver adapter.
- Add `prisma.config.ts`, schema, first migration, generated client, and the
  terminal-driven super-admin seed.
- Add scripts for lint, typecheck, test, build, migration, seed, and web. Add
  the worker script in Phase 6 with its first real job handler.
- Establish the shared validation/error shape with Phase 2's first mutation;
  the health route has a deliberately smaller operational response.
- Create the responsive application shell, navigation, empty/error/loading
  states, accessible form controls, tooltip/help pattern, and status badge.
- Replace the starter page and assets; keep Tailwind 4 rather than adding a UI
  framework prematurely.

**Acceptance:**

- [x] A clean database migrates and seeds successfully.
- [x] The app starts and reads a health query through Prisma.
- [x] Lint, typecheck, tests, and production build pass.
- [x] Mobile and desktop navigation work with keyboard-only use.
- [x] No secret or `.env` file is read, written, or committed by the agent.

**Evidence:** 2026-09-23 — Prisma validation/client generation, password test,
TypeScript, ESLint, Compose validation, and Docker production build passed.
The initial migration and disposable super-admin seed passed against a clean
PostgreSQL 18 container; the test row was verified and the disposable database
was removed. 2026-09-23 UI shell and preview routes passed lint, typecheck,
tests, and a Docker production build. Dashboard, settings, mobile, and dark-mode
views were inspected in Chrome. A disposable full Docker stack returned
`{"status":"ok","checks":{"database":"ok"}}` from `/api/health`, then its
test containers and volume were removed.

---

### Phase 2 — Authentication and minimal user management

**Status:** DONE

**Goal:** Protect every private route and implement only the requested
`SUPER_ADMIN`/`ADMIN` distinction.

**Build:**

- Seed the first `SUPER_ADMIN` using credentials passed to a terminal command
  through runtime environment variables. Add later `ADMIN` users directly from
  the admin panel; the creator enters and manually shares the initial password.
  Do not build invitation or credential emails.
- Login, logout, change password, forgotten-password recovery, session expiry,
  and revoke-other-sessions.
- Both user types otherwise have identical access. Only `SUPER_ADMIN` can
  deactivate or delete another user; an `ADMIN` cannot perform either action.
- Prevent deactivation/deletion of the sole `SUPER_ADMIN` and prevent creation
  or promotion of a second `SUPER_ADMIN`.
- Password hashing with a memory-hard algorithm already available in the chosen
  runtime/dependencies; secure, HTTP-only, SameSite cookies and hashed session
  tokens in PostgreSQL.
- Rate-limit login and recovery attempts and log sensitive actions.

**Acceptance:**

- [x] An unauthenticated request cannot access pages, data routes, or worker controls.
- [x] Login, logout, expiry, password change, and recovery each pass.
- [x] A revoked session stops working immediately.
- [x] The seed creates exactly one `SUPER_ADMIN` without hardcoded credentials.
- [x] Users created in the panel are always `ADMIN`.
- [x] `ADMIN` and `SUPER_ADMIN` can use the same product features.
- [x] Only `SUPER_ADMIN` can deactivate/delete another user.
- [x] The sole `SUPER_ADMIN` cannot be deactivated or deleted.
- [x] No generic roles, permissions, or policy framework was added.

**Evidence:** 2026-09-23 — Added protected workspace routes, database-backed
opaque sessions with hashed tokens, secure HTTP-only cookies, logout with
immediate server-side revocation, and persistent login throttling. Prisma
validation/client generation, unit tests, TypeScript, ESLint, and diff checks
pass. A Docker production build and both migrations passed against an isolated
PostgreSQL 18 database; its containers and volume were then removed. Added real user
management, password changes, revoke-other-sessions, audit events, and mobile
logout. An isolated Docker test verified unauthenticated redirects, login/logout,
admin creation, admin authorization denial, super-admin protection, password
change, audit records, and immediate session revocation after deactivation.
2026-09-24 — Added throttled email OTP recovery with a keyed six-digit code,
10-minute expiry, five-attempt limit, one-time transactional consumption,
password replacement, full session revocation, and audit events. SMTP delivery
reuses the settings connection and validates headers, addresses, TLS mode, and
dot-stuffing. A clean PostgreSQL 18 database applied all five migrations; a
fake SMTP end-to-end check delivered the OTP, rejected replay and the old
password, accepted the new password, revoked the old session, and recorded both
recovery audit events. Unit tests, Prisma validation, TypeScript, ESLint, diff
checks, and a production webpack build pass; disposable resources were removed.

---

### Phase 3 — Settings center and connection checks

**Status:** DONE

**Goal:** Make every operational product setting manageable without editing
code or deployment variables.

**Build:**

- `/settings` sections matching the complete inventory in Section 7.
- Typed server validation, safe defaults, encrypted secret storage, audit
  history, and test actions for SMTP and IMAP.
- Global kill switch displayed persistently whenever sending is disabled.

**Acceptance:**

- [x] Every Section 7 setting is present, searchable by section, and explained.
- [x] Invalid ports, addresses, timezones, URLs, and limits are rejected.
- [x] Saved secrets cannot be read back through UI, HTML, logs, or API responses.
- [x] SMTP/IMAP tests return useful success or remediation messages.
- [x] Switching the global kill switch on prevents a test job from sending.

**Evidence:** 2026-09-24 — Backend slice complete. Added `AppSettings`
singleton (typed values JSONB, three encrypted secret columns, kill-switch
flag and reason, audit-linked updater) with migration `20260923030000_app_settings`
applied against a clean PostgreSQL 18 container. AES-256-GCM secret encryption
(`lib/crypto.ts`) and a registry-driven settings module (`lib/settings-schema.ts`,
`lib/settings.ts`) cover identity, SMTP, IMAP, safety/kill-switch, tracking
retention, and notification fields with server-side validation (ports, email,
URL, select options, IANA timezones, numeric bounds) and unit tests. `/api/settings/save`
and `/api/settings/test-smtp|test-imap` enforce same-origin and session
authorization, write `settings.updated` / `settings.*_tested`
audit events, and merge section-scoped submissions with stored values so
unsubmitted fields and the kill switch never move implicitly. STARTTLS and
implicit-TLS SMTP probes with buffered multi-line reply parsing plus an IMAP
TLS probe were verified against local fake mail servers (accept, reject,
connection-refused, and stored-secret paths); the stored secret path decrypts
and authenticates without ever echoing the value. The settings page renders
from the registry with configured-only secret display and per-section validation
highlighting; the sidebar shows the live
global kill-switch state and reason. 19 unit tests, lint, typecheck, and the
production build pass. Live smoke matrix: login, save, partial save, kill-switch
flip with reason enforcement, five invalid-input rejections, admin/unauthenticated/cross-origin
denials leaving data unchanged, audit history, and dashboard banner state.
Follow-up audit added the remaining Section 7 settings, section/field search,
explicit secret removal, locale/quiet-window/deployment-origin validation, and
real use of the configured SMTP timeout and HELO name. It also restored the
approved shared `ADMIN`/`SUPER_ADMIN` settings access and enabled TLS certificate
verification. Unit tests, TypeScript, ESLint, diff checks, and a production
webpack build pass.

---

### Phase 4 — Contacts, lists, and suppression

**Status:** DONE

**Goal:** Safely manage target data before any bulk sending exists.

**Build:**

- Contact CRUD, search, filters, tags, lists, custom fields, archive, and delete.
- CSV preview/import with column mapping, normalization, duplicate handling,
  row errors, and an import result summary.
- Global suppression list with manual, unsubscribe, bounce, and complaint reasons.
- CSV export of filtered contacts without secret/internal fields.

**Acceptance:**

- [x] Importing a fixture twice creates no duplicate contacts.
- [x] Invalid rows are reported without discarding valid rows.
- [x] Search, list membership, archive, export, and deletion behave as shown in UI.
- [x] A suppressed address cannot be selected for a campaign.
- [x] The interface clearly explains why a contact is suppressed.

**Evidence:** 2026-09-25 — Added normalized contacts, durable address-based
suppressions, lists and cascading memberships, editable tags/custom fields,
search/status/list filters, pagination, archive/restore/delete, eligibility
counts that exclude every suppressed address, human-readable suppression
reasons, and authenticated audited mutations. CSV import previews and maps
columns, validates again on the server, keeps valid rows when others fail,
records row errors and import history, and inserts in bounded transactional
batches. Filtered export streams CSV without internal IDs or secrets.

A clean PostgreSQL 18 database applied all six migrations. An authenticated
smoke imported a four-row fixture twice: the first pass added 2, skipped 1
in-file duplicate, and reported 1 invalid row; the second added 0, skipped all
3 valid rows as duplicates, and again reported the invalid row. Database totals
were 2 contacts, 2 histories, 2 imported, 4 duplicates, and 2 invalid rows.
List-filtered active/archived exports, search, a visible `MANUAL` suppression,
and deletion were exercised through application routes. Deletion cascaded list
membership while its suppression remained. Unit tests, Prisma validation,
TypeScript, ESLint, diff checks, and the production webpack build pass.

---

### Phase 5 — Templates and safe rendering

**Status:** DONE

**Goal:** Create reusable email content with predictable personalization.

**Build:**

- Template create/edit/duplicate/archive, subject, plain text, sanitized HTML,
  preview, test send, and version history.
- Documented variables from contact, company, campaign, and sender data.
- Missing-variable detection before scheduling and escaped-by-default rendering.
- Required unsubscribe link/footer insertion at send time.

**Acceptance:**

- [x] Preview and delivered test email render the same supported variables.
- [x] Missing required variables block scheduling and identify affected contacts.
- [x] Unsafe HTML/scripts cannot execute in preview or stored output.
- [x] Every bulk email includes sender identity and a working unsubscribe route.

**Evidence:** 2026-09-25 — Added template create/edit/duplicate/archive/restore,
immutable version history, documented contact/campaign/sender variables, one
shared renderer for previews and SMTP delivery, per-contact missing-variable
reports, and mandatory bulk identity/address/unsubscribe footers. Authors enter
plain text and stored HTML is generated exclusively from escaped content;
preview HTML is additionally isolated in a sandboxed iframe. Opaque encrypted
unsubscribe tokens require an explicit public confirmation and preserve stronger
bounce/complaint suppression reasons.

A clean PostgreSQL 18 database applied all seven migrations. An authenticated
smoke created and updated a template; the database showed current version 2,
two immutable versions, no stored `<script>` element, and escaped literal script
text in version 1. The personalized preview rendered the expected campaign and
sender values. A disposable local SMTP sink captured the multipart test email
with the same rendered content plus sender name, company, physical address, and
a working unsubscribe URL. The valid link created an `UNSUBSCRIBED` suppression;
a tampered token was rejected. Unit tests cover rendering, escaping, affected
contact reporting, footer requirements, token integrity, and multipart SMTP.
Prisma validation, TypeScript, ESLint, diff checks, and production build pass.

---

### Phase 6 — Durable scheduler, SMTP sending, and kill switches

**Status:** DONE

**Goal:** Reliably send scheduled bulk email without duplicate sends.

**Build:**

- Campaign draft/review/schedule workflow, audience snapshot, optional sequence
  steps, test send, and estimated send window.
- PostgreSQL job worker with leases, idempotency, retry/backoff, stale-job
  recovery, graceful shutdown, and worker heartbeat.
- Enforce global, campaign, rate, daily, quiet-hour, suppression, reply, and
  unsubscribe checks immediately before each SMTP send.
- Pause, resume, cancel pending work, and clearly show what cannot be recalled.

**Acceptance:**

- [x] A scheduled campaign sends only after its due time in the configured timezone.
- [x] Restarting the worker during a batch causes neither loss nor duplicate sends.
- [x] Global kill switch stops the next unsent message within one worker cycle.
- [x] Campaign pause affects only that campaign; resume continues pending work.
- [x] Rate/daily/quiet-hour limits hold under two concurrent worker processes.
- [x] Failed jobs retry as configured and end with an actionable error.

**Evidence:** 2026-09-25 — Added campaign draft/review/schedule, immutable
recipient snapshots, sequences, timezone-aware scheduling and estimates, a
PostgreSQL worker with row locking, stable message IDs, retries, heartbeat,
global randomized 40–50-message batches with 3–7-minute gaps, and global,
campaign, minute, hour, daily, quiet-window, suppression, reply, and duplicate
guards. The delivery ledger records the exact recipient, rendered content, and
SMTP outcome; contacts retain their latest SMTP-accepted subject and timestamp.
The UI labels SMTP acceptance separately from inbox delivery.

A clean PostgreSQL 18 database applied all eight migrations. A future-dated
campaign remained `PENDING` with no message row. Two simultaneous workers sent
exactly one of two due messages under a one-per-minute limit and deferred the
other; separate daily-cap and quiet-window runs also stayed pending with no SMTP
attempt. Global pause stopped a due job across multiple cycles. Campaign pause
left the same job pending, and resume completed it with one stable Message-ID
and updated contact history. A pre-DATA `550` rejection retried to attempt 2 and
ended `FAILED` with the SMTP response. A post-DATA timeout ended after one
attempt as terminal `UNKNOWN`; startup recovery likewise converted a simulated
stale `DELIVERING` job to `UNKNOWN` without requeueing it. The local SMTP sink
captured one copy of each accepted or ambiguous message. Unit tests, Prisma
validation, TypeScript, ESLint, diff checks, and production build pass.

---

### Phase 7 — Knowledge base and AI draft assistant

**Status:** DONE

**Entry decision:** Resolved — Google Gemini API, selectable supported model,
and pasted text/PDF/Word/plain-text sources.

**Goal:** Draft grounded emails using only relevant approved business knowledge.

**Build:**

- Knowledge source add/edit/archive, extraction status, last processed time,
  provenance, and reprocess action.
- Extract text once, split into attributable chunks, index with PostgreSQL text
  search first, and retrieve only the most relevant chunks within the configured
  context budget. Add vector search only if measured quality is insufficient.
- AI drafting for subject/body with tone, goal, recipient facts, selected
  knowledge citations, regenerate, compare, and manual editing.
- Prompt-injection resistance: source content is untrusted data, never system
  instruction; never expose secrets or unrelated contacts to the model.

**Acceptance:**

- [x] A known fixture retrieves the expected relevant chunks and excludes noise.
- [x] Draft UI shows which sources supported the draft.
- [x] Disallowed claims/phrases and missing recipient data produce clear warnings.
- [x] Provider timeout/failure preserves the user's current work.
- [x] No AI draft can enter the send queue without human approval.

**Evidence:** 2026-09-25 — Google Gemini was selected. Settings now store the
API key encrypted and expose a validated dropdown of current Gemini text models,
defaulting to `gemini-3.8-flash`; retired stored IDs fall back safely. The fixed
Google endpoint prevents configured credential exfiltration. Added structured
Gemini generation with timeout/retry handling, untrusted-source isolation,
allowlisted citations, forbidden-phrase and missing-recipient warnings, editable
drafts, regeneration/compare history, and an explicit approval action that is
the only path from AI output to a reusable template. Provider failures preserve
the current browser inputs and draft. Source management supports pasted text and
PDF, `.doc`, `.docx`, and `.txt` uploads with the approved 20 MB cap, editable
pasted content/names, archive/restore, visible extraction failures, provenance,
and reprocessing from the retained original.

A clean PostgreSQL 18 database applied all nine migrations. Real fixtures for
all four file paths extracted the expected text, an actual file over 20 MB was
rejected, and the production standalone artifact successfully extracted PDF
after its worker asset was explicitly traced. A known full-text query returned
the expected routing chunks from PDF, DOC, DOCX, and TXT while excluding an
unrelated cafeteria source. Edit, archive, restore, reprocess, missing-key
failure, and explicit draft approval were exercised through authenticated
application routes. Unit tests cover chunking, limits, supported types,
structured Gemini output, citation allowlisting, warnings, injection isolation,
and retry behavior. Prisma validation, TypeScript, ESLint, diff checks, and the
production webpack build pass. A live Gemini generation awaits the owner's API
key, which is a deployment secret rather than an implementation dependency.

---

### Phase 8 — IMAP inbox, threading, replies, and bounces

**Status:** DONE

**Goal:** Synchronize inbound mail and stop follow-ups when recipients respond.

**Build:**

- Incremental IMAP synchronization with durable cursor/UID state and safe resync.
- Parse and store required headers, text/sanitized HTML bodies, attachments
  metadata, and Message-ID/In-Reply-To/References relationships.
- Inbox/thread UI, unread/read state, contact/campaign link, reply via SMTP, and
  manual association for unmatched mail.
- Detect delivery-status notifications and common automatic replies; uncertain
  matches are flagged for review rather than silently suppressing contacts.

**Acceptance:**

- [x] Re-running the same sync creates no duplicate messages.
- [x] A campaign reply attaches to the correct contact/thread and stops follow-ups.
- [x] A recognized hard bounce suppresses the address before another send.
- [x] Malformed email or attachment cannot crash or block later sync.
- [x] IMAP cursor loss can recover within the configured look-back window.

**Evidence:** 2026-09-25 — Added provider-neutral TLS, STARTTLS, and plain IMAP
support with encrypted username/password settings, worker polling, a leased durable
UID/UIDVALIDITY cursor, incremental UID search, and configured look-back recovery
when the cursor is absent or invalid. MIME parsing stores addresses, subject,
Message-ID/In-Reply-To/References, bounded text, an inert sanitized HTML
projection, and attachment metadata; oversized or malformed messages become
visible review records without blocking later UIDs. The inbox supports search,
read/unread state, outbound context, contact/campaign association, manual matching,
and SMTP replies with standards-based thread headers. Exact campaign replies update
the contact's last received/replied history and cancel pending follow-ups when the
setting is enabled. Strong permanent-DSN evidence marks the outbound delivery and
recipient bounced, creates durable suppression, and cancels pending sends; uncertain
bounces and automatic replies do not suppress silently.

A PostgreSQL fixture proved duplicate-safe ingest, exact reply threading and stop,
hard-bounce suppression/status, and that a malformed record did not prevent the
next valid message. Unit coverage verifies hard-bounce conservatism, auto-replies,
header safety, HTML inertness, and UID cursor/look-back behavior. The authenticated
inbox rendered its stored fixtures and the read-state route returned a successful
303. All twelve migrations apply to the disposable PostgreSQL 18 database; tests,
Prisma validation, TypeScript, ESLint, diff checks, and the production webpack build
pass. A live mailbox handshake awaits the eventual provider credentials and is not
an implementation blocker.

---

### Phase 9 — Tracking, unsubscribe, and complete statistics

**Status:** DONE

**Goal:** Show trustworthy operational and campaign results without overstating
what SMTP can prove.

**Build:**

- Signed unsubscribe URLs and standards-compatible unsubscribe headers.
- Optional open pixel and click redirects controlled by privacy settings.
- Dashboard and campaign/contact drill-downs for queued, sent, SMTP-accepted,
  failed, bounced, replied, unsubscribed, opened, and clicked counts/rates.

- Date/campaign/template/list filters, export, denominator definitions, and
  warnings that opens are privacy-client affected and SMTP acceptance is not
  guaranteed delivery.

**Acceptance:**

- [x] Unsubscribe works without login, is idempotent, and suppresses immediately.
- [x] Every displayed rate has a defined denominator and matches SQL fixtures.
- [x] Disabling tracking stops new open/click tracking URLs from being emitted.
- [x] Dashboard totals reconcile with campaign and message records.
- [x] Empty, delayed, and partially known delivery states are explained clearly.

**Evidence:** 2026-09-25 — Campaign mail now emits signed RFC-compatible
`List-Unsubscribe` and one-click headers. The public endpoint accepts provider
one-click POSTs without a login, keeps unsubscribe idempotent, creates durable
suppression, cancels pending jobs immediately, and records a message-attributable
event. Optional open pixels and click redirects use opaque authenticated tokens,
deduplicate by message/target, reject invalid or non-HTTP targets, and are emitted
only when their individual privacy setting is enabled; unsubscribe links are never
wrapped by click tracking.

The dashboard now uses PostgreSQL aggregates instead of preview numbers, with
inclusive date, campaign, template, and contact-list filters plus an authenticated
CSV export. It shows queued, attempted, SMTP-accepted, failed, unknown, bounced,
replied, unsubscribed, uniquely opened, and uniquely clicked facts. Each rate names
its denominator, empty denominators render as unknown rather than zero, and the UI
warns about SMTP uncertainty and open-tracking privacy effects. Campaign cards and
contact rows expose their stored activity drill-downs.

A SQL fixture reconciled the same known campaign to exactly 2 jobs, 1 attempt, 1
SMTP acceptance, 1 accepted recipient, 1 reply, 1 unsubscribe, 1 unique open, and
1 unique click through campaign, template, and list filters. The rendered dashboard
and CSV matched the stored database totals. Public route checks returned a 34-byte
GIF, the exact signed click redirect, and two successful one-click unsubscribe
responses while retaining one suppression and one event. All thirteen migrations
apply; 52 unit assertions, Prisma validation, TypeScript, ESLint, diff checks, and
the production webpack build pass.

---

### Phase 10 — Operational visibility and recovery

**Status:** DONE

**Goal:** Make failures diagnosable and recoverable from the application.

**Build:**

- Health view for web, database, worker heartbeat, SMTP, IMAP, and AI.
- Failed-job list with safe retry/cancel, campaign audit trail, and settings audit.
- Structured logs with IDs but no credentials or full email bodies.
- Alerts configured in Section 7 and documented database backup/restore drill.

**Acceptance:**

- [x] Simulated SMTP, IMAP, AI, database, and worker failures are distinguishable.
- [x] Retrying a failed job cannot duplicate a previously accepted send.
- [x] Stale worker status triggers one deduplicated alert.
- [x] A backup restores into a clean non-production database and passes integrity checks.

**Evidence:** Operations UI and `/api/health` expose independent service states; 54 automated assertions pass, including accepted/unknown retry rejection. The database fixture emitted one stale-worker notification across two evaluations. PostgreSQL 18 backup restored into `cold_emailer_restore_check` with 14 applied migrations and zero orphan jobs/messages. Typecheck, lint, Prisma validation, Compose validation, and the webpack production build pass.

---

### Phase 11 — Security, privacy, accessibility, and load hardening

**Status:** DONE

**Goal:** Verify the complete system at its trust boundaries and expected scale.

**Build/check:**

- CSRF, XSS, SSRF for URL ingestion if enabled, SQL/HTML/template injection,
  attachment limits, auth rate limits, secure headers, and secret redaction.
- Data retention/deletion, audit integrity, unsubscribe permanence, sender
  identity, consent basis, and privacy copy reviewed by the product owner.
- Keyboard/screen-reader/reduced-motion checks and responsive layouts.
- Load test at Phase 0 limits for imports, campaign claiming, dashboard queries,
  IMAP sync, and kill-switch response.

**Acceptance:**

- [x] No unresolved critical/high security finding remains.
- [x] Accessibility checks cover every primary workflow with no serious blocker.
- [x] Expected load stays within recorded response-time and worker-lag targets.
- [x] Retention/deletion jobs remove only intended data and preserve suppressions.
- [x] Sender identity, consent basis, privacy settings, suppression, and unsubscribe behavior are configured before sending.

**Evidence:** Production `npm audit` reports zero vulnerabilities after safe Prisma transitive overrides. Same-origin mutation checks returned 403; hardened CSP, framing, MIME, referrer, permissions, and HSTS headers were observed. Template HTML remains escaped/sandboxed, SQL is parameterized, URL ingestion is absent, uploads are bounded, and CSV formulas are neutralized. Chrome accessibility trees across all nine authenticated workflows plus login, recovery, and unsubscribe found no unnamed interactive control, duplicate ID, missing main/H1, or 390 px overflow; reduced-motion styles applied. A 20,000-row CSV import completed in 9.881 s, five main pages rendered in 579–614 ms, 20 concurrent dashboards completed in 552 ms, selectable-contact/statistics queries took 226/20 ms, kill-switch claim took 70 ms, and 2,500 inbound classifications took 5 ms. The load run found and verified a transaction-timeout fix. A retention fixture removed expired events/audits/terminal jobs and redacted old bodies while preserving pending jobs and unsubscribe suppression. Fifty-six assertions, typecheck, lint, Prisma/Compose/script validation, diff checks, and the webpack production build pass.

---

### Phase 12 — Production readiness and final acceptance

**Status:** IN PROGRESS

**Goal:** Prove the whole product with a controlled, reversible launch.

**Acceptance scenario:**

- [ ] Deploy web and worker from a clean checkout and migrate PostgreSQL.
- [ ] Sign in as the seeded `SUPER_ADMIN`, create an `ADMIN`, and configure every required setting through UI.
- [x] Import a test contact list containing valid, invalid, duplicate, and suppressed rows.
- [ ] Add knowledge, generate and approve a grounded template, then send a test.
- [x] Schedule a small campaign; verify limits, pause/resume, and global kill switch.
- [ ] Receive a reply and bounce through IMAP; verify threading and suppression.
- [x] Unsubscribe one recipient; verify no later step can send to that address.
- [x] Reconcile dashboard counts and export with stored message/event records.
- [x] Restart web and worker during controlled processing with no duplicate send.
- [x] Restore the latest backup into a clean environment.
- [ ] Record rollback steps and obtain owner launch approval.

**Evidence:** The final image built from the complete source with the normal Turbopack path and a zero-vulnerability install. A fresh isolated Compose deployment applied all 14 migrations and ran healthy web, worker, and monitor services; `/api/health` reported web/database/worker `ok`. The seeded `SUPER_ADMIN` signed in and created an `ADMIN`. Controlled web/worker restart returned to healthy, and the latest backup restored into a clean database with 14 migrations, both users, and zero orphan jobs. Earlier phase fixtures complete the checked import, scheduling/limits, unsubscribe, statistics reconciliation, and at-most-once restart scenarios.

Rollback is defined around immutable `APP_IMAGE` tags: engage the global sending kill switch, back up the database, set `APP_IMAGE` to the last compatible release, and recreate web/worker/monitor. Database migrations are forward-only; restore the pre-migration backup only into a clean database when forward recovery is not possible. Keep the new deployment stopped until integrity and health checks pass.

Remaining launch gates require external state intentionally absent from development: commit the current work and deploy that clean revision; select a mail provider and configure/test real SMTP and IMAP credentials; add the owner's Gemini API key and complete a live grounded draft/test send; configure every required identity/consent/privacy value; then obtain explicit owner launch approval.

## 9. Progress summary

| Phase | Status | Completed | Evidence summary |
|---|---|---|---|
| 0. Decisions and limits | DONE | 2026-09-25 | Scale, cadence, provider flexibility, global scope, safeguards, and knowledge inputs approved |
| 1. Foundation | DONE | 2026-09-23 | Prisma/Docker, responsive UI shell, preview routes, and live database health verified |
| 2. Authentication and users | DONE | 2026-09-24 | Login, sessions, user management, throttled OTP recovery, revocation, and audit verified end-to-end |
| 3. Settings | DONE | 2026-09-24 | Complete searchable inventory, encrypted replace/remove secrets, validation, kill switch, and SMTP/IMAP probes verified |
| 4. Contacts | DONE | 2026-09-25 | CRUD, lists, custom fields, suppression, idempotent CSV import, and filtered export verified |
| 5. Templates | DONE | 2026-09-25 | Safe rendering, version history, previews, SMTP test delivery, and unsubscribe footer verified |
| 6. Scheduling and SMTP | DONE | 2026-09-25 | Durable at-most-once worker, throttling, limits, kill switches, ledger, and UNKNOWN crash boundary verified |
| 7. Knowledge and AI | DONE | 2026-09-25 | Four approved source paths, 20 MB cap, full-text retrieval, Gemini drafting guardrails, citations, and approval boundary verified |
| 8. IMAP inbox | DONE | 2026-09-25 | Durable incremental sync, threaded inbox/replies, reply-stop, bounce suppression, and recovery fixture verified |
| 9. Statistics | DONE | 2026-09-25 | One-click unsubscribe, optional signed tracking, filtered SQL metrics/export, and reconciliation fixture verified |
| 10. Operations | DONE | 2026-09-25 | Service health, atomic safe recovery, deduplicated alerts, retention, structured logs, and clean restore drill verified |
| 11. Hardening | DONE | 2026-09-25 | Zero dependency findings, trust-boundary/header checks, 12-screen accessibility pass, 20k-contact load proof, and retention safety verified |
| 12. Production acceptance | NOT STARTED | — | — |

## 10. Deferred until evidence requires them

- Custom roles/permissions, organizations, billing, and tenant isolation
- Gmail API, Microsoft Graph, multiple mailbox providers, or mailbox rotation
- Redis or a third-party queue
- Microservices, monorepo packages, event bus, and separate analytics database
- Vector database before PostgreSQL search quality is measured
- Mobile applications

Add a deferred item only when there is a concrete requirement, expected usage,
an acceptance check, and an owner-approved phase.

## 11. Progress log

Append one short row whenever phase status changes.

| Date | Phase | Change | Evidence/decision |
|---|---|---|---|
| 2026-09-23 | Planning | Tracker created | SMTP/IMAP; PostgreSQL; Prisma 7; Tailwind 4 |
| 2026-09-23 | 0 | Started | Single VPS with Docker Compose selected |
| 2026-09-23 | 0 | Access model revised | One seeded `SUPER_ADMIN`; panel-created `ADMIN` users; only super admin can deactivate/delete users |
| 2026-09-23 | 0 | User provisioning decided | Super admin from environment; admins created directly in panel without email |
| 2026-09-23 | 0 | Initial passwords decided | Super admin passed to seed command; admin creator enters and manually shares password |
| 2026-09-23 | 0 | Password policy decided | No forced first-login password change |
| 2026-09-23 | 1 | Foundation started | Prisma 7.10, PostgreSQL 18 migration/seed, Docker build, and host port 6543 verified |
| 2026-09-23 | 1 | UI prototype built | Responsive dashboard, feature routes, full settings form, loading/error/empty states, and dark mode verified |
| 2026-09-23 | 1 | Completed | Live database health passed in a disposable Docker stack; worker correctly deferred to sending phase |
| 2026-09-24 | 3 | Backend slice started | `app_settings` migration, AES-256-GCM secret store, registry validation, save/test routes, kill-switch state in shell |
| 2026-09-24 | 3 | Probes verified live | Fake SMTP/IMAP servers confirmed accept, reject, refused, and stored-secret paths; auth matrix and audit verified on disposable stack |
| 2026-09-24 | 3 | Completed | Full inventory/search, shared admin access, secret removal, validation, secure TLS probes, checks, and production build pass |
| 2026-09-24 | 2 | Completed | SMTP OTP recovery, expiry/attempt limits, one-time reset, session revocation, audit, and clean-database smoke test passed |
| 2026-09-24 | 0 | Scale and cadence decided | Unlimited configured contacts/campaigns; 2,500/day global cap; randomized 40–50 batches every 3–7 minutes |
| 2026-09-24 | 0 | Mail integration decided | Provider-agnostic username/password SMTP/IMAP; provider-specific connection details and limits are configured at deployment |
| 2026-09-24 | 0 | Recipient scope decided | Global recipients, no country filter or separate legal-approval workflow; product safeguards remain required |
| 2026-09-25 | 0 | Completed | Pasted text plus PDF, Word, and text-file knowledge sources; URL ingestion excluded; all required decisions resolved |
| 2026-09-25 | 4 | Started | Contact normalization, CRUD/search, archive, and durable manual suppression foundation verified on a clean database |
| 2026-09-25 | 8 | Completed | Durable IMAP cursor, MIME ingest, inbox UI/replies, reply-stop, bounce suppression, and recovery checks passed |
| 2026-09-25 | 9 | Completed | Public unsubscribe/tracking routes and filtered SQL dashboard/export reconciled against fixtures |
| 2026-09-25 | 10 | Completed | Operations health/recovery UI, alert monitor, retention, structured logs, and PostgreSQL backup/restore integrity drill passed |
| 2026-09-25 | 11 | Completed | Security, accessibility, retention, and 20,000-contact load gates passed after fixing import timeout, CSV injection, and mobile overflow |
| 2026-09-25 | 12 | Started | Final container deployment and acceptance run begun; live provider checks and owner launch approval remain external gates |
