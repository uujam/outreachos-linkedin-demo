# OutreachOS — Requirements Document

**Version:** 2.0
**Date:** March 2026
**Status:** Complete — ready for build

---

## 1. App Overview

OutreachOS is a done-for-you B2B outreach platform for UK-based service businesses. It helps agency clients find the right people to contact, reach out to them automatically across LinkedIn, email, and phone, and track every conversation until a meeting is booked. The system has two sides: a public-facing marketing website that shows what the service offers, and a private client dashboard that shows live outreach data, pipeline progress, and campaign performance.

**Product positioning — one subscription replaces many tools:**
A typical B2B outreach stack requires a client to subscribe separately to LinkedIn Sales Navigator, a scraping tool, a data enrichment service, an email finder, an email verification service, an email sending platform, an AI voice calling tool, and a meeting scheduler. OutreachOS replaces all of these with a single subscription. OutreachOS maintains its own accounts with each underlying tool and uses their APIs on the client's behalf — clients never see, manage, or pay for these tools directly. This is a core part of the value proposition and shapes the entire backend architecture.

This requirements document covers wiring the existing frontend (the screens are already built) to a real backend — meaning: real data, real logins, real messages sent, and real leads tracked.

---

## 2. Main Goals

1. Keep all API keys, passwords, and third-party credentials on the server only — never exposed to the browser.
2. Allow clients to log in securely and only see their own data.
3. Pull real leads from LinkedIn and Companies House using automated tools.
4. Send personalised outreach via email sequences and LinkedIn messages.
5. Qualify leads using AI-powered voice calls (VAPI).
6. Track every lead through a pipeline from "Identified" to a defined terminal outcome (Meeting Booked, Not Interested, Follow Up Later, Do Not Contact, or Wrong Fit).
7. Show live, accurate metrics on the dashboard (not hardcoded numbers).
8. Let clients configure their Ideal Client Profile (ICP) to shape all targeting.
9. Generate and export reports on campaign performance.
10. Collect subscription payments from clients securely via Stripe, and restrict dashboard access to paying subscribers only.

---

## 3. User Stories

| ID | Story |
|----|-------|
| US-001 | As a client, I want to log in with my email and password so that I can access my private dashboard securely. |
| US-002 | As a client, I want to see a dashboard summary of my key numbers (meetings booked, pipeline value, outreach sent, response rate) so that I can understand performance at a glance. |
| US-003 | As a client, I want to see my lead pipeline as a board (Identified → Booked) so that I can track where every prospect is. |
| US-004 | As a client, I want to search and filter Companies House data so that I can find UK businesses that match my ideal client. |
| US-005 | As a client, I want LinkedIn profile scraping to run automatically based on my ICP settings so that new leads appear in my pipeline without manual effort. |
| US-006 | As a client, I want personalised email sequences to be sent automatically to leads so that I do not have to write or send individual emails. |
| US-007 | As a client, I want AI voice calls to ring and qualify leads so that only budget-confirmed, interested prospects reach me. |
| US-008 | As a client, I want to see a log of all voice calls with outcomes and notes so that I know what was said and what happens next. |
| US-009 | As a client, I want to view all booked meetings in one place so that I can prepare and never miss a call. |
| US-010 | As a client, I want to save my ICP settings (industry, job title, revenue range, geography) so that all scraping and messaging targets the right people. |
| US-011 | As a client, I want to create and manage outreach campaigns so that I can run different targeting strategies at the same time. |
| US-012 | As a client, I want to download a report of my pipeline and campaign stats so that I can share results with stakeholders. |
| US-013 | As an admin, I want to manage client accounts and assign them to campaigns so that the system stays organised across multiple clients. |
| US-014 | As a client, I want the dashboard to update in near real-time so that I always see current data without refreshing the page. |
| US-015 | As a prospective client, I want to see the pricing plans on the landing page so that I know what I will pay before signing up. |
| US-016 | As a prospective client, I want to select a plan and pay by card so that I can start using the service immediately after checkout. |
| US-017 | As a client, I want to see my current plan and billing history in my account so that I can keep track of what I have been charged. |
| US-018 | As a client, I want to cancel or upgrade my subscription from within my account so that I do not have to contact support to make changes. |
| US-019 | As an admin, I want the system to automatically suspend dashboard access when a payment fails so that we are not providing a service we are not being paid for. |
| US-020 | As a client, I want the system to automatically search for leads, enrich them, and begin outreach once I have saved my ICP — without me having to trigger each step manually. |

---

## 4. Features

### F-001 — Secure Authentication
- What it does: Lets clients and admins log in with email and password. Keeps sessions alive with a secure token stored server-side. Logs users out after inactivity.
- When it appears: Before any dashboard access. All dashboard routes are protected.
- If something goes wrong: Show a clear error ("Incorrect email or password"). Lock accounts after 5 failed attempts for 15 minutes.
- Security note: Passwords stored as hashed values only. Tokens signed with a secret key kept in environment variables — never in code.

### F-002 — Dashboard KPI Widgets
- What it does: Fetches real-time numbers from the database — meetings booked, pipeline value, outreach sent, response rate — and displays them with trend indicators.
- When it appears: On the Overview screen, always visible on first load.
- If something goes wrong: Show dashes ("—") instead of numbers with a small warning; do not crash the whole dashboard.

### F-003 — Lead Pipeline (Kanban + Table)
- What it does: Shows all leads in columns by stage. Each card shows name, company, source, fit score, and enrichment status. Leads move through two sets of stages:

  **Enrichment stages** (automatic, handled by F-019):
  Discovered → Identified → Enriched → Validated → Ready for Outreach → Invalid Email (dead end)

  **Outreach stages** (starts once a lead reaches "Ready for Outreach"):
  In Outreach → Responded → Qualified → **Terminal outcomes (see below)**

  **Terminal outcomes** (a lead ends in exactly one of these):
  - **Meeting Booked** — A meeting was confirmed via booking system webhook (Calendly / Cal.com)
  - **Not Interested** — Prospect explicitly declined
  - **Follow Up Later** — Prospect asked to be contacted again after a set date; system creates a reminder
  - **Wrong Fit** — Company or person does not match ICP on closer review
  - **Do Not Contact** — Prospect requested no further contact; system permanently suppresses them from all future campaigns

- When it appears: On the Pipeline screen. The Kanban board shows outreach stages. A separate "Enrichment" status indicator appears on each card.
- If something goes wrong: If a lead cannot be moved (e.g. network error), show a toast notification and revert the card to its original column. A lead marked "Do Not Contact" cannot be moved or enrolled in any campaign — this is enforced server-side, not just in the UI.

### F-004 — LinkedIn (Lead Source: Scraping + Outreach Channel)

LinkedIn serves two distinct roles in OutreachOS, handled by two separate tools:

**Part A — LinkedIn scraping / discovery (Phantombuster)**
- What it does: Connects to Phantombuster to scrape LinkedIn profiles matching the client's ICP filters (job title, industry, seniority, geography). Creates a lead record at the "Discovered" enrichment stage (see Appendix C). The lead then moves through the enrichment pipeline (F-019) before outreach begins.
- When it appears: Triggered on a daily schedule as part of F-021 automation, or manually via "Run New Scrape" button on the LinkedIn screen (S-007).
- If something goes wrong: Log the error server-side. Alert admin. Do not retry immediately — LinkedIn rate limits apply and repeated failures can trigger account restrictions.
- Security note: Phantombuster API key stored in environment variables only.

**Part B — LinkedIn outreach (Heyreach — white-label)**
- What it does: Uses Heyreach (white-label plan) to send connection requests and personalised LinkedIn messages to leads that have reached "Ready for Outreach" stage and are enrolled in a campaign with LinkedIn as a channel. Heyreach manages the sending schedule, daily limits, and sequence steps for LinkedIn. Tracks accepts, replies, and profile views.
- **White-label Heyreach — why and what it unlocks:**
  OutreachOS runs on Heyreach's white-label plan, not the standard consumer plan. This is a deliberate architectural choice with three significant benefits:
  1. **Full webhook access to message content:** The white-label API exposes the full body of every message sent and received — connection request notes, outbound messages, and inbound replies. This is what powers the Lead Conversation Timeline (F-031). The standard Heyreach plan does not expose message content via webhook.
  2. **Dedicated infrastructure:** White-label accounts run on isolated infrastructure, not shared with other Heyreach customers. This means LinkedIn action limits, queue performance, and API rate limits are dedicated to OutreachOS only — not affected by other businesses on the platform.
  3. **Platform branding:** Heyreach's interface (if ever exposed) shows OutreachOS branding, not Heyreach branding. Clients experience a seamless single product.
  OutreachOS's white-label Heyreach account is configured with the LinkedIn account(s) used for outreach. Clients never see or interact with Heyreach directly.
- When it appears: Automatically when a lead is enrolled in a LinkedIn-channel campaign. Also triggerable manually from a lead's record.
- If something goes wrong: If a LinkedIn action is rejected (e.g. daily limit reached), Heyreach queues it for the next available slot. The system logs the delay and does not retry immediately.
- **LinkedIn account rate-limit and ban handling:**
  - Heyreach enforces LinkedIn's safe daily action limits automatically (connection requests: ~20/day, messages: ~40/day). The system does not override these limits.
  - If LinkedIn restricts or temporarily limits the Heyreach-connected account (a soft restriction — usually temporary), Heyreach will surface this via API. The system pauses all LinkedIn outreach across all clients immediately, logs the restriction, and sends an admin notification (F-028 admin alert). LinkedIn steps for affected leads remain in their current queue state — they are not cancelled, so they resume automatically when the restriction lifts.
  - If LinkedIn permanently bans or disables the account (a hard restriction): admin is notified immediately. All active LinkedIn campaign steps are paused. The OutreachOS team must resolve the account situation (reinstate or replace the connected LinkedIn account in Heyreach) and manually resume campaigns. This is an operational risk — the Admin Panel (S-013) should surface the current Heyreach account status on the integration health view at all times.
  - **Mitigation:** Heyreach's safe limits are set conservatively (below LinkedIn's published maximums) and the connected account should have a warm, established LinkedIn history before being used for outreach. The Admin Panel should flag if the account is new (< 3 months old) or has a low connection count, as these increase restriction risk.
- Security note: Heyreach API key stored in environment variables only. Heyreach operates under the client-facing LinkedIn account configured in Heyreach — OutreachOS does not store individual client LinkedIn passwords.

- Extensibility note: LinkedIn scraping (Part A) is one implementation of the Lead Source interface (Appendix C). LinkedIn outreach (Part B) is one implementation of the Outreach Channel interface. Both can be replaced with alternative tools without touching the pipeline logic.

### F-005 — Companies House Search (Lead Source: Companies House)
- What it does: Calls the UK Companies House public API. Lets the client filter by sector (SIC code), revenue, region, and director name. Results show a list of matching companies with an ICP match score per company.

- **"Add to Pipeline" — officer extraction (one lead per person, not one lead per company):**
  Because outreach is always to a *person*, clicking "Add to Pipeline" on a company does not create a single company-level record. Instead the system:
  1. Calls the Companies House Officers endpoint for that company to retrieve the full list of current officers (directors, CEOs, managing partners, etc.).
  2. Filters the officer list against the ICP's `job_titles` setting — only officers whose role matches a target title are included (e.g. "Director", "Managing Director", "CEO", "Founder"). Company secretaries and non-executive roles are excluded unless explicitly included in the ICP.
  3. Creates **one lead record per matching officer** at the "Discovered" enrichment stage. If a company has three directors and two match the ICP title filter, two leads are created.
  4. Each lead is created with: full officer name (from Companies House), company name, company SIC code and region (from the company record), `source_label = "Companies House"`, and a `source_id` composed of the Companies House company number + the officer's appointment ID (ensuring deduplication).
  5. The monthly lead cap (F-020) is checked and incremented once per lead created, not once per company.
  6. Duplicate detection: if a lead with the same `source_id` already exists in this client's pipeline, they are skipped silently — no duplicate created, counter not incremented.

- **What the system does NOT have at this point:** A LinkedIn URL or email address. Companies House only provides name, role, and appointment date. The enrichment pipeline (F-019) immediately kicks off to find the LinkedIn profile (ProxyCurl: name + company → LinkedIn URL + job title), then the email (Apollo.io primary, Hunter.io fallback: LinkedIn URL + company domain → email + phone), then email verification (ZeroBounce). Under 5 minutes on the fast path. Clay handles the hard-to-find cases asynchronously.

- **Relationship to automated discovery:** The Companies House screen (S-010) is a *manual supplement* to the automated discovery system (F-021), not the primary mechanism. By default, the system automatically searches Companies House daily using the client's saved ICP and adds matching officers to the pipeline without any client action. S-010 exists so a client can: (a) browse and hand-pick specific companies that the automated job may not have surfaced, (b) add companies outside the normal ICP filters on a one-off basis, (c) preview exactly which officers would be added before committing. Clients who never visit S-010 still get a fully populated pipeline via F-021.

- When it appears: On the Companies House screen (S-010). The results table shows companies; expanding a company row shows the matched officers and their roles before the client commits to adding them.
- If something goes wrong: If the Companies House company search API is unavailable, show a friendly message and cache the last search result for 10 minutes. If the Officers API call fails for a specific company, show a warning on that company's row and allow the client to retry — without re-running the full search.
- Security note: Companies House API key stored server-side only. The Officers endpoint is called once per company added, not on every search result.
- Cross-channel note: Companies House provides name and role only. LinkedIn URL, email, and phone are found by the enrichment pipeline (F-019) using name + company as the search inputs.

### F-019 — Lead Enrichment Pipeline

- What it does: Runs automatically the moment a lead is created from any source — no manual trigger needed. Each step uses data from the previous one. A lead does not enter outreach until it has at minimum a verified email address or a confirmed LinkedIn URL.

  **Enrichment steps:**
  1. **Discover** — Lead created with name + company from source. Stage: "Discovered". Immediately queues background enrichment job.
  2. **Cache check (F-022)** — Before calling any paid API, the pipeline checks the internal Enrichment Cache (D-018) using the LinkedIn URL (if known) or name + company domain as the lookup key. If a fresh cache entry (< 90 days old) exists with all required fields, the pipeline skips to step 5 (Ready) immediately — no API cost, under one second. If the entry has a global suppression flag, the lead is blocked from outreach permanently. If the cache is stale or absent, proceed to step 3.
  3. **Identify** — Find the person's LinkedIn profile URL and job title using name + company as search inputs. Uses the registered LinkedIn lookup provider (ProxyCurl by default). Stage: "Identified". (Skipped if the source already provided a LinkedIn URL.) Result written to D-018 cache.
  4. **Enrich** — Find email address and phone number. Uses the registered email-find provider (Apollo.io primary, Hunter.io fallback). Stage: "Enriched". Result written to D-018 cache.
  5. **Validate** — Verify the email address is deliverable and not a catch-all. Uses the registered email-verify provider (ZeroBounce by default). Stage: "Validated" or "Invalid Email" (dead end — blocked from outreach permanently). Result written to D-018 cache.
  6. **Ready** — All required data confirmed (from cache or fresh API calls). Stage: "Ready for Outreach". Lead is now eligible to be enrolled in a campaign.

- **Architecture: provider abstraction layer with direct APIs (primary) and Clay waterfall (async fallback)**

  Each enrichment step does not call a specific API directly. Instead, it calls a registered **enrichment provider** for that step type. The provider is a swappable module — changing from ZeroBounce to NeverBounce, or ProxyCurl to another LinkedIn lookup tool, means updating the registered provider for that step and nothing else. The pipeline code remains unchanged.

  **Step execution order for each lead:**

  | Step | Primary provider | Fallback provider | Async last resort |
  |------|-----------------|-------------------|-------------------|
  | 1 — LinkedIn identify | ProxyCurl | *(none — if fails, goes to Clay queue)* | Clay waterfall |
  | 2 — Email find | Apollo.io | Hunter.io | Clay waterfall |
  | 3 — Email verify | ZeroBounce | *(none)* | Clay waterfall |

  **Failure and Clay fallback behaviour:**
  - If the primary provider for a step returns no result or an error, the system tries the fallback provider (where one exists).
  - If all direct API providers for a step are exhausted, the lead is not failed permanently — it is flagged with an enrichment status of **"Pending Clay"** and placed in the Clay batch queue.
  - Clay (clay.com) runs its 150+ provider waterfall against the lead in the next batch cycle (typically within a few hours). When Clay returns a result, the webhook updates the lead record and the enrichment pipeline continues from where it paused.
  - If Clay also cannot find the data (all 150+ providers exhausted), only then is the lead permanently flagged as unable to enrich at that step. Admin is notified.
  - **The result:** direct APIs handle the majority of leads in minutes. Clay handles the harder-to-find leads in hours. No lead is abandoned prematurely.

  This approach is deliberately two-speed: fast path for the common case, slower but more thorough path for difficult leads. Both paths feed the same pipeline stages and activity log (D-015).

- When it appears: Triggered automatically on lead creation. Progress (Discovered → Identified → Enriched → Validated → Ready, or Pending Clay at any stuck step) is visible on each pipeline card as a status indicator.
- If something goes wrong: If a step fails and the Clay fallback also fails, the lead stays at the failed step with a reason flag. Admin is notified. The lead can be manually enriched (admin enters the email/profile directly) or discarded. A failed step never silently skips forward to outreach.
- **Provider swappability:** Because each step calls a registered provider, any individual tool can be replaced without touching the pipeline logic. Example: to swap ZeroBounce for NeverBounce, add `neverbounce.js` to the email-verify provider folder and update the step registry to point to it. No other code changes needed.
- Cost note: Each enrichment lookup has a real unit cost (ProxyCurl credit, Apollo credit, ZeroBounce credit, Clay credit for fallback leads). The monthly lead cap (F-020) exists partly to control this cost. Admin panel tracks spend per client in D-017.
- Security note: All enrichment API keys (ProxyCurl, Apollo.io, Hunter.io, ZeroBounce, Clay) stored in server `.env` only — never exposed to the browser.

### F-006 — Email Sequences
- What it does: Integrates with Instantly for multi-step email sequences (3–5 steps spaced over days). Each email is personalised using lead data and AI-generated snippets (via Claude API). Tracks opens, clicks, and replies via Instantly webhooks.
- When it appears: Can be started manually per lead or automatically when a lead enters a campaign (see F-025 for channel timing rules).
- **Unsubscribe / opt-out (required — UK PECR and GDPR compliance):**
  - Every outbound email must contain an unsubscribe link. Instantly provides this natively — it is enabled and cannot be disabled.
  - When a recipient clicks the unsubscribe link, Instantly fires a webhook to our system. The server receives this event, sets the lead's `terminal_outcome` to "Do Not Contact", sets `dnc_flag = true` in D-002, and writes the DNC entry to D-018's global suppression flag if the erasure applies globally. This is enforced server-side — the lead is immediately and permanently blocked from all future outreach for this client (and, if global suppression applies, for all clients).
  - If a recipient replies with an opt-out signal (e.g. "please remove me from your list", "unsubscribe", "stop"), Instantly's reply detection flags this automatically and fires the same opt-out webhook. Backup: the system also scans inbound reply content for common opt-out phrases and triggers DNC if detected.
  - A client or admin can never override a DNC flag set by an unsubscribe action. Server-side enforcement applies.
- **Domain warming (pre-launch requirement):**
  - Sending cold email at scale from a new domain without warming will result in deliverability failure (spam folders). Instantly has a built-in domain warmup feature ("Unibox") which must be activated for all sending domains before any sequence sends to leads.
  - **Minimum warmup period before live sends: 4 weeks.** During this period, Instantly gradually increases sending volume by sending and automatically engaging with warmup emails between seed accounts.
  - Sending domains must be configured with SPF, DKIM, and DMARC before warmup begins.
  - The Admin Panel (S-013) must show the warmup status and current daily send limit for each registered sending domain. No live outreach sequence should be able to start if the sending domain's warmup status is below "Active" (as reported by the Instantly API).
- If something goes wrong: If Instantly reports a sending limit reached, pause the sequence and notify admin via F-028. Log all failures to D-005.
- Security note: Instantly API key stored in server `.env` only. Sending domains authenticated with SPF/DKIM/DMARC before warmup begins.

### F-007 — AI Voice Qualification (VAPI + Twilio Branded Calling)

Two tools work together for the voice channel. They are complementary, not alternatives:

- **VAPI** is the AI brain: it hosts the conversation script, manages the AI voice agent's responses, detects qualification signals (budget confirmed, timeline given, meeting agreed), and fires outcome webhooks to our system. VAPI handles *what is said and what it means*.

- **Twilio** is the telephony carrier: it places the actual phone call over the PSTN network. VAPI is configured to route calls through Twilio as its carrier. On top of standard calling, Twilio's **Enhanced Branded Calling** feature displays the OutreachOS client's company name, logo, and reason for calling on the recipient's phone screen before they answer. This is significant: unbranded calls from unknown numbers are frequently ignored; branded calls improve answer rates meaningfully. Twilio handles *how the call reaches the phone*.

- What it does end-to-end: VAPI triggers a call via Twilio (with branded display). The Twilio Branded Call arrives on the prospect's phone showing the client's business name and "Sales enquiry" (or configured call reason). The prospect answers. VAPI's AI agent runs the qualification script. When the call ends, VAPI sends the outcome (Qualified / Interested / Not Reached / Voicemail) to our webhook. We update the lead record and activity log.
- When it appears: Triggered automatically when a lead is enrolled in a voice-channel campaign, or manually from a lead's record.
- If something goes wrong: If the call is not answered, VAPI marks it "Not Reached", leaves a voicemail if configured, and schedules one retry after 24 hours. If Twilio rejects the call (e.g. number invalid), the lead is flagged for admin review.
- Security note: Both VAPI API key and Twilio Account SID + Auth Token stored in server `.env` only. Call recordings stored in Supabase Storage, accessible only to the assigned client via a signed URL.
- **Voice opt-out during a call:** If a prospect verbally declines and asks not to be called again, VAPI's outcome webhook returns a "Do Not Contact" signal. The server sets the lead's `terminal_outcome` to "Do Not Contact" and `dnc_flag = true` immediately — no further contact is attempted.

### F-008 — Campaign Management
- What it does: Lets clients create named campaigns with a target audience (linked to ICP), a channel mix (LinkedIn, Email, Voice), a start date, and per-channel timing configuration. Shows progress bar, sent count, open rate, and reply count per campaign.
- **Channel configuration per campaign:** When creating or editing a campaign, the client can:
  - Enable or disable individual channels (Email, LinkedIn, Voice).
  - Set custom delays between channel steps (overriding the defaults defined in F-025).
  - Enable or disable voice calling for this campaign specifically (voice is the highest unit cost and most intrusive — the client may want email + LinkedIn only).
  - Set whether a LinkedIn follow-up message requires the connection request to be accepted first, or fires after a fixed delay regardless.
- **Channel sequencing:** Multi-channel campaigns follow the rules defined in F-025 — channels fire in order (Email → LinkedIn → Voice), with reply detection pausing all pending steps automatically.
- When it appears: On the Campaigns screen (S-005).
- If something goes wrong: If a campaign tries to start with no leads assigned (and no active ICP to auto-assign from), block it and prompt the user to add leads or verify ICP settings. If the sending domain warmup is not complete (F-006), block the campaign from starting and show the warmup status.

### F-009 — Meetings Tracker
- What it does: Lists all meetings booked by the system, with date, time, prospect name, company, booking channel, and confirmation status. Includes a "Sync Calendar" option to connect with Google Calendar or Outlook.
- How a meeting gets into the system (three routes):
  1. **Booking webhook (primary)** — The client connects their Calendly or Cal.com account. When a prospect books a slot, Calendly/Cal.com sends a webhook to our server. The server creates a meeting record, updates the lead's pipeline stage to "Meeting Booked", and fires an activity event. This is automatic — no human input needed.
  2. **VAPI call outcome** — If an AI voice call ends with the prospect agreeing to a meeting, VAPI returns that outcome. Our server creates a draft meeting record and notifies the client to confirm the time via their booking link.
  3. **Manual entry** — The client or admin can add a meeting directly from the Meetings screen (e.g. for a meeting booked via a phone call outside the system).
- When it appears: On the Meetings screen.
- If something goes wrong: If the Calendly/Cal.com webhook fails to arrive, the meeting is not created automatically — the client must enter it manually. If calendar sync fails, meetings still appear in the dashboard. Show a warning that calendar sync is disconnected.

### F-010 — ICP Settings
- What it does: A form where the client defines their ideal customer. Settings include: industries, geography, job titles, revenue range, employee range, buying signals to watch for, a written description (used by AI to personalise messages), and exclusions.
- When it appears: On the ICP Settings screen. Settings are saved to the database and applied to all scraping and scoring.
- If something goes wrong: If the form fails to save, show a clear error and keep the user's input so they do not lose their work.

### F-011 — Reporting & Export
- What it does: Generates a summary report of pipeline health, outreach performance by channel, meeting rate, and campaign stats. Reports can be downloaded as PDF or CSV.
- When it appears: On the Reports screen.
- If something goes wrong: If the report takes too long to generate (over 10 seconds), generate it in the background and notify the user when it is ready.

### F-012 — Real-time Activity Feed
- What it does: Shows a live stream of events — new leads scraped, emails sent, calls made, replies received, meetings booked. Powered by server-sent events or WebSocket so the feed updates without a page refresh.
- When it appears: On the Overview screen, in the "Live Activity" panel.
- If something goes wrong: If the live connection drops, fall back to polling every 30 seconds.

### F-014 — Pricing Page (Landing Site)
- What it does: Adds a pricing section to the landing page (index.html) showing the available subscription plans (e.g. Starter, Growth, Enterprise), what is included in each, and a "Get Started" button per plan that takes the visitor to the Stripe checkout flow.
- When it appears: On the public landing page. Visible to anyone — no login needed.
- If something goes wrong: If Stripe is unreachable, the button still loads the landing page and shows a fallback message ("Please contact us to sign up").

### F-015 — Stripe Checkout (Subscription Sign-up)
- What it does: When a visitor clicks a plan's "Get Started" button, the server creates a Stripe Checkout Session for that plan and redirects the user to the Stripe-hosted payment page. After successful payment, Stripe redirects back to a success page and a new client account is created (or activated) in the database.
- When it appears: After clicking a plan on the pricing section (F-014).
- If something goes wrong: If payment fails or is cancelled, the user is returned to the pricing page with a message explaining what happened. No account is created until payment succeeds.
- Security note: Stripe publishable key used in the browser (safe to expose). Stripe secret key kept in server `.env` only — never in frontend code. All payment processing happens on Stripe's servers, not ours.

### F-016 — Billing Portal (Client Dashboard)
- What it does: A "Billing" section in the client dashboard that shows the current plan name, next billing date, last 5 invoices with download links, and buttons to upgrade, downgrade, or cancel. This is powered by Stripe's Customer Portal — clicking "Manage Billing" opens the Stripe-hosted portal in a new tab.
- When it appears: On the Billing screen inside the dashboard (S-014).
- If something goes wrong: If the portal link cannot be generated, show a message with a direct email to support.
- Security note: The portal session is created server-side using the Stripe secret key. The client is identified by their Stripe Customer ID stored in the database — not by anything the browser sends.

### F-017 — Subscription Status Enforcement
- What it does: Every time a client loads the dashboard, the server checks their subscription status in the database. If the status is `active`, access is granted. If `past_due` (payment failed), a warning banner is shown but access continues for a grace period (e.g. 7 days). If `cancelled` or `unpaid`, the dashboard is locked and a payment prompt is shown.
- When it appears: On every dashboard load, silently in the background.
- If something goes wrong: If the status check fails (e.g. database error), grant access and log the failure — do not lock out a paying client due to a system error.

### F-018 — Stripe Webhooks
- What it does: A server endpoint that Stripe calls whenever a billing event happens — payment succeeded, payment failed, subscription cancelled, subscription renewed, trial ended. The server updates the client's subscription status in the database in response to each event.
- When it appears: Runs in the background, invisible to the user.
- If something goes wrong: Each webhook event is logged. If the server returns an error, Stripe will retry the event up to 3 times over 24 hours. Failed events are flagged for admin review.
- Security note: Every incoming webhook request is verified using a Stripe webhook signing secret stored in `.env`. Requests without a valid signature are rejected immediately.

### F-020 — Monthly Lead Cap Enforcement
- What it does: Controls how many new leads a client can add to the system within their current billing period. The cap is defined on the pricing plan (D-014) and can be overridden per client by an admin (D-001). The count of leads used this period is stored in D-012 and incremented every time a new lead is created from any source (LinkedIn scrape, Companies House import, manual entry, or any future adapter).
- **Why this cap exists — two reasons:**
  1. **Feature differentiation** — higher plans unlock more leads, encouraging upgrades.
  2. **Cost protection** — because OutreachOS pays for enrichment API credits (ProxyCurl, Apollo.io, ZeroBounce, Clay fallback), Heyreach LinkedIn actions, VAPI call minutes, and email sends on behalf of every client, each new lead has a real unit cost. The cap ensures no plan runs at a loss. The OutreachOS team sets cap values in D-014 to reflect the unit economics of each plan.

- **How the cap is resolved** (in order of priority):
  1. If D-001 has a `custom_lead_cap_override` set for this client, use that value.
  2. Otherwise, use the `monthly_lead_cap` from the client's current plan (D-014).
  3. If the resolved cap is `null`, the client has unlimited leads (Enterprise plan behaviour).

- **Enforcement rules:**
  - At **80% of cap**: Client sees a yellow warning banner on the dashboard — "You have used X of Y leads this month. Upgrade to add more."
  - At **100% of cap**: All lead creation attempts are blocked server-side. The scrape trigger endpoint, Companies House "Add to Pipeline" button, and manual lead entry all return an error. A clear message is shown: "Monthly lead limit reached. Upgrade your plan or wait until your next billing period."
  - The cap is checked on the **server** — not just the UI. A client cannot bypass it by calling the API directly.

- **Reset:**
  The `leads_used_this_period` counter in D-012 is reset to 0 when the Stripe `invoice.paid` webhook fires for a renewal. It is tied to the billing period, not the calendar month.

- **Configurability:**
  - Plan-level caps are set in D-014 and are changed by editing the plan record (admin only).
  - Client-level overrides are set in D-001 via the Admin Panel (S-013) — useful for grandfathered clients, trials, or one-off exceptions.
  - The client can see their current usage vs. cap on the Billing screen (S-014).

- **What counts as a "lead created":**
  A lead record written to D-002 for the first time in the current billing period. Updating an existing lead, re-enriching a lead, or moving a lead between pipeline stages does not increment the counter. Duplicate detection (same LinkedIn URL or email address already in the system for this client) prevents double-counting.

- When it appears: Enforced silently on every lead creation request. Visible to the client as a usage bar on S-014 and as warning banners when approaching or hitting the limit.
- If something goes wrong: If the counter cannot be read (e.g. database error), fail open — allow the lead creation and log the failure for admin review. Do not block a client due to a system error.

### F-021 — End-to-end Automation Trigger

- What it does: This is the orchestration layer that ties all other features together. When a client saves or updates their ICP settings (F-010), the system automatically fires the full outreach pipeline without any further action from the client. The sequence:

  1. **ICP saved** → server validates the settings, stores them, then immediately queues a lead discovery job for each active lead source configured for this client (Companies House search using ICP sector/region/title filters, LinkedIn scrape using the same filters).
  2. **Lead discovery** → each source adapter (Appendix C) runs its `search()` method against the ICP, creates lead records at "Discovered" stage, and enforces the monthly lead cap (F-020) — stopping if the cap is reached.
  3. **Enrichment triggered automatically** → as soon as each lead record is created, the enrichment pipeline (F-019) background jobs are queued. ProxyCurl identifies the LinkedIn profile, Apollo.io finds the email, ZeroBounce verifies it.
  4. **Outreach begins automatically** → as soon as a lead reaches "Ready for Outreach" stage, the system checks whether the lead matches an active campaign for this client. If it does, the lead is enrolled automatically — email sequence starts, LinkedIn connection request is sent, and (if voice is enabled for this campaign) a VAPI call is scheduled.
  5. **Lead progresses through outreach pipeline** → replies, opens, call outcomes, and booking events are all captured automatically. When a prospect books a meeting via Calendly/Cal.com, the webhook (F-009) fires and the lead's terminal outcome is set to "Meeting Booked".

- **This is fully automatic.** The client's only required action is: (a) sign up and pay (F-015), (b) save their ICP (F-010), and (c) optionally connect their Calendly account (F-009). Everything else — searching, enriching, messaging, qualifying, booking — runs without them.

- **Automated discovery is the default and primary mechanism.** The Companies House search screen (S-010) and LinkedIn screen (S-007) exist as *manual supplements* — a client can use them to hand-pick specific companies or trigger a one-off scrape. But by default, no client action is required after ICP is saved. Leads appear in the pipeline automatically.

- **Pause Discovery kill switch:**
  Automated discovery can be paused per client. This is an important operational control — for example, when a client is close to their lead cap, when a campaign needs to be reviewed before more leads enter, or when the OutreachOS team needs to investigate a data quality issue.

  **Two levels of pause:**
  1. **Admin-level pause (S-013):** An OutreachOS admin can pause automated discovery for any client from the Admin Panel. This sets `discovery_paused = true` in D-001. Useful for any operational reason — the client does not need to take action.
  2. **Client-level pause (S-011 — ICP Settings):** A client can pause their own discovery by toggling an "Automation" switch on their ICP Settings screen. This sets the same `discovery_paused` flag. The toggle shows the current state clearly: "Lead discovery is running / paused."

  **What "paused" means:**
  - The scheduled daily discovery job skips this client entirely.
  - The ICP-save trigger does NOT queue discovery jobs for this client.
  - The "Run New Scrape" button on S-007 is disabled (greyed out with "Discovery is paused" tooltip).
  - The Companies House manual "Add to Pipeline" button on S-010 **still works** — manual actions are never blocked by the pause.
  - Manual lead entry (F-029) **still works**.
  - All enrichment and outreach for **existing leads** continues normally — the pause only stops *new leads being discovered*.

  **Cancelling in-progress discovery jobs:**
  When the pause switch is toggled ON, the system immediately cancels any queued (not yet started) discovery jobs for this client from the BullMQ `discovery` queue using BullMQ's `job.remove()`. Any discovery job that has already started and is mid-run completes its current batch but does not queue additional batches. Leads already created before the pause remains in the pipeline and continue through enrichment and outreach normally.

  **Resuming:**
  When the switch is toggled back OFF (discovery re-enabled), the system immediately queues a fresh discovery job as if the ICP had just been saved. The client sees new leads begin appearing within minutes.

  **Visibility:** A yellow banner is shown on the Overview screen (S-003) when discovery is paused: "Automated lead discovery is paused. [Resume]"

- **Multi-campaign conflict resolution:** When a lead reaches "Ready for Outreach" and the system checks for matching active campaigns, it is possible (especially for clients running more than one campaign) that a lead qualifies for multiple campaigns simultaneously. The resolution rule is:
  1. If only one campaign matches the lead's ICP filters — enrol in that campaign. No conflict.
  2. If multiple campaigns match — enrol the lead in the campaign with the **earliest creation date** (the oldest active campaign for this client). Rationale: the client's first campaign typically represents their primary targeting strategy.
  3. An admin or client can manually re-assign a lead to a different campaign from the lead detail view at any time, regardless of which campaign was auto-selected.
  4. A lead is enrolled in at most one campaign at a time. Once enrolled, it will not be auto-enrolled in another campaign unless it is manually moved or its current campaign completes.
  This rule is logged in the lead's activity log: "Auto-enrolled in campaign [Name] (earliest matching campaign)."

- **The discovery job also runs on a schedule** (independent of ICP saves) so the system continues finding new leads in the background. Default schedule: once per day per client. Admin can adjust frequency per client from the Admin Panel (S-013).

- When it appears: The trigger fires silently when ICP settings are saved. The client sees new leads appearing in the pipeline and the activity feed (F-012) updating in real time. No "start" button is needed.
- If something goes wrong:
  - If a discovery source fails, the error is logged and the remaining sources continue — a failure in one adapter does not block others.
  - If enrichment fails for a lead, that lead is flagged but other leads continue through the pipeline.
  - If outreach enrolment fails (e.g. email service limit reached), the lead stays at "Ready" and is retried on the next cycle. Admin is notified.
  - Discovery jobs are idempotent — re-running does not create duplicates (checked via source_id + client_id uniqueness constraint).
- Security note: The automation only acts within the scope of the client's current subscription and lead cap. A client at cap cannot trigger discovery that creates new leads — the job is queued but blocked at the lead creation step (F-020).

### F-022 — Enrichment Cache (Internal Lead Intelligence Pool)

- **What it does:** Before calling any paid enrichment API (ProxyCurl, Apollo.io, Hunter.io, ZeroBounce), the enrichment pipeline checks an internal cache table (D-018) for that person's professional data. If a fresh cache entry exists, the pipeline uses it immediately and skips the API call entirely. If the entry is stale or absent, the API is called as normal and the result is written back to the cache for future use.

- **Why this matters:** Two clients with overlapping ICPs (e.g. both target London-based law firms with 50–200 employees and want to reach Managing Partners) will likely discover many of the same people. Without a cache, OutreachOS pays for ProxyCurl + Apollo + ZeroBounce for every lead, for every client, every time. With a cache, the second client pays nothing for enrichment of an already-known contact. As the client base grows, cache hit rates compound — a large portion of new leads will already be known. Cache hits also complete in under a second vs. 2–5 minutes for a full API run.

- **What is cached (cross-client — professional contact facts):**
  - Full name, company name, company domain
  - LinkedIn URL, job title (from ProxyCurl)
  - Email address, phone number (from Apollo.io / Hunter.io)
  - Email deliverability status and reason (from ZeroBounce)
  - Which service provided each field, and when it was last verified
  - Global suppression flag (see below)

- **What is NOT cached (remains per-client):**
  - Outreach stage (In Outreach, Responded, Qualified)
  - Terminal outcome (Meeting Booked, Not Interested, etc.)
  - Per-client Do Not Contact flag
  - Campaign assignment
  - Activity log (emails sent, calls made, replies received)
  - Fit score (calculated against each client's specific ICP, not universal)

- **Cache key:** Primary key is LinkedIn URL (stable, unique, precise). Fallback key is `normalised_full_name + company_domain` for leads where LinkedIn URL is not yet known (e.g. at the "Discovered" stage from Companies House).

- **Cache TTL (time-to-live):** 90 days. Entries older than 90 days are considered stale — the pipeline will call the API again and refresh the cache. This accounts for people changing jobs, emails being deactivated, or phone numbers changing. The TTL is configurable by admin.

- **Global suppression flag:** Separate from any per-client DNC flag. If a prospect sends a formal GDPR erasure/suppression request (i.e. "never contact me via any marketing system"), the cache entry is flagged globally. All clients' enrichment pipelines will see this flag and block the lead from outreach permanently — regardless of which client found them. This is the correct GDPR response to an opt-out that applies across the business, not just one client relationship.

- **Privacy and GDPR note:** The cache stores professional contact data (work email, LinkedIn URL, business phone, job title) — information the prospect has made available in a professional context. Processing this data for B2B outreach qualifies under the legitimate interests legal basis. Sharing it across clients as an internal efficiency mechanism (not a third-party data sale) is consistent with that basis. The cache does not store personal browsing behaviour, private contact details, or outreach response history — only publicly-resolvable professional facts. OutreachOS's privacy policy must disclose this internal data pooling and the global suppression mechanism.

- **Cost impact:** A single enrichment run costs approximately £0.03–0.05 in API credits (ProxyCurl + Apollo + ZeroBounce). A cache hit costs £0.00. As cache fill rate grows with client count, enrichment costs per client fall. The admin panel (D-017) should track cache hit rate per billing period alongside API spend, to surface the cost savings the cache is generating.

- When it appears: Invisible to the client — the enrichment pipeline runs the cache check transparently before any API call. The pipeline card shows the same enrichment stages either way; only the speed differs.
- If something goes wrong: If the cache lookup fails (e.g. database error), the pipeline falls through to the API call as normal. Cache failures never block enrichment — they just mean the client pays for the API call it would have paid for anyway.

### F-013 — Admin Panel
- What it does: A separate, restricted section for the OutreachOS team to manage client accounts, assign campaigns, view system health, and manage API integrations.
- When it appears: Only accessible to users with the "admin" role.
- If something goes wrong: Admin access failures are logged for audit purposes.

### F-023 — Password Reset

- What it does: Allows a client who has forgotten their password to request a time-limited, single-use reset link sent to their registered email address. Clicking the link takes them to a screen (S-019) where they can set a new password.
- **Flow:**
  1. Client clicks "Forgot password?" on S-002.
  2. They are taken to a simple form where they enter their email address.
  3. The server checks whether an account with that email exists. Regardless of the result, the same response is shown: "If an account exists for this email, you'll receive a reset link shortly." This prevents enumeration of registered addresses.
  4. If the account exists, the server generates a cryptographically random 64-character token, stores a hashed version in D-019 with a 1-hour expiry, and sends an email containing the reset link.
  5. The client clicks the link, is taken to S-019, and sets a new password. On submission, the server validates the token (correct hash, not expired, not already used), updates the password (bcrypt, cost factor 12), invalidates the token, and invalidates all existing refresh tokens for that account (forcing re-login on all devices).
- **Security rules:**
  - The reset token is stored hashed — the plain token exists only in the email, never in the database.
  - Tokens expire after 1 hour. Expired tokens are rejected with a clear "link expired" message and a prompt to request a new one.
  - A token is single-use: it is deleted from D-019 immediately after a successful password change.
  - Rate-limited: a maximum of 3 reset requests per email address per hour. Requests beyond this are silently discarded (same success message shown — no timing difference).
  - If the email service fails to send, the token is not created. The user sees an error and is prompted to try again. This prevents orphaned tokens.
- When it appears: Triggered from the "Forgot password?" link on S-002. Token validation and new password entry happen on S-019.
- If something goes wrong: If the token link has expired, show a clear message and a link to request a new one. If the new password fails validation (e.g. too short), preserve the form state and show the error inline.

### F-024 — Lead Fit Scoring

- What it does: Calculates a numerical fit score (0–100) for each lead, reflecting how closely they match the client's saved ICP. The score is used to sort leads by priority within campaigns and displayed on every pipeline card.
- **When scoring runs:**
  - Automatically when a lead first reaches the "Identified" enrichment stage (job title and company are known).
  - Automatically re-run for all of a client's active leads when the client updates their ICP settings.
  - On-demand via an admin trigger (e.g. to re-score after a provider change).
- **How the score is calculated — Claude API with weighted rubric:**
  The server sends the lead's profile (job title, company, industry, geography, employee range, revenue range) and the client's ICP settings to the Claude API. Claude evaluates the match against the following rubric and returns a score and a one-sentence reasoning note:

  | Dimension | Weight | What is assessed |
  |-----------|--------|-----------------|
  | Job title match | 30% | Does the title match or closely relate to the target titles in the ICP? |
  | Industry match | 25% | Does the company operate in a target industry? |
  | Geography match | 20% | Is the company in the target region? |
  | Company size match | 15% | Do employee count / revenue range fall within the ICP range? |
  | Buying signals | 10% | Are any ICP buying signal keywords present in the company description or role? |

  Each dimension is scored 0 (no match), 0.5 (partial match), or 1 (strong match). The weighted sum × 100 gives the final score (0–100). Claude's one-sentence reasoning note is stored alongside the score in D-002 (`fit_score_reasoning`) and shown on the lead detail view.

- **Score thresholds displayed on pipeline cards:**
  - 80–100: Strong fit (green badge)
  - 60–79: Moderate fit (amber badge)
  - Below 60: Weak fit (grey badge — lead is not excluded or blocked, but is deprioritised within campaign enrolment order)

- **Campaign enrolment priority:** When multiple leads are eligible for enrolment simultaneously, higher-scoring leads are enrolled first.
- When it appears: Score badge visible on every pipeline card (S-004) and in the leads table. Full score and reasoning visible on the lead detail view.
- If something goes wrong: If the Claude API call fails, the lead's score is set to `null` and displayed as "—" on the card. The lead is not blocked from outreach. Scoring is retried on the next enrichment cycle. Failures are logged to D-017.
- Security note: Claude API key stored in server `.env` only. The data sent to Claude contains professional contact facts only — no client credentials or personal data beyond name and job title.
- Cost note: One Claude API call per lead scored (~300–500 tokens per request). Tracked in D-017. Negligible unit cost — approximately £0.001 per score.

### F-025 — Campaign Channel Orchestration

- What it does: Defines the precise rules governing how multiple outreach channels fire, sequence, and interact for a single lead enrolled in a multi-channel campaign. This is the logic that prevents channels from conflicting, ensures a reply on one channel pauses others automatically, and controls timing.
- **Default channel sequence** (when a campaign has more than one channel enabled):

  Email → LinkedIn → Voice

  This order is deliberate: email is least intrusive and gives the prospect a low-friction way to respond; LinkedIn adds social proof (the prospect can view the sender's profile before deciding to reply); voice is the highest-effort channel and is reserved for leads who have not engaged on the quieter channels.

- **Default timing (delays between steps):**

  | Step | Action | Timing |
  |------|--------|--------|
  | 1 | First email sent | Day 0 — immediately on campaign enrolment |
  | 2 | Email sequence continues | Per sequence configuration (e.g. Day 3, Day 7, Day 12) |
  | 3 | LinkedIn connection request sent | Day 3 after the last email step fires — only if no reply received on any channel |
  | 4 | LinkedIn follow-up message | Day 2 after connection is accepted by the prospect |
  | 5 | Voice call placed (VAPI) | Day 5 after the LinkedIn connection request was sent — only if no reply on any channel |
  | 6 | Voice call retry | +24 hours after first call if outcome was "Not Reached" — one retry only |

  These delays are **defaults**. When creating or editing a campaign (F-008 / S-005), the client can override any delay and enable or disable individual channels.

- **Reply detection — pauses all other channels immediately:**
  When a reply is received on any channel (email reply tracked by Instantly webhook, LinkedIn reply tracked by Heyreach webhook, voice call outcome of "Interested" or "Qualified" from VAPI webhook), the system immediately:
  1. Cancels all pending scheduled steps on all other channels for that lead (removes from BullMQ queues).
  2. Updates the lead's outreach stage to "Responded".
  3. Logs the reply event to D-005.
  4. Triggers a client notification (F-028 — "Lead replied").
  No further automated outreach fires for that lead until a human decides the next action.

- **Single-channel campaigns:** If a campaign is configured with only one channel, these sequencing rules do not apply — only that channel's own logic runs.
- **Campaign configurability:** When creating a campaign, the client can set per-step delays, enable/disable voice (since voice has the highest unit cost and is most intrusive), and choose whether LinkedIn requires a connection to be accepted before the follow-up message fires.
- When it appears: Enforced automatically during campaign enrolment and step scheduling. The lead detail view shows the current step and the next scheduled action with its timestamp.
- If something goes wrong: If a channel step fails (e.g. email service unreachable), that specific step is retried after 30 minutes using BullMQ's built-in retry with exponential backoff. Other channel steps for the same lead are not blocked by a failure on a different channel. After 3 failed retries, the step is flagged for admin review and the lead's status is updated to show the delay.

### F-026 — Follow-up Scheduler

- What it does: A background job that processes leads whose terminal outcome is "Follow Up Later" and whose `follow_up_date` has arrived. For each such lead, it clears the terminal outcome, moves the lead back to the "Responded" outreach stage, and notifies the client that this lead is ready for re-engagement.
- **Job schedule:** Runs once per hour (BullMQ repeatable job). On each run, it queries D-002 for all leads where `terminal_outcome = 'Follow Up Later'` AND `follow_up_date <= now()` AND `client_id` is in the set of active client accounts.
- **What happens to the lead:**
  1. `terminal_outcome` is set to `null` (lead is active again).
  2. `outreach_stage` is set to "Responded" (placing the lead in a stage that expects a human to decide the next action).
  3. A note is added to the lead's activity log (D-005): "Follow-up date reached — lead reactivated from Follow Up Later."
  4. A client notification is triggered (F-028): "A lead is ready for follow-up: [Lead Name], [Company]."
- **Why the system does NOT auto re-enrol in outreach:**
  A "Follow Up Later" outcome typically means the prospect said something like "check back in 3 months." Automatically re-enrolling them in the same automated sequence would be jarring and potentially relationship-damaging. The human decides the right next touch — a personal message, a different campaign, or a different outcome.
- When it appears: Invisible to the client until a lead is reactivated. The lead then reappears in the "Responded" column on the Pipeline Kanban (S-004) with the activity note visible in the lead's timeline.
- If something goes wrong: If the job fails during a run (e.g. database error mid-batch), it is retried on the next scheduled run. The job queries for `follow_up_date <= now()` — not exactly today — so any leads missed due to downtime are caught on recovery.

### F-027 — Integrations Setup

- What it does: A screen within the dashboard (S-018) where clients connect the per-client OAuth accounts needed for the system to function fully. Each integration card shows its connection status and a Connect / Disconnect button.
- **Integrations managed here:**

  | Integration | Purpose | Required for |
  |-------------|---------|-------------|
  | Calendly | Meeting booking webhook — when a prospect books, the lead moves to "Meeting Booked" automatically | F-009 automatic meeting tracking |
  | Cal.com | Alternative to Calendly — same behaviour | F-009 automatic meeting tracking |
  | Google Calendar | Syncs confirmed meetings to the client's own Google Calendar | F-009 calendar sync |
  | Microsoft Outlook | Same as Google Calendar for Outlook users | F-009 calendar sync |

- **OAuth flow (same pattern for all):**
  1. Client clicks "Connect [Service]".
  2. Redirected to the service's OAuth consent screen.
  3. Client grants access.
  4. Service redirects back to our callback endpoint with an authorisation code.
  5. Server exchanges code for access + refresh tokens. Tokens stored server-side in D-021 scoped to this client. Never returned to the browser.
  6. For Calendly/Cal.com specifically: after token exchange, the server registers a webhook subscription with the service, pointing to our booking webhook endpoint.

- **Connection health indicator:** Each card shows:
  - Last successful sync timestamp (for calendar integrations).
  - Last webhook received timestamp (for Calendly/Cal.com).
  - An error state with a "Reconnect" prompt if the OAuth token has expired and cannot be refreshed silently.

- **Dashboard prompt for Calendly:** If the client has not yet connected Calendly or Cal.com, a yellow banner appears on the Overview screen (S-003): "Connect your booking calendar to track meetings automatically → Connect now." This banner is dismissed once either service is connected.

- When it appears: On the Integrations screen (S-018). The Overview banner appears until Calendly or Cal.com is connected.
- If something goes wrong: OAuth token refresh is attempted silently in the background using the stored refresh token. If the refresh fails (token revoked), the client sees an error on S-018 and a banner on S-003. Integration errors do not affect other dashboard functions.
- Security note: All OAuth tokens stored server-side only, encrypted at rest. Scopes requested are minimal: read/write access to the calendar only for Google/Outlook; webhook registration only for Calendly/Cal.com. Tokens are never returned in API responses.

### F-028 — Client Notifications

- What it does: Delivers important system events to the client through two channels: an in-app notification bell (visible in the dashboard header), and email alerts for high-priority events.
- **Events and delivery channel:**

  | Event | In-app | Email |
  |-------|--------|-------|
  | Meeting booked | Yes | Yes |
  | Lead replied on any channel | Yes | Yes |
  | Follow-up lead reactivated | Yes | No |
  | Lead cap at 80% of limit | Yes | No |
  | Lead cap at 100% of limit | Yes | Yes |
  | Payment failed | Yes | Yes |
  | Subscription cancelled | Yes | Yes |
  | Calendly/Cal.com disconnected | Yes | Yes |
  | LinkedIn outreach paused (rate limit / Heyreach issue) | Yes | Yes |

- **In-app notification centre:** Clicking the notification bell opens a dropdown showing the last 20 notifications with timestamp and a link to the relevant record (lead, campaign, billing screen, or integrations screen as appropriate). Unread notifications show a count badge on the bell icon. Notifications are marked as read when the dropdown is opened.

- **Email notifications:** Sent via a dedicated transactional email service (Postmark or SendGrid — separate from the outreach sending service managed by Instantly, to keep transactional email reputation isolated from sequence sending). Templates are plain, functional, and text-heavy — no marketing design. Each email contains a direct link to the relevant record in the dashboard.

- **Notification preferences:** Clients can toggle individual email notification types off from their account settings (a simple checkbox list). In-app notifications are always created and cannot be disabled.

- **Admin notifications:** Admin-only events (enrichment failures, Clay queue backlog, API cost anomalies) are delivered to admin accounts only and are visible in the Admin Panel (S-013) — not to client accounts.

- When it appears: Notification bell always visible in the authenticated dashboard header. Email notifications fire within 60 seconds of the triggering event.
- If something goes wrong: If an email notification fails to send, the failure is logged but the in-app notification is still created and the underlying action proceeds normally. Email notification delivery failure never blocks or reverts a business action.

### F-029 — Manual Lead Entry

- What it does: A form accessible from the Pipeline screen (S-004) that allows a client or admin to manually add a single lead to the pipeline. Used for leads discovered outside the system — a networking contact, a referral, or a prospect researched independently.
- **Form fields:**
  - Full name (required)
  - Company name (required)
  - Job title (optional — if provided, enrichment step 1 can be skipped or supplemented)
  - Email address (optional — if provided, enrichment step 2 is skipped and only verification runs)
  - LinkedIn URL (optional — if provided, enrichment step 1 is skipped)
  - Phone number (optional)
  - Notes (free text, optional — stored in lead's activity log as the first entry)
- **On submission:**
  1. A lead record is created at "Discovered" stage with `source_label = "Manual"`.
  2. Duplicate detection runs: if the same LinkedIn URL or email address already exists for this client, the submission is rejected with a clear message ("This person is already in your pipeline") and a link to the existing lead record.
  3. If no duplicate, the monthly lead cap check and increment run (F-020).
  4. The enrichment pipeline (F-019) starts automatically, skipping steps where the client has already provided the data.
- **Access:** Available to both clients (for their own pipeline) and admins (can add leads to any client's pipeline from the Admin Panel).
- When it appears: Triggered by an "Add Lead" button in the top-right of the leads table on S-004. The form appears as a modal overlay — no page navigation required.
- If something goes wrong: If the form submission fails (validation error or server error), the user's input is preserved in the modal and a clear inline error is shown. The modal does not close on error.

### F-030 — Post-signup Onboarding

- What it does: Guides a new client through the minimum actions needed to activate the system. This is a lightweight in-dashboard checklist — not a multi-screen wizard — shown on the Overview screen (S-003) until all steps are complete.
- **Onboarding checklist (displayed as a card on S-003 for new clients):**

  | # | Step | How it gets checked off |
  |---|------|------------------------|
  | 1 | Plan selected and payment complete | Auto-checked immediately on account activation |
  | 2 | Set your ICP — link to S-011 | Checked when ICP settings are saved for the first time |
  | 3 | Connect your booking calendar — link to S-018 | Checked when Calendly or Cal.com is successfully connected |
  | 4 | Your first leads are being found | Auto-checked when the first lead record is created for this client |

  Steps 2 and 3 are required for the full automation pipeline to function. Step 4 confirms the system is live and working.

- **Welcome email:** When a client account is activated (post-payment success, F-015), a transactional welcome email is sent within 60 seconds. Content: confirmation of the plan purchased, a direct link to the dashboard, and a plain-text summary of the three setup steps. Sent via the transactional email service (same as F-028), not via the outreach sequence service.

- **Checklist dismissal:** The onboarding card is hidden permanently and automatically once all four steps are checked. The client can also manually dismiss it early via an "×" button — this preference is stored in D-001 so it does not reappear on refresh or re-login.

- When it appears: On S-003 for all newly created accounts. Hidden once complete or dismissed.
- If something goes wrong: If the welcome email fails to send, the failure is logged and the account remains active. The in-dashboard checklist still appears regardless of email delivery status.

### F-031 — Lead Conversation Timeline

- **What it does:** A unified, chronological message thread displayed on every lead's detail view (S-020). It shows every message sent to and received from a prospect across all channels — email, LinkedIn, and voice — in a single scrollable interface, like a WhatsApp chat. Each message is labelled with its source tool so the client always knows exactly what was sent, when, through which channel, and what the response was.

- **Why this matters:** Without this, the client has to jump between the Email screen, the LinkedIn screen, and the Voice Calls screen to piece together what has happened with a specific person. When all channels are running simultaneously for the same prospect, this is extremely confusing. The conversation timeline collapses everything into a single coherent view per lead.

- **Layout — WhatsApp-style thread:**
  - Outbound messages appear on the **right** side of the thread (messages we sent).
  - Inbound messages (replies, accepted connections, voice call outcomes) appear on the **left** side.
  - Messages are sorted strictly by timestamp — interleaved across channels in true chronological order.
  - Each message bubble shows: tool label, channel icon, delivery status, and timestamp.
  - Voice calls appear as a distinct card (not a text bubble): duration, outcome, and a "View transcript / recording" link.

- **Tool labels on each message:**

  | Source | Label shown | Colour |
  |--------|------------|--------|
  | Instantly (email sent) | "Email — Instantly" | Blue |
  | Instantly (reply received) | "Email reply" | Blue |
  | Heyreach (connection request) | "LinkedIn — Connection request" | LinkedIn blue |
  | Heyreach (connection accepted) | "LinkedIn — Connection accepted" | LinkedIn blue |
  | Heyreach (message sent) | "LinkedIn — Message" | LinkedIn blue |
  | Heyreach (reply received) | "LinkedIn — Reply" | LinkedIn blue |
  | VAPI / Twilio (call placed) | "Voice call" | Green |
  | Manual note | "Note" | Grey |

- **Message content stored:**
  - **Email (Instantly):** Subject line, first 1,000 characters of body (truncated with "Show full email" expand), sender address, recipient address.
  - **LinkedIn (Heyreach):** Full message text (LinkedIn messages are short by nature). Connection request note. Reply text.
  - **Voice (VAPI):** Call summary note (AI-generated by VAPI), outcome label, duration, link to full transcript (Supabase Storage). Recording link if stored.

- **Delivery status indicators (email):**
  - Sent ✓
  - Delivered (no bounce) ✓✓
  - Opened 👁
  - Clicked 🔗
  - Replied ↩
  - Bounced ✕ (shown in red)
  - Unsubscribed 🚫 (shown in red, DNC label applied)

- **Inbound data sources — how messages get into the timeline:**
  All inbound data arrives via webhooks:
  - **Instantly webhooks:** `email_sent`, `email_opened`, `email_clicked`, `email_replied` (includes reply body), `email_bounced`, `email_unsubscribed`. On each event, a record is created in D-022 and the timeline updates in near-real-time via the SSE connection (F-012).
  - **Heyreach webhooks (white-label):** `connection_request_sent`, `connection_accepted`, `message_sent` (includes message body), `message_received` (includes reply body), `profile_viewed`. White-label Heyreach exposes full message content via webhook — this is one of the key reasons for using the white-label version.
  - **VAPI webhooks:** `call_started`, `call_ended` (includes outcome, duration, AI summary). Full transcript fetched from VAPI and stored in Supabase.

- **No client action required to populate the timeline.** Every message is logged automatically as webhooks arrive. The client can also add a **manual note** from within the timeline (free text, stored in D-022 with `tool = "Manual"`) — useful for recording a conversation that happened outside the system (e.g. a phone call on a personal phone).

- **Real-time updates:** The timeline on an open lead detail view updates live via the SSE connection (F-012). If a reply arrives while the client is looking at the lead, it appears immediately without a page refresh.

- When it appears: On the Lead Detail View (S-020), accessed by clicking any lead card on S-004 (Pipeline), S-005 (Campaigns), or S-006 (Meetings). The timeline is the primary content of S-020.
- If something goes wrong: If a webhook payload cannot be matched to a lead (e.g. Instantly sends a reply event for an email address not in our system), the event is logged server-side for admin review and discarded gracefully — no crash, no silent data loss.
- Security note: Message content is scoped to the client who owns the lead — `WHERE lead_id = ? AND client_id = [from JWT]`. No message content from one client's leads is ever accessible to another client.

---

## 5. Screens

| ID | Screen | What is on it | How you get there |
|----|--------|---------------|-------------------|
| S-001 | Landing Page (index.html) | Marketing content — hero, services, process, testimonials, CTA, footer | Direct URL / public link |
| S-002 | Login Page | Email and password fields, submit button, "forgot password" link | Via nav "Login" button on S-001, or any protected route redirect |
| S-003 | Dashboard — Overview | KPI grid, outreach chart, live activity feed, pipeline snapshot, upcoming meetings | After login, default view |
| S-004 | Dashboard — Pipeline | Kanban board by stage, full leads table with filters and CSV export | Sidebar: Pipeline |
| S-005 | Dashboard — Campaigns | KPI row, list of active campaigns with progress and stats | Sidebar: Campaigns |
| S-006 | Dashboard — Meetings | KPI row, full meetings list, calendar sync button | Sidebar: Meetings |
| S-007 | Dashboard — LinkedIn | Channel stats, scrape batch history table, "Run New Scrape" button | Sidebar: LinkedIn |
| S-008 | Dashboard — Email | Channel stats, active sequences table, "Create Sequence" button | Sidebar: Email |
| S-009 | Dashboard — Voice Calls | Channel stats, call log table, download log button | Sidebar: Voice Calls |
| S-010 | Dashboard — Companies House | Search bar with filters, matched companies table, "Add to Pipeline" per row | Sidebar: Companies House |
| S-011 | Dashboard — ICP Settings | Configuration form: industries, titles, revenue, geography, signals, description, plus "Automation" toggle (pause/resume automated discovery — sets discovery_paused flag in D-001) | Sidebar: ICP Settings |
| S-012 | Dashboard — Reports | Report cards grid, download PDF/CSV buttons | Sidebar: Reports |
| S-013 | Admin Panel | Client list, account management, system logs, integration status, per-client lead cap override field (editable by admin only) | Separate protected route (/admin) |
| S-014 | Dashboard — Billing | Current plan name, next billing date, last 5 invoices, "Manage Billing" button (opens Stripe portal), upgrade/cancel options, lead usage bar showing leads used vs. cap this period (e.g. "1,340 / 2,000 leads used") | Sidebar: Billing (new link to add) |
| S-015 | Checkout Success Page | Confirmation message, summary of the plan purchased, "Go to Dashboard" button | Stripe redirects here after successful payment |
| S-016 | Checkout Cancelled Page | Message explaining the payment was not completed, link back to pricing | Stripe redirects here if the user exits checkout |
| S-017 | Dashboard — Locked (Payment Required) | Warning message explaining access is suspended, link to resume subscription | Automatic redirect when subscription is cancelled or unpaid |
| S-018 | Dashboard — Integrations | Cards for Calendly, Cal.com, Google Calendar, Microsoft Outlook — each showing connection status, last sync timestamp, and Connect / Disconnect button | Sidebar: Integrations (new link to add) |
| S-019 | Password Reset — Set New Password | Form to enter and confirm a new password; shown after client clicks a valid password reset link from email | Direct link from reset email only |
| S-020 | Lead Detail View | Full lead profile (name, company, fit score + reasoning, enrichment stage, outreach stage, assigned campaign, source), conversation timeline (F-031 — WhatsApp-style chronological message thread across all channels with tool labels), next scheduled action, and action buttons (move stage, reassign campaign, add manual note, mark DNC) | Click any lead card on S-004, S-005, or S-006 |

---

## 6. Data

| ID | Data | Description |
|----|------|-------------|
| D-001 | User / Client Account | Name, email, hashed password, role (client/admin), company name, created date, last login, custom lead cap override (integer or null — if set, this overrides the plan-level cap for this client; only editable by admin), onboarding_dismissed (boolean — true if the client manually dismissed the onboarding checklist before completing it), notification_preferences (JSON — per-event email toggle settings for F-028), discovery_paused (boolean — when true, all automated discovery jobs are skipped for this client and the ICP-save trigger does not queue discovery; manual actions on S-010 and S-007 still work; settable by both admin and client) |
| D-002 | Lead / Prospect | Full name, job title, company, LinkedIn URL, email address, phone number, source (LinkedIn / Companies House / Manual), fit score (0–100), fit_score_reasoning (one-sentence text from Claude — stored alongside score, displayed on lead detail view), enrichment stage (Discovered / Identified / Enriched / Validated / Ready / Invalid Email), outreach stage (In Outreach / Responded / Qualified), terminal outcome (Meeting Booked / Not Interested / Follow Up Later / Wrong Fit / Do Not Contact — null if still active), follow-up date (if outcome is Follow Up Later), DNC flag (boolean, enforced server-side), assigned campaign, current_channel_step (tracks which F-025 orchestration step this lead is currently on), created date, last activity date |
| D-003 | Company (from Companies House) | Company name, Companies House number, SIC codes, incorporated date, director name(s), employee range, region, ICP match score |
| D-004 | Campaign | Name, channel mix (array: LinkedIn / Email / Voice), target ICP filters, start date, status (Active / Paused / Complete), linked client ID, channel_config (JSON — per-campaign overrides for F-025 timing defaults: email_to_linkedin_delay_days, linkedin_to_voice_delay_days, voice_enabled, require_connection_before_message) |
| D-005 | Outreach Activity | Lead ID, channel (LinkedIn / Email / Voice), action type (Sent / Opened / Clicked / Replied / Called / Voicemail), timestamp, notes |
| D-006 | Email Sequence | Sequence name, steps (subject line, body, delay in days), linked campaign, status |
| D-007 | Voice Call Record | Lead ID, call date, duration, outcome (Qualified / Interested / Not Reached / Voicemail), AI summary notes, recording URL (if stored) |
| D-008 | Meeting | Lead ID, meeting date, time, duration, channel booked via, confirmation status (Confirmed / Pending / No-show) |
| D-009 | ICP Settings | Per client: industries, geography, job titles, revenue range, employee range, buying signals, description text, exclusions |
| D-010 | LinkedIn Scrape Batch | Batch ID, filters used, number of leads found, average fit score, status, date run |
| D-011 | Report Snapshot | Client ID, report type, date generated, data payload (JSON), file URL if exported |
| D-012 | Subscription | Client ID, Stripe Customer ID, Stripe Subscription ID, plan name (Starter / Growth / Enterprise), status (active / past_due / cancelled / unpaid), current period start, current period end, leads_used_this_period (integer, incremented each time a new lead is created, reset to 0 at the start of each billing period). Note: trial_end_date field is reserved but not used in MVP — no free trial is offered at launch. All accounts require payment before access. |
| D-013 | Invoice | Client ID, Stripe Invoice ID, amount (in pence), status (paid / open / void), invoice date, PDF download URL |
| D-014 | Pricing Plan | Plan name, price (monthly / annual), features list, Stripe Price ID — used to create checkout sessions, monthly_lead_cap (integer or null — null means unlimited, e.g. Starter = 500, Growth = 2000, Enterprise = null) |
| D-015 | Enrichment Log | Lead ID, enrichment step (Identify / Enrich / Validate), status (success / failed / skipped), data retrieved (e.g. email found, LinkedIn URL found), third-party service used, timestamp — one row per step per lead |
| D-016 | Booking Webhook Event | Raw payload from Calendly / Cal.com, event type (booking.created / booking.cancelled / booking.rescheduled), matched lead ID, processed timestamp — stored for audit and replay if needed |
| D-017 | API Usage Log (internal) | Client ID, service name (ProxyCurl / Apollo.io / Hunter.io / ZeroBounce / Clay / VAPI / Twilio / Instantly / Phantombuster / Heyreach), action type (enrichment lookup / clay fallback run / voice call minute / twilio branded call / email sent / scrape run / linkedin action / cache hit), unit count, approximate unit cost (in pence), billing period — used by admin only to monitor per-client cost and cache hit rate. Never shown to clients. |
| D-018 | Enrichment Cache | Cache key (LinkedIn URL as primary; normalised_full_name + company_domain as fallback), full_name, company_name, company_domain, linkedin_url, job_title, email, phone, email_deliverable (boolean), email_deliverable_reason, source_linkedin (service that provided LinkedIn URL), source_email (service that provided email), source_verified (service that verified email), last_verified_at (timestamp), global_suppression (boolean — set if prospect has issued a GDPR erasure/suppression request), created_at, updated_at — shared across all clients; no per-client data stored here |
| D-019 | Password Reset Token | id, client_id (FK → D-001), token_hash (SHA-256 hash of the plain token — plain token is never stored), expires_at (1 hour from creation), used_at (timestamp — set when the token is consumed; null if not yet used), created_at. One active token per client at a time — creating a new token invalidates any prior unused token for that client. |
| D-020 | Notification | id, client_id (FK → D-001), event_type (string — e.g. "meeting_booked", "lead_replied", "cap_80_percent", "payment_failed"), title (short display text), body (one-sentence detail), link_url (deep link to the relevant record in the dashboard — nullable), read_at (timestamp — null if unread), created_at. Retained for 90 days then deleted. |
| D-021 | Integration Connection | id, client_id (FK → D-001), service (enum: calendly / cal_com / google_calendar / microsoft_outlook), access_token (encrypted at rest), refresh_token (encrypted at rest), token_expires_at, scope (string — the OAuth scopes granted), calendly_webhook_id (nullable — Calendly webhook subscription ID, stored so it can be deregistered on disconnect), last_sync_at (timestamp), status (active / error / disconnected), error_message (nullable — populated if last token refresh failed), created_at, updated_at. One row per client per service. |
| D-022 | Message (Conversation Timeline) | id, lead_id (FK → D-002), client_id (FK → D-001), direction (outbound / inbound), channel (email / linkedin / voice / note), tool (enum: Instantly / Heyreach / VAPI / Manual), message_type (email / connection_request / linkedin_message / voice_call / note), subject (nullable — email subject line), body (text — message content, email body preview up to 1,000 chars, LinkedIn message, voice call AI summary, or manual note), delivery_status (enum: sent / delivered / opened / clicked / replied / bounced / unsubscribed / accepted / not_reached / voicemail / qualified — not all statuses apply to all channels), external_id (nullable — the message/event ID from Instantly or Heyreach, for deduplication on repeated webhook delivery), metadata (JSON — channel-specific extras: email open count, voice call duration in seconds, recording_url, transcript_url), timestamp (when the message was sent or received — used for chronological sort in timeline), created_at |

---

## 7. Extra Details

- **Internet required:** Yes. The app cannot work offline. It calls external APIs (LinkedIn tools, Companies House, VAPI, email services, AI).
- **Where data is stored:** A cloud database (PostgreSQL, e.g. on Supabase or Railway). No data stored in the browser except the session token.
- **API credentials:** All third-party keys live in server-side environment variables (`.env` file). They are never sent to the frontend. The frontend only talks to our own backend API.
- **Security layers — non-negotiable, applied to every endpoint:**
  - **HTTPS only.** No plain HTTP in production. Enforced at the platform level (Railway) and via HSTS header.
  - **JWT authentication on every API route.** No endpoint returns data without a valid, unexpired JWT. The auth middleware runs before any route handler. There are no "public" data endpoints — the only public routes are the landing page HTML and the Stripe/webhook receivers (which are authenticated via signature, not JWT).
  - **Short-lived tokens.** Access tokens expire in 15 minutes. Refresh tokens expire in 7 days and are rotated on each use. A stolen token has a short window of validity.
  - **Passwords hashed with bcrypt.** Cost factor 12. Plain text passwords are never stored or logged at any point.
  - **Helmet.js** sets 15+ HTTP security headers on every response: `Content-Security-Policy`, `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, `Strict-Transport-Security`, etc.
  - **Rate limiting on all routes**, not just login. Login: 5 requests per 15 minutes per IP before lockout. All other API routes: 100 requests per minute per IP. Scrape triggers and enrichment triggers: 10 per minute per client.
  - **CORS policy:** only the app's own domain is whitelisted. All other origins receive a 403.
  - **Input validation with Zod** on every request body, query parameter, and URL segment before it touches business logic or the database. Unexpected fields are stripped. Type mismatches return a 400 with a safe error message (no internal detail exposed).
  - **Parameterised queries via Prisma.** No raw SQL string interpolation anywhere. SQL injection is prevented by design.
  - **Webhook signature verification.** Every inbound webhook (Stripe, Calendly, Clay, Heyreach, VAPI) is verified against a shared secret before the payload is processed. Requests without a valid signature return a 400 immediately and are logged.
  - **Secrets in environment variables only.** API keys are loaded from `process.env` at startup. They are never returned in API responses, never logged, and never committed to source control. A `.env.example` file documents what keys are needed without exposing values.
  - **Multi-tenant data isolation.** Every database query includes a `WHERE client_id = ?` clause enforced at the repository layer — not at the route handler. A client cannot access another client's data even by manipulating request parameters.
  - **Admin-only routes.** Routes under `/admin/*` check for `role === 'admin'` in the JWT payload. A client-role JWT returns a 403 on all admin routes.
  - **Error responses are safe.** Production error messages never expose stack traces, internal field names, or database errors to the caller. Errors are logged server-side with full context; the client receives a generic message and an error code.
  - **OWASP Top 10 addressed:** Injection (Zod + Prisma), Broken Auth (JWT + bcrypt + rate limit), Sensitive Data Exposure (HTTPS + env vars), Security Misconfiguration (Helmet), XSS (CSP header), Insecure Direct Object Reference (client_id scoping).
- **Multi-tenancy:** Each client only sees their own leads, campaigns, and meetings. All database queries are scoped by client ID.
- **Hosting:** Three environments — local development (Docker Compose on laptop), staging (GCP Cloud Run), production (GCP Cloud Run). Frontend static files served from Cloud Run or a CDN fronted by Cloudflare. Database on Supabase (managed PostgreSQL, separate projects per environment). See Appendix D for the full environment breakdown, Docker Compose config, and GitHub Actions CI/CD pipeline.
- **Data retention policy:**
  - Lead records (D-002), campaign data (D-004), and outreach activity (D-005): retained for the duration of the client's active subscription plus 12 months after cancellation, then permanently deleted.
  - Call recordings (D-007): retained for 90 days from the call date, then automatically deleted from Supabase Storage. The call record (outcome, summary) is retained for the full subscription + 12 months period even after the recording is deleted.
  - Notifications (D-020): retained for 90 days, then automatically deleted.
  - Password reset tokens (D-019): deleted immediately on use, or on expiry (1 hour). A cleanup job runs daily to purge any expired unused tokens.
  - Enrichment cache (D-018): entries are invalidated (stale) after 90 days (TTL — they remain in the table but are treated as absent by the pipeline). A monthly cleanup job hard-deletes entries older than 180 days where `global_suppression = false`. Entries with `global_suppression = true` are retained indefinitely.
  - API usage logs (D-017): retained for 24 months for billing and cost audit purposes.
  - Invoice records (D-013): retained indefinitely (legal requirement for financial records).
  - On account deletion (client requests data erasure under GDPR Article 17): all per-client records are deleted within 30 days. Entries in D-018 that originated from this client's enrichment runs are not deleted (the cache is cross-client and the data is professional contact facts — not the client's personal data). The global_suppression flag in D-018 is not deleted — it protects the prospect from future contact by any client.
- **Trial period:** No free trial is offered at MVP launch. All subscriptions require payment before dashboard access is granted. The `trial_end_date` field in D-012 is reserved for a future trial feature but is always `null` at launch and should not be referenced in any access control logic.
- **WhatsApp channel — out of scope for MVP:** WhatsApp outreach (inbound lead capture and outbound messaging via WhatsApp Cloud API) is documented in Appendix A and C as a planned future capability. It is explicitly out of scope for the initial build. Build steps B-001 through B-021 do not include WhatsApp. When WhatsApp is built, it will follow the lead source adapter pattern (Appendix C) and the OAuth connection pattern (F-027 / D-021) without requiring changes to the core pipeline.
- **Background job infrastructure (BullMQ + Redis):** BullMQ is the queue system used for all asynchronous processing — enrichment steps, email sends, voice call scheduling, follow-up reactivation, fit scoring, and the daily discovery job. Redis (via Upstash) is the backing store for BullMQ. Both must be provisioned and configured as part of B-001 (project scaffolding). BullMQ queues that must be created at setup: `enrichment`, `outreach`, `discovery`, `scoring`, `follow-up`, `notifications`. Each queue should have a dead-letter queue for jobs that exhaust all retries.
- **LinkedIn scraping compliance note:** LinkedIn scraping sits in a legal grey area. The system should use a responsible tool (e.g. Phantombuster with rate limits) and respect LinkedIn's daily action limits to avoid account bans.
- **Payments:** All money handling goes through Stripe. We never store card numbers or payment details ourselves. The Stripe secret key and webhook signing secret live in `.env` only. The Stripe publishable key is the only Stripe value that can safely appear in the browser.
- **Managed credentials model:** OutreachOS holds its own subscriptions and API accounts with all underlying tools (Phantombuster, Heyreach, ProxyCurl, Apollo.io, Hunter.io, ZeroBounce, Clay, VAPI, Twilio, Instantly, etc.). These are OutreachOS business accounts — not per-client. All API keys for these tools live in the server `.env` and are shared across clients. Three exceptions require per-client credentials because they access client-owned accounts: Google/Microsoft Calendar OAuth, Calendly/Cal.com OAuth, and WhatsApp Business account OAuth. Clients never create accounts with, log into, or pay for any other tools directly. This is intentional — it is the core of the "one subscription" value proposition.
- **Enrichment cache and cross-client data:** The internal enrichment cache (D-018) stores professional contact facts (work email, LinkedIn URL, job title) that are shared across clients as an efficiency mechanism. Per-client data (outreach history, DNC flags, pipeline stage) is never shared. A prospect's global suppression request (GDPR erasure) is stored in D-018 and honoured across all clients. The OutreachOS privacy policy must disclose this internal data pooling and global suppression mechanism. Legal basis: legitimate interests (B2B professional contact data in a business context).
- **API cost awareness:** Because OutreachOS bears the cost of every enrichment lookup, LinkedIn action, voice call, and email sent, the admin panel must track approximate API spend per client. This does not need to be precise billing — it is an internal operations tool so the OutreachOS team can identify any client that is costing significantly more than their plan revenue. Tracked in D-017. Approximate per-lead costs: ProxyCurl (~$0.01) + Apollo.io (~$0.03) + ZeroBounce (~$0.004) = ~£0.03–0.05 for the fast path. Clay fallback credits are additional for harder-to-find leads. Heyreach LinkedIn actions are charged per action. Admin panel should surface these costs per client alongside plan revenue to flag unprofitable accounts.

---

## 8. Build Steps

| ID | Step | What to build | Depends on |
|----|------|---------------|-----------|
| B-001 | Project scaffolding | Set up the Node.js/Express backend project in TypeScript. Add folder structure, `.env` file support, and basic health-check endpoint. Connect to PostgreSQL database via Prisma. Provision Redis via Upstash and configure BullMQ with the following named queues (each with a corresponding dead-letter queue for jobs that exhaust retries): `enrichment`, `outreach`, `discovery`, `scoring`, `follow-up`, `notifications`. Confirm queue connectivity with a startup health check. | Nothing |
| B-002 | Database schema | Create all tables in the database for D-001 through D-022. Set up foreign-key relationships (leads belong to a client; activities belong to a lead; messages/conversation events belong to a lead and client; notifications belong to a client; integration connections belong to a client; password reset tokens belong to a client). Add a composite index on D-022 (lead_id, timestamp) for efficient timeline queries. | B-001 |
| B-003 | Authentication | Build login, logout, and session management (F-001). Create the Login screen (S-002). Protect all dashboard routes. Test that a logged-out user cannot access any data. | B-002 |
| B-003a | Password reset | Build the full password reset flow (F-023): forgot-password form, rate-limited token generation endpoint, reset email send, token validation endpoint (S-019 — set new password screen), password update, and immediate invalidation of all existing refresh tokens on success. Build the daily cleanup job (BullMQ repeatable job on the `notifications` queue) that purges expired unused tokens from D-019. | B-003 |
| B-004 | ICP Settings (backend + frontend wire-up) | Build the API endpoint to save and load ICP settings (F-010). Wire up the ICP Settings screen (S-011) so the form saves real data. | B-003 |
| B-005 | Companies House integration | Connect to the Companies House API (F-005). Build the search endpoint. Wire up the Companies House screen (S-010) to show real results. Build "Add to Pipeline" so it creates a real lead record (D-002). | B-004 |
| B-006 | Lead Pipeline (backend + frontend wire-up) | Build CRUD endpoints for leads. Wire up the Pipeline screen (S-004) — Kanban board and leads table — to show real data. Build drag-to-move and CSV export. | B-005 |
| B-006a | Manual lead entry | Build the manual lead entry form (F-029) as a modal on S-004. Build the server endpoint: validate input, run duplicate detection (LinkedIn URL or email already exists for this client → reject), check and increment lead cap (F-020), create lead at "Discovered" stage with source_label "Manual", queue enrichment job (skipping steps where the client has already provided the data). | B-006 |
| B-007 | LinkedIn scraping integration | Connect to Phantombuster (or chosen tool). Build a scrape trigger endpoint (F-004). Pull results in and create lead records at "Discovered" stage. Wire up the LinkedIn screen (S-007) to show batch history. | B-006 |
| B-007a | Lead enrichment pipeline — provider abstraction layer + cache integration | Build the `src/enrichment/` module structure: `step-registry.ts`, `pipeline.ts`, and provider modules (`proxycurl.ts`, `apollo.ts`, `hunter.ts`, `zerobounce.ts`, `clay.ts`). Add cache lookup as the first step in `pipeline.ts`: check D-018 using LinkedIn URL or (name + company_domain) key — if fresh hit found, populate lead fields from cache and mark Ready, log as "cache hit" in D-017, skip all API calls. If miss or stale, run the three API steps in sequence. After each successful API step, write result to D-018 cache (upsert). If all direct providers fail for any step, flag "Pending Clay" and queue for Clay batch. Build Clay webhook receiver. Build global suppression check — if D-018 has `global_suppression = true` for this person, block outreach and mark lead accordingly. Each step writes D-015 log. Block any un-validated lead from outreach enrolment. | B-007 |
| B-007d | Lead fit scoring | Build the fit scoring module (F-024). When a lead reaches "Identified" stage, enqueue a job on the `scoring` BullMQ queue. The worker calls the Claude API with the lead's profile and the client's ICP settings, using the weighted rubric defined in F-024. Store the returned score (0–100) and one-sentence reasoning in D-002 (`fit_score` and `fit_score_reasoning`). Log the Claude API call in D-017. Handle Claude API errors gracefully: set score to null, log failure, retry on next enrichment cycle. Trigger a re-score for all active leads when a client updates their ICP settings (F-010). | B-007a |
| B-007b | End-to-end automation trigger | Build the orchestration layer (F-021). On ICP save, queue lead discovery jobs for all active source adapters (Companies House + LinkedIn). After each lead is created, auto-queue enrichment jobs (B-007a). After lead reaches "Ready", auto-enrol into matching active campaign. Build the scheduled discovery job (configurable per-client frequency, defaulting to daily). Add idempotency check on lead creation (source_id + client_id must be unique). Wire up the ICP settings save endpoint (B-004) to trigger this chain. | B-007a |
| B-007c | Heyreach LinkedIn outreach integration (white-label) | Connect to the white-label Heyreach API. Build the LinkedIn outreach enrolment endpoint — when a lead is enrolled in a campaign with LinkedIn as a channel, create a Heyreach sequence for that lead (connection request → personalised message sequence). Configure white-label webhook endpoints to receive: `connection_request_sent`, `connection_accepted`, `message_sent` (with full message body), `message_received` (with full reply body), `profile_viewed`. Map each event to a D-022 (Message) record for the conversation timeline and a D-005 (Outreach Activity) record for the activity feed. Wire up the LinkedIn screen (S-007) to show Heyreach sending status alongside scrape batch history. Enforce Heyreach daily limits. | B-007b |
| B-008 | Email sequences integration | Connect to Instantly API. Build sequence creation, lead enrolment, and tracking (F-006). Configure Instantly webhooks to receive: `email_sent` (with subject + body preview), `email_opened`, `email_clicked`, `email_replied` (with reply body), `email_bounced`, `email_unsubscribed`. Map each webhook event to a D-022 (Message) record for the conversation timeline and a D-005 record for the activity feed. Handle unsubscribe webhook by setting DNC flag server-side. Enforce that only "Ready for Outreach" leads can be enrolled. Wire up the Email screen (S-008) and Campaigns (S-005). | B-007b |
| B-006b | Lead detail view + conversation timeline | Build S-020 (Lead Detail View). Build the lead detail API endpoint returning full lead profile, enrichment status, campaign assignment, and next scheduled action. Build the conversation timeline API endpoint (GET /leads/:id/messages) returning D-022 records in timestamp order. Build the real-time update hook so new messages arriving via webhook appear in an open timeline without a page refresh (using the existing SSE connection from F-012). Build the "Add note" form within the timeline (creates a D-022 record with tool = "Manual"). Build all action buttons: move stage (with server-side validation), reassign campaign, mark DNC. Wire up the discovery pause toggle on S-011 (sets discovery_paused in D-001 and cancels queued discovery jobs). | B-007c, B-008, B-009 |
| B-009 | VAPI + Twilio voice integration | Connect to VAPI. Configure Twilio as VAPI's carrier. Enable Twilio Enhanced Branded Calling — configure business display name and call reason string in Twilio dashboard; set VAPI to route via Twilio. Build the call trigger endpoint and VAPI outcome webhook (F-007) — handle all outcomes including the "Do Not Contact" verbal opt-out signal. Wire up the Voice Calls screen (S-009) with real call logs. Wire up automatic call scheduling as part of campaign auto-enrolment (F-021). | B-007b |
| B-009a | Campaign channel orchestration | Build the F-025 orchestration layer in a dedicated `src/orchestration/channel-sequencer.ts` module. This module is called by the campaign enrolment logic (B-007b) and manages step scheduling via BullMQ delayed jobs on the `outreach` queue. Implement: (1) default step ordering (email → LinkedIn → voice) with configurable delays read from D-004's `channel_config`; (2) reply detection listener — when any channel webhook fires a reply event, the sequencer cancels all pending BullMQ jobs for that lead across all channels and sets outreach stage to "Responded"; (3) `current_channel_step` tracking in D-002. Add the campaign channel configuration UI to the campaign creation/edit form on S-005. | B-008, B-009 |
| B-010 | Dashboard KPIs and activity feed | Build the data aggregation endpoints that power the KPI widgets (F-002) and live activity feed (F-012). Wire up the Overview screen (S-003) to replace all hardcoded numbers. Activity feed must show automation events (lead discovered, enrichment started, enrichment complete, outreach enrolled) not just manual actions. | B-007b, B-008, B-009 |
| B-010b | Client notifications system | Build the notifications system (F-028). Create the BullMQ worker on the `notifications` queue that processes notification jobs. Build the in-app notification API endpoints: GET /notifications (paginated, last 20), POST /notifications/:id/read. Build the notification bell UI component in the dashboard header with unread badge count. Build the transactional email sender for high-priority notification events (separate from the Instantly email service — use Postmark or SendGrid). Wire up notification triggers from all relevant events: meeting booked (B-011), lead replied (B-009a), lead cap warnings (B-018a), payment events (B-016), Calendly disconnected (B-011a). Add notification preference settings (per-event email toggles) to account settings UI and store in D-001. | B-010 |
| B-011 | Meetings tracker + booking webhook | Build the meetings endpoint. Wire up the Meetings screen (S-006). Connect Calendly / Cal.com webhook endpoint — on `booking.created`, create the meeting record (D-008), update the lead's terminal outcome to "Meeting Booked", write D-016. Handle `booking.cancelled` and `booking.rescheduled` events. Build manual meeting entry form. | B-009 |
| B-011a | Integrations screen + OAuth connections | Build the Integrations screen (S-018, F-027). Build OAuth flow endpoints for Calendly, Cal.com, Google Calendar, and Microsoft Outlook: authorisation redirect, callback handler (exchange code for tokens, encrypt and store in D-021), Calendly webhook registration on connect, webhook deregistration on disconnect. Build the token refresh background job (runs every 6 hours via BullMQ repeatable job — silently refreshes tokens nearing expiry). Build the integration health status API endpoint (last sync timestamp, error state). Wire up the Calendly-missing banner on S-003. Wire up calendar sync (Google / Outlook) so confirmed meetings in D-008 are written to the client's connected calendar. | B-011, B-010b |
| B-011b | Follow-up scheduler | Build the F-026 follow-up reactivation job as a BullMQ repeatable job on the `follow-up` queue, running hourly. Job query: leads where `terminal_outcome = 'Follow Up Later'` AND `follow_up_date <= now()`. For each matched lead: clear terminal_outcome, set outreach_stage to "Responded", write activity log note, enqueue a notification job (F-028 — "lead reactivated"). Verify the job catches up correctly after downtime (by querying `<= now()` not `= today`). | B-011a |
| B-012 | Reporting and export | Build the report generation endpoint (F-011). Wire up the Reports screen (S-012) with real data and working PDF/CSV downloads. | B-010 |
| B-013 | Admin panel | Build the admin-only section (F-013, S-013) — client management, system health view, integration status. Include: (1) per-client API cost view (D-017) surfacing cost across ProxyCurl, Apollo.io, Clay fallback credits, Heyreach actions, VAPI minutes, and email sends alongside plan revenue to flag unprofitable accounts; (2) Clay fallback queue view showing leads per client currently "Pending Clay" and which step they are stuck on; (3) Heyreach account health indicator — current LinkedIn account status (active / restricted / banned) and daily action counts vs. limits; (4) sending domain warmup status per domain (pulled from Instantly API) — admin must confirm warmup is "Active" before any email campaign can launch; (5) BullMQ queue health view — queue depth, failed jobs, and dead-letter queue contents for each of the six queues. | B-003 |
| B-014 | Stripe — pricing page | Add a pricing section to the landing page (S-001) with plan cards and "Get Started" buttons. Set up Stripe products and prices in the Stripe dashboard and store the Price IDs in `.env`. | B-001 |
| B-015 | Stripe — checkout flow | Build the server endpoint that creates a Stripe Checkout Session (F-015). Handle the success and cancelled redirects. Build S-015 and S-016 pages. On success, create or activate the client account and write D-012 subscription record. Trigger the onboarding welcome email (B-015a). | B-014, B-003 |
| B-015a | Post-signup onboarding | Build the F-030 onboarding checklist. Send the welcome transactional email within 60 seconds of account activation (BullMQ job on `notifications` queue). Build the onboarding checklist API endpoint returning the completion state of all four steps for the authenticated client. Wire up the checklist card on S-003 — visible only while at least one step is incomplete and `onboarding_dismissed = false` in D-001. Build the dismiss endpoint. Steps 2, 3, and 4 auto-check when the relevant actions complete (ICP saved in B-004, Calendly connected in B-011a, first lead created in B-005/B-006/B-007/B-006a). | B-015 |
| B-016 | Stripe — webhooks | Build the webhook endpoint (F-018). Handle these events: `checkout.session.completed`, `invoice.paid`, `invoice.payment_failed`, `customer.subscription.updated`, `customer.subscription.deleted`. Verify the Stripe signature on every request. Update D-012 and D-013 records accordingly. | B-015 |
| B-017 | Stripe — billing portal | Build the server endpoint that generates a Stripe Customer Portal session (F-016). Wire up the Billing screen (S-014) in the dashboard showing plan, invoices, and the "Manage Billing" button. | B-016 |
| B-018 | Subscription status enforcement | Add middleware (F-017) that checks the client's subscription status on every dashboard request. Build the locked/payment-required screen (S-017). Apply the grace period logic for `past_due` accounts. | B-016 |
| B-018a | Lead cap enforcement | Build the cap resolution logic (F-020): read plan cap from D-014, check for client override in D-001, compare against `leads_used_this_period` in D-012. Add server-side guard to all lead creation endpoints. Add the 80% warning banner and 100% hard-stop message to the dashboard. Wire up the usage bar on S-014. Add cap override field to the admin panel (S-013). Hook the counter reset into the `invoice.paid` Stripe webhook (B-016). Add duplicate detection to prevent double-counting. | B-017 |
| B-019 | Security hardening | Add rate limiting, CORS rules, input validation, and HTTPS enforcement across all routes. Review all endpoints for authorisation gaps. | B-013, B-018 |
| B-020 | Testing and staging deployment | End-to-end test of the full flow: pricing page → checkout → login → ICP settings → scrape → pipeline → outreach → voice → meeting booked. Also test: payment failure → grace period → lockout → renewal → access restored. Deploy to staging. | B-019 |
| B-021 | Production deployment + monitoring | Deploy to production. Set up error logging (e.g. Sentry). Set up uptime monitoring. Switch Stripe keys from test mode to live mode. Hand over to client with onboarding guide. | B-020 |

---

## Appendix A — Third-Party Services Summary

All credentials below are **OutreachOS's own accounts** — not per-client. Clients do not create, manage, or pay for any of these services directly.

| Service | Purpose | Account owner | Credentials location |
|---------|---------|--------------|---------------------|
| Companies House API | UK business data search (free public API) | OutreachOS | Server `.env` only |
| Phantombuster | LinkedIn profile **scraping** (discovery / lead source). Finds profiles matching ICP filters. Not used for outreach. | OutreachOS | Server `.env` only |
| Heyreach (Agency or Unlimited plan) | LinkedIn **outreach** (connection requests, message sequences, reply tracking). Used on the Agency or Unlimited plan — required for multi-client management and full white-label API access (including webhook delivery of full message content for F-031). These plans require OutreachOS to supply its own residential proxies (one per LinkedIn sender account) — Heyreach does not manage proxies at this tier. See Appendix D proxy architecture section. | OutreachOS | Server `.env` only |
| ProxyCurl | LinkedIn profile lookup — enrichment step 1 primary provider. Given a person's name and company, returns their LinkedIn URL and job title. Swappable (see Appendix C enrichment provider pattern). | OutreachOS | Server `.env` only |
| Apollo.io | Email and phone finder — enrichment step 2 primary provider. Also usable as a lead source adapter. Swappable. | OutreachOS | Server `.env` only |
| Hunter.io | Email finder — enrichment step 2 fallback provider. Used when Apollo.io returns no result. Swappable. | OutreachOS | Server `.env` only |
| ZeroBounce | Email verification — enrichment step 3 primary provider. Confirms deliverability before outreach. Swappable (e.g. could be replaced with NeverBounce, Bouncer). | OutreachOS | Server `.env` only |
| Clay (clay.com) | Enrichment **async fallback**. GTM workflow platform with 150+ provider waterfall. Used only when all direct API providers for an enrichment step fail. Leads are queued to Clay; results returned via webhook, typically within hours. Not used in the real-time fast path. | OutreachOS | Server `.env` only |
| VAPI | AI voice call brain — hosts the conversation script, manages agent responses, detects qualification outcomes, fires outcome webhooks. Routes calls through Twilio as carrier. | OutreachOS | Server `.env` only |
| Twilio | Voice telephony carrier used by VAPI. Also provides **Enhanced Branded Calling** — displays client company name, logo, and call reason on the recipient's screen before they answer. Improves answer rates significantly over unbranded calls. Account SID + Auth Token stored server-side. | OutreachOS | Server `.env` only |
| WhatsApp Cloud API (Meta) | WhatsApp outreach channel — sends templated messages and session messages; also handles inbound leads from WhatsApp Business. Per-client WhatsApp Business account required. | Per-client OAuth — client connects their WhatsApp Business account | OAuth tokens stored server-side per client |
| Instantly | Email sending and sequence management (multi-step sequences, open/reply tracking, deliverability monitoring). | OutreachOS | Server `.env` only |
| Supabase | PostgreSQL database hosting | OutreachOS | Server `.env` only |
| GCP Cloud Run | Backend server hosting (staging + production). Local dev uses Docker Compose. | OutreachOS | GCP Secret Manager (staging/production); `.env` file (local dev only) |
| Google / Microsoft OAuth | Calendar sync for client meeting calendars | Per-client OAuth — client authorises access to their own calendar only | OAuth tokens stored server-side per client |
| Anthropic Claude API | Lead fit scoring, message personalisation | OutreachOS | Server `.env` only |
| Sentry | Error monitoring (internal) | OutreachOS | Server `.env` only |
| Stripe | Subscription payments, invoicing, billing portal | OutreachOS | Secret key + webhook signing secret: server `.env` only. Publishable key: safe to use in browser. |
| Calendly / Cal.com | Meeting booking webhook — client connects their own Calendly account | Per-client OAuth — client authorises access to their own booking calendar | OAuth tokens + webhook signing secret stored server-side per client |

> **Per-client credentials** (OAuth tokens stored server-side, not shared across clients): Google/Microsoft Calendar, Calendly/Cal.com, WhatsApp Business account. All other credentials are OutreachOS business accounts shared across all clients.

> No third-party API key is ever sent to the browser or stored in client-side code, **with the single exception of the Stripe publishable key**, which is designed to be public and contains no sensitive access.

---

## Appendix B — Acceptance Criteria Reference

Each user story has the following acceptance criteria that should be verified before marking it complete:

| AC ID | Linked Story | Criterion |
|-------|-------------|-----------|
| AC-001 | US-001 | A user with valid credentials can log in and reach the dashboard |
| AC-002 | US-001 | A user with invalid credentials sees an error and is not admitted |
| AC-003 | US-001 | A logged-out user who visits a dashboard URL is redirected to login |
| AC-004 | US-002 | All four KPI numbers on the overview reflect real database values |
| AC-005 | US-002 | Trend badges (up/down) are calculated from the previous period |
| AC-006 | US-003 | Leads appear in the correct pipeline column based on their stage in the database |
| AC-007 | US-003 | Moving a card between columns updates the lead's stage in the database |
| AC-008 | US-004 | Searching Companies House returns results filtered by the chosen sector, revenue, and region |
| AC-009 | US-004 | Clicking "Add to Pipeline" creates a new lead record scoped to the logged-in client |
| AC-010 | US-005 | A scrape batch triggered by the client creates new lead records in the database |
| AC-011 | US-005 | Each scraped lead has a fit score calculated against the client's saved ICP |
| AC-012 | US-006 | An email sequence step is sent to a lead at the configured delay after the previous step |
| AC-013 | US-006 | Opens and replies are tracked and written back to the lead's activity log |
| AC-014 | US-007 | An AI voice call is placed to a lead and the outcome is saved to the lead record |
| AC-015 | US-007 | A call that does not connect is logged as "Not Reached" and not retried immediately |
| AC-016 | US-008 | The call log shows outcome, duration, and AI-generated notes for each call |
| AC-017 | US-009 | All confirmed meetings appear on the Meetings screen with correct date, time, and contact |
| AC-018 | US-010 | Saving ICP settings persists them to the database and they are applied to the next scrape |
| AC-019 | US-011 | A new campaign can be created, assigned leads, and launched from the Campaigns screen |
| AC-020 | US-012 | A report can be downloaded as PDF or CSV with accurate data |
| AC-021 | US-013 | An admin user can view all client accounts; a client user cannot |
| AC-022 | US-014 | The Live Activity feed on the overview updates without a full page refresh |
| AC-023 | US-015 | The landing page shows a pricing section with at least two plan options and a "Get Started" button per plan |
| AC-024 | US-016 | Clicking "Get Started" redirects to a Stripe-hosted checkout page for the correct plan |
| AC-025 | US-016 | After successful payment, the user is redirected to a success page and a new account record is created with an `active` subscription status |
| AC-026 | US-016 | If the user exits checkout without paying, they are returned to the pricing page and no account is created |
| AC-027 | US-017 | The Billing screen shows the current plan name, next billing date, and a list of past invoices with download links |
| AC-028 | US-018 | Clicking "Manage Billing" opens the Stripe Customer Portal where the client can upgrade, downgrade, or cancel |
| AC-029 | US-018 | Changes made in the Stripe portal (e.g. cancellation) are reflected in the database within seconds via the webhook |
| AC-030 | US-019 | When a payment fails, the client sees a warning banner but retains access for the grace period (7 days) |
| AC-031 | US-019 | After the grace period, the dashboard is locked and the client is shown a payment prompt |
| AC-032 | US-019 | When a failed payment is resolved, the dashboard is unlocked automatically without admin intervention |
| AC-033 | US-019 | Incoming webhooks without a valid Stripe signature are rejected with a 400 error and logged |
| AC-034 | F-019 | A lead created from Companies House automatically progresses through all enrichment steps without manual input |
| AC-035 | F-019 | A lead with an invalid email is flagged and blocked from being enrolled in any outreach sequence |
| AC-036 | F-019 | The enrichment log records every step attempted, the service used, and the outcome |
| AC-037 | F-003 | A lead marked "Do Not Contact" cannot be enrolled in a campaign — this is rejected server-side even if attempted via the API directly |
| AC-038 | F-003 | A lead with outcome "Follow Up Later" reappears as active on the set follow-up date |
| AC-039 | F-009 | When a Calendly webhook fires for a confirmed booking, the meeting is created automatically and the lead's stage is set to "Meeting Booked" without any manual action |
| AC-040 | F-009 | When a booking is cancelled via Calendly, the meeting record is updated to "Cancelled" and the lead's stage is reverted |
| AC-041 | F-004 | Adding a new lead source (new adapter) does not require changes to the enrichment pipeline, pipeline board, or dashboard — only a new adapter file is needed |
| AC-042 | F-020 | A client on the Starter plan cannot create more than 500 leads in a billing period |
| AC-043 | F-020 | When a client reaches 80% of their cap, a warning banner appears on the dashboard |
| AC-044 | F-020 | When a client reaches 100% of their cap, all lead creation routes return an error — including the API directly, not just the UI buttons |
| AC-045 | F-020 | When a Stripe renewal payment succeeds, the `leads_used_this_period` counter resets to 0 |
| AC-046 | F-020 | An admin can set a custom lead cap override for a specific client from the Admin Panel, and it takes effect immediately |
| AC-047 | F-020 | A client on Enterprise plan (null cap) has no lead creation limit |
| AC-048 | F-020 | Attempting to add a lead with a LinkedIn URL or email already in the system for that client does not increment the counter |
| AC-049 | F-020 | The Billing screen shows the correct leads used vs. cap figure, updating in real time as leads are added |
| AC-050 | F-020 | If the cap check fails due to a database error, lead creation is allowed and the failure is logged — the client is not blocked |
| AC-051 | US-020 | When a client saves their ICP for the first time, lead discovery jobs are automatically triggered for all active source adapters — no manual "start" action required |
| AC-052 | US-020 | A lead created by an automated discovery job enters the enrichment pipeline immediately — within 60 seconds of creation, the first enrichment step (ProxyCurl LinkedIn lookup) has been attempted |
| AC-053 | US-020 | A lead that reaches "Ready for Outreach" is automatically enrolled in the correct active campaign based on ICP filters — no manual enrolment needed |
| AC-054 | US-020 | If a discovery job creates a lead that already exists (same source_id + client_id), no duplicate is created and the lead count is not incremented |
| AC-055 | US-020 | The automation runs on a daily schedule per client even if the ICP has not changed — ensuring new companies appearing in Companies House or LinkedIn are discovered automatically |
| AC-056 | F-021 | A failure in one lead source adapter (e.g. Companies House API is down) does not stop discovery from running for other sources (e.g. LinkedIn continues) |
| AC-057 | F-023 | A client can request a password reset and receives an email containing a reset link within 2 minutes |
| AC-058 | F-023 | A valid reset link allows the client to set a new password; after success, the old password no longer works |
| AC-059 | F-023 | A reset link that is older than 1 hour is rejected with a clear "link expired" message and a prompt to request a new one |
| AC-060 | F-023 | A reset link cannot be used a second time — the first use invalidates it |
| AC-061 | F-023 | After a successful password reset, all existing sessions for that account are invalidated — previously issued refresh tokens no longer work |
| AC-062 | F-023 | Requesting a reset for an email address that does not exist in the system shows the same success message as a valid request — no information is disclosed |
| AC-063 | F-023 | Submitting more than 3 reset requests for the same email within an hour does not create new tokens and does not send additional emails |
| AC-064 | F-024 | When a lead reaches "Identified" enrichment stage, a fit score (0–100) and one-sentence reasoning note are calculated and stored within 5 minutes |
| AC-065 | F-024 | The score badge on a pipeline card is green for 80+, amber for 60–79, and grey for below 60 |
| AC-066 | F-024 | When a client updates their ICP settings, all active leads in their pipeline have their fit scores recalculated within 24 hours |
| AC-067 | F-024 | If the Claude API call for scoring fails, the lead's score is set to null and displayed as "—" — the lead is not blocked from outreach |
| AC-068 | F-025 | When a lead is enrolled in a multi-channel campaign, the first email fires on day 0 and the LinkedIn connection request fires on day 3 (default) if no reply has been received |
| AC-069 | F-025 | When an email reply is received for a lead in a multi-channel campaign, all pending LinkedIn and voice steps for that lead are cancelled immediately |
| AC-070 | F-025 | When a LinkedIn reply is received, all pending email and voice steps are cancelled immediately |
| AC-071 | F-025 | Custom per-campaign channel delays (set in the campaign editor) override the defaults and are applied correctly |
| AC-072 | F-025 | A single-channel campaign (e.g. email only) does not trigger LinkedIn or voice steps |
| AC-073 | F-025 | A campaign with voice disabled does not trigger VAPI calls even if a lead would otherwise qualify |
| AC-074 | F-026 | A lead with outcome "Follow Up Later" and a follow_up_date of today reappears in the "Responded" pipeline stage within 1 hour of the follow-up date being reached |
| AC-075 | F-026 | When a follow-up lead is reactivated, a note is added to its activity log and the client receives an in-app notification |
| AC-076 | F-026 | The reactivated lead is NOT automatically re-enrolled in any outreach campaign — it waits for a human decision |
| AC-077 | F-026 | If the follow-up scheduler job is down for a period, leads whose follow_up_date fell during the downtime are correctly reactivated on the next successful job run |
| AC-078 | F-006 | Every outbound email in every sequence contains a functional unsubscribe link |
| AC-079 | F-006 | When a recipient clicks the unsubscribe link, the lead's DNC flag is set server-side within 60 seconds and no further emails are sent |
| AC-080 | F-006 | When a recipient replies with an opt-out phrase (e.g. "please remove me"), the system detects it and sets the DNC flag — no further contact is attempted |
| AC-081 | F-006 | A campaign cannot be launched if the assigned sending domain's warmup status in Instantly is not "Active" — the system blocks launch and shows a warmup status warning |
| AC-082 | F-027 | A client can connect their Calendly account via OAuth from S-018; after connection, booking webhooks are received and meetings are created automatically (AC-039 still applies) |
| AC-083 | F-027 | A client can connect Google Calendar from S-018; confirmed meetings in the dashboard are synced to the connected Google Calendar |
| AC-084 | F-027 | When a connected OAuth token expires, the system silently refreshes it; if refresh fails, the client sees an error on S-018 and a banner on S-003 |
| AC-085 | F-027 | Disconnecting Calendly from S-018 deregisters the webhook with Calendly so no further events are sent |
| AC-086 | F-027 | The Overview screen (S-003) shows a banner prompting the client to connect Calendly if it is not yet connected |
| AC-087 | F-028 | When a meeting is booked, the client receives an in-app notification and an email notification within 60 seconds |
| AC-088 | F-028 | When a lead replies on any channel, the client receives an in-app notification |
| AC-089 | F-028 | When the lead cap reaches 80%, a warning banner appears on the dashboard (AC-043 still applies) and an in-app notification is created |
| AC-090 | F-028 | A client who has opted out of a specific email notification type (via notification preferences) does not receive that type of email — but still receives the in-app notification |
| AC-091 | F-028 | Clicking a notification in the bell dropdown navigates the client to the relevant record (lead, meeting, billing screen, or integrations screen as appropriate) |
| AC-092 | F-028 | Notifications older than 90 days are no longer returned by the notifications API |
| AC-093 | F-029 | A client can manually add a lead from the Pipeline screen and the lead appears in the pipeline at "Discovered" stage |
| AC-094 | F-029 | Manually adding a lead with a LinkedIn URL or email that already exists in the client's pipeline is rejected with a message and a link to the existing lead |
| AC-095 | F-029 | A manually added lead with an email address provided skips enrichment steps 1 and 2 — only email verification (step 3) runs |
| AC-096 | F-029 | A manually added lead increments the monthly lead cap counter |
| AC-097 | F-030 | When a new client account is created, a welcome email is sent within 60 seconds |
| AC-098 | F-030 | The onboarding checklist appears on S-003 for a new client and shows step 1 as already checked |
| AC-099 | F-030 | Checklist step 2 is automatically checked when the client saves their ICP settings for the first time |
| AC-100 | F-030 | Checklist step 3 is automatically checked when the client connects Calendly or Cal.com |
| AC-101 | F-030 | Checklist step 4 is automatically checked when the first lead appears in the client's pipeline |
| AC-102 | F-030 | Once all four steps are checked, the onboarding card disappears permanently and does not return |
| AC-103 | F-030 | A client can dismiss the onboarding card manually before completing all steps; it does not reappear after dismissal |
| AC-104 | F-004 | If Heyreach reports a LinkedIn account restriction, all LinkedIn outreach steps across all clients are paused immediately and the admin receives an alert |
| AC-105 | F-021 | When a lead reaches "Ready for Outreach" and matches multiple active campaigns, it is enrolled in the campaign with the earliest creation date |
| AC-106 | F-021 | A lead enrolled in a campaign via auto-enrolment is not simultaneously enrolled in a second campaign |
| AC-107 | F-021 | An admin or client can manually reassign a lead to a different campaign from the lead detail view |
| AC-108 | F-021 | When discovery_paused is true for a client, the scheduled daily discovery job skips that client entirely — no new leads are created |
| AC-109 | F-021 | When discovery_paused is true, saving ICP settings does not trigger a discovery job |
| AC-110 | F-021 | When discovery_paused is true, the "Run New Scrape" button on S-007 is disabled |
| AC-111 | F-021 | When discovery_paused is true, the manual "Add to Pipeline" on S-010 and manual lead entry (F-029) still work — the pause only blocks automated discovery |
| AC-112 | F-021 | When discovery is re-enabled (paused → active), a fresh discovery job is queued immediately |
| AC-113 | F-021 | When discovery_paused is set, any queued (not yet started) discovery jobs for that client are cancelled from the BullMQ queue |
| AC-114 | F-021 | The Overview screen shows a yellow banner when discovery is paused, with a "Resume" action |
| AC-115 | F-031 | Clicking a lead card from any screen (S-004, S-005, S-006) opens the lead detail view (S-020) showing the conversation timeline |
| AC-116 | F-031 | All outbound messages (email, LinkedIn connection request, LinkedIn message, voice call) appear in the timeline in chronological order with correct tool labels |
| AC-117 | F-031 | When a reply is received via Instantly webhook, the reply content appears in the timeline within 60 seconds |
| AC-118 | F-031 | When a LinkedIn reply is received via Heyreach webhook, the reply content appears in the timeline within 60 seconds |
| AC-119 | F-031 | When an email is opened, the delivery status on the corresponding timeline message updates from "Sent" to "Opened" |
| AC-120 | F-031 | A voice call card shows duration, outcome, and a link to the AI-generated transcript |
| AC-121 | F-031 | A client can add a manual note from within the timeline; it appears immediately and is labelled "Note" |
| AC-122 | F-031 | The timeline is client-scoped — a client cannot see conversation data for a lead belonging to another client |
| AC-123 | F-031 | If a lead has messages on multiple channels on the same day, they appear interleaved in true timestamp order — not grouped by channel |
| AC-124 | F-005 | Clicking "Add to Pipeline" on a Companies House company result extracts all current officers whose role matches the ICP job title filter and creates one lead per matching officer |
| AC-125 | F-005 | If a company has 3 directors but only 1 matches the ICP title filter, only 1 lead is created |
| AC-126 | F-005 | Adding a company where the same officer already exists in the client's pipeline (matched by source_id) does not create a duplicate — that officer is silently skipped |

---

## Appendix C — Lead Source Architecture (Extensibility)

This section explains the design pattern that makes adding new lead sources straightforward.

### The problem it solves

Without a shared pattern, each new lead source (LinkedIn, Companies House, Apollo, Twitter/X, manual CSV upload, etc.) would require unique code throughout the system — different database writes, different pipeline handling, different dashboard logic. This is fragile and slow to build.

### The solution: Lead Source Adapter

Every lead source is built as an **adapter** — a small, self-contained module that translates a source's output into the standard lead format the rest of the system understands. The adapter must answer three questions:

| Question | Method | What it does |
|----------|--------|-------------|
| How do I search this source? | `search(icpFilters)` | Takes the client's ICP settings and returns a raw list of results from the source |
| How do I turn a result into a lead? | `normalise(rawResult)` | Maps the source's field names to our standard lead fields (name, company, LinkedIn URL, email, phone, source label) |
| How do I trigger this source? | `trigger(clientId, filters)` | Handles scheduling, rate limits, and error handling specific to this source |

### What "standard lead fields" means

Every adapter must produce a lead with at minimum:

- `full_name` — person's name
- `company_name` — their company
- `source_label` — which source found them (e.g. "LinkedIn", "Companies House", "Apollo")
- `source_id` — the unique ID of the record in the source (e.g. LinkedIn profile URL, Companies House number)
- `enrichment_stage` — always starts at "Discovered"

All other fields (email, phone, LinkedIn URL) are filled in by the enrichment pipeline (F-019), not by the source adapter itself.

### Enrichment Provider Adapter pattern

The same swappability principle that applies to lead sources also applies to the enrichment tools at each pipeline step. This is the mechanism that makes it possible to replace ProxyCurl with another LinkedIn lookup tool, or ZeroBounce with NeverBounce, without rewriting the pipeline.

Each enrichment step type has a **provider registry** — a list of modules that implement the same interface for that step. The pipeline calls the registered provider, not the tool directly.

**Step types and their provider interface:**

| Step type | Interface method | Returns | Example providers |
|-----------|-----------------|---------|-------------------|
| LinkedIn lookup | `lookup(fullName, companyName)` | `{ linkedinUrl, jobTitle }` | `proxycurl.js`, *(future: RocketReach, etc.)* |
| Email find | `findEmail(linkedinUrl, companyDomain)` | `{ email, phone }` | `apollo.js`, `hunter.js`, *(future: Snov.io, etc.)* |
| Email verify | `verify(email)` | `{ deliverable: boolean, reason }` | `zerobounce.js`, *(future: neverbounce.js, bouncer.js)* |
| Clay fallback | `enrich(leadData)` | all fields above | `clay.js` (async, batch) |

**How the pipeline uses providers:**

```
src/enrichment/
  providers/
    linkedin-lookup/
      proxycurl.js        ← current primary
    email-find/
      apollo.js           ← current primary
      hunter.js           ← current fallback
    email-verify/
      zerobounce.js       ← current primary
    clay/
      clay.js             ← async last-resort fallback for all step types
  step-registry.js        ← maps each step to its ordered list of providers
  pipeline.js             ← orchestrates steps, tries providers in order
```

**To swap a provider** — for example, replacing ZeroBounce with NeverBounce:
1. Create `src/enrichment/providers/email-verify/neverbounce.js` implementing `verify(email)`.
2. Update `step-registry.js` to point email-verify at `neverbounce.js`.
3. Deploy. No pipeline logic changes needed.

**To add a new fallback provider** — for example, adding Snov.io as a second email fallback:
1. Create `src/enrichment/providers/email-find/snov.js` implementing `findEmail(...)`.
2. Add it to the email-find provider list in `step-registry.js` (after `hunter.js`, before `clay.js`).
3. Done.

### Cross-channel enrichment flow

Each step runs as a background job immediately after the previous one completes. The full sequence from lead creation to "Ready for Outreach" takes under 5 minutes under normal conditions.

```
Source Adapter         Our System          Enrichment Pipeline                              Result
──────────────         ──────────          ───────────────────                              ──────
Companies House  ──►  Lead created   ──►  Step 0: Cache check (D-018)  ──► HIT  ──────►  Ready for Outreach
(name + company)      "Discovered"         key: LinkedIn URL                    (<1 sec)   (no API cost)
                                           or name + domain             ──► MISS ──┐
                                                                                   ↓
                                           Step 1: LinkedIn identify           ProxyCurl ──► LinkedIn URL
                                           (provider registry)                 OR fails ──► Clay queue
                                                                                   ↓
                                           Step 2: Email find                  Apollo.io → Hunter.io
                                           (provider registry)                 OR fails ──► Clay queue
                                                                                   ↓
                                           Step 3: Email verify                ZeroBounce
                                           (provider registry)                 OR fails ──► Clay queue
                                                                                   ↓
                                           Write result to D-018 cache ◄────────────────
                                           (next client with same lead pays nothing)
                                                                                   ↓
                       Lead updated to                                       "Ready for Outreach"
                       "Ready" stage  ◄──────────────────────────────────── (auto-enrol — F-021)
                       Cache hit: <1 sec
                       API fast path: ~5 min
                       Clay fallback: ~hours
```

**Cache hit path (F-022):** If the person is already in D-018 with fresh data, the lead skips steps 1–3 entirely. The cached email, LinkedIn URL, phone, and deliverability status are applied directly to the lead record. API cost: £0.00. This becomes increasingly valuable as client count grows and ICP overlap between clients increases.

**Clay batch fallback:** Any lead that exhausts all direct-API providers at a step is flagged "Pending Clay". Clay's 150+ provider waterfall runs in the next batch cycle and webhooks results back. If Clay also fails, the lead is permanently flagged as unenrichable at that step and admin is notified.

A failure at any step never silently advances a lead to outreach. All attempts are logged in D-015 per step. Cache hits are logged in D-017 as zero-cost events for reporting purposes.

### How to add a new lead source

1. Create a new adapter file (e.g. `src/adapters/apollo.js`).
2. Implement the three methods: `search`, `normalise`, `trigger`.
3. Register the adapter in the source registry (`src/adapters/index.js`).
4. Add the new source's API key to `.env`.
5. The enrichment pipeline, pipeline board, dashboard, and reports all work immediately with the new source — no other files need to change.

### Current adapters

| Adapter | Source | Data it provides at "Discovered" stage |
|---------|--------|----------------------------------------|
| `linkedin.js` | LinkedIn (via Phantombuster) | Full name, job title, company, LinkedIn URL |
| `companies-house.js` | UK Companies House API | Director name, company name, SIC code, region, incorporated date |

### Planned adapters (future)

| Adapter | Source | Notes |
|---------|--------|-------|
| `apollo.js` | Apollo.io | Can be used as both a source (search) and enrichment (email/phone finder) |
| `csv-upload.js` | Manual CSV | Client uploads a spreadsheet of contacts |
| `facebook-ads.js` | Facebook / Instagram Lead Ads | Pulls leads from Facebook Lead Ad forms via the Facebook Marketing API. When a prospect submits a lead form on a Facebook or Instagram ad, the contact details (name, email, phone, company) are pushed to our system in real time via a Facebook webhook. The adapter normalises the form fields and creates a lead at "Discovered" stage. The enrichment pipeline then fills in any missing fields. Requires the client to connect their Facebook Business account via OAuth — OutreachOS stores the page access token server-side. |
| `twitter-ads.js` | Twitter / X Lead Generation Cards | Pulls leads from Twitter/X Lead Generation Card campaigns via the Twitter Ads API. When a prospect submits a lead card, contact details are pushed to our webhook. Similar OAuth flow to Facebook. Note: Twitter/X API access tiers and pricing change frequently — verify current API availability before building. |
| `tiktok-ads.js` | TikTok Lead Generation | Pulls leads from TikTok Lead Generation ads via the TikTok Business API. Real-time webhook delivery of lead form submissions. Requires TikTok Business account OAuth connection. TikTok Lead Generation is most effective for B2C but can work for B2B campaigns targeting founders or directors on the platform. |
| `whatsapp.js` | WhatsApp Business (inbound leads + outreach channel) | **Inbound (lead source):** When a prospect sends a first message to the business WhatsApp number, the adapter creates a lead at "Discovered" stage and logs the initial message as an activity. **Outbound (outreach channel):** The system can also send templated WhatsApp messages to leads enrolled in a WhatsApp-channel campaign, using the WhatsApp Cloud API (Meta). WhatsApp Business template messages must be pre-approved by Meta. Regular session messages can be sent within 24 hours of a prospect responding. **Calls:** WhatsApp also supports voice calls via the WhatsApp API — these can be triggered as an alternative to a VAPI phone call for prospects where a WhatsApp number is available. All via the WhatsApp Cloud API (Meta). Requires per-client WhatsApp Business account OAuth. |

> **Social media ad adapters — implementation note:** Facebook, TikTok, and WhatsApp all use Meta's platform infrastructure and share a similar OAuth + webhook pattern. Building `facebook-ads.js` first creates reusable patterns for TikTok and WhatsApp. Twitter/X should be treated separately due to API volatility. All four require per-client OAuth — the client authorises access to their own ad account or page. OutreachOS does not run the ads; it only reads the leads generated by the client's own campaigns.

---

## Appendix D — Recommended Tech Stack

This appendix records the chosen technology for each layer of the system. Decisions are based on: developer ecosystem maturity, fit for Node.js, security tooling availability, and operational simplicity for a small team.

### Backend

| Component | Technology | Notes |
|-----------|-----------|-------|
| Runtime | Node.js 20 LTS | Long-term support, async-first, large ecosystem |
| Framework | Express.js | Well-documented, middleware model suits the security layer pattern |
| Language | TypeScript | Type-safe provider interfaces (Appendix C), catches errors at compile time |
| ORM | Prisma | Parameterised queries by default (prevents SQL injection), clean schema migrations |
| Input validation | Zod | Runtime schema validation + TypeScript types from one definition |
| Auth | `jsonwebtoken` + `bcryptjs` | JWT access tokens (15 min) + rotating refresh tokens (7 days); bcrypt cost factor 12 |
| HTTP security headers | Helmet.js | Sets CSP, HSTS, X-Frame-Options, X-Content-Type-Options in one call |
| Rate limiting | `express-rate-limit` | Per-IP limits; stricter on `/auth/*` (5 req / 15 min), general API (100 req / min) |
| CORS | `cors` package | Whitelist app domain only; all other origins rejected |
| Background jobs | BullMQ | Redis-backed job queue with retries, delays, priorities — critical for enrichment pipeline |
| HTTP client | Axios | Third-party API calls from background jobs; interceptor-based retry logic |
| Real-time feed | Server-Sent Events (SSE) | Simpler than WebSocket; one-way server→client is sufficient for the activity feed |
| Logging | Pino | Structured JSON logs, low overhead, easily shipped to a log aggregator |
| Error monitoring | Sentry | Captures exceptions with request context and stack traces; alerts on new error types |

### Database and Storage

| Component | Technology | Notes |
|-----------|-----------|-------|
| Primary database | PostgreSQL via Supabase | Managed, row-level security, generous free tier, built-in S3-compatible storage |
| Job queue store | Redis via Upstash | Serverless Redis — no idle server cost; pay-per-request |
| File storage | Supabase Storage | Report PDFs, call recording URLs (signed access only) |

### Frontend

| Component | Technology | Notes |
|-----------|-----------|-------|
| Pages | Static HTML + CSS + JS | No framework migration needed for MVP — existing pages are kept |
| Reactivity | Alpine.js | Lightweight (15 KB) — adds reactive bindings to existing HTML without a full SPA |
| Real-time | `EventSource` (native browser API) | Connects to the SSE endpoint for the live activity feed |
| API calls | `fetch` (native) | All calls go to our own backend; bearer token injected from localStorage |

### Infrastructure — Three environments

The system runs across three environments: local development, staging (GCP), and production (GCP). Each environment is isolated — separate databases, separate credentials, separate Stripe keys (test vs live). No environment shares data or secrets with another.

#### Local development (laptop)

| Component | Technology | Notes |
|-----------|-----------|-------|
| Containerisation | Docker Desktop | Runs Postgres and Redis locally in containers; no cloud costs during development |
| Database | `postgres:16` Docker container | Mapped to `localhost:5432`; data persisted via a named Docker volume |
| Job queue store | `redis:7` Docker container | Mapped to `localhost:6379` |
| App runtime | Node.js on host machine (not in Docker) | Run directly for fast hot-reload with `nodemon`; no Docker rebuild cycle |
| Secrets | `.env` file (gitignored) | All credentials loaded from `.env`; a `.env.example` documents required keys without values |
| Database migrations | `prisma migrate dev` | Runs migrations against the local Docker Postgres on demand |

**Docker Compose setup (`docker-compose.yml` in repo root):**
```yaml
services:
  postgres:
    image: postgres:16
    ports: ["5432:5432"]
    environment:
      POSTGRES_DB: outreachos
      POSTGRES_USER: outreachos
      POSTGRES_PASSWORD: localdevpassword
    volumes:
      - postgres_data:/var/lib/postgresql/data

  redis:
    image: redis:7
    ports: ["6379:6379"]

volumes:
  postgres_data:
```

Start with `docker compose up -d` — Postgres and Redis are ready in seconds. The Node.js app runs on the host with `npm run dev` (nodemon + ts-node).

#### Staging (GCP)

| Component | Technology | Notes |
|-----------|-----------|-------|
| Backend hosting | GCP Cloud Run | Containerised Node.js; scales to zero when idle (no idle cost); billed per request; staging gets 1 container max |
| Database | Supabase (staging project) | Separate Supabase project from production; free tier sufficient for staging |
| Job queue store | Upstash Redis (staging instance) | Serverless Redis; no VPC connector needed (unlike GCP Memorystore) — works natively with Cloud Run; free tier covers staging volumes |
| Container registry | GCP Artifact Registry | Docker images pushed here by GitHub Actions before Cloud Run deployment |
| Secrets | GCP Secret Manager | All environment variables stored here; Cloud Run loads them at startup via Secret Manager bindings — no `.env` files in cloud environments |
| CDN + DDoS | Cloudflare (free tier) | SSL termination; DDoS protection; caches static frontend assets |
| Uptime monitoring | Better Uptime | Monitors staging health endpoints; alerts on downtime |

#### Production (GCP)

| Component | Technology | Notes |
|-----------|-----------|-------|
| Backend hosting | GCP Cloud Run | Same as staging but with higher concurrency limits; min 1 instance to avoid cold starts on production |
| Database | Supabase (production project) | Separate Supabase project; Pro plan for daily backups and higher connection limits |
| Job queue store | Upstash Redis (production instance) | Pay-per-request; production plan |
| Container registry | GCP Artifact Registry | Shared with staging (different image tags: `staging-*` vs `production-*`) |
| Secrets | GCP Secret Manager | Production secrets stored here; separate from staging secrets |
| CDN + DDoS | Cloudflare (Pro tier recommended) | WAF rules for additional protection in production |
| Error monitoring | Sentry | Production error tracking; Sentry's free tier covers early production volumes |
| Uptime monitoring | Better Uptime | Monitors all production endpoints; PagerDuty or Slack alerts on downtime |

#### Why Upstash over GCP Memorystore for Redis

GCP Memorystore (managed Redis) requires a VPC network and a Serverless VPC Access connector to connect to Cloud Run. The connector costs ~$40–60/month even at low traffic — disproportionate for early-stage. Upstash Redis connects over HTTPS with no VPC setup, works immediately with Cloud Run, and costs near-zero at low volumes. It can be swapped for Memorystore later if connection volumes demand it.

#### Why Supabase over Cloud SQL for PostgreSQL

Cloud SQL (managed PostgreSQL on GCP) is the native choice but has a minimum instance cost of ~$10–20/month even when idle. Supabase's free tier covers staging at zero cost, and its Pro plan (~$25/month) is cost-competitive with Cloud SQL for this workload. Supabase also provides a usable web-based DB explorer — useful during active development. It connects to Cloud Run via standard PostgreSQL connection string; no GCP-specific setup needed.

### CI/CD — GitHub Actions

Two pipelines, triggered by branch:

| Branch | Pipeline | Trigger | Action |
|--------|----------|---------|--------|
| `develop` | Staging deploy | Push to `develop` | Build → test → push image → deploy to Cloud Run (staging) |
| `main` | Production deploy | Push to `main` | Build → test → push image → **manual approval gate** → deploy to Cloud Run (production) |

**Staging pipeline steps** (`.github/workflows/deploy-staging.yml`):
1. Checkout code
2. Run TypeScript type check (`tsc --noEmit`)
3. Run tests (`npm test`)
4. Authenticate to GCP (using a GCP service account key stored as a GitHub secret)
5. Build Docker image and push to Artifact Registry with tag `staging-{short-sha}`
6. Deploy to Cloud Run (staging service) using the new image
7. Run Prisma migrations against the staging database (`prisma migrate deploy`)
8. Post deployment status to Slack (or GitHub PR comment)

**Production pipeline steps** (`.github/workflows/deploy-production.yml`):
- Identical to staging steps 1–6, but:
- After the image is built and pushed, the pipeline **pauses and requires a manual approval** from a designated reviewer before deploying to production (using GitHub Actions `environment: production` with required reviewers configured in repo settings)
- This ensures no untested code goes live without a human sign-off

**Branch strategy:**
- `develop` — active development; all feature branches merge here; deploys to staging automatically
- `main` — production-ready code only; promoted from `develop` via a pull request with review

**Secrets in GitHub:**
```
GCP_SERVICE_ACCOUNT_KEY        # JSON key for the GCP service account used by Actions
GCP_PROJECT_ID                 # GCP project ID
GCP_REGION                     # e.g. europe-west2 (London)
GCP_ARTIFACT_REGISTRY_REPO     # e.g. europe-west2-docker.pkg.dev/project-id/outreachos
CLOUD_RUN_SERVICE_STAGING      # Cloud Run service name for staging
CLOUD_RUN_SERVICE_PRODUCTION   # Cloud Run service name for production
```
All application secrets (database URLs, API keys) live in **GCP Secret Manager**, not GitHub secrets. Cloud Run loads them at startup. GitHub only holds the credentials needed to deploy.

### Proxy architecture — LinkedIn outreach

> **Confirmed — proxy provisioning is required.** Heyreach's Starter plan includes a dedicated residential proxy per LinkedIn sender. The Agency and Unlimited plans — which OutreachOS must use in order to manage multiple client accounts and access full white-label API capabilities — require the operator to supply their own proxies. This is not a grey area: it is stated explicitly on Heyreach's pricing page. Proxy provisioning is a confirmed build requirement.

**Why not Cloud Run / GCP instances as proxies:**
Cloud Run instances use GCP data centre IP ranges. LinkedIn's detection systems explicitly flag requests from known cloud provider IP blocks (AWS, GCP, Azure) as potential automation. Using GCP as a proxy layer would be a high-risk approach — accounts could face restrictions within days. The correct solution is residential proxies (IPs registered to real household ISP connections).

**Architecture:**

```
OutreachOS backend (Cloud Run) → Heyreach white-label API
                                         ↓
                          Residential proxy assigned to
                          this LinkedIn account
                          (e.g. Bright Data sticky IP:
                           87.23.45.12 — BT Broadband, London)
                                         ↓
                                     LinkedIn
```

OutreachOS never routes traffic through the proxy directly. The proxy credentials are configured inside Heyreach against each LinkedIn account. Heyreach routes all LinkedIn-bound traffic through the assigned proxy.

**Proxy provisioning:**
- Provider: Bright Data, Smartproxy, or IPRoyal (dedicated residential / mobile proxies)
- Type: **Dedicated sticky residential** (one fixed IP assigned to one account; does not rotate)
- Assignment: one proxy per LinkedIn account connected to Heyreach
- Consistency: the same proxy IP is used for every session for that account — LinkedIn expects consistent IP behaviour from a given account
- Cost: approximately £5–15/month per proxy depending on provider and bandwidth

**Admin panel proxy management (S-013 addition):**
The Admin Panel must include a LinkedIn proxy management section:
- List of all configured LinkedIn accounts in Heyreach with their assigned proxy
- Proxy health status (active / error — pulled from Heyreach's account status)
- Ability to assign or reassign a proxy to a LinkedIn account
- Alert if an account shows no proxy assigned (block it from being used for outreach)

**Important:** Do not use rotating residential proxies for LinkedIn. Rotating proxies change IP on each request. LinkedIn sessions are expected to come from a consistent IP — rotation defeats the purpose and triggers security flags. Sticky/dedicated proxies only.

| Component | Technology | Notes |
|-----------|-----------|-------|
| CDN + DDoS | Cloudflare | Free tier for staging; Pro recommended for production |
| Uptime monitoring | Better Uptime | Monitors all critical endpoints across staging and production |

### Security tooling summary

| Threat | Defence |
|--------|---------|
| Unauthenticated API access | JWT middleware on every route — no unprotected data endpoint exists |
| Brute-force login | Rate limit: 5 attempts / 15 min per IP; account locked after 5 failures |
| SQL injection | Prisma parameterised queries — no raw SQL string interpolation |
| XSS | `Content-Security-Policy` header via Helmet; no `innerHTML` with user data |
| CSRF | Stripe and webhook endpoints verified by signature; dashboard uses JWT not cookies |
| Credential exposure | All secrets in `process.env`; never logged, never returned in API responses |
| Man-in-the-middle | HTTPS enforced at platform level + HSTS header (1 year) |
| Insecure direct object reference | Every DB query scoped by `client_id` from JWT — not from request params |
| Sensitive data in logs | Pino redact config strips `password`, `token`, `apiKey` fields before writing |
| Webhook spoofing | Signature verified (HMAC-SHA256) before payload processed — invalid = 400 + logged |
