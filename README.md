# Cold Emailer

Single-company campaign management, SMTP sending, IMAP replies, suppression, statistics, knowledge retrieval, and optional Gemini-assisted drafting.

## Production deployment

1. Copy `.env.example` values into the deployment environment and replace every placeholder with a strong secret. Set `APP_URL` to the public HTTPS origin.
2. Put an HTTPS reverse proxy in front of the loopback-only application port. Do not expose port 3000 directly.
3. Build an immutable image, run `docker compose run --rm seed` once, then start the stack with `docker compose up -d`.
4. Configure and test SMTP, IMAP, identity, consent, privacy, and Gemini settings in the UI before disabling the global sending pause.
5. Schedule `scripts/backup.sh` outside the application, copy backups off the VPS, and regularly verify one with `scripts/restore-check.sh` against a disposable database.

Before launch, complete the unchecked Phase 12 acceptance items in `BUILD-PLAN.md`, including a real reply, bounce, grounded draft, test send, rollback rehearsal, and owner approval.
