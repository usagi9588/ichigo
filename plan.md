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
- Stages are To Apply, Applying, Pending, Applied, Interview, Offer, Rejected, and Archived. Reuse the same job for duplicate URLs and retain multiple application records. Only one application may be active at a time in the first version.
- Designed for a single local user; the service binds to 127.0.0.1. Automatic form filling, submission, bulk collection, and multi-device sync are out of scope.

See [README.md](README.md) for installation, startup, migration, and backup instructions.

## Native PDF fallback

- Always attempt a full-page PNG first. If it fails, retry once. If both attempts fail, call native Playwright MCP `browser_pdf_save` with its default print settings; this replaces the viewport screenshot fallback. Apply the same sequence to initial captures and recaptures.
- Import the actual readable local PDF path returned by the tool. If PDF generation or import fails, report the failure and preserve any previous capture. Keep existing sign-in handling.
- Extend the screenshot CLI and API to accept PNG and PDF files, validate their signatures, and retain the 12 MB limit and existing PNG compatibility. Serve PDFs as `application/pdf` through the existing restricted capture routes.
- Keep the existing screenshot URL and status fields without a database migration. Show PDF captures as “Job PDF” with an “Open PDF” link, retain PNG previews, and record the correct format in activity history.
- Update the apply-job skill and README.md to match this workflow. Record implementation and verification status in progress.md.
- Verify PNG compatibility, PDF import and serving, invalid files, size limits, fallback ordering, preservation of previous captures on failure, and frontend PDF links. Exercise native `browser_pdf_save` on a local test page, then run syntax checks and relevant automated tests.

Playwright MCP is configured with `--caps=pdf`. Native PDF generation, CLI/API import, restricted serving, and opening the PDF from job details are implemented and verified. See progress.md and tests/pdf-latest.json for acceptance results.
