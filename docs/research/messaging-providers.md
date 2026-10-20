# Messaging providers (SMS, WhatsApp, voice): pass 1

Seen 2026-10-17. Scout pass 1 was partial. A gap-fill pass follows below.
Goal: sellers set up messaging inside CodAdmin, top up a CodAdmin wallet, and send to any number worldwide.

## Confirmed
- Twilio SMS outbound: NG $0.3868/segment; GH $0.3741/segment; GH inbound $0.01/msg. Alphanumeric sender ID (SMS only). https://www.twilio.com/en-us/sms/pricing/ng , /gh. NG figure may be the international-number route; check the CSV.
- Twilio voice NG: $0.2303/min to landline, $0.2349/min to mobile. https://www.twilio.com/en-us/voice/pricing/ng
- Twilio WhatsApp: $0.005/msg Twilio fee + Meta fee ($0.0034 utility/auth on the page), "current as of September 2026". https://www.twilio.com/en-us/whatsapp/pricing
- Termii: WhatsApp Business Account $50/account/month; SMS and voice rates through sales only; USD/NGN/FCFA. https://termii.com/pricing
- Africa's Talking: NG sender ID free, about 1 working day. https://help.africastalking.com/en/articles/2257657-how-do-i-get-a-sender-id-in-nigeria . Pricing page returned 403.
- Infobip: no public per-message rates (sales-led).

## Unverified
- GH SMS (aggregator, undated): Plivo $0.015155; Sinch $0.029185; Twilio $0.03065; Infobip $0.032284. https://www.sent.dm/resources/ghana-sms-pricing . Note: the Twilio figure here conflicts with Twilio's own page ($0.3741).
- Nigeria sender ID: per-network registration under NCC rules (MTN strictest); timelines reported from days to 2-3 weeks. https://www.telerivet.com/blog/nigeria-sms-sender-id-dnd-compliance
- Ghana: NCA sender ID registration; promo window reported as 8am-7pm Mon-Sat. https://www.telerivet.com/blog/ghana-sms-compliance-nca-sender-id-registration-and-act-843

## Pass 1 ranking (provisional)
1. Twilio: one API for SMS, WhatsApp and voice; NG/GH SMS is expensive.
2. Africa's Talking: Africa focus, fast NG sender IDs; prices not seen.
3. Plivo: cheaper GH SMS (aggregator figure only).

## Early signal
On confirmed prices, a WhatsApp utility message (about $0.008) costs about 2% of a Twilio SMS to NG/GH (about $0.38).

## Not verified yet
Vonage, Telnyx, Sinch, Bird, 360dialog, Gupshup, Hubtel, Arkesel, mNotify, BulkSMSNigeria prices; Africa's Talking rates; WhatsApp Tech Provider / embedded signup terms; sub-accounts and resale with markup; minimum top-ups; two-way numbers in NG and GH; payment from a Nigerian company.

---

# Pass 2: gap fill (2026-10-17)

## WhatsApp per seller (Tech Provider + Embedded Signup)
- Twilio: needs a Meta-approved app and a Partner Solution link to Twilio. Each seller logs in with Facebook, creates or picks a WABA, and verifies the number by OTP. Approval "usually takes 3-4 weeks". https://www.twilio.com/en-us/whatsapp/tech-provider-program CONFIRMED.
- Vonage: same hosted flow (Solution ID), limited to 10 registrations per number per week. https://developer.vonage.com/en/channel-manager/guides/whatsapp/hosted-es-flow (search snippet only).
- 360dialog, Gupshup, Infobip, Meta Cloud API direct: NOT CHECKED.

## Meta per-message rates
- Rate card effective 1 July 2026. Ghana and Kenya fall under "Rest of Africa"; Nigeria and UK have their own rows. Values not retrieved. https://developers.facebook.com/docs/whatsapp/pricing
- Twilio shows a Meta fee of $0.0034 for utility/auth (page "current as of September 2026"). A secondary source gives NG utility $0.01 and marketing $0.06 (older card). CONFLICT, so read Meta's CSV before pricing.
- Who pays Meta under a Tech Provider (the seller's WABA or us): UNKNOWN.

## Sub-accounts
- Twilio: API-created; one shared balance billed to the main account; default cap 1,000; suspension of main suspends all. https://www.twilio.com/docs/iam/api/subaccounts CONFIRMED. Resale terms not checked.
- Plivo: own credentials, logs and webhooks per sub-account; charged to the parent balance; reseller/white-label listed as a use case, no terms. https://www.plivo.com/docs/account/concepts/subaccounts CONFIRMED.

## SMS prices
- Plivo NG: MTN $0.2729, Airtel $0.4165, Glo $0.5423, other $0.3199. https://www.plivo.com/sms/pricing/ng/ CONFIRMED.
- Hubtel GH: GHS 0.033/SMS gateway; bundles down to about GHS 0.016. https://explore.hubtel.com/?p=77 , ?p=19. The two pages disagree.
- Vonage, Telnyx, Sinch, Bird, Termii, Arkesel, mNotify: not retrieved.

## Africa's Talking
- NG voice: NGN 15/min outgoing; NGN 3/min SIP and incoming; number NGN 5,000/month + VAT. https://help.africastalking.com/en/articles/6054867-voice-pricing-nigeria (page "updated over 3 years ago").
- SMS prices for NG/GH: not found (pages 403).

## Signup
- Twilio Nigeria numbers need a Regulatory Compliance Bundle (third-party source, UNVERIFIED). Payment options for a Nigerian company not confirmed.

## Pass 2 ranking
1. Twilio: only confirmed per-seller WhatsApp onboarding + sub-accounts. NG/GH SMS is expensive.
2. Vonage: same WhatsApp onboarding pattern; prices not checked.
3. Plivo: sub-accounts; cheaper NG SMS than Twilio; no per-seller WhatsApp found.

## Still open
Meta rate values and who pays; Africa's Talking SMS prices; GH voice prices; resale/markup terms; Nigerian payment/KYC; 360dialog/Gupshup/Infobip/Meta direct.
