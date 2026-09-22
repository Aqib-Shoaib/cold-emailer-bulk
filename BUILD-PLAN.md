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
| Primary outbound transport | SMTP |
| Primary inbound transport | IMAP |
| Database | PostgreSQL |
| ORM | Prisma ORM `7.10.0` stable, with matching `prisma` and `@prisma/client` versions |
| UI | Existing Next.js 16 App Router app and Tailwind CSS 4 |
| Architecture | One Next.js application and one background worker using the same code and database |
| Queue | PostgreSQL-backed jobs; no Redis until measured throughput requires it |
| Deployment | Single VPS with Docker Compose for web, worker, and PostgreSQL |
| PostgreSQL host port | `6543`, bound to VPS loopback only; containers use internal port `5432` |

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
- Maximum messages per minute/hour/day, batch size, delay jitter
- Retry count/backoff, quiet days, quiet hours, and timezone

### IMAP receiving

- Host, port, TLS mode, username, password, mailbox/folder
- Poll interval, look-back window, processed/archive folder behavior
- Test-connection and sync-now actions

### Safety and campaign defaults

- Global sending kill switch with reason
- Default campaign pause switch and per-campaign pause/resume
- Maximum campaign audience, start delay, daily cap, and concurrent campaigns
- Duplicate-send window, bounce threshold, reply-stop rule, and unsubscribe-stop rule
- Required review-before-send and test-recipient address

### AI drafting

- Provider, API endpoint when supported, API key, model
- Temperature/creativity, maximum output length, timeout, retry limit
- Default tone, language, signature, forbidden claims/phrases
- Knowledge-result limit and maximum context budget
- Require human approval before queueing AI output

The AI provider is intentionally **unselected**. It must be chosen before Phase
7; do not invent an endpoint or key.

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

**Status:** IN PROGRESS

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
- Password-reset method
- Expected contacts, messages/day, and simultaneous campaigns
- Sending domain/mailbox and provider limits
- Required jurisdictions and legal review owner
- AI provider (may remain open until Phase 7)
- Knowledge source types needed at launch: pasted text, files, and/or URLs

**Acceptance:**

- [ ] Every item except the explicitly deferred AI choice has an owner-approved answer.
- [ ] SMTP and IMAP test mailbox details exist outside the repository.
- [ ] A non-production PostgreSQL database is available.
- [ ] No real campaign can send from the development environment.

**Evidence:** _Add links/commands/results here._

---

### Phase 1 — Foundation, database, and quality checks

**Status:** IN PROGRESS

**Goal:** A deployable shell with PostgreSQL, Prisma, validation, and repeatable
checks before product features begin.

**Build:**

- Install matching stable Prisma packages and PostgreSQL driver adapter.
- Add `prisma.config.ts`, schema, first migration, generated client, and the
  terminal-driven super-admin seed.
- Add scripts for lint, typecheck, test, build, migration, seed, web, and worker.
- Establish one reusable server-side validation/error shape.
- Create the responsive application shell, navigation, empty/error/loading
  states, accessible form controls, tooltip/help pattern, and status badge.
- Replace the starter page and assets; keep Tailwind 4 rather than adding a UI
  framework prematurely.

**Acceptance:**

- [x] A clean database migrates and seeds successfully.
- [ ] The app starts and reads a health query through Prisma.
- [x] Lint, typecheck, tests, and production build pass.
- [x] Mobile and desktop navigation work with keyboard-only use.
- [x] No secret or `.env` file is read, written, or committed by the agent.

**Evidence:** 2026-09-23 — Prisma validation/client generation, password test,
TypeScript, ESLint, Compose validation, and Docker production build passed.
The initial migration and disposable super-admin seed passed against a clean
PostgreSQL 18 container; the test row was verified and the disposable database
was removed. 2026-09-23 UI shell and preview routes passed lint, typecheck,
tests, and a Docker production build. Dashboard, settings, mobile, and dark-mode
views were inspected in Chrome.

---

### Phase 2 — Authentication and minimal user management

**Status:** NOT STARTED

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

- [ ] An unauthenticated request cannot access pages, data routes, or worker controls.
- [ ] Login, logout, expiry, password change, and recovery each pass.
- [ ] A revoked session stops working immediately.
- [ ] The seed creates exactly one `SUPER_ADMIN` without hardcoded credentials.
- [ ] Users created in the panel are always `ADMIN`.
- [ ] `ADMIN` and `SUPER_ADMIN` can use the same product features.
- [ ] Only `SUPER_ADMIN` can deactivate/delete another user.
- [ ] The sole `SUPER_ADMIN` cannot be deactivated or deleted.
- [ ] No generic roles, permissions, or policy framework was added.

**Evidence:** _Add links/commands/results here._

---

### Phase 3 — Settings center and connection checks

**Status:** NOT STARTED

**Goal:** Make every operational product setting manageable without editing
code or deployment variables.

**Build:**

- `/settings` sections matching the complete inventory in Section 7.
- Typed server validation, safe defaults, encrypted secret storage, audit
  history, and test actions for SMTP and IMAP.
- Global kill switch displayed persistently whenever sending is disabled.

**Acceptance:**

- [ ] Every Section 7 setting is present, searchable by section, and explained.
- [ ] Invalid ports, addresses, timezones, URLs, and limits are rejected.
- [ ] Saved secrets cannot be read back through UI, HTML, logs, or API responses.
- [ ] SMTP/IMAP tests return useful success or remediation messages.
- [ ] Switching the global kill switch on prevents a test job from sending.

**Evidence:** _Add links/commands/results here._

---

### Phase 4 — Contacts, lists, and suppression

**Status:** NOT STARTED

**Goal:** Safely manage target data before any bulk sending exists.

**Build:**

- Contact CRUD, search, filters, tags, lists, custom fields, archive, and delete.
- CSV preview/import with column mapping, normalization, duplicate handling,
  row errors, and an import result summary.
- Global suppression list with manual, unsubscribe, bounce, and complaint reasons.
- CSV export of filtered contacts without secret/internal fields.

**Acceptance:**

- [ ] Importing a fixture twice creates no duplicate contacts.
- [ ] Invalid rows are reported without discarding valid rows.
- [ ] Search, list membership, archive, export, and deletion behave as shown in UI.
- [ ] A suppressed address cannot be selected for a campaign.
- [ ] The interface clearly explains why a contact is suppressed.

**Evidence:** _Add links/commands/results here._

---

### Phase 5 — Templates and safe rendering

**Status:** NOT STARTED

**Goal:** Create reusable email content with predictable personalization.

**Build:**

- Template create/edit/duplicate/archive, subject, plain text, sanitized HTML,
  preview, test send, and version history.
- Documented variables from contact, company, campaign, and sender data.
- Missing-variable detection before scheduling and escaped-by-default rendering.
- Required unsubscribe link/footer insertion at send time.

**Acceptance:**

- [ ] Preview and delivered test email render the same supported variables.
- [ ] Missing required variables block scheduling and identify affected contacts.
- [ ] Unsafe HTML/scripts cannot execute in preview or stored output.
- [ ] Every bulk email includes sender identity and a working unsubscribe route.

**Evidence:** _Add links/commands/results here._

---

### Phase 6 — Durable scheduler, SMTP sending, and kill switches

**Status:** NOT STARTED

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

- [ ] A scheduled campaign sends only after its due time in the configured timezone.
- [ ] Restarting the worker during a batch causes neither loss nor duplicate sends.
- [ ] Global kill switch stops the next unsent message within one worker cycle.
- [ ] Campaign pause affects only that campaign; resume continues pending work.
- [ ] Rate/daily/quiet-hour limits hold under two concurrent worker processes.
- [ ] Failed jobs retry as configured and end with an actionable error.

**Evidence:** _Add links/commands/results here._

---

### Phase 7 — Knowledge base and AI draft assistant

**Status:** NOT STARTED

**Entry decision:** Select the AI provider/model and approved launch source types.

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

- [ ] A known fixture retrieves the expected relevant chunks and excludes noise.
- [ ] Draft UI shows which sources supported the draft.
- [ ] Disallowed claims/phrases and missing recipient data produce clear warnings.
- [ ] Provider timeout/failure preserves the user's current work.
- [ ] No AI draft can enter the send queue without human approval.

**Evidence:** _Add links/commands/results here._

---

### Phase 8 — IMAP inbox, threading, replies, and bounces

**Status:** NOT STARTED

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

- [ ] Re-running the same sync creates no duplicate messages.
- [ ] A campaign reply attaches to the correct contact/thread and stops follow-ups.
- [ ] A recognized hard bounce suppresses the address before another send.
- [ ] Malformed email or attachment cannot crash or block later sync.
- [ ] IMAP cursor loss can recover within the configured look-back window.

**Evidence:** _Add links/commands/results here._

---

### Phase 9 — Tracking, unsubscribe, and complete statistics

**Status:** NOT STARTED

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

- [ ] Unsubscribe works without login, is idempotent, and suppresses immediately.
- [ ] Every displayed rate has a defined denominator and matches SQL fixtures.
- [ ] Disabling tracking stops new open/click tracking URLs from being emitted.
- [ ] Dashboard totals reconcile with campaign and message records.
- [ ] Empty, delayed, and partially known delivery states are explained clearly.

**Evidence:** _Add links/commands/results here._

---

### Phase 10 — Operational visibility and recovery

**Status:** NOT STARTED

**Goal:** Make failures diagnosable and recoverable from the application.

**Build:**

- Health view for web, database, worker heartbeat, SMTP, IMAP, and AI.
- Failed-job list with safe retry/cancel, campaign audit trail, and settings audit.
- Structured logs with IDs but no credentials or full email bodies.
- Alerts configured in Section 7 and documented database backup/restore drill.

**Acceptance:**

- [ ] Simulated SMTP, IMAP, AI, database, and worker failures are distinguishable.
- [ ] Retrying a failed job cannot duplicate a previously accepted send.
- [ ] Stale worker status triggers one deduplicated alert.
- [ ] A backup restores into a clean non-production database and passes integrity checks.

**Evidence:** _Add links/commands/results here._

---

### Phase 11 — Security, privacy, accessibility, and load hardening

**Status:** NOT STARTED

**Goal:** Verify the complete system at its trust boundaries and expected scale.

**Build/check:**

- CSRF, XSS, SSRF for URL ingestion if enabled, SQL/HTML/template injection,
  attachment limits, auth rate limits, secure headers, and secret redaction.
- Data retention/deletion, audit integrity, unsubscribe permanence, and legal
  copy reviewed by the owner's qualified adviser for target jurisdictions.
- Keyboard/screen-reader/reduced-motion checks and responsive layouts.
- Load test at Phase 0 limits for imports, campaign claiming, dashboard queries,
  IMAP sync, and kill-switch response.

**Acceptance:**

- [ ] No unresolved critical/high security finding remains.
- [ ] Accessibility checks cover every primary workflow with no serious blocker.
- [ ] Expected load stays within recorded response-time and worker-lag targets.
- [ ] Retention/deletion jobs remove only intended data and preserve suppressions.
- [ ] Legal/compliance owner signs off on sender identity, consent, and unsubscribe behavior.

**Evidence:** _Add links/commands/results here._

---

### Phase 12 — Production readiness and final acceptance

**Status:** NOT STARTED

**Goal:** Prove the whole product with a controlled, reversible launch.

**Acceptance scenario:**

- [ ] Deploy web and worker from a clean checkout and migrate PostgreSQL.
- [ ] Sign in as the seeded `SUPER_ADMIN`, create an `ADMIN`, and configure every required setting through UI.
- [ ] Import a test contact list containing valid, invalid, duplicate, and suppressed rows.
- [ ] Add knowledge, generate and approve a grounded template, then send a test.
- [ ] Schedule a small campaign; verify limits, pause/resume, and global kill switch.
- [ ] Receive a reply and bounce through IMAP; verify threading and suppression.
- [ ] Unsubscribe one recipient; verify no later step can send to that address.
- [ ] Reconcile dashboard counts and export with stored message/event records.
- [ ] Restart web and worker during controlled processing with no duplicate send.
- [ ] Restore the latest backup into a clean environment.
- [ ] Record rollback steps and obtain owner launch approval.

**Evidence:** _Add links/commands/results here._

## 9. Progress summary

| Phase | Status | Completed | Evidence summary |
|---|---|---|---|
| 0. Decisions and limits | IN PROGRESS | — | VPS with Docker Compose selected |
| 1. Foundation | IN PROGRESS | — | Prisma/Docker verified; responsive UI shell and preview routes built |
| 2. Authentication and users | NOT STARTED | — | — |
| 3. Settings | NOT STARTED | — | — |
| 4. Contacts | NOT STARTED | — | — |
| 5. Templates | NOT STARTED | — | — |
| 6. Scheduling and SMTP | NOT STARTED | — | — |
| 7. Knowledge and AI | NOT STARTED | — | — |
| 8. IMAP inbox | NOT STARTED | — | — |
| 9. Statistics | NOT STARTED | — | — |
| 10. Operations | NOT STARTED | — | — |
| 11. Hardening | NOT STARTED | — | — |
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
