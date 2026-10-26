# Ichigo: Codex-Initiated Applications and Local Job Tracker

This plan reflects the latest agreement. See [progress.md](progress.md) for tasks and acceptance status.

## Current workflow

The user provides a job URL → Codex uses the apply-job skill and local backend to create a record → Playwright MCP opens a separate job tab, extracts details, and saves a full-page PNG (or a PDF fallback after two failed PNG attempts) → the user fills out, uploads a resume, and submits manually → the user tells Codex the result → Codex records the result and closes pages associated with this application.

When the user confirms the application was submitted, record Applied. If they ask only to close the page without stating the result, record Pending. If they did not apply, return the job to To Apply. If saving fails, keep the page open. Closing a page manually does not update the stage.

## Implementation

- Keep the existing static HTML, CSS, and JavaScript frontend and connect it to real APIs; no React rewrite is needed.
- Use local Node.js 24+, TypeScript, the built-in HTTP server, and built-in SQLite, with no third-party runtime dependencies. Fastify was originally planned, but dependency downloads were restricted, so the first version uses built-in HTTP.
- SQLite stores jobs, application sessions, page associations, notes, and activity history; local PNG or PDF files store job captures.
- The backend serves data APIs, screenshots, and the frontend. It does not start or control Playwright or monitor page closure.
- The apply-job skill and CLI start the service and record jobs and application results. Codex uses Playwright MCP for browser operations.
- Stages are To Apply, Applying, Pending, Applied, Interview, Offer, Rejected, and Archived. Reuse the same job for duplicate URLs and retain multiple application records. Multiple applications may be active across different jobs, with at most one active session per job.
- Designed for a single local user; the service binds to 127.0.0.1. Automatic form filling, submission, bulk collection, and multi-device sync are out of scope.

See [README.md](README.md) for installation, startup, migration, and backup instructions.

## Multiple active applications

Implemented and verified: different jobs can have active application sessions simultaneously. Starting another job must not require recording the previous job's result. Each job retains at most one active session; starting that job again reuses its session.

### Storage and application behavior

- Upgrade SQLite to schema version 2. Transactionally replace the global active-session unique index with a unique index on `job_id` where `ended_at IS NULL`. New databases must have the same constraint. Preserve existing jobs, sessions, page associations, and history.
- Change application startup to query active sessions for the requested job only. Reuse its active session or create a new one regardless of other active jobs. Preserve the existing response shape and `reused` behavior.
- Continue requiring job ID and session ID for page updates and results. Finishing one session must leave other jobs' sessions, stages, history, and page records untouched.
- Retain result mappings, idempotency, screenshot behavior, and the requirement to record an active job's result before changing its stage. Manual browser closure alone does not end a session.

### Skill, interfaces, and compatibility

- Update the apply-job skill to permit multiple active jobs. Resolve result reports using explicit job references or unambiguous conversation context. Ask which job the user means when ambiguous, before saving or closing pages; never default to the newest session.
- Identify application pages through session markers and saved associations. After saving succeeds, close only the pages the user requested for that application. Preserve all pages when saving fails.
- No new endpoints, CLI flags, response fields, or frontend controls are required. Update README.md and workflow documentation to remove the single-active-job restriction, and track implementation and verification in progress.md.
- Restart the backend after implementation to load the new code and migration. The older backend rejects schema version 2; reverting requires a compatible database backup.
- Each application remains a separate manual workflow; automatic submission and bulk application remain out of scope.

### Verification

- Start two different jobs and verify distinct active sessions. Repeated starts must reuse each job's own session. Verify SQLite rejects a second active session for the same job while allowing sessions across jobs.
- Migrate a version 1 database containing an active session, page records, and history; reopen it, verify preservation, and start another job successfully.
- Finish sessions in reverse order and verify isolation, explicit application times, idempotent retries, and rejection of mismatched job/session IDs.
- Run existing automated tests and syntax checks. Use an isolated browser fixture to verify separate page markers and confirm closing one application's pages leaves the other open. Review skill instructions for ambiguous reports and save failures.

## Native PDF fallback

- Always attempt a full-page PNG first. If it fails, retry once. If both attempts fail, call native Playwright MCP `browser_pdf_save` with its default print settings; this replaces the viewport screenshot fallback. Apply the same sequence to initial captures and recaptures.
- Import the actual readable local PDF path returned by the tool. If PDF generation or import fails, report the failure and preserve any previous capture. Keep existing sign-in handling.
- Extend the screenshot CLI and API to accept PNG and PDF files, validate their signatures, and retain the 12 MB limit and existing PNG compatibility. Serve PDFs as `application/pdf` through the existing restricted capture routes.
- Keep the existing screenshot URL and status fields without a database migration. Show PDF captures as “Job PDF” with an “Open PDF” link, retain PNG previews, and record the correct format in activity history.
- Update the apply-job skill and README.md to match this workflow. Record implementation and verification status in progress.md.
- Verify PNG compatibility, PDF import and serving, invalid files, size limits, fallback ordering, preservation of previous captures on failure, and frontend PDF links. Exercise native `browser_pdf_save` on a local test page, then run syntax checks and relevant automated tests.

Playwright MCP is configured with `--caps=pdf`. Native PDF generation, CLI/API import, restricted serving, and opening the PDF from job details are implemented and verified. See progress.md and tests/pdf-latest.json for acceptance results.
