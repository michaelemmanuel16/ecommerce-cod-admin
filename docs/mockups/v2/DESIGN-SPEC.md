# CodAdmin v2 mockups: design spec for builders

Owner approved the look in `index.html` (Dashboard, Orders, Targets, Leaderboard, North Star setup). Every new screen must look like it belongs to that same app. Read `index.html` and `app.css` fully before you start.

## What CodAdmin is
A COD (cash-on-delivery) e-commerce admin for a Ghana seller (Manny Dynamics, main product Magic Groove copybooks, GH₵249 per order). Orders come from Meta ads. Call reps confirm orders by phone. Delivery is done by delivery agents (individuals) or 3PL companies (Logiswift today). Agents and 3PLs collect cash and pay it back later. The owner works toward an annual **North Star** (GH₵1,800,000 delivered revenue in 2026), split into quarterly, monthly and per-role targets.

Feel: high-end, modern agentic SaaS. A professional e-commerce admin like Salesgee / Salesunbox / Sniper, but cleaner. Easy to scan. A light game layer: targets, role leaderboards, rewards and result badges.

## Hard rules
1. **Shell:** copy the `<head>`, sidebar `<aside class="side">`, top bar `<header class="top">`, agent drawer, ⌘K palette, sample-data pill and the `<script>` from `index.html` exactly. Remove only the view-switching code you do not need. In the sidebar, set `class="nav on"` on your page's link (find it by `data-page="yourfile.html"`) and remove `on` from Dashboard.
2. **CSS:** link `app.css`. `app.css` and `shell.js` are shared: change them only for a component every page uses. Put any new CSS for your page in a `<style>` block in your own file, built only from the tokens in `app.css` (`--pine --mint --gold --coral --violet --ink --ink-2 --ink-3 --bg --card --line --hover` and their `-soft` versions). It must work in dark mode (the moon button sets `data-theme="dark"`). No new colours, no new fonts.
3. **Reuse components** from `app.css`: `.head`, `.card`, `.ct`, `.grid`, `.kpis/.kpi`, `.two`, `.tag.ok/.bad/.warn/.v/.n`, `.prog` with `.pace`, `.who`, `.tabs/.tab`, `.filters`, `.btn/.btn.pri`, `.mini`, `.insight` (agent suggestions), `.drv`, `.seg`, tables, `.tablewrap`.
4. **No XP, no levels, no streaks.** Rewards and badges come only from hitting or beating a target.
5. **Roles:** roles are given in Staff & roles. A role can be held by a human, an AI agent or a company. An AI agent is never its own group; it is scored under the role it holds (e.g. Call rep). Delivery agent (person) and 3PL (company) are the same **Delivery** role.
6. **Agentic:** every page has 1–3 agent suggestion cards (`.insight` with `sparkles` icon, violet) that find a real problem on that page and offer a one-click action.
7. **Data:** realistic sample data. Ghana names (Akan/Ga/Ewe), Ghana cities (Accra, Kumasi, Tema, Takoradi, Cape Coast, Tamale), GH₵ for revenue, ₦ for Meta ad spend. Numbers must agree with the dashboard: October delivered GH₵92k of GH₵180k target, delivery success 48% (target 60%), confirmation 71%, CPA ₦5,903 (max CPA ₦7,040 at the 34% yield, it moves with the yield), GH₵23.4k cash still with agents/3PLs, 38 orders unpaid over 8 days, Logiswift payout short GH₵840, Magic Groove stock 12 units short at Logiswift.
8. **Copy:** short, plain, active voice, sentence case. Name things the way a seller would. No ALL-CAPS labels, no "→" on buttons, no emojis.
9. **Quality:** icons from lucide (already loaded; call `lucide.createIcons()`). Responsive down to 760px (existing media queries). Visible focus. Each page is one self-contained HTML file in this folder.

## After building
Screenshot each page with headless Chrome (light and dark) and look at it:
`"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --disable-gpu --hide-scrollbars --window-size=1440,1400 --virtual-time-budget=6000 --screenshot=OUT.png file:///ABS/PATH.html`
For dark mode, copy the file to your scratch dir with `data-theme="light"` changed to `"dark"` (keep `app.css` reachable via an absolute `href`). Fix anything broken, cramped, overlapping or off-palette. Report: files created, one line per page on what it contains, and the screenshot paths.

---

# Round 2 (owner approved 17 Oct)

The owner said the first round skipped many features the current app already has. Round 2 brings them back. **Grounding:** before you design a screen, read the current app page named in your brief (under `/Users/mac/work/codadmin/frontend/src/`). Carry over every feature it has, redesigned in this style. Do not drop features. Do not invent large features that were not asked for.

## Shell (changed)
- The sidebar was regrouped (Dashboard, Inbox / Sell / Stock / Money / Team / Setup) and the bell now links to `inbox.html`. Every existing page is already updated. **Copy the shell from `products.html`** (by markers, not line numbers), and set `on` on your own page's link (`data-page="yourfile.html"`).
- Still do NOT edit `app.css`. Only the builder who owns `index.html` may edit it.

## Rules added in round 2
1. **No Logiswift sync UI anywhere.** The sync runs outside the app (a local scheduled agent). Do not show sync status, "Retry sync", "Sync late", "last run 06:30" or sync-failure cards. Logiswift data (orders, stock counts, payouts) still appears as normal data.
2. **No Kanban board view.**
3. **Manual order assignment is new:** orders can be assigned to a call rep or a delivery agent per row and in bulk.
4. **Notifications, reminders and team threads** live in `inbox.html`. Other pages link to them using these shared parts:
   - "Set reminder" button: opens a small popover (what, when, who: me or a teammate).
   - "Team notes" thread on an order, customer, payout or product: comments, @mentions, replies.
   - A small "3 replies" or "Reminder 18 Oct, 09:00" chip where one exists.
5. **Customer messages are tracked** in `messages.html`: each message shows sent, delivered, read, failed or replied, and customer replies appear in a conversation view.

## Fix pass (19 Oct 2026)
The v2 mockups were corrected against `docs/prd/gap-matrix.md` section 4 and `docs/prd/decisions.md` (O1 to O7 win over older items). Shared behaviour (toast, confirm dialog, account menu, agent chat, dismiss on cards) lives in `shell.js`, loaded by every page. Charts of accounts use the live codes. The app is English only and country-agnostic: the store currency follows the country and is not locked. Direct-write agent cards open a confirm dialog and change nothing until a person confirms.

## Sample data (round 1 final, use exactly)
- October 1–17: 1,445 orders, 1,026 confirmed (71%), 376 delivered (delivery success 48% of closed orders, yield 34%), GH₵92k delivered revenue. Meta spend ₦8.53M (about GH₵76k), CPA ₦5,903. Net result −GH₵14.3k (−16%) by delivery date, after rep commission. Aug +12%, Sep +12%. `NUMBERS.md` is the single source for every sample figure; where this file and `NUMBERS.md` differ, `NUMBERS.md` wins.
- Call rep role target 1,300 confirmed: Adwoa Darko 640/760, Confirm agent (AI agent) 328/450, Nana Kyei 58/90.
- Delivery role (target 60% delivery success): Kofi Appiah (Kumasi, 54%), Esi Badu (Accra, 55%), Kwesi Amoah (Takoradi, 54%), Logiswift (3PL, Accra and Tema, 45%), Kasapa Express (3PL trial, Cape Coast, no closed orders yet). One term for what we pay whoever delivers: "delivery fee". The partner keeps it from the cash it collects. There is no agent pay.
- Rewards (cash tiers only, set only in Settings, Rewards): Call rep 100% GH₵300 bonus, 120% GH₵500 + paid day off. Delivery 100% GH₵250, 120% GH₵400 + paid day off. Companies and AI agents get no payout.
- Team: Manny (owner, also Finance clerk and Marketing), Adwoa, Nana, Confirm agent, Kofi, Esi, Kwesi, Logiswift, Kasapa Express, "Manny's Claude" (AI agent, Marketing).
- Products: Magic Groove copybook set GH₵249 (MG-CB-SET), refill pens GH₵40, pencil grip trainer GH₵35, Smart Parent's Home Study Guide GH₵59 (digital). Stock: copybook set Logiswift 100 (they count 88), Kofi 36.
- Integrations in the current app: Arkesel SMS, WhatsApp Business (Meta), email (SendGrid / Resend / SMTP), Paystack, webhooks (order import), AI assistant MCP keys. Meta Ads is new.

## Screenshots
Use your own `--user-data-dir` for headless Chrome, or it hangs while the owner's Chrome is open. Save screenshots to `scratchpad/r2/<builder>/`.
