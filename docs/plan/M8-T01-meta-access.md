# M8-T01: Meta access check (2026-11-11)

Result: the live pull can run now. No App Review now. No CSV fallback.

## App
- CodAdmin uses Meta app **COD Admin Pro** (`1598135364755354`), Live mode, business portfolio `519872910295311`.
- Use cases already on: "Measure ad performance data with Marketing API" and "WhatsApp". Nothing to add.
- Graph API: code uses v21.0 (available until 2027-01-21). Latest is v27.0. **Ads calls use v25.0** (supported to 2028-07-29). WhatsApp calls stay on v21 for now (move later, not in M8).

## Access and App Review
- Standard/Limited access to `ads_read` is enough when the app reads only its own business's ad accounts. App admins and developers can call for ad account admins. Source: https://developers.facebook.com/docs/marketing-api/overview/authorization
- Other stores' ad accounts need Advanced Access (App Review per permission) and Business Verification. Moved to Backlog: needed when the first other store connects.

## Scopes
- `ads_read` (insights) and `business_management` (list the business's ad accounts). Separate scope set from WhatsApp; the WhatsApp login is not changed.

## Token
- Live check: a SYSTEM_USER token in the same business (`expires_at: 0`, never expires) reads `act_864465431329981` insights with `ads_read`.
- Use a **system user token** from Facebook Login for Business (business integration system user token, "default to never expire"). Source: https://developers.facebook.com/docs/facebook-login/facebook-login-for-business/
- Fallback if that configuration is not possible: a 60-day long-lived user token with a re-login prompt (token health alert at 7 days).
- Token health still needed: a system user token can be revoked (user removes the app or the system user). Daily `debug_token` check sets Disconnected + alert.

## Rate limits
- Ads Insights is a Business Use Case limit. Standard tier: calls per hour = 600 + 400 x active ads - 0.001 x user errors. Header `X-Business-Use-Case-Usage` gives `call_count` %. Error 80000 (subcode 2446079) = Ads Insights limit; also 4, 17, 613. Back off when usage nears 100% or on those codes. Source: https://developers.facebook.com/docs/graph-api/overview/rate-limiting
- One campaign-level call per account per day (3 days, `time_increment=1`) is far under the limit.

## Fields (verified live on v25.0, MG account, last_7d, level=campaign, time_increment=1)
- `account_currency` (MG = **NGN**; the store is GH₵, so FX conversion is needed), `campaign_id`, `campaign_name`, `date_start`, `spend`, `impressions`, `inline_link_clicks`.
- From `actions`: `link_click`, `landing_page_view`, `offsite_conversion.fb_pixel_initiate_checkout` (checkouts started; `omni_initiated_checkout` also present, do not sum both).
- `attribution_setting` returns `multiple` -> use the account default; do not override.

## Late changes
- Insights refresh every 15 minutes and can change for a couple of days; they do not change after 28 days. The 3-day daily re-pull is right. Source: https://developers.facebook.com/docs/marketing-api/insights/best-practices

## Decisions
1. App Review now: **no**.
2. Token: **system user token** (fallback 60-day user token).
3. CSV fallback (T02): **not needed**, moved to Backlog.
4. Graph version for ads: **v25.0**.
