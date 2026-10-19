# PRD area 05: Messages, Workflows and Inbox

Date: 2026-10-18. Builder B1. Status: draft for Opus review.

## 1. Scope

This file covers:
- Gap matrix 1.6 Messages (MS-01 to MS-13). F-IDs F-450 to F-499.
- Gap matrix 1.18 Workflows (WF-01 to WF-15). F-IDs F-500 to F-549.
- Gap matrix 1.17 Inbox (IB-01 to IB-07). F-IDs F-550 to F-599. This includes the rep inbox and the delivery agent inbox, and customer message tracking (locked decision 13).
- Auto-confirm by WhatsApp or SMS (locked decision 6).
- Broken items (matrix section 3): #3, #4, #13, #14, #15, #40, #43.
- Mockup fixes (matrix section 4): #9, #18, #28.

Screens: `messages.html` (Conversations, Scheduled, Bulk send, Campaigns, Templates, Opt-outs), `workflows.html` (list, builder), `inbox.html` (feed, Reminders, Team threads, Assigned to me, Notification settings), the Inbox views inside `rep.html` and `agent.html`, public unsubscribe page, public confirm page.

Roles:
- Owner (`super_admin`), `admin`: full access to all three areas.
- `manager`: Messages (view, send), Workflows (view, run), Inbox.
- Call rep (`sales_rep`): own Inbox (rep app). Replies to customers on WhatsApp from the Conversations page (decision P5), limited to conversations assigned to them (F-454).
- Delivery agent (`delivery_agent`): own Inbox (agent app).
- Accountant, inventory manager: own Inbox only.
- AI agents hold roles and can receive assignments. They have no Inbox UI.

Decisions used: decision 6 (auto-confirm by WhatsApp or SMS, queue timer, time to first call), decision 13 (Inbox holds notifications, reminders and team threads; reps and agents have own inboxes; customer messages are tracked: sent, delivered, read, failed, replied), D3 and O4 (build "By region" assign as a Workflow: condition "Region is X", action "Assign to", split Evenly or Weighted; G7 and P8 are replaced), G5 and D6 (operating hours), G10 (suggestion cards never change data in release one), D9 (cash reward tiers only).

Terms:
- "Message" means one SMS, WhatsApp or email.
- "Conversation" means all messages with one customer.
- "24-hour window" means the WhatsApp rule: free-form messages are allowed only within 24 hours after the customer's last message. After that only an approved template can start a message.
- "Template" means saved message text. A "WhatsApp approved template" is one that Meta approved.
- "Run" means one execution of a workflow.

Words to avoid: the Messages overview must not use a name for the share of delivered messages that clashes with the order KPI names. The current overview card uses such a name (see the wording guard F-112 in file 01). Use "Delivered" with "% of sent" (F-455).

---

## 2. Requirements: Messages (F-450 to F-499)

### F-450: Message data model: events, replies, conversations, campaigns
- Priority: P0. Milestone: M9.
- Description: To track sent, delivered, read, failed and replied (decision 13) the app needs a full history per message, a place to keep inbound messages, and a conversation record per customer. Campaign counters must also survive log clean-up.
- Current app: `MessageLog` (channel, direction, status `pending|sent|delivered|read|failed|skipped`, `sentAt`, `deliveredAt`, `readAt`, `providerMessageId` unique, `campaignId`). `EmailCampaign` (email only). `message-log-cleanup` job deletes logs older than 90 days. Inbound WhatsApp messages are logged to the console only (`whatsappController.ts` line 104).
- Mockup: `messages.html` bubbles with status Sent, Delivered, Read, Failed, Replied.
- Acceptance criteria:
  - [ ] `MessageStatus` adds `replied`. A message status moves only forward: `pending` < `sent` < `delivered` < `read` < `replied`. `failed` and `skipped` are separate end states. A late "delivered" event after "read" does not lower the status.
  - [ ] New `MessageEvent` {tenantId, messageLogId, event (`sent`, `delivered`, `read`, `failed`, `replied`), at, providerCode, raw JSON}. One row per event, unique on `(messageLogId, event)`. `MessageLog` keeps `sentAt`, `deliveredAt`, `readAt` and adds `repliedAt`, `failureReason`, `failedAt`.
  - [ ] `failureReason` enum: `no_whatsapp`, `network`, `opted_out`, `outside_window`, `template_error`, `invalid_number`, `provider_error`, `other`.
  - [ ] New `Conversation` {tenantId, customerId (nullable for an unknown number), phone, assignedToId, status (`open`, `done`), lastInboundAt, lastOutboundAt, lastMessagePreview, unreadCount, windowExpiresAt, linkedOrderId}. One per customer (or per unknown number).
  - [ ] `EmailCampaign` becomes `Campaign` with `channel` (`sms`, `whatsapp`, `email`), `status` (`draft`, `scheduled`, `queued`, `sending`, `completed`, `cancelled`), `scheduledAt`, `templateId`, `audienceFilter` JSON, `createdById`, and stored counters: `sentCount`, `deliveredCount`, `readCount`, `repliedCount`, `failedCount`, `ordersAfterCount`, `ordersAfterValue`. Existing rows become `channel = email`.
  - [ ] Campaign counters are written to the campaign row as events arrive. They are not recomputed from logs, so clean-up does not change them.
  - [ ] Log retention: `MESSAGE_LOG_RETENTION_DAYS` default rises from 90 to 365 so a conversation and its tracking last a year (check storage cost; GUESS that the table stays small at the current volume of about 4,000 messages a month). `MessageEvent` rows are deleted with their message.
  - [ ] All new models have a required `tenantId` and are in the tenant-scoped list (file 03, F-363).
- Data: as listed. API: see the later requirements.
- Permissions: not applicable (data).
- Edge cases and errors: events can arrive before the "sent" call returns. The writer uses `upsert` on `(messageLogId, event)`. An event for an unknown provider message id is stored in a holding table for 1 hour and matched when the log row appears; after that it is dropped with a warning.
- Tests: unit test of the status ladder; migration test for `EmailCampaign` → `Campaign`; test that a late event does not lower the status.

### F-451: Messaging provider interface
- Priority: P1. Milestone: M9.
- Description: Design doc 8.3 says to build a provider interface (`send`, `status webhook`, `inbound`) so a second provider can be added. Arkesel (SMS) and the Meta WhatsApp Cloud API stay for the owner's business. Email already switches between SendGrid, Resend and SMTP in `emailService`.
- Current app: `smsService.ts` (Arkesel), `whatsappService.ts` (Cloud API v21.0, template and text sends, SMS fallback), `emailService.ts`.
- Mockup: `connections.html` cards for Arkesel SMS, WhatsApp Business and Email (area C).
- Acceptance criteria:
  - [ ] One interface `MessagingProvider`: `channel`, `send({to, kind: template | text, template?, params?, body?, replyToProviderId?})`, `verifyWebhook(req)`, `parseStatus(payload)`, `parseInbound(payload)`.
  - [ ] Adapters: `ArkeselSmsProvider`, `WhatsAppCloudProvider`. Email keeps its own provider switch behind the same `send`.
  - [ ] All sends (workflows, bulk, auto-confirm, one-to-one replies, reminders to staff) go through one `messageService.send()`. It checks opt-out, the 24-hour window, the template approval status and the phone format (file 03, F-362). It writes the `MessageLog` row and returns it.
  - [ ] The SMS fallback after a WhatsApp failure (exists today for order templates) stays and is written as a second `MessageLog` row linked to the first (`fallbackOfId`).
  - [ ] A fake provider exists for tests.
  - [ ] The messaging wallet, top-up and per-seller WhatsApp onboarding are not built (seller SaaS, non-goal).
- Data: `MessageLog.fallbackOfId Int?`, `MessageLog.provider String`.
- API: none public.
- Permissions: not applicable.
- Edge cases and errors: a provider that is disabled makes `send` return a `skipped` log row with reason `provider_disabled`. It never throws to the caller.
- Tests: unit tests with the fake provider; contract tests per adapter with mocked HTTP.

### F-452: Inbound WhatsApp messages and reply tracking
- Priority: P1. Milestone: M7 (core, needed for auto-confirm buttons), M9 (conversations and Inbox).
- Description: Customers reply on WhatsApp. Today the app logs these and drops them. Store them, link them to the customer and the message they answer, mark that message `replied`, and tell the right person. Two-way chat on SMS is not assumed (see edge cases).
- Current app: `POST /api/whatsapp/webhook` verifies the HMAC signature with the app secret, handles `statuses`, and logs `messages` only. The route is global, not per tenant.
- Mockup: `messages.html` Conversations; Inbox rows "Abena Owusu replied"; Rep inbox row "WhatsApp reply from a customer".
- Acceptance criteria:
  - [ ] The webhook reads `metadata.phone_number_id` from the payload to find the tenant. Add a unique indexed column `SystemConfig.whatsappPhoneNumberId` (copied from the provider JSON) for this lookup. The signature is checked with that tenant's app secret (or the platform app secret for the Meta login mode), using the raw body. An unknown phone number id is ignored with a warning.
  - [ ] For each inbound message: create a `MessageLog` row (`direction = inbound`, `providerMessageId` = the `wamid`, so repeats are ignored), update or create the `Conversation`, set `lastInboundAt`, `windowExpiresAt = lastInboundAt + 24 hours`, increase `unreadCount`.
  - [ ] Customer match: compare the sender number with `Customer.phoneNumber` and `alternatePhone` after normalizing (file 03, F-362). No match → a `Conversation` with `customerId = null` and the number. The page shows "Unknown number" and a button "Create customer".
  - [ ] Reply link: if the payload has `context.id`, the message with that `providerMessageId` gets `status = replied`, `repliedAt` and a `MessageEvent`. If there is no context, the newest outbound message to that customer in the last 24 hours gets it.
  - [ ] Message types: text → the text; `button` or `interactive` → the button title and payload; image, audio, video, document, location, sticker → the placeholder text "[image]" and so on (media download is not built; P3).
  - [ ] The keywords STOP, UNSUBSCRIBE (any case) set the WhatsApp opt-out with reason "Replied STOP" (F-462) and send one free-form reply "You are unsubscribed. We will not message you again." The reply is allowed because the window is open.
  - [ ] Button payloads that belong to auto-confirm go to the auto-confirm handler first (F-466).
  - [ ] A notification `customer_replied` goes to the conversation assignee, else the order's call rep, else the owner (F-557).
  - [ ] The webhook answers HTTP 200 at once and processes after (as today). Errors are logged and do not cause retries to pile up.
  - [ ] A customer reply sets `Order.firstContactAt` only when it is a YES to the auto-confirm message (file 03, F-304, decision R10). Other replies do not set it.
- Data: `SystemConfig.whatsappPhoneNumberId` (unique); `Conversation`, `MessageLog` fields from F-450.
- API: `POST /api/whatsapp/webhook` (public, signed).
- Permissions: public, signature protected.
- Edge cases and errors:
  - SMS replies: GUESS that Arkesel does not return customer replies for a normal sender ID. Check the Arkesel documentation for two-way SMS (a dedicated number or short code may be needed). Until checked, only WhatsApp replies are tracked. SMS replies would need a second inbound route and are P3.
  - The sender writes from a different number than the stored one: the message goes to "Unknown number". Staff can link it to a customer ("Link to customer" button).
  - A customer sends many messages quickly: one notification per conversation per 5 minutes (group them).
  - Reps who answer from their own phone with `wa.me` links are outside the system. Their replies are not tracked.
- Tests: signature tests; payload fixtures for text, button, image, status; idempotency test with a repeated `wamid`; STOP keyword test; two-tenant routing test.

### F-453: Message status events (sent, delivered, read, failed)
- Priority: P1. Milestone: M9.
- Description: Provider status callbacks update each message and write `MessageEvent` rows. Failure reasons are mapped to the list in F-450 so the page can say "6 went to numbers without WhatsApp".
- Current app: `whatsappService.processStatusUpdate(id, status, timestamp)`; `smsService.processStatusUpdate(messageId, status)` from `POST /api/sms/webhook`.
- Mockup: `messages.html` KPI "Failed today 9 (6 no WhatsApp · 3 network)"; bubble statuses; failed note with "Resend as SMS" or "Try again".
- Acceptance criteria:
  - [ ] WhatsApp statuses `sent`, `delivered`, `read`, `failed` update the log and add an event with the provider timestamp. For `failed`, store the provider error code and title in `MessageEvent.providerCode` and map to `failureReason`.
  - [ ] Mapping (GUESS: check each code in the Meta WhatsApp Cloud API error code list before build): code 131026 (message undeliverable, number not on WhatsApp) → `no_whatsapp`; code 131047 (outside the 24-hour window) → `outside_window`; template errors (132000 range) → `template_error`; other codes → `provider_error`.
  - [ ] Arkesel delivery reports update SMS logs. GUESS: the status strings that Arkesel sends (check the Arkesel documentation). Unknown strings are stored in `providerCode` and the message stays `sent`.
  - [ ] A failed WhatsApp message with reason `no_whatsapp` triggers the SMS fallback when the template has an SMS version (as today for order templates).
  - [ ] "Try again" resends the same text on the same channel (new log row linked by `retryOfId`). "Resend as SMS" sends the plain text by SMS. Both need the customer not opted out.
  - [ ] The page shows each status in the bubble: Sent, Delivered, Read, Failed (with the reason in plain words), Replied.
- Data: fields from F-450; `MessageLog.retryOfId`.
- API: `POST /api/messages/:id/retry`, `POST /api/messages/:id/resend-sms`.
- Permissions: `communications:send` (owner, admin; manager as today).
- Edge cases and errors: a status for a message older than the retention is ignored.
- Tests: fixtures for each status; mapping tests; fallback test.

### F-454: Conversations screen
- Priority: P1. Milestone: M9.
- Description: A two-way inbox for customer messages. The owner and managers read, assign, answer and follow up. Reps use the call card and rep inbox (F-558). This screen replaces the History tab as the default view.
- Current app: none (outbound log only, `Communications.tsx` History tab).
- Mockup: `messages.html#p-conv`. Tabs: Conversations 38, Bulk send, Campaigns 6, Templates 8, Opt-outs 27 (plus Scheduled). Status switch All / Unreplied / Failed / Scheduled 41; channel chips (All channels, WhatsApp, SMS). Thread list rows. Thread pane with header, bubbles, compose row. Side pane: Linked order, Assigned to, Customer, Team notes.
- Acceptance criteria:
  - [ ] Thread list: customer name (or number), last message text, time, channel icon, order number, tag Replied or Failed. Empty state: "No conversations match."
  - [ ] "Unreplied" = the last message is inbound and no outbound message came after it and the conversation is `open`. "Failed" = the last outbound message failed. "Scheduled" opens the Scheduled view (F-463).
  - [ ] The Conversations tab badge shows the number of unreplied conversations (matrix section 4 #18: tab said 38, list showed 26). The list header shows the exact count of the list.
  - [ ] Thread pane: bubbles with time, status, and "by <team member>" for staff-sent messages. Failed bubbles show the reason and the buttons "Resend as SMS" or "Try again" (F-453).
  - [ ] Compose: channel switch (WhatsApp or SMS), "Insert template" (works: lists templates for the channel, F-461), text box, Send. WhatsApp free text is allowed only while the window is open. When it is closed the compose box shows "More than 24 hours since the customer wrote. Send an approved template." and lists approved templates only.
  - [ ] Sending a message from this page does not set `Order.firstContactAt`. Only a rep call attempt, or a customer YES to auto-confirm, sets it (file 03, F-304, decision R10).
  - [ ] A call rep can open this page, see the conversations assigned to them and reply on WhatsApp (decision P5). A rep sees no other conversation. The 24-hour rule in the compose row applies to reps too.
  - [ ] Mark done / Reopen button. A new inbound message reopens a done conversation.
  - [ ] Side pane: Linked order (the customer's newest open order, else the newest order; number, status, product, delivery partner, "Open order" opens the drawer in file 03, F-321); Assigned to (select: staff who hold the Call rep role, plus Manny); Customer (phone, region, orders, last channel); Team notes (link with "n replies" or "Add a note", F-553 customer thread); "Set reminder" popover (what, when, who) using F-552.
  - [ ] Assigning a conversation sends the assignee a notification (`order_assigned` family, text "Conversation with Abena Owusu was assigned to you").
  - [ ] Unknown numbers show "Create customer" and "Link to customer".
  - [ ] Realtime: new inbound messages appear without reload (socket, tenant-scoped room).
- Data: `Conversation` (F-450).
- API: `GET /api/conversations?filter=&channel=&q=`, `GET /api/conversations/:id/messages`, `POST /api/conversations/:id/messages`, `PATCH /api/conversations/:id` (assign, done).
- Permissions: view and send: owner, admin, manager. Call reps can reply on WhatsApp (decision P5): add `communications:reply` for the Call rep role and show reps only conversations assigned to them. Delivery agents: no access.
- Edge cases and errors:
  - Two people reply at once: both messages send. The second sender sees the first in the thread (socket). No lock.
  - A customer with an opt-out for WhatsApp can still reply to us. We may answer inside the window because they wrote first, but a bulk send would skip them.
  - Very long threads load the newest 50 messages and load more on scroll.
- Tests: component tests for each filter; integration tests for the window rule and assignment; e2e: inbound fixture appears in Unreplied, reply sends, status updates.

### F-455: Overview figures
- Priority: P1. Milestone: M9.
- Description: A row of tiles at the top of Messages. Every figure comes from message events and has one definition, so totals agree across tiles, tables and campaigns (matrix section 4 #18: tile said 2,860 sent, campaigns alone sent 4,070).
- Current app: Overview tab cards Total, Delivered, Failed, a fourth card for the delivered share (its name is banned by F-112), and "Messages by Channel". `GET /api/communications/stats`.
- Mockup: tiles: Messages sent in October 2,860 (1,940 WhatsApp, 920 SMS, GH₵312); Delivered 94% (63% of WhatsApp read); Customer replies 312 (reply rate 11%, 14 not answered); Failed today 9 (6 no WhatsApp, 3 network).
- Acceptance criteria:
  - [ ] Period selector: This month (default), Last 7 days, Last month, Custom.
  - [ ] Sent = outbound messages with `sentAt` in the period, by channel. This includes workflow, bulk, auto-confirm and one-to-one messages. The sum of the channel figures equals the tile.
  - [ ] Delivered = outbound messages whose status reached `delivered`, `read` or `replied`, divided by sent. Label: "Delivered" with the sub line "% of sent". The banned order-KPI name is not used for this tile (F-112). Sub line: "63% of WhatsApp messages read" = read ÷ WhatsApp messages delivered.
  - [ ] Estimated cost = sum over messages of the unit price the owner entered per channel in Connections (F-457). The tile says "Estimated" and shows nothing if no price is set. Prices are not hard coded (the mockup's GH₵0.06 per SMS part and GH₵0.15 per WhatsApp message are samples; design doc 8.3 marks prices UNVERIFIED).
  - [ ] Customer replies = customers (not messages) who sent an inbound message in the period. Reply rate = customers who replied ÷ customers who were sent a message in the period. "Not answered" = unreplied conversations (F-454).
  - [ ] Failed today = outbound messages that failed today, split by `failureReason`.
  - [ ] An auto-confirm line: sent, confirmed by the customer (%), said no, no answer (F-466).
  - [ ] A test fixture proves: tile Sent = sum of channels = rows in the Message log (F-456) for the same period.
- Data: none new.
- API: `GET /api/communications/stats?from=&to=` (extended).
- Permissions: owner, admin, manager.
- Edge cases and errors: no messages → tiles show 0 and "No messages yet". Percent figures with a zero denominator show "—".
- Tests: integration test on a fixture where totals are known; test that the three figures agree.

### F-456: Message log
- Priority: P2. Milestone: M9.
- Description: A flat list of every message, sent and received, with filters. The Conversations view groups by customer. Staff still need the full log to answer "did customer X get the message?" The mockup has no log. Add it as the last page tab "Message log".
- Current app: History tab with filters (Channel All/WhatsApp/SMS, Status, dates) and a table (Date, Channel, Recipient, Template, Status, Message).
- Mockup: not in mockup (matrix MS-03). Build in v2 style: a table inside a card with the filter row above.
- Acceptance criteria:
  - [ ] Filters: channel (WhatsApp, SMS, Email), direction, status (all statuses), failure reason, campaign, date range, search by customer name, phone or order number.
  - [ ] Columns: Date, Channel, Direction, Customer, Template, Status, Message (first 80 characters), Order.
  - [ ] A row click opens the conversation (WhatsApp, SMS) or a read-only preview (email).
  - [ ] 50 rows per page, newest first. Sorting by date only.
  - [ ] Export is not in release one.
- Data: none new. API: `GET /api/communications/messages` (extended filters).
- Permissions: owner, admin, manager.
- Edge cases and errors: a message sent to a deleted customer shows the stored phone.
- Tests: integration test of filter combinations.

### F-457: Bulk send (SMS, WhatsApp, email)
- Priority: P1. Milestone: M9.
- Description: Send one message to many customers. The page shows who will get it, what it costs and what it may bring back. It can send now, schedule, or send a test to the sender.
- Current app: Bulk Send tab: channel selector; SMS template or text; WhatsApp template key (5 keys) with optional link; recipient filters (state/area text, product, one checkbox); "Preview Recipients"; `POST /bulk-sms`, `/bulk-whatsapp`, `/bulk-email`.
- Mockup: `messages.html#bulk`. Fields: Channel (SMS via Arkesel sender ID, WhatsApp from a number, Email via provider); Message source (template or write my own); Email subject; Text with insert tags; Custom link (WhatsApp); Who gets it: Region, Bought, Has ordered before. Summary card: Will be sent to, Match your filters, Removed: opted out, Parts per message, Cost estimate, Expected orders, phone preview "Preview as Ama Mensah", character count. Buttons: Send now, Schedule, Send a test to me.
- Acceptance criteria:
  - [ ] Audience filters: Region (the regions of the store's country, multi-select; file 04, F-413), Bought (any product, or pick products), Has ordered before (Anyone, Yes bought again, No one order only), Last order within N days, Risk level (exclude High risk: checkbox), Delivered at least once (checkbox).
  - [ ] Removed automatically: customers opted out of the channel, customers with no phone or email for the channel, duplicate phone numbers. The summary shows each count.
  - [ ] SMS: show parts per message (160 characters per part; 70 for text with non-GSM characters) and total parts.
  - [ ] Cost estimate = recipients × parts × the unit price set by the owner in Connections for that channel. No price set → "Add a price in Connections to see the cost."
  - [ ] Expected orders = recipients × the average orders-after rate of the owner's past completed campaigns on this channel (F-460). With fewer than 3 past campaigns the line is hidden. It is never a fixed number.
  - [ ] Phone preview renders the message for one real customer from the audience with the merge tags filled. A "Preview as" select picks another customer.
  - [ ] WhatsApp: outside the 24-hour window only approved templates can be sent (marketing category for promotions). The page lists approved templates only, with their approval status. Free text is not offered. Template variables map to merge tags (F-461).
  - [ ] Send now: a confirm dialog "Send to 4,180 customers?" (file 03, F-328 pattern). Creates a `Campaign` and queued jobs. Jobs respect provider rate limits (a queue with a concurrency setting per provider).
  - [ ] Schedule: date and time in Africa/Accra, at least 5 minutes ahead and not more than 90 days ahead. Opt-outs are checked again at send time.
  - [ ] Send a test to me: sends one message to the user's own phone or email (Profile). It is logged as a test message, is not part of any campaign and is not counted in totals.
  - [ ] Merge tags: `{{customer_name}}`, `{{order_number}}`, `{{order_total}}`, `{{store_name}}`, `{{customer_email}}`, `{{unsubscribe_url}}`. Email gets the unsubscribe footer and headers automatically.
  - [ ] Draft: the form can be saved as a draft campaign and finished later (F-460 "Finish and send").
  - [ ] Suggestion-card "Draft the offer" from Customers (file 03, F-358) opens this page with the audience prefilled and no text.
- Data: `Campaign` (F-450); `SystemConfig.messagePrices {sms, whatsapp, email}` (Decimal, per message or per part, currency of the store).
- API: `POST /api/communications/audience/preview` {filters} → counts and the first 50 recipients; `POST /api/communications/campaigns` {channel, templateId or body, subject, filters, scheduledAt?, sendNow?}; `POST /api/communications/test-send`.
- Permissions: owner, admin (send); manager can build drafts and cannot send (GUESS; today the bulk routes allow `sa, ad` only).
- Edge cases and errors:
  - WhatsApp business-initiated messages are limited per day for each business number (GUESS: a new number starts near 250 customers a day; check "Messaging limits" in WhatsApp Manager). The page shows the limit if the Cloud API returns it, and warns when the audience is larger. Messages over the limit fail with a reason and are listed in the campaign.
  - Provider outage mid-send: the campaign shows "sending" with a count; failed rows can be retried in one click.
  - Recipient count of 0 disables the send buttons.
- Tests: audience filter tests (each filter, opt-out removal, duplicate removal); SMS parts unit test; schedule validation tests; e2e: preview, test send, schedule.

### F-458: Recipient preview table
- Priority: P2. Milestone: M9.
- Description: The mockup shows only a count. Staff should see who is in the audience before sending (existing feature).
- Current app: "Preview Recipients" button and table.
- Mockup: count only (matrix MS-05).
- Acceptance criteria:
  - [ ] A "Show who gets it" link under the summary opens a table: name, phone or email, region, last order date, orders. First 50 rows with a page control. Search by name or phone.
  - [ ] The table shows removed customers on a second tab "Removed (opted out, no number)" with the reason.
  - [ ] A person can untick a recipient to exclude them from this send. The count updates.
- Data: `Campaign.excludedCustomerIds` JSON (kept for the record).
- API: `POST /api/communications/audience/preview` (F-457) with paging.
- Permissions: as F-457.
- Edge cases and errors: an audience over 20,000 shows the first page only and exact counts.
- Tests: component test; integration test of exclude.

### F-459: Email composer
- Priority: P2. Milestone: M9.
- Description: Keep the email composer features. The mockup shows plain text with tags for email.
- Current app: `EmailComposer`: campaign title, starter templates (Announcement, Promo / Sale, Re-engagement), subject, HTML body, merge tag toolbar, live preview, audience filters, "Check eligibility" (audienceTotal, emailable, noEmail, optedOut), send with confirm.
- Mockup: Bulk send with Channel = Email: subject and text with insert tags.
- Acceptance criteria:
  - [ ] Default editor is plain text with tag buttons (as the mockup). A switch "Edit HTML" opens the current HTML editor with live preview.
  - [ ] Starters stay (Announcement, Promo, Re-engagement). They are saved templates in F-461.
  - [ ] HTML is cleaned on save (the existing sanitizer). Scripts and event attributes are removed.
  - [ ] Eligibility numbers show in the summary card (F-457): total, with email, no email, opted out.
  - [ ] Every email has a visible unsubscribe link, the `List-Unsubscribe` and `List-Unsubscribe-Post` headers (one-click), and skips placeholder addresses ending in `@codadminpro.com` (as today).
  - [ ] Sends go through the email campaign queue, one job per recipient, with the existing retry and backoff.
- Data: none new. API: existing (`/email-audience`, `/bulk-email`) behind the new campaign API.
- Permissions: as F-457.
- Edge cases and errors: an email body over 100 KB is refused. A subject over 150 characters is refused.
- Tests: sanitizer tests; header test; placeholder skip test.

### F-460: Campaigns
- Priority: P1. Milestone: M9.
- Description: A list of every bulk send with its results. Staff see what worked and how many orders followed.
- Current app: Campaigns tab (email only): Campaign, Status, Audience, Emailable, Waiting, Sent, skipped detail.
- Mockup: filters (channel, status, date). Columns: Campaign, Channel, Date, Sent, Delivered, Read, Replied, Failed, Orders after. 6 rows. Draft row with "Finish and send".
- Acceptance criteria:
  - [ ] Columns as in the mockup. Counters come from the stored campaign counters (F-450).
  - [ ] Orders after = orders placed (any status except `cancelled` at the time of counting is not applied: count all orders not deleted) by customers who were sent this campaign, created within 3 days after the send start, with their total value in the store currency. The column heading is "Orders after send". It is not called "attributed" because other causes may exist.
  - [ ] Status: Draft, Scheduled, Sending, Completed, Cancelled. A scheduled campaign can be cancelled before it starts.
  - [ ] Row click opens a detail drawer: message text, audience filter, per-recipient status list (search, filter by status), "Retry failed" button.
  - [ ] "Finish and send" on a draft opens Bulk send with the saved data.
  - [ ] Totals row at the bottom for the filtered set.
- Data: `Campaign` (F-450).
- API: `GET /api/communications/campaigns`, `GET /api/communications/campaigns/:id`, `POST /api/communications/campaigns/:id/cancel`, `POST /api/communications/campaigns/:id/retry-failed`.
- Permissions: view: owner, admin, manager.
- Edge cases and errors: the orders-after job runs 4 days after the send and updates the counter once (and nightly for 7 days). Before that the cell shows "Counting".
- Tests: integration test of the orders-after rule on a fixture with an order at day 2 and one at day 4.

### F-461: Templates (SMS, WhatsApp, email) and the old notification templates
- Priority: P1. Milestone: M9.
- Description: One Templates page for all channels. It shows email templates that have no UI today, keeps SMS CRUD, and handles WhatsApp in two kinds: approved templates (synced from Meta) and free-text quick replies. The unmounted `MessageTemplates` component and the `notificationTemplates` setting are retired.
- Current app: SMS template CRUD (`/sms-templates`). `emailTemplateService` (list, create, update, delete, seeds defaults) has no UI. `SettingsMessageTemplates` component is built but not mounted. `SystemConfig.notificationTemplates` JSON (8 textareas; GUESS unused).
- Mockup: `messages.html#tpl`: grid of 8 cards (name, channel tag, body with `{{tags}}`, where used, Edit, Use in bulk send); New template modal (name, channel, body, insert tags: Customer name, Order number, Order total, Store name).
- Acceptance criteria:
  - [ ] Cards show name, channel, body, "Used in" (workflows, auto-confirm, scheduled sends that use it) and buttons Edit and "Use in bulk send".
  - [ ] SMS and email templates: full create, edit, delete. Email has subject and body.
  - [ ] WhatsApp approved templates: a "Sync from WhatsApp" button reads the approved list from the business account (`message_templates`), stores `providerTemplateName`, `languageCode`, `category` (utility, marketing, authentication), `approvalStatus` (approved, pending, rejected) and the body. They are read-only in the app, except the mapping of numbered variables to merge tags. New templates are created in Meta Business Manager (in-app creation is not built).
  - [ ] WhatsApp quick replies: free-text templates for use inside the 24-hour window. Full CRUD.
  - [ ] Merge tags in one syntax: `{{customer_name}}`, `{{order_number}}`, `{{order_total}}`, `{{store_name}}`, `{{customer_address}}`, `{{customer_email}}`, `{{unsubscribe_url}}`. The older camel case forms in workflows (`{{orderNumber}}`) are accepted as aliases (see F-509).
  - [ ] A template that a workflow, scheduled send or auto-confirm uses cannot be deleted. The message lists those uses.
  - [ ] Default templates are seeded for each tenant (as `emailTemplateService` does for email).
  - [ ] Migration (matrix section 3 #4): first confirm the backend does not read `SystemConfig.notificationTemplates`. Then copy any non-empty entry into SMS or email templates named "Order confirmation (SMS)" and so on, and delete the `SettingsMessageTemplates` component and the setting (decision R8).
  - [ ] Wire `emailTemplate.service.ts` in the frontend (matrix section 3 #43).
  - [ ] `SmsTemplate.name` is unique per tenant (file 03, F-363).
- Data: `MessageTemplate` replaces `SmsTemplate` and `EmailTemplate` over time: {tenantId, channel, name, subject?, body, kind (`standard`, `quick_reply`, `approved`), providerTemplateName?, languageCode?, category?, approvalStatus?, variableMap JSON}. A migration copies both old tables. (If the team prefers to keep two tables for release one, the API must still return one list.)
- API: `GET/POST/PUT/DELETE /api/message-templates`, `POST /api/message-templates/sync-whatsapp`.
- Permissions: view: owner, admin, manager. Edit: owner, admin.
- Edge cases and errors: a rejected WhatsApp template shows its status and cannot be picked for sends. Sync failure shows the Meta error text.
- Tests: CRUD tests; sync test with a mocked response; delete-block test; migration test for the old setting.

### F-462: Opt-outs
- Priority: P1. Milestone: M9.
- Description: A list of customers who opted out, why and when. Staff can change a switch. Every change is recorded. Opt-out words in replies and the unsubscribe link write the same records.
- Current app: Opt-outs tab: Name, Phone, SMS Opt-out toggle, WhatsApp Opt-out toggle; `PATCH /opt-out/:customerId`; `Customer.smsOptOut`, `whatsappOptOut`, `emailOptOut`.
- Mockup: search; table Customer, Region, Opted out (date), Reason (Replied STOP, Unsubscribe link, Asked on a call), SMS off, WhatsApp off. "Showing 8 of 27".
- Acceptance criteria:
  - [ ] Add an Email off column (the flag exists and the unsubscribe link sets it).
  - [ ] New `OptOutEvent` {tenantId, customerId, channel, action (`opt_out`, `opt_in`), reason (`replied_stop`, `unsubscribe_link`, `asked_on_call`, `staff`, `other`), note, byId, at}. The table shows the newest event per customer and channel.
  - [ ] Switching a channel off needs a reason (default "Asked on a call"). Switching on needs a note and the role manager or above.
  - [ ] STOP replies (F-452) and the unsubscribe page (F-465) create events automatically.
  - [ ] The counts ("27") come from the customer flags: customers with at least one channel off.
  - [ ] Sends check the flag at send time (bulk, workflow, auto-confirm, scheduled). One-to-one replies inside an open window are allowed.
  - [ ] Search by name or phone. 25 rows per page.
- Data: `OptOutEvent`; flags on `Customer` stay.
- API: `GET /api/communications/opt-outs`, `PATCH /api/communications/opt-out/:customerId` {channel, off, reason, note}.
- Permissions: view: owner, admin, manager. Change: owner, admin, manager.
- Edge cases and errors: opt-out applies per phone number. A second customer record with the same number (before F-362) is not covered; the F-362 report lists them.
- Tests: event tests for each source; send-time check test.

### F-463: Scheduled sends
- Priority: P2. Milestone: M9.
- Description: A page that shows what will be sent later: scheduled campaigns and messages that workflows will send (a schedule trigger, or a wait action). Staff can preview, pause and resume. The backend has no message scheduler today and the time-based workflow trigger never fires.
- Current app: none.
- Mockup: `messages.html#sched`. Table: Goes out, Workflow (link), Template, Channel, Customers, Status (Scheduled or Paused), Actions (Preview, Pause or Resume). Note: "opted-out customers are removed; edit when and to whom in Workflows".
- Acceptance criteria:
  - [ ] A `ScheduledMessage` row exists for each planned message {tenantId, source (`campaign` or `workflow`), sourceId, executionId?, customerId, orderId?, channel, templateId, sendAt, status (`scheduled`, `paused`, `sent`, `skipped`, `cancelled`)}. A workflow `wait` action creates one when it schedules a message. A campaign creates them when scheduled.
  - [ ] The page groups rows by source, template and send time. "Customers" is the group size. For a workflow with a schedule trigger that has not run yet, the row shows "About 41 customers (counted now)" and the exact number appears after the run.
  - [ ] Pause and Resume change the group status. A paused group does not send. Resume sends rows whose time has passed within 24 hours; older ones are marked `skipped` with the reason "missed while paused".
  - [ ] Preview expands the rendered message for the first customer and the recipient list.
  - [ ] At send time each row re-checks: customer not opted out; order still exists and still matches the workflow conditions (F-510). Otherwise the row is `skipped` with a reason.
  - [ ] Times show in Africa/Accra.
  - [ ] Delayed jobs run in the queue, not in a blocked worker (see F-510).
- Data: `ScheduledMessage`.
- API: `GET /api/communications/scheduled`, `POST /api/communications/scheduled/groups/pause|resume`.
- Permissions: view: owner, admin, manager. Pause and resume: owner, admin.
- Edge cases and errors: when a workflow is deleted or deactivated its pending rows are `cancelled`. Server restart does not lose rows (they live in the database and the queue is rebuilt from them at boot).
- Tests: integration test of pause and resume; restart test; skip-on-opt-out test.

### F-464: Customer message tracking on orders and customers
- Priority: P1. Milestone: M9.
- Description: Decision 13 says customer messages are tracked. Show the messages with their status wherever staff look at a customer or an order.
- Current app: none in the UI (data in `MessageLog` has `orderId` and `customerId`).
- Mockup: order drawer shows no messages; Conversations side pane links the order.
- Acceptance criteria:
  - [ ] The order drawer (file 03, F-321) has a "Messages" block: the messages linked to the order (template or first 60 characters, channel icon, status, time). A "Replied" status shows the reply text.
  - [ ] The customer page (file 03, F-354) has a Messages tab with the same list for the customer.
  - [ ] The rep call card shows the last 3 messages and their status (read-only).
  - [ ] A message link opens the conversation.
  - [ ] Statuses use the same words everywhere: Sent, Delivered, Read, Failed, Replied.
- Data: none new.
- API: `GET /api/orders/:id/messages`, `GET /api/customers/:id/messages`.
- Permissions: with the order or customer. Delivery agents see no messages.
- Edge cases and errors: opted-out customers: the block shows "Opted out of WhatsApp" on the last line.
- Tests: component tests; integration test of the order link.

### F-465: Public unsubscribe page
- Priority: P2. Milestone: M9.
- Description: The page a customer sees after clicking the unsubscribe link. Keep it, make it look like the store.
- Current app: `GET/POST /api/public/unsubscribe/:token` returns plain HTML; sets `Customer.emailOptOut`.
- Mockup: none (matrix MS-13).
- Acceptance criteria:
  - [ ] Page shows the store name, a sentence "Stop emails from <store name>?", one button "Unsubscribe" and, after the click, "You are unsubscribed" with a "Changed your mind? Subscribe again" link.
  - [ ] Works without JavaScript. Mobile first.
  - [ ] The POST also serves the one-click `List-Unsubscribe-Post` header from email apps.
  - [ ] Each action writes an `OptOutEvent` (reason `unsubscribe_link`).
  - [ ] Tokens are 32-byte random hex (as today), not guessable. An unknown token shows a neutral message, not an error with details.
  - [ ] Rate limit: 30 requests per 15 minutes per IP.
- Data: `OptOutEvent` (F-462).
- API: existing routes.
- Permissions: public.
- Edge cases and errors: a token for a deleted customer shows "You are unsubscribed" (no leak).
- Tests: integration tests for both routes; header test.

### F-466: Auto-confirm by WhatsApp or SMS (decision 6)
- Priority: P1. Milestone: M7.
- Description: This requirement owns the messaging side of auto-confirm: the message, the buttons and keywords, the confirm page and the handler. The rep-side effects (queue tag, pay rule) are in F-764 (file 08). When a new COD order arrives, the app asks the customer to confirm it by WhatsApp (buttons or a YES reply) or SMS (link). A customer who confirms moves the order to `confirmed` with no call. This lifts the confirmation rate and cuts the wait. It runs next to the rep queue. The order stays in the queue until it is confirmed. The "Confirm agent" in NUMBERS.md (328 confirmed, median 2 minutes to first contact) is the AI agent that gets the credit.
- Current app: none. Today `order_created` workflows can send an "order received" message. The WhatsApp template `order_created` exists.
- Mockup: only the queue timer and rank are shown. There is no screen for settings (matrix RE-11).
- Flow:
  1. A new order enters `pending_confirmation`. The system checks: the setting is on; the customer has a valid number; the customer is not opted out of the chosen channel; the order is not `requiresManualCall` (COD-blocked customer, file 03, F-357); the order is a COD physical order.
  2. The message goes out at once, also outside operating hours (decision P4). Only the rep call clock waits for opening time.
  3. Send the WhatsApp template `order_confirm_request` (utility category, needs Meta approval) with two quick-reply buttons "Confirm order" and "I need to change it". If the number has no WhatsApp (failure reason `no_whatsapp`) or the channel setting says SMS, send an SMS with a short link `https://<host>/c/<token>`.
  4. The order received message from `order_created` is not sent when auto-confirm is on, so the customer gets one message.
  5. Customer taps "Confirm order" (WhatsApp), replies YES (any case, WhatsApp), or opens the link and taps "Yes, confirm my order": the handler `orderService.confirmByCustomer` moves the order to `confirmed` through the machine (actor kind `system`, `metadata.autoConfirm = true`). It writes a `Call` row with `source = auto_confirm`, outcome `confirmed`, rep = the AI agent user that holds the Call rep role (the Confirm agent), or the system user if none.
  6. Customer taps "I need to change it", "No, I need help", or replies NO (any case): the order stays `pending_confirmation`. It gets `customerResponse = change_requested` (button) or `said_no` (NO). A NO does not cancel (decision P2): the order goes to the call queue with a "said NO" flag, and a rep calls once before any cancel. The rep queue shows "Customer asked for a change: call them" or "Customer said NO". Any other text reply goes to the Conversation and the Inbox as a normal customer reply.
  7. No answer: nothing happens. The rep queue and the call flow carry on.
- Acceptance criteria:
  - [ ] Settings live in Settings → Operations (area C, F-1200 range), as F-764 states: switch "Ask customers to confirm" (`autoConfirmEnabled`); channel (`autoConfirmChannel`: WhatsApp first then SMS if WhatsApp fails, SMS only, WhatsApp only); send delay in minutes (`autoConfirmDelayMinutes`, default 0; GUESS from F-764: confirm with the owner). There is no "send only inside operating hours" switch: the message goes out at once (decision P4). The WhatsApp and SMS texts are templates chosen in Messages → Templates (F-461). Messages shows a link to the settings and the result tile (F-455).
  - [ ] Confirm links use a signed single-purpose token: `ConfirmToken` {tokenHash, orderId, tenantId, expiresAt (48 hours), usedAt}. The public page `/c/:token` shows the first name, the items, the total and the address, and two buttons. It shows no phone, no email and no other orders. Rate limit 30 per 15 minutes per IP. Not-found and expired tokens show a neutral "This link is no longer active. Please contact us."
  - [ ] WhatsApp button payloads carry the order id and a short signed value. The handler checks that the sender number equals the order customer's number (normalized). A mismatch is ignored and logged.
  - [ ] Idempotent and race safe: if the order is already `confirmed` (rep got there first) the customer sees "Your order is already confirmed. Thank you." and no second move happens. If the order is `cancelled` the page says "This order was cancelled. Contact us if this is a mistake."
  - [ ] The confirm sets `Order.confirmedAt` and `firstContactAt`. A customer YES confirms the order and closes the time-to-first-call clock; the order counts as "auto-confirmed", not as a rep call (decision R10). The order leaves the rep queue at once (socket event).
  - [ ] Commission: commission (GH₵8) is paid only for orders a rep confirms by call (decision P6). An auto-confirmed order earns no commission, for the AI agent or for the assigned rep. If a rep also called and confirmed, the rep earns (F-764). The `CommissionEntry` logic (F-769, file 08) reads `Call.salesRepId` and `source`.
  - [ ] Conflict between F-764, F-755 and F-304 on first contact. RESOLVED (decision R10): time to first call is the time to the first rep call attempt, inside operating hours. A customer YES to auto-confirm closes the clock as "auto-confirmed". The automatic message by itself never counts. The stored field is `Order.firstContactAt`; file 03 owns its definition.
  - [ ] Result tracking: `Order.autoConfirmSentAt` and `Order.customerResponse` (`confirmed`, `said_no`, `change_requested`, null). The overview (F-455) shows sent, confirmed %, said NO, change requested, no answer.
  - [ ] Opt-outs, quiet rules and the 24-hour window are respected through `messageService.send` (F-451).
  - [ ] The success screen of the checkout form says "We sent you a message on WhatsApp. Reply to confirm." when auto-confirm is on (file 04, F-421).
  - [ ] Android tap-to-call is not part of this requirement (non-goal for now).
- Data: `Order.autoConfirmSentAt`, `Order.customerResponse`; `ConfirmToken`; `Call.source = auto_confirm` (file 03, F-324); settings keys `autoConfirmEnabled`, `autoConfirmChannel`, `autoConfirmDelayMinutes`, `autoConfirmWhatsappTemplateId`, `autoConfirmSmsTemplateId` in `SystemConfig`.
- API: `GET /api/public/confirm/:token`, `POST /api/public/confirm/:token` {action: confirm | change}; settings through the Operations settings API (area C).
- Permissions: settings: owner, admin. Public page: token.
- Edge cases and errors:
  - Meta must approve the template before the first send. This can take days. Until then the SMS path works.
  - A customer taps a button twice: second tap is a no-op.
  - Duplicate orders from the same customer within minutes: each gets its own message with its own order number. The customer can confirm each.
  - If WhatsApp sending fails with `no_whatsapp`, the SMS goes out within 1 minute.
  - Orders created by staff on a call (rep or owner) that are confirmed in the same call: the app skips the message if the order is `confirmed` before the send runs.
- Tests: unit tests for the eligibility checks; integration tests for the confirm page (valid, expired, used, wrong status); webhook test for the button payload with a wrong sender; race test (rep confirm and customer confirm together); e2e with the fake provider.

### F-467: Messages suggestion cards
- Priority: P2. Milestone: M11.
- Description: Three read-only cards on the Messages page. A card finds a real problem and opens a pre-filled screen. A person confirms (G10).
- Current app: none.
- Mockup: "14 customers replied and nobody answered" (Show the 14; Give them to Adwoa); "6 WhatsApp messages went to numbers without WhatsApp" (Resend 6 as SMS; Dismiss); "41 Delivery tomorrow reminders go out at 17:00" (See what goes out).
- Acceptance criteria:
  - [ ] Cards are built from the problem finders (`slow_queue` family, design 7.3) and show only when the count is above 0.
  - [ ] "Show the 14" opens Conversations with the Unreplied filter on.
  - [ ] "Give them to Adwoa" opens a dialog listing the 14 conversations with Adwoa selected. A person clicks "Assign 14 conversations". It does not assign by itself.
  - [ ] "Resend 6 as SMS" opens the Failed filter with the 6 selected and a confirm dialog "Send 6 SMS messages?". The send happens after the click.
  - [ ] "See what goes out" opens Scheduled (F-463). "Dismiss" hides the card for 24 hours.
  - [ ] Numbers in the text are computed. No fixed text.
- Data: none. API: `GET /api/communications/insights`.
- Permissions: owner, admin, manager.
- Edge cases and errors: if the SMS provider is off, the resend button is disabled with the reason.
- Tests: unit tests of the finders; component test that no card writes without the dialog.

---

## 3. Requirements: Workflows (F-500 to F-549)

### F-500: Workflow list, tiles and search
- Priority: P1. Milestone: M9.
- Description: The list of workflows with a short summary at the top. It keeps search and the status filter.
- Current app: `/workflows`: table Workflow Name, Status, Description, Trigger Type, Last Updated, Actions; "Workflow Statistics" panel; search.
- Mockup: `workflows.html`. Header "5 are on and ran 1,084 times this week." Tiles: Active 5; Inactive 2; Runs this week 1,084 (98% passed); Failed runs this week 23 (16 SMS, 7 HTTP). Search; tabs All 7 / Active 5 / Inactive 2. Columns: Workflow (name, description), Trigger, Actions (count), Last run (time and Passed or "1 failed" or Never run), Runs this week, Active (switch), Edit and Delete.
- Acceptance criteria:
  - [ ] Columns and tiles as in the mockup. Counts come from `WorkflowExecution` (test runs excluded, F-514).
  - [ ] Runs this week = executions started in the last 7 days. Passed % = completed ÷ finished. Failed runs lists the count by action type (SMS, HTTP, assign, status).
  - [ ] Header sentence is computed.
  - [ ] Search by name and description. Tabs filter on `isActive`.
  - [ ] Buttons: Browse templates (scrolls to the gallery), New workflow. Empty state: "Create from scratch".
  - [ ] Trigger column reads in words: "Status changes to Confirmed", "Order created", "Every day at 17:00", "Manual", "Payment received", "Webhook".
- Data: none new. API: `GET /api/workflows` (adds `stats`), `GET /api/workflows/summary`.
- Permissions: `workflows:view` (owner, admin, manager).
- Edge cases and errors: a workflow with a stored trigger the UI does not know shows "Custom trigger" and stays editable only in JSON by the owner (should not happen after F-509 migration).
- Tests: integration test of summary numbers on a fixture; component test of the list.

### F-501: Active switch and delete
- Priority: P1. Milestone: M9.
- Description: Turn a workflow on or off; delete it with a confirm.
- Current app: Pause or Activate buttons; Delete with confirm; `PUT /api/workflows/:id {isActive}`; `DELETE /:id`.
- Mockup: switch in the Active column; trash icon; browser confirm for delete (matrix section 4 #29).
- Acceptance criteria:
  - [ ] The switch updates at once and reverts with a toast if the call fails.
  - [ ] Turning on validates the workflow (trigger set, at least one action, no empty required fields). A bad workflow stays off and the message names the problem.
  - [ ] Turning off cancels pending delayed jobs and scheduled messages of this workflow (F-463, F-510) after a confirm that states the count: "Turning this off cancels 41 waiting messages."
  - [ ] Delete uses the shared confirm dialog (file 03, F-328): "Delete Auto-assign by region? It ran 612 times this week." Run history is kept for 90 days under the workflow name.
- Data: none. API: existing.
- Permissions: toggle and delete: `workflows:update`, `workflows:delete` (owner, admin).
- Edge cases and errors: deleting a workflow used by a template ("Used in") is allowed; the template stays.
- Tests: integration test of cancel-on-off.

### F-502: Manual "Run" button
- Priority: P1. Milestone: M9.
- Description: A workflow with the Manual trigger needs a way to start it. The mockup shows the trigger "Manual (run from an order)" but no button. Add Run in three places.
- Current app: "Run" button in the list for manual workflows. `POST /api/workflows/:id/execute`.
- Mockup: not in mockup (matrix WF-04).
- Acceptance criteria:
  - [ ] List row: a Run button on manual workflows opens "Run on which orders?": search by order number, phone or name; pick up to 50 orders; button "Run on 3 orders".
  - [ ] Order drawer (file 03, F-321): a "Run workflow" menu listing active manual workflows.
  - [ ] Orders list bulk bar: "Run workflow" for the selected orders.
  - [ ] Each order gets its own run. The conditions are checked. An order that does not match is reported "did not match" and no action runs.
  - [ ] Result: toast "Ran on 3 orders. 2 passed, 1 did not match." with a link to the run history.
  - [ ] A workflow that is off cannot be run.
  - [ ] Permission `workflows:execute` (owner, admin, manager).
  - [ ] Limit: 50 orders per click. A larger set returns "Run on 50 orders or fewer."
- Data: none. API: `POST /api/workflows/:id/execute` {orderIds[]}.
- Permissions: `workflows:execute`.
- Edge cases and errors: running twice on the same order sends twice. The dialog warns "This order was already run through this workflow today."
- Tests: integration test of conditions on manual runs; e2e from the drawer.

### F-503: Run history
- Priority: P2. Milestone: M9.
- Description: A table of past runs for each workflow, with the step results and the failure reason.
- Current app: `ExecutionHistory` modal; `GET /api/workflows/:id/executions`.
- Mockup: Review step "Run history" table: Order, Result, When; with a failure reason.
- Acceptance criteria:
  - [ ] Columns: Order (number), Result (Passed, Failed, Skipped), When, Duration. A row expands to the steps: action, outcome, detail (who it assigned, which message id, HTTP status).
  - [ ] Filter: All or Failed. Paging 25.
  - [ ] Failed rows show the error in plain words (for example "No delivery partner was available in Western North.").
  - [ ] "Run again" on a failed row repeats the run for that order. Actions are idempotent (a message sent in the first run is not sent twice; F-510).
  - [ ] Runs are kept 90 days.
  - [ ] Failed runs create an Inbox alert for the owner at most once per workflow per hour (F-557, event "System problem").
- Data: `WorkflowExecution.steps` JSON {index, type, status, startedAt, durationMs, result, error}; `WorkflowExecution.mode` (`live`, `test`); `WorkflowExecution.orderId`.
- API: `GET /api/workflows/:id/executions?status=&page=`, `POST /api/workflows/executions/:id/retry`.
- Permissions: `workflows:view`; retry: `workflows:execute`.
- Edge cases and errors: an execution with a deleted order shows the stored number.
- Tests: integration test of step logging; retry idempotency test.

### F-504: Template gallery
- Priority: P2. Milestone: M9.
- Description: A set of ready workflows the owner can start from. The mockup shows 8 cards, including "Shopify order import" with no Shopify connection (matrix section 4 #28). Remove that card.
- Current app: frontend gallery of 8; backend `workflowTemplates.ts` has 10 (different list). The backend sample for "assign by area" uses US area names "Downtown" and "Suburbs".
- Mockup: "Start from a template" gallery of 8 cards.
- Acceptance criteria:
  - [ ] The gallery shows 7 templates: Send confirmation message; Assign orders by product; High-value order alert; Auto-assign by region; VIP customer priority; Daily delivery reminder; Failed delivery follow-up. "Shopify order import" is removed (the webhook importer covers imports).
  - [ ] One source of truth: the backend template list. The frontend reads it from `GET /api/workflows/templates`. The 3 backend templates not in the gallery (low stock alert, collect payment reminder, weekend order handling) and "out for delivery notification" are removed from the template list, or kept for later by a flag. Decide with the owner (see report).
  - [ ] "Auto-assign by region" is a Workflow with the condition "Region is X" and the action "Assign to" (F-511). The region names come from the store's country list (for the sample store, Ghana region names), not "Downtown" or "Suburbs".
  - [ ] "Send confirmation message" is a plain notification (SMS or WhatsApp) on order created. The built-in auto-confirm (F-466) is separate and replaces the "order received" text when on.
  - [ ] A card click opens the builder with the template filled. Nothing is saved until the user saves.
  - [ ] Search by name, description, tag.
- Data: none. API: `GET /api/workflows/templates`.
- Permissions: `workflows:view`.
- Edge cases and errors: a template that needs a connection that is not set (for example WhatsApp) shows a note "Needs WhatsApp in Connections".
- Tests: unit test that every template passes workflow validation.

### F-505: Workflow builder (5 steps)
- Priority: P1. Milestone: M9.
- Description: The builder walks through Basic info, Trigger, Conditions, Actions, Review. Keep the current 5-step wizard in the v2 style.
- Current app: `WorkflowWizard` (`/workflows/new`, `/workflows/:id`). Steps and "Test and save" with Save and "Save & Activate".
- Mockup: `workflows.html#builder`: top bar (Workflows back, name, state tag, Test run, Save workflow); step rail (click to jump); Back and Continue footer.
- Acceptance criteria:
  - [ ] Step rail shows all five steps and marks incomplete ones. A click jumps to any step.
  - [ ] Basic info: Name (required), Description, Active switch (text: "Runs on every new match as soon as you save").
  - [ ] "Test run" in the top bar jumps to Review and starts a test (F-514).
  - [ ] Save keeps the workflow in the chosen state. "Save and activate" turns it on after validation.
  - [ ] Unsaved changes show a prompt when the user leaves.
  - [ ] Works on a phone width (steps become a dropdown).
  - [ ] The older node editor (`WorkflowEditor`, `components/workflow/*`) is not used.
- Data: none. API: `POST /api/workflows`, `PUT /api/workflows/:id`.
- Permissions: create and update: owner, admin.
- Edge cases and errors: a workflow with more than 10 actions is refused ("Use 10 actions or fewer").
- Tests: component tests per step; e2e: build "Auto-assign by region" from the gallery and save.

### F-506: Triggers: order created and status change
- Priority: P0. Milestone: M2 (hook on the machine), M9 (UI).
- Description: These two triggers fire today. They must fire from the state machine so every path (screen, agent app, MCP, import, payment) triggers workflows in the same way.
- Current app: `workflowService.triggerOrderCreatedWorkflows`, `triggerStatusChangeWorkflows` (matches `triggerData.status` or `targetStatus`).
- Mockup: Trigger step: Order created; Status change (From status select, To status select).
- Acceptance criteria:
  - [ ] The machine (file 03, F-301) emits `order.created` and `order.status_changed {from, to, actor}` after the transaction commits. The workflow service subscribes. No other code calls the trigger functions.
  - [ ] Status change trigger: From (any, or one of the 12 statuses) and To (one of the 12 statuses). Existing workflows with only a target status keep working (From = any).
  - [ ] Imported history and backdated sync changes must not send customer messages by accident. Rules: orders imported with a status other than `pending_confirmation` fire no workflows. A status change made by an integration actor with a backdated `deliveryDate` more than 1 day old fires no workflows. The import dialog and the MCP tool accept `runWorkflows: true` to override (default false). (GUESS: confirm that real-time sync changes should fire workflows.)
  - [ ] Loop guard: a workflow chain triggered by another workflow's status change stops at depth 3, and one workflow runs at most once per order per minute. The run is recorded as "Skipped: loop guard".
  - [ ] The trigger runs after commit and never blocks or fails the status change.
- Data: none new.
- API: internal event.
- Permissions: not applicable.
- Edge cases and errors: if the queue is down, the trigger is stored in an outbox table and retried when the queue returns (GUESS: an outbox is the simplest way; the team may use the Bull retry instead).
- Tests: tests that each path (UI, MCP, import, payment settle) emits the event once; loop guard test.

### F-507: Triggers: payment received, schedule, webhook
- Priority: P1 (schedule), P2 (payment received), P3 (webhook). Milestone: M9.
- Description: Three triggers exist in the enum and the mockup but nothing fires them (matrix section 3 #15). Build the firing, or hide them. This PRD builds them, in this order of value.
- Current app: `WorkflowTriggerType`: `payment_received`, `time_based`, `webhook`. The builder lists them. No code runs them.
- Mockup: Payment received (Paystack or manual); Schedule (Repeat Every day or Every week, Time in the store's time zone); Webhook (read-only URL `https://app.codadmin.com/hooks/wf_...`, POST JSON).
- Acceptance criteria:
  - [ ] Payment received: fires when an order's payment status first becomes `paid` or `deposited` (online settlement through the `payment.settled` hook, file 04, F-406; a deposit or settlement reconciled by Finance). It does not fire for COD cash collected by an agent.
  - [ ] Schedule: choose Every day or Every week (with a weekday) and a time in Africa/Accra. It is stored as a cron string with timezone `Africa/Accra`. The scheduler (a repeatable queue job per active workflow) runs the workflow once per tick. The workflow looks at open orders (not deleted, not closed) that match its conditions at run time, up to 5,000 per run, and runs the actions for each. A run never repeats for the same order and workflow on the same local date (idempotency key).
  - [ ] Webhook: each workflow gets an unguessable URL and a key. A POST with JSON `{orderId}` or `{orderNumber}` runs the workflow for that order with the payload available as `{{payload.x}}`. Calls need the `X-Webhook-Key` header. Rate limit 60 per minute per workflow. Calls are logged.
  - [ ] Turning a workflow off removes its scheduler job. Server restart rebuilds all scheduler jobs from the database (not just once at boot without removing old ones).
  - [ ] The builder shows the trigger in words and validates the fields.
- Data: `Workflow.triggerData` JSON {cron, timezone, weekday?, webhookKeyHash}; `WorkflowExecution.idempotencyKey` unique per tenant.
- API: `POST /api/hooks/wf/:token` (public, key protected).
- Permissions: build: owner, admin.
- Edge cases and errors: a schedule time that passes while the server is down: the run happens at restart if less than 1 hour late; otherwise it is skipped and logged. A webhook for an order of another tenant returns 404.
- Tests: schedule tests with a fake clock; idempotency test; webhook auth test; payment trigger test.

### F-508: Conditions
- Priority: P1. Milestone: M9.
- Description: "Run when" rules. The engine supports 15 operators. The builder shows five.
- Current app: conditions with AND/OR groups; builder fields orderTotal, productName, customerType, status, paymentMethod, state, country, itemCount.
- Mockup: Run when All match or Any match; rows Field + Operator (is, is not, is greater than, is less than, contains) + Value; Add condition; remove. Hint lists the fields.
- Acceptance criteria:
  - [ ] Match mode: All or Any.
  - [ ] Fields: Order total, Product, Customer type (first-time, repeat; same definition as file 03, F-351), Status, Payment method, Region, Country, Item count.
  - [ ] Operators in the UI: is, is not, is greater than, is less than, contains. They map to `equals`, `not_equals`, `greater_than`, `less_than`, `contains`. Region and Status and Product accept several values with "is" (stored as `in`).
  - [ ] Region values come from the regions of the store's country (file 04, F-413; country-state-city data, decision O3). The field reads `Order.deliveryState`. The Country field lists the store's country. "Assign by region" is built with this condition (decision O4).
  - [ ] Workflows that already use other operators (`between`, `starts_with`, `is_empty`) keep working. The builder shows those rows with their operator name and lets the user delete them but not create new ones.
  - [ ] Conditions are checked at trigger time and again when a delayed action wakes (F-510).
- Data: none new. API: existing.
- Permissions: owner, admin.
- Edge cases and errors: an empty value is refused. A numeric operator on a text field is refused.
- Tests: unit tests of each operator and the mapping.

### F-509: Actions
- Priority: P1. Milestone: M9.
- Description: The steps a workflow performs. Seven action types: Assign user, Send SMS, Send WhatsApp, Send email, Change status, Wait, HTTP request. The separate actions `assign_agent` and `add_tag` are dropped.
- Current app: `send_sms`, `send_email`, `send_whatsapp`, `update_order`, `assign_agent`, `assign_user`, `add_tag`, `wait`, `http_request` (enum has 7, runtime uses 9).
- Mockup: Actions step: ordered list, expand, remove; add buttons Assign user, Send SMS, Send WhatsApp, Send email (Subject, Body), Change status, Wait (value, hours/minutes/days), HTTP request (URL, POST/GET, header).
- Acceptance criteria:
  - [ ] Send WhatsApp: "Send to" = The assigned agent / The customer / A fixed number; template or message with merge tags. Same for SMS and email (email: to customer or fixed address).
  - [ ] Merge tags: one syntax `{{customer_name}}`, `{{order_number}}`, `{{order_total}}`, `{{customer_address}}`, `{{store_name}}` (F-461). The mockup forms `{{orderNumber}}`, `{{customerName}}`, `{{customerAddress}}`, `{{total}}` and the current HTTP body style `{orderNumber}` are read as aliases so old workflows keep working.
  - [ ] Messages to customers go through `messageService.send` (opt-out, window, phone format checks). Messages to staff (the assigned agent) skip the customer opt-out and use the staff member's phone.
  - [ ] Change status: choose one of the 12 statuses. It runs through the machine as actor kind `workflow` (system). If the move is not allowed from the order's current state, the run fails with the machine error. No forced moves.
  - [ ] Wait: value 1 to 30 and unit minutes, hours or days. Maximum total wait 30 days.
  - [ ] HTTP request: method (GET, POST, PUT, PATCH, DELETE), URL (https only), one header (values are masked after save), JSON body with merge tags. Timeout 10 seconds. Redirects are not followed. Private and local addresses are refused (see F-510). Success is HTTP 2xx. The response status and the first 1 KB of the body are stored in the step.
  - [ ] `assign_agent` is migrated to `assign_user` with role Delivery agent and the same user. `add_tag` has no replacement: workflows that contain it are listed in a migration report and the action is kept as "Removed" in the stored JSON for audit; the owner reviews them. (GUESS: count them on production first; the report may be empty.)
  - [ ] Failure in any action stops the run and marks it Failed (as today).
- Data: none new beyond `WorkflowExecution.steps`.
- API: existing.
- Permissions: owner, admin.
- Edge cases and errors: a template picked for an action that is later deleted is blocked by F-461. A deleted user in an assign action is skipped with a warning at save and a failure at run.
- Tests: unit tests per action; migration test for `assign_agent` and `add_tag`; tag alias test.

### F-510: Workflow engine: one runner, real services, delayed waits, real HTTP
- Priority: P0. Milestone: M2 (route through services), M9 (queue and HTTP).
- Description: The engine has four faults (matrix section 3 #13, #14). Actions `update_order` and `assign_agent` write with `prisma.order.update` and skip stock, ledger and history. The `wait` action blocks a worker with `setTimeout`. `http_request` is a mock. Two parallel runners exist (`workflowQueue.ts` and `workflowService.processWorkflowExecution`). Fix all four.
- Current app: as listed.
- Mockup: not applicable.
- Acceptance criteria:
  - [ ] One runner: the `workflow-execution` queue worker. The in-process duplicate is removed. Manual and trigger runs only enqueue.
  - [ ] All order changes go through services: status → `transitionOrder` (file 03, F-301); assign → the assign function (file 03, F-314); messages → `messageService.send`. A test fails if any workflow action calls `prisma.order.update`.
  - [ ] `wait` creates a delayed job for the next action and ends the current job. The worker is free. Waiting runs survive a restart (jobs are in Redis; `ScheduledMessage` rows are in the database, F-463).
  - [ ] On wake, the run re-checks the trigger conditions on the current order. If the order no longer matches (for example it was cancelled) the rest of the run is skipped with the reason "Order changed".
  - [ ] `http_request` is real (F-509). SSRF protection: resolve the host and refuse loopback, link-local, private and cloud metadata addresses; allow only ports 80 and 443; do not follow redirects; deny `localhost` and internal host names.
  - [ ] Each action is idempotent per `(executionId, actionIndex)`. A job retry (3 attempts with backoff, as today) does not repeat a finished action.
  - [ ] Every step is recorded in `WorkflowExecution.steps` (F-503).
  - [ ] Runs execute inside the tenant context. Socket events for workflows go to tenant-scoped rooms only (area A, matrix section 3 #31).
  - [ ] Concurrency per tenant is capped (default 5) so one tenant cannot starve others.
- Data: `WorkflowExecution` fields (F-503, F-507).
- API: none.
- Permissions: not applicable.
- Edge cases and errors: a run that exceeds 10 minutes in total (not counting waits) is stopped and marked Failed.
- Tests: tests that no action uses `prisma.order.update`; wait and wake test; HTTP SSRF tests (10 addresses); retry idempotency test; restart test.

### F-511: Assign user action: Evenly or Weighted (assign by region)
- Priority: P1. Milestone: M9.
- Description: The assign action ("Assign to") picks one or more call reps or delivery agents or partners and assigns the order. Two split modes: Evenly and Weighted. "Assign by region" (D3) is not a third mode. It is a Workflow: the condition "Region is X" (see F-508; conditions already include Region and Country) plus this action. Many agents can serve one region. This replaces the coverage grid (G7) and the priority order (P8), decision O4.
- Current app: `assign_user` with `userType`, `distributionMode` (round robin or weighted), `assignments`, `onlyUnassigned`. `assignmentService` skips inactive, unavailable and blocked partners. The "assign by area" template uses fake area names.
- Mockup: Assign user (role Call rep or Delivery agent; share Evenly / Weighted % / By region). The mockup also shows a By region table typed in the workflow. Do not build the table; use a condition instead (O4).
- Acceptance criteria:
  - [ ] Role: Call rep (people and AI agents holding the Call rep role) or Delivery agent (people and 3PL companies).
  - [ ] Evenly: smooth round robin over the chosen candidates. Weighted %: the shares must add up to 100; the result over time follows the shares (F-513).
  - [ ] There is no "By region" mode and no coverage table. The owner builds one Workflow per region (or group of regions): condition "Region is X" (values pick from the store country's regions), action "Assign to" the agents for that region.
  - [ ] Matching uses `Order.deliveryState` (region) through the condition. A missing or unknown region matches no region workflow.
  - [ ] If no Workflow matches an order, the order stays unassigned for the fulfilment lead. There is no fallback partner.
  - [ ] A chosen agent who is inactive, marked unavailable or blocked for unpaid cash is skipped. If every chosen agent is unavailable, the order stays unassigned, the run is marked Passed with the note "No partner available", and the owner gets an Inbox alert (F-557).
  - [ ] "Only when no one is assigned yet" switch (current `onlyUnassigned`): on by default for new assign actions.
  - [ ] Each assignment goes through the assign function (file 03, F-314), writes an order history row "Assigned to Esi Badu by workflow Auto-assign by region (Greater Accra)" and notifies the assignee.
  - [ ] The review step summary reads "Assign a delivery agent when the region is Greater Accra." (the region text comes from the condition).
- Data: `Workflow.actions[].config` {userType, mode (`even`, `weighted`), assignments[], onlyUnassigned}. No coverage data.
- API: none new. The builder reads partners from the Deliveries partner list (`GET /api/delivery-partners`).
- Permissions: owner, admin.
- Edge cases and errors:
  - Two Workflows match one order: the first one by run order assigns; the second skips because of "Only when no one is assigned yet".
  - Kasapa Express (trial) with 8 orders and no closed orders can be picked; the picker tags it "Trial".
- Tests: unit tests for matching (region match, no match, unavailable, blocked, empty region, two agents); integration test of the history row and notification.

### F-512: Assign orders that have no one yet (catch-up)
- Priority: P2. Milestone: M9.
- Description: The mockup switch "Also assign orders that have no one yet (38 would be assigned now)" runs the assign action once on existing unassigned orders when the workflow is saved.
- Current app: none (the current `onlyUnassigned` is a different thing: it skips orders that already have someone).
- Mockup: switch under the Assign user action with a live count.
- Acceptance criteria:
  - [ ] The count is live: open orders (pre-dispatch states and `failed_delivery` for the delivery role; `pending_confirmation` for the rep role) with no one assigned for that role that match the workflow conditions.
  - [ ] On Save with the switch on, a dialog says "38 orders will be assigned now." A person clicks Assign. The job runs once and is recorded as one execution "Catch-up" with a step per order (F-503).
  - [ ] The switch resets to off after the run. It does not run again on later saves.
  - [ ] Maximum 500 orders per catch-up. A larger count says "500 of 812 will be assigned now. Run it again for the rest."
  - [ ] Orders that are closed, deleted or already assigned are never touched.
- Data: none new. API: `POST /api/workflows/:id/catch-up` {confirm: true}; `GET /api/workflows/:id/catch-up/preview`.
- Permissions: owner, admin.
- Edge cases and errors: the workflow must be saved first. A catch-up on a workflow that is off is refused.
- Tests: integration test of the count and the run; test that the switch clears.

### F-513: Assignment cursor survives restarts
- Priority: P2. Milestone: M6.
- Description: The round-robin position lives in memory today and resets at every restart (matrix section 3 #40). Weighted selection is random, so shares only match in the long run. Keep the position in Redis with a database fallback, and use a smooth weighted round robin so shares are exact over short runs.
- Current app: `assignmentService.ts`: in-memory index; `selectUserWeighted` uses random.
- Mockup: not applicable.
- Acceptance criteria:
  - [ ] A cursor per `(tenantId, workflowId or scope, role)` stored in Redis, with a table `AssignmentCursor` as the fallback. A restart keeps the position.
  - [ ] Weighted assignment uses smooth weighted round robin. After 100 assignments with weights 60 and 40 the counts are 60 and 40, give or take 2.
  - [ ] Manual assignment does not move the cursor.
  - [ ] Test runs do not move the cursor (F-514).
- Data: `AssignmentCursor` {tenantId, scope, role, position, state JSON}.
- API: none.
- Permissions: not applicable.
- Edge cases and errors: candidates change (a user leaves): the cursor resets for that scope with a log line.
- Tests: restart test; distribution test; concurrency test with 20 parallel assignments.

### F-514: Test run (no messages sent)
- Priority: P2. Milestone: M9.
- Description: In the Review step the user picks a sample order and runs a test. It shows what the workflow would do and sends nothing.
- Current app: none ("Test and save" button label only).
- Mockup: Review step: Test run (select a sample order, Run test): "No messages are sent", shows the steps and who it would assign.
- Acceptance criteria:
  - [ ] Pick a sample order by search. The test evaluates the conditions and plans each action.
  - [ ] Output per step: Send WhatsApp → "Would send to +233 24 555 0123: <rendered text>"; Assign user → "Would assign to Esi Badu (region is Greater Accra)"; Change status → "Would move to Confirmed"; Wait → "Would wait 2 hours"; HTTP request → the rendered request, not sent.
  - [ ] Nothing is sent, assigned or changed. The cursor does not move.
  - [ ] The test is stored as a `WorkflowExecution` with `mode = test`. It is not counted in tiles or history lists by default (a "Show tests" filter shows them).
  - [ ] A condition mismatch shows "This order does not match the conditions" and stops.
- Data: `WorkflowExecution.mode`.
- API: `POST /api/workflows/test` {workflow draft, orderId}.
- Permissions: owner, admin.
- Edge cases and errors: a test on a draft that is not saved works on the draft JSON.
- Tests: tests that no side effects occur (spy on message, order and HTTP calls).

### F-515: "Describe a workflow and I will build it"
- Priority: P3. Milestone: M12.
- Description: An AI card where the owner writes a sentence and the assistant drafts a workflow. This writes data when it saves, so it waits for the AI write tools (matrix WF-15, G10).
- Current app: none.
- Mockup: Agent card with an input that holds a sample sentence (assign confirmed Accra orders to Esi and send Esi a WhatsApp) and the button "Build it" (opens the builder at the Actions step).
- Acceptance criteria:
  - [ ] Not shown in release one.
  - [ ] In M12 the tool `workflow_draft` returns a workflow JSON. The builder opens with it, unsaved. A person reviews, runs a test and clicks Save. The tool never saves or activates.
  - [ ] The draft must pass the same validation as F-505.
- Data: none. API: AI tool registry (area A, F-1300 range).
- Permissions: owner, admin.
- Edge cases and errors: a sentence the assistant cannot map returns "I could not build that. Try the template gallery."
- Tests: later.

### F-516: Workflow suggestion cards
- Priority: P2. Milestone: M11.
- Description: Read-only cards on the Workflows page.
- Current app: none.
- Mockup: "Failed delivery follow-up is off" (Turn it on; Review first).
- Acceptance criteria:
  - [ ] The card appears when a template-type workflow is off or missing and the matching problem exists (for example failed deliveries with no follow-up message in 7 days).
  - [ ] "Review first" opens the builder at the Review step. "Turn it on" also opens the builder at the Review step with the Activate button highlighted. It does not switch the workflow on by itself in release one (G10).
  - [ ] "Dismiss" hides it for 24 hours.
- Data: none. API: `GET /api/workflows/insights`.
- Permissions: owner, admin.
- Edge cases and errors: none.
- Tests: component test.

---

## 4. Requirements: Inbox (F-550 to F-599)

### F-550: Notification feed
- Priority: P0. Milestone: M9.
- Description: One place for everything that needs a person: alerts, replies, mentions, assignments and reminders. It replaces the in-memory bell list. Notifications are stored per person.
- Current app: `Notification` (userId, type, title, message, data, isRead). Created only for overdue collections and agent block or unblock. The bell reads an in-memory store fed by socket events.
- Mockup: `inbox.html`. Header buttons Mark all read, New reminder, Notification settings. Left rail: All, Mentions, Assigned to me, Reminders, Team threads, Alerts, Done (with unread counts). Feed rows grouped Today, Yesterday, Earlier: unread dot, icon by type, bold title, link to the source, "who · time", red "Alert" tag.
- Acceptance criteria:
  - [ ] `Notification` gains: `kind` (event key, F-557), `severity` (`info`, `alert`), `subjectType`, `subjectId`, `actorId`, `link`, `doneAt`, `snoozedUntil`, `groupKey`. Existing columns stay.
  - [ ] A role inbox is done by fan-out: an event for a role creates one row per active holder of the role. Each person keeps their own read, snooze and done state.
  - [ ] Views: All (not done and not snoozed), Mentions (`kind = mention`), Assigned to me (F-551), Reminders (F-552), Team threads (F-553), Alerts (`severity = alert`, not done), Done (`doneAt` set).
  - [ ] Rows show the title, a link that opens the subject (order drawer, customer, payout, stock screen, target, conversation), actor and time, and an "Alert" tag. Unread rows have a dot. Opening the link marks the row read.
  - [ ] "Mark all read" marks the current view's rows as read.
  - [ ] Empty state: "Nothing here. You are caught up."
  - [ ] 30 rows per load with "Load more". Newest first within each group.
  - [ ] Retention: done items are deleted after 180 days. Open items are kept.
  - [ ] The bell in the top bar shows the unread count and opens the Inbox (area A reads `GET /api/inbox/counts`, F-560).
  - [ ] `createNotification` keeps its signature for current callers (overdue collections, agent blocked). They get `kind` values.
- Data: `Notification` changes above.
- API: `GET /api/inbox?view=&cursor=`, `PATCH /api/inbox/:id` {read, done, snoozedUntil}, `POST /api/inbox/mark-all-read?view=`.
- Permissions: every logged-in user sees their own rows only.
- Edge cases and errors: a notification whose subject was deleted still shows, with the link greyed and the text "Item was deleted".
- Tests: fan-out test; view filter tests; retention job test; two-tenant isolation test.

### F-551: Assigned to me
- Priority: P2. Milestone: M9.
- Description: A table of things other people or the AI assistant asked me to do.
- Current app: none.
- Mockup: `inbox.html#assigned`: columns Item, Assigned by, Due, Status, Action. Rows such as "Approve GH₵30 discount (Order #24120, Kofi, Today 12:00, Due soon)". Row buttons Open order, Open reward, Open payout, Done (dead).
- Acceptance criteria:
  - [ ] Items are open reminders where `forUserId` is me and `createdById` is someone else (a person, an AI agent or the system). No new model.
  - [ ] Columns: Item (text and linked subject), Assigned by, Due, Status (Due soon = within 4 hours; Overdue; Upcoming), Action (Open item, Done).
  - [ ] "Open item" opens the subject. "Done" completes the reminder (F-552).
  - [ ] Sort by due date, overdue first.
  - [ ] The AI assistant may create such items only through a person's confirm in release one (G10). It never assigns by itself.
  - [ ] The sample row about a GH₵100 reward at 80% is removed (decision D9: cash tiers at 100% and 120% only). A reward item reads "Pay Adwoa's GH₵300 target reward" and exists only after month close (G4).
- Data: `Reminder` (F-552).
- API: `GET /api/inbox/assigned`.
- Permissions: own items.
- Edge cases and errors: items assigned to a role with no holder go to the owner.
- Tests: integration test of the filter; component test.

### F-552: Reminders
- Priority: P1. Milestone: M9.
- Description: Reminders on orders, customers, payouts, products and free text. They fire at the due time to the right person on the chosen channels.
- Current app: none.
- Mockup: `inbox.html#reminders`: lists Overdue, Today, Upcoming, Done; row: tick, text, "<by> set for <to>", linked item, channel icons, repeat tag, due date and "Overdue by 1 day", Snooze. New reminder form: What; Linked item; Due date; Time; Repeat (Does not repeat, Every day, Every week, Every month); For (Me or a teammate); Notify by (In-app, WhatsApp, Email, SMS); Create reminder. Agent card: "3 reminders are overdue; 2 are Kofi's" with Nudge Kofi on WhatsApp and Reschedule all to tomorrow.
- Acceptance criteria:
  - [ ] New `Reminder` {tenantId, subjectType (`order`, `customer`, `payout`, `product`, `thread`, `free`), subjectId, text, dueAt, repeat (`none`, `daily`, `weekly`, `monthly`), createdById, forUserId, channels[], doneAt, snoozedUntil}.
  - [ ] Create from: the Inbox form, the order drawer popover (file 03, F-325), the Conversations side pane (F-454), a thread message (F-553), a feed row (F-554), the customer page. All use the same popover and the same endpoint.
  - [ ] Past due times are refused when creating. Time zone is Africa/Accra.
  - [ ] Scheduler: a repeatable job runs every minute and fires reminders due in the last minute. The accuracy is within 1 minute. A firing creates a Notification `reminder_due` for the target person and sends the chosen external channels, respecting their quiet hours (F-555). WhatsApp to staff uses an approved utility template with one text variable.
  - [ ] Repeat: when a repeating reminder fires, the next occurrence is created. Completing one occurrence does not stop the series. "Stop repeating" is in the row menu.
  - [ ] Lists: Overdue (past due, not done), Today, Upcoming, Done. Row tick completes or reopens. Snooze options: 1 hour, This evening 17:00, Tomorrow 09:00, Monday 09:00. A snoozed reminder moves to Upcoming and fires again at the new time.
  - [ ] Who can set for whom: everyone for self; owner, admin and manager for any teammate; a call rep for self only.
  - [ ] Linked item shows a working link. A deleted subject shows "Item was deleted".
  - [ ] Card actions (G10): "Nudge Kofi on WhatsApp" opens a prefilled message dialog; a person clicks Send. "Reschedule all to tomorrow" opens a confirm dialog listing the reminders; a person confirms.
  - [ ] Reminder created by a rep from a "Call back later" outcome (file 03, F-324) has the order as subject and the callback time.
- Data: `Reminder`.
- API: `GET/POST /api/reminders`, `PATCH /api/reminders/:id` {done, snoozedUntil, dueAt}, `DELETE /api/reminders/:id`.
- Permissions: as above.
- Edge cases and errors: a reminder for a deactivated user goes to the creator with a note. A reminder with channels that the target's preferences block (for example SMS off) uses in-app only.
- Tests: scheduler test with a fake clock; repeat test; quiet-hours test; permission tests.

### F-553: Team threads and comments
- Priority: P1. Milestone: M9.
- Description: A conversation among staff about an order, customer, payout or product, or a general topic. Notes live on the subject (order drawer, customer page) and in the Inbox.
- Current app: none. (`Order.internalNotes` is one text field.)
- Mockup: `inbox.html#threads`: thread list (Order #24114 · Yaw Boateng, Delivery team general with 4 members, Payout · Logiswift 1–15 Oct, Product · Magic Groove copybook set), "New" button; thread pane with title, member avatars, "Open item" and "Open members", context chips, messages with attachment, reactions, Reply, "Seen by"; composer with Attach, Mention, "Set reminder from this message", Send.
- Acceptance criteria:
  - [ ] New `Thread` {tenantId, subjectType (`order`, `customer`, `payout`, `product`, `general`), subjectId?, title, createdById, memberIds, lastCommentAt, archivedAt} and `Comment` {threadId, authorId, body, parentCommentId?, mentions[], attachmentUrls[], createdAt, editedAt}. `ThreadRead` {threadId, userId, lastReadCommentId}.
  - [ ] One thread per subject. The first note on an order creates it. Members: the author, mentioned people, the order's call rep and delivery agent. Others are added with "Open members".
  - [ ] "New" creates a thread: pick a subject (search) or General; set a title and members.
  - [ ] Replies attach to a comment (one level). Edit within 10 minutes. Delete by author or owner (soft).
  - [ ] Context chips come from the subject: for an order, status, amount and package, and the re-delivery date when set.
  - [ ] "Open item" opens the subject. "Set reminder from this message" opens the reminder popover with the thread linked (F-552).
  - [ ] Attach: images (jpeg, png, webp) up to 5 MB through the existing upload route (R2). P2.
  - [ ] Unread: per member from `ThreadRead`. "Seen by" shows members who have read up to that comment (P3). Reactions are P3 and use an icon set, not emoji characters.
  - [ ] Visibility: members, plus owner, admin and manager for all threads. A call rep sees threads on orders they own and threads they are a member of. A delivery agent sees threads on their own orders and threads they are a member of. A mentioned person is added as a member and sees the thread with a small summary of the subject, not other data.
  - [ ] The order drawer and the customer page embed the thread (file 03, F-326, F-354). A thread on a deleted order is archived.
- Data: `Thread`, `Comment`, `ThreadRead`.
- API: `GET /api/threads`, `POST /api/threads`, `GET /api/threads/:id`, `POST /api/threads/:id/comments`, `PATCH /api/comments/:id`, `DELETE /api/comments/:id`, `GET /api/threads/by-subject/:type/:id`.
- Permissions: as above.
- Edge cases and errors: a comment over 4,000 characters is refused. HTML is escaped (plain text only with line breaks).
- Tests: visibility tests per role; mention-membership test; unread count test.

### F-554: Row actions: snooze, mark done, set reminder
- Priority: P2. Milestone: M9.
- Description: Actions on a feed row.
- Current app: none.
- Mockup: on hover: Open, Mark done (or Move back), Snooze (1 hour, This evening 17:00, Tomorrow 09:00, Monday 09:00), Set reminder (opens Reminders pre-filled). The "Open item" and Assigned-to-me row buttons are dead in the mockup.
- Acceptance criteria:
  - [ ] Open follows the row link and marks it read.
  - [ ] Mark done sets `doneAt`. In the Done view the same button reads "Move back" and clears it.
  - [ ] Snooze hides the row until the chosen time, then it returns as unread. Times in Africa/Accra.
  - [ ] Set reminder opens the popover with the row's subject linked and the row title as text.
  - [ ] All buttons work on touch screens without hover (a "..." menu).
  - [ ] Keyboard: each action is reachable with Tab and Enter.
- Data: `Notification.doneAt`, `snoozedUntil` (F-550).
- API: `PATCH /api/inbox/:id`.
- Permissions: own rows.
- Edge cases and errors: snoozing an Alert keeps it in the Alerts count after the time passes.
- Tests: component tests; integration test of snooze return.

### F-555: Notification settings
- Priority: P1. Milestone: M9.
- Description: Each person chooses which events reach them on which channel. The owner sets defaults by role. This one store also drives the delivery agent app switches (matrix section 4 #9) and replaces the two dead toggles in Settings (matrix section 3 #3).
- Current app: Settings → My Notifications has "Order updates" and "Payment notifications" toggles that are not wired.
- Mockup: `inbox.html#settings`. Switch "My alerts / Role defaults". My alerts matrix: events × In-app, WhatsApp, Email, SMS. Role defaults matrix: Call rep, Delivery, Finance clerk, Marketing × the same 4 channels, with "Apply to team". Quiet hours (switch, From 21:00, To 07:00, switch "Still send short payouts and failed deliveries"). Digest and nudges (Daily digest switch, Send at 08:00, Send by WhatsApp or Email, "Remind me if not done after" 4 hours, 1 day, 2 days, Never). Agent card "Kwesi gets no alert when a payout is short" (Turn on for Delivery; Ignore). Agent app More: four switches (New orders, Reminders, Team messages, Reward updates).
- Events (F-557): Order assigned to me; Delivery failed; Customer replied; Mentioned in a thread; Reminder due; Payout short or late; Stock gap; Target milestone (100% or 120% reached; the 80% step is removed, D9); Agent finding; System problem (new, owner and admin only, in-app).
- Acceptance criteria:
  - [ ] Stores: `NotificationPreference` {userId, event, channel, enabled}; `NotificationRoleDefault` {tenantId, roleKey, event, channel, enabled}; `NotificationSettings` {userId, quietEnabled, quietFrom, quietTo, quietKeepCritical, digestEnabled, digestTime, digestChannel, nudgeAfter}.
  - [ ] A person with no own row uses the role default. A person's own change overrides it.
  - [ ] Defaults (GUESS: confirm with the owner): In-app on for every event and role. WhatsApp on for Reminder due, Order assigned and Customer replied. Email and SMS off. System problem: in-app only.
  - [ ] "Apply to team" opens a confirm dialog ("Replace the settings of 9 people with the role defaults?"). On confirm it overwrites each person's rows for people in those roles.
  - [ ] Quiet hours (Africa/Accra): in-app rows are always created. External channels are held until the quiet period ends, then sent once. Events marked "critical" (Payout short or late, Delivery failed) still send when the switch is on.
  - [ ] Daily digest: at the set time, one message lists the person's open items (assigned, overdue reminders, unread alerts). It uses the chosen channel.
  - [ ] Nudge: if an item assigned to me is still not done after the chosen time, I get one reminder (not repeated).
  - [ ] Agent app switches map to events: New orders → Order assigned to me; Reminders → Reminder due; Team messages → Mentioned in a thread (and replies in my threads); Reward updates → Target milestone. A switch controls the In-app and WhatsApp cells of that event together (GUESS: confirm). The agent app has no separate store.
  - [ ] Settings → Notifications (area C) shows a link to this page. The dead toggles are removed. The "Order updates" and "Payment notifications" settings do not exist.
  - [ ] The card "Kwesi gets no alert when a payout is short" shows when a role holder has the event off. "Turn on for Delivery" opens the Role defaults view with the cell highlighted. The person clicks the switch. It does not change by itself (G10).
- Data: the three tables above.
- API: `GET/PUT /api/notification-settings/me`, `GET/PUT /api/notification-settings/roles`, `POST /api/notification-settings/roles/apply`.
- Permissions: my alerts: own. Role defaults and Apply: owner, admin.
- Edge cases and errors: a person who turns every channel off for an event still gets the in-app row unless they turn in-app off. Turning off in-app for System problem is refused for the owner.
- Tests: resolution order test (own over role); quiet-hours hold test; digest test; agent-app mapping test.

### F-556: Mentions
- Priority: P1. Milestone: M9.
- Description: Type `@` in a note to mention a teammate. They get a notification and see the thread.
- Current app: none.
- Mockup: composer Mention button opens a list (Kofi, Esi, Kwesi, Adwoa, Nana); order drawer quick buttons @Adwoa, @Nana, @Kofi; text "Mentioned teammates get a notification."
- Acceptance criteria:
  - [ ] Typing `@` shows the list of staff in the tenant (people only; AI agents and companies are not mentioned). The pick stores the user id in `Comment.mentions`. Typed text without a pick does nothing.
  - [ ] A mention creates a Notification `mention` for that person (grouped: one per thread per 5 minutes) and adds them to the thread (F-553).
  - [ ] The mentioned person sees the comment in the Mentions view.
  - [ ] A person is not notified of their own mentions.
  - [ ] In the order drawer, quick mention buttons show the order's assigned rep and agent.
- Data: `Comment.mentions` (F-553).
- API: `GET /api/users/mentionable?q=`.
- Permissions: any user who can post a comment.
- Edge cases and errors: a deactivated user is not listed. Renaming a user does not change old comments (the id is stored).
- Tests: integration test of the notification and membership; component test of the picker.

### F-557: Notification events and delivery rules
- Priority: P0. Milestone: M9.
- Description: The list of events that create notifications, who gets them, and the text. One service `inboxService.notify(event, subject, recipients, payload)` creates the rows and sends external channels by the settings in F-555. The unused helpers in `notificationService` are replaced.
- Current app: `createNotification`; `notifyOrderAssigned`, `notifyOrderStatusChanged`, `notifyDeliveryScheduled` have no callers (matrix section 3 #22).
- Mockup: the 14 sample items in `inbox.html`.
- Acceptance criteria:

| Event key | When | Recipients | Severity |
|---|---|---|---|
| `order_assigned` | an order or conversation is assigned | the assignee | info |
| `delivery_failed` | an order enters `failed_delivery` | the order's call rep, managers, owner | alert |
| `customer_replied` | an inbound message (F-452) | conversation assignee, else the order's rep, else owner | info |
| `mention` | a mention (F-556) | the mentioned person | info |
| `reminder_due` | a reminder fires (F-552) | `forUserId` | info (alert when overdue) |
| `payout_short_or_late` | a partner payout is short, or cash is overdue (Finance area emits) | owner, finance holder | alert |
| `stock_gap` | a count differs from the system (stock area emits) | owner, stock holder | alert |
| `target_milestone` | a person reaches 100% or 120% of target (targets area emits). The reward is confirmed at month close (G4); the text says "reached", not "earned". | that person, owner | info |
| `agent_finding` | a problem finder opens a Finding (area A emits) | owner | alert |
| `system_problem` | payment needs review (file 04, F-404), ledger entry failed (F-406), revenue not booked after 30 minutes (file 03, F-303), workflow run failed (F-503), no delivery partner available (F-511), digital delivery failed | owner, admin | alert |

  - [ ] Each event has a title, a short text and a link. Texts are plain and name the subject (for example "Delivery failed #24114. The brother refused.").
  - [ ] Events fan out per F-550 and send external channels per F-555.
  - [ ] Duplicate suppression: the same event for the same subject to the same person within 10 minutes is merged (`groupKey`).
  - [ ] The three dead helpers are deleted. `createNotification` stays as the low-level writer.
  - [ ] An order status change from an outside agent that fails because stock is short (file 03, F-305) creates a `system_problem` alert. The app shows no sync status (decision O1).
  - [ ] No notification text mentions an 80% tier or any reward other than the cash tiers (D9).
- Data: `Notification.kind` (F-550).
- API: internal service.
- Permissions: not applicable.
- Edge cases and errors: if the recipient list is empty the owner gets it. External channel failure does not remove the in-app row.
- Tests: one test per event key; merge test; recipient fallback test.

### F-558: Rep inbox
- Priority: P1. Milestone: M7 (basic), M9 (full).
- Description: The call rep app has its own inbox, linked from the bell. It holds items about the rep's own work. The screen is built in the rep app (F-763, file 08). This requirement defines the events, data, scope and rules that screen uses.
- Current app: none.
- Mockup: `rep.html#inbox`: header unread summary and Mark all read; tabs All, Reminders, Team notes (with unread counts); rows grouped Today, Yesterday, Earlier. Row types: Call back <name> (reminder, "Open call card"); WhatsApp reply from a customer ("Open call card"); Order moved to you ("Open call card"); "Delivered: <name>. You earned GH₵28" ("Open in My orders"); "Failed: <name> refused the order" ("Open re-delivery call"); target reached ("Open Earnings"); "Payout paid: GH₵600" ("Open Earnings"); team note ("Open note"). Team notes tab: thread list with unread dots and a thread pane with Write a reply and Send. Empty state "Nothing here. You are caught up."
- Acceptance criteria:
  - [ ] The inbox shows only the rep's own notifications and the threads where they are a member or that sit on their orders.
  - [ ] Events used: `order_assigned`, `customer_replied`, `reminder_due` (callbacks), `delivery_failed`, `target_milestone`, `mention`, plus rep-specific kinds `order_delivered` (text "Delivered: Abena Owusu. You earn GH₵8") and `payout_paid`.
  - [ ] The example amount "You earned GH₵28" in the mockup is wrong for the rule GH₵8 per delivered order (+ 10% of extra value). The text uses the real computed amount: GH₵8 plus 10% of the extra value added (the commission ledger, area B2/C, M7).
  - [ ] The target row reads "You reached 100% of your target (423 confirmed and delivered). Your GH₵300 reward is confirmed at month close." The 80% step does not exist (D9, G4).
  - [ ] Links open the call card, My orders or Earnings in the rep app.
  - [ ] Team notes tab: reply and send. Replies post as comments on the thread (F-553).
  - [ ] A rep cannot create reminders for others and cannot see other reps' items.
  - [ ] Bell shows the unread count (F-560).
- Data: `Notification.kind` values. API: `GET /api/inbox` (same API, own rows).
- Permissions: the rep sees own rows only.
- Edge cases and errors: an order moved away from the rep keeps the old notification with the link greyed.
- Tests: scope test; component test of the three tabs.

### F-559: Delivery agent inbox
- Priority: P1. Milestone: M10.
- Description: The phone app for delivery agents has an inbox. It holds new deliveries, reminders, notes and reward news. The screen is built in the agent app (F-812, file 09). This requirement defines the events, data, scope and rules that screen uses.
- Current app: none (the agent app has no inbox).
- Mockup: `agent.html#inbox` (from the Home bell): unread summary, Mark all read; rows grouped Today, Yesterday, Earlier: "Reminder to deposit cash" (Go to Cash); "Abena Owusu moved the delivery time" (Open delivery); team note from Manny (Open delivery, Reply); "20 copybook sets are waiting for you" (Go to My stock); "New delivery" rows (Open delivery); note from Adwoa (Open delivery, Reply); "Reward paid" (the old payout row is replaced, decision F1). Reply opens a sheet with a text field and "Send reply".
- Acceptance criteria:
  - [ ] Own rows only. Events used: `order_assigned` (New delivery), `reminder_due` (deposit cash), `mention` and thread replies (team notes), `stock_incoming` (new kind: stock transferred to the agent and waiting for confirmation, from the stock area), `payout_paid` (new kind), `target_milestone`, customer moved delivery time (new kind `delivery_rescheduled`, created when staff change `nextAttemptDate` on the agent's order).
  - [ ] The reward text uses numbers from the books: the target reward amount paid (F-916). There is no "still owed" line for delivery fees: the agent keeps the fee from collected cash (decision F4). The agent can open "Fees you kept" (file 09, F-815).
  - [ ] Links open the delivery detail, Cash, or My stock in the app.
  - [ ] Reply sheet posts a comment on the thread. Toast: "Reply sent to <name>."
  - [ ] English only (D1). No language switch.
  - [ ] Notification switches in More use the shared store (F-555).
  - [ ] Works on a basic Android phone browser (small screen, slow network). The inbox loads 20 rows first.
- Data: new kinds `stock_incoming`, `payout_paid`, `delivery_rescheduled`.
- API: `GET /api/inbox` (own rows). Reply: `POST /api/threads/:id/comments`.
- Permissions: own rows only.
- Edge cases and errors: an agent with no internet sees the last loaded list and "Offline" text; replies queue and send when online (GUESS: the agent app may not support offline queueing; if not, show "Check your connection").
- Tests: scope test; component test for the reply sheet.

### F-560: Unread counts and realtime
- Priority: P1. Milestone: M9.
- Description: The sidebar pill, the bell and the rail counts update without reload.
- Current app: bell counts from an in-memory store fed by `order:*` socket events.
- Mockup: sidebar Inbox pill (5); bell dot; rail counts.
- Acceptance criteria:
  - [ ] `GET /api/inbox/counts` returns `{unread, mentions, assigned, remindersDue, alerts}` for the user.
  - [ ] A socket event `inbox:updated` goes to the room `tenant:<id>:user:<userId>` after any change. Rooms are tenant-scoped (area A, matrix section 3 #31). The client refetches the counts.
  - [ ] The bell shows a number up to 99 and "99+" above.
  - [ ] The counts are correct after a snooze returns (a scheduled job or an on-read check).
- Data: none. API: as above.
- Permissions: own.
- Edge cases and errors: if the socket drops, the client polls the counts every 60 seconds.
- Tests: integration test of counts; socket test.

### F-561: Inbox suggestion cards
- Priority: P2. Milestone: M11.
- Description: Read-only cards on three Inbox views.
- Current app: none.
- Mockup: All view: "The GH₵840 Logiswift shortfall has no owner" (Remind me Monday 09:00; Start a team thread). Reminders view: "3 reminders are overdue; 2 are Kofi's" (Nudge Kofi on WhatsApp; Reschedule all to tomorrow). Notification settings: "Kwesi gets no alert when a payout is short" (Turn on for Delivery; Ignore).
- Acceptance criteria:
  - [ ] Cards come from the problem finders and show only when true.
  - [ ] "Remind me Monday 09:00" opens the new-reminder form pre-filled with the payout linked and the date. "Start a team thread" opens New thread with the payout as the subject. A person clicks the final button in each case (G10).
  - [ ] "Nudge Kofi" and "Reschedule all" as in F-552. "Turn on for Delivery" as in F-555.
  - [ ] Amounts in the text are computed (the GH₵840 payout shortfall comes from Finance, area C).
- Data: none. API: `GET /api/inbox/insights`.
- Permissions: owner, admin, manager.
- Edge cases and errors: none.
- Tests: component test that no card writes without a confirm.

---

## 5. Cross-area dependencies

| Needed | Area / range | Used by |
|---|---|---|
| Order state machine (`transitionOrder`, events `order.created`, `order.status_changed`), assign function, `firstContactAt`, `requiresManualCall` | Orders, file 03, F-301, F-302, F-304, F-314, F-317, F-357 | F-466, F-506, F-509, F-510, F-511 |
| Customer page, order drawer (embed blocks for messages, thread, reminder) | file 03, F-321, F-325, F-326, F-354 | F-464, F-552, F-553 |
| Phone normalization | file 03, F-362 | F-452, F-457 |
| Shared confirm dialog | file 03, F-328 | F-457, F-501 |
| Tenant scope of new models | file 03, F-363 | F-450, F-552, F-553 |
| Region list of the store's country | file 04, F-413 | F-457, F-508, F-511 |
| `payment.settled` hook | file 04, F-406 | F-507 |
| Checkout success screen text for auto-confirm | file 04, F-421 | F-466 |
| Partner list, availability, blocked partners, days to pay (F-704) | Deliveries, B2, F-700 range | F-511 |
| Stock events (`stock_gap`, `stock_incoming`), stock errors on sync | Stock, B2, F-650 range | F-557, F-559 |
| Rep screen shell (F-750), Queue timer and tags (F-754), auto-confirm rep side (F-764), rep inbox screen (F-763), outcomes (F-757) | Rep screen, B2, F-750 range | F-466, F-558 |
| Agent app shell (F-800), agent inbox screen and reply sheet (F-812), More screen with notification switches (F-813) | Agent app, B2, F-800 range | F-559, F-555 |
| Payout events, finding events, commission ledger, delivery fee posting (F1 to F4) | Finance, C, F-900 range | F-557, F-558, F-559 |
| Targets and rewards events (100%, 120%, month close) | Targets, C, F-1100 range | F-557 |
| Connections: provider cards, message unit prices, operating hours (Settings → Operations), notifications link in Settings | Connections and Settings, C, F-1150 and F-1200 range | F-451, F-457, F-466, F-555 |
| Problem finders and suggestion cards framework; AI write tools (M12) | AI drawer and MCP, A, F-1300 range | F-467, F-515, F-516, F-561 |
| Bell and sidebar pill; tenant-scoped socket rooms | Shell, A, F-100 range | F-550, F-560 |
| KPI service for medians and the confirmation rate | Dashboard and KPI, A, F-200 range | F-466 |

## 6. Coverage table

### 6.1 Section 1.6 Messages (13 rows)

| Row | Feature | Covered by |
|---|---|---|
| MS-01 | Conversations (two-way) | F-454, with F-450 and F-452 |
| MS-02 | Overview stats | F-455 |
| MS-03 | Message history table with filters | F-456 |
| MS-04 | Bulk send | F-457 |
| MS-05 | Recipient preview table | F-458 |
| MS-06 | Email composer | F-459 |
| MS-07 | Campaigns | F-460 |
| MS-08 | Templates | F-461 |
| MS-09 | Email templates | F-461 |
| MS-10 | Opt-outs | F-462 |
| MS-11 | Scheduled sends | F-463 |
| MS-12 | Message status tracking | F-453, with F-450 and F-464 |
| MS-13 | Public unsubscribe page | F-465 |

### 6.2 Section 1.17 Inbox (7 rows)

| Row | Feature | Covered by |
|---|---|---|
| IB-01 | Feed: All, Mentions, Alerts, Done | F-550 |
| IB-02 | Assigned to me | F-551 |
| IB-03 | Reminders | F-552 |
| IB-04 | Team threads | F-553 |
| IB-05 | Snooze, mark done, set reminder | F-554 |
| IB-06 | Notification settings | F-555 |
| IB-07 | Mention a teammate | F-556 |

### 6.3 Section 1.18 Workflows (15 rows)

| Row | Feature | Covered by |
|---|---|---|
| WF-01 | Workflow list | F-500 |
| WF-02 | KPI tiles | F-500 |
| WF-03 | Active switch | F-501 |
| WF-04 | Run manual workflow | F-502 |
| WF-05 | Execution history | F-503 |
| WF-06 | Template gallery | F-504 |
| WF-07 | Builder: 5 steps | F-505 |
| WF-08 | Triggers: order created, status change, manual | F-506 (manual in F-502) |
| WF-09 | Triggers: payment received, schedule, webhook | F-507 |
| WF-10 | Conditions | F-508 |
| WF-11 | Actions | F-509 (engine in F-510) |
| WF-12 | Assign by region | F-511 |
| WF-13 | Also assign orders with no one yet | F-512 |
| WF-14 | Test run | F-514 |
| WF-15 | "Describe a workflow and I'll build it" | F-515 |

### 6.4 Section 3 broken items covered here (7 rows)

| Row | Item | Covered by |
|---|---|---|
| 3-#3 | Notification toggles do nothing | F-555 |
| 3-#4 | `MessageTemplates` not mounted; `notificationTemplates` unused | F-461 |
| 3-#13 | Workflow `update_order` and `assign_agent` skip `orderService` | F-510 (and F-509 migration) |
| 3-#14 | `http_request` mock; `wait` blocks a worker; two runners | F-510 |
| 3-#15 | Triggers `payment_received`, `time_based`, `webhook` never fire | F-507 |
| 3-#40 | Round-robin index in memory | F-513 |
| 3-#43 | `emailTemplate.service` has no UI | F-461 |

### 6.5 Section 4 mockup fixes covered here (3 rows)

| Row | Issue | Covered by |
|---|---|---|
| 4-#9 | Agent app has its own notification switches | F-555, F-559 |
| 4-#18 | Messages totals disagree (2,860 vs 4,070; tab 38 vs list 26) | F-455, F-454 |
| 4-#28 | "Shopify order import" workflow with no Shopify connection | F-504 |

### 6.6 Count check

| Section | Rows in matrix for this file | Rows in this table |
|---|---|---|
| 1.6 Messages | 13 | 13 |
| 1.17 Inbox | 7 | 7 |
| 1.18 Workflows | 15 | 15 |
| Section 3 broken | 7 | 7 |
| Section 4 fixes | 3 | 3 |
| Total | 45 | 45 |

Auto-confirm (decision 6, matrix row RE-11) has no row in these sections. It is covered by F-466 (rep screen row RE-11 stays with area B2 for the rep UI part).

F-IDs written in this file: F-450 to F-467 (18), F-500 to F-516 (17), F-550 to F-561 (12). Total 47.
