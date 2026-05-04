# Drop Image Roadmap

## Goal

Build Drop Image into a production-ready image upload and processing platform with AI-powered SEO naming, safer traffic controls, privileged admin access, and background processing for long-running and batch tasks.

## Roadmap Overview

| Phase | Initiative                            | Priority | Status      | Purpose                                                              |
| ----- | ------------------------------------- | -------: | ----------- | -------------------------------------------------------------------- |
| 1     | AI Image Naming Upgrade               |     High | Not started | Generate alternative SEO-friendly image names using LLMs             |
| 2     | Rate Limiting and IP Limiting         |     High | Not started | Protect the service from abuse and excessive traffic                 |
| 3     | Super Admin Privileged Access         |   Medium | Not started | Give trusted users elevated access and operational controls          |
| 4     | Lightweight User Tracking and Auth V0 |   Medium | Not started | Track users with cookies and add a simple authentication layer       |
| 5     | BullMQ Background Queue System        |     High | Not started | Support AI processing, long-running jobs, and batch image processing |

---

## Phase 1: AI Image Naming Upgrade

### Objective

Use LLMs to process uploaded images and generate alternative names for SEO.

### Scope

* Analyze uploaded images using AI.
* Generate alternative image names.
* Preserve old image names for SEO continuity.
* Support multiple model providers through an OpenAI-compatible format.

### Provider Support

Initial provider targets:

* OpenAI
* xAI
* Amprotech
* Gemini

### Implementation Notes

* Use an OpenAI-style API interface where possible.
* Abstract provider configuration so new model providers can be added later.
* Store both the original filename and generated alternatives.
* Consider allowing users to approve, edit, or reject generated names before applying them.

### Deliverables

* AI naming service abstraction.
* Provider configuration layer.
* Image-to-name generation workflow.
* Storage for original name plus generated SEO alternatives.
* Basic UI or API response showing suggested names.

### Open Questions

* Should AI naming happen automatically after upload, or only when requested?
* Should generated names overwrite filenames, metadata, or both?
* How many alternatives should be generated per image?
* Should the system generate slugs, alt text, captions, or only filenames?

---

## Phase 2: Rate Limiting and IP Limiting

### Objective

Protect Drop Image from abuse, excessive requests, scraping, and expensive AI usage.

### Scope

* Add rate limiting by IP address.
* Add usage limits for upload and AI-processing endpoints.
* Add stricter limits for unauthenticated or anonymous users.
* Prepare for future user-based limits.

### Suggested Limits

* Upload endpoint: limit by IP and cookie/user identifier.
* AI processing endpoint: stricter limits due to cost and long-running work.
* Admin endpoints: restricted access only.

### Deliverables

* Global rate limiting middleware.
* IP-based request limiting.
* Endpoint-specific limits.
* Error responses for rate-limited users.
* Basic logging of blocked or throttled requests.

### Open Questions

* What should the free or anonymous user limits be?
* Should rate limits reset hourly, daily, or both?
* Should limits vary by endpoint?

---

## Phase 3: Super Admin Privileged Access

### Objective

Create a privileged access layer for super admins to manage and inspect the system.

### Scope

* Add super admin role or privileged access mechanism.
* Restrict sensitive endpoints and actions.
* Allow super admins to bypass certain limits if needed.
* Prepare for future admin dashboard features.

### Possible Super Admin Capabilities

* View uploaded images and processing status.
* Trigger or retry AI processing jobs.
* View queue health.
* Bypass rate limits.
* Manage provider settings.
* Inspect usage and abuse signals.

### Deliverables

* Super admin access check.
* Protected admin-only routes.
* Basic privileged actions.
* Admin bypass rules where appropriate.

### Open Questions

* Should super admins be configured via environment variable, database, or cookie token in V0?
* Should admin access expire?
* Should admin actions be logged?

---

## Phase 4: Lightweight User Tracking and Auth V0

### Objective

Introduce a simple V0 identity layer using cookies before adding a full authentication system.

### Scope

* Track users using cookies.
* Cache or persist anonymous user identifiers.
* Add basic user identity for rate limiting and job ownership.
* Later, evaluate open-source authentication tools.

### V0 Approach

* Assign an anonymous user ID through a secure cookie.
* Use the cookie to associate uploads and jobs with the same browser.
* Use cookie identity together with IP limits.
* Keep the design compatible with future authentication.

### Future Auth Options

* Open-source authentication library or framework.
* Cookie-based session auth.
* Magic link or OAuth later if needed.

### Deliverables

* Anonymous cookie identity.
* User/session tracking.
* Cookie-based ownership for uploads and jobs.
* Compatibility path for future auth.

### Open Questions

* Should anonymous user data expire?
* Should users be able to recover previous uploads across devices?
* Is full login needed soon, or is cookie identity enough for V0?

---

## Phase 5: BullMQ Background Queue System

### Objective

Add a queue system to support long-running AI tasks and batch image processing.

### Scope

* Add BullMQ for background jobs.
* Use Redis as the likely queue backend.
* Explore SQLite-backed alternatives if Redis is too heavy for deployment.
* Queue AI image-processing jobs.
* Support batch processing for many photos.

### Why This Matters

AI processing can be slow, expensive, and unreliable if handled directly inside request-response flows. A queue makes the system more resilient and allows users to upload or process many images without blocking the app.

### Deliverables

* Background job queue setup.
* AI processing worker.
* Job status tracking.
* Retry and failure handling.
* Batch job support.
* Queue monitoring foundation.

### Suggested Job Types

* `process-image-ai-names`
* `process-batch-ai-names`
* `retry-failed-image-processing`
* `cleanup-expired-jobs`

### Open Questions

* Is Redis acceptable for the current infrastructure?
* Should batch processing be limited by count, file size, or both?
* Should users receive progress updates in the UI?
* How should failed AI jobs be retried?

---

## Suggested Execution Order

### Milestone 1: Safety and Foundations

1. Add cookie-based anonymous user tracking.
2. Add IP and endpoint-based rate limiting.
3. Add basic super admin access.

### Milestone 2: AI Processing V0

1. Add AI provider abstraction.
2. Support OpenAI-compatible providers.
3. Generate SEO-friendly alternative names.
4. Store original and generated names.

### Milestone 3: Queue-Based Processing

1. Add BullMQ and Redis.
2. Move AI processing into background jobs.
3. Add job status tracking.
4. Add retry and failure handling.

### Milestone 4: Batch Processing

1. Add batch upload or batch selection flow.
2. Queue multiple images.
3. Show processing progress.
4. Add limits to avoid abuse and excessive cost.

---

## Near-Term MVP Scope

The best near-term version should include:

* Cookie-based anonymous user tracking.
* IP and endpoint rate limiting.
* Basic super admin bypass or privileged access.
* AI naming with one provider first, preferably OpenAI-compatible.
* Storage for original and generated image names.
* Queue-ready architecture, even if BullMQ is added immediately after.

---

## Recommended Priority

1. **Cookie user tracking** because it supports ownership, rate limits, and future auth.
2. **Rate limiting and IP limiting** because AI usage can become expensive quickly.
3. **AI naming provider abstraction** because it defines how OpenAI, xAI, Amprotech, and Gemini will fit together.
4. **BullMQ queue system** because long-running AI tasks should not block requests.
5. **Super admin access** either before or alongside queue monitoring, depending on how much operational control is needed early.

---

## Risks and Considerations

### Cost Risk

AI image processing can become expensive if public users can trigger unlimited jobs.

### Abuse Risk

Without rate limiting, users or bots could overload upload and AI endpoints.

### Reliability Risk

Long-running AI calls can fail, timeout, or block requests if not handled by a queue.

### Identity Risk

Cookie-only tracking is simple, but users may lose access when cookies are cleared or when using another device.

### Provider Compatibility Risk

OpenAI-compatible APIs may still differ slightly across providers, so a provider abstraction layer should handle differences cleanly.

---

## One-Sentence Product Direction

Drop Image will evolve from a simple image upload tool into an AI-assisted SEO image management platform with safe usage controls, admin privileges, and scalable background processing.
