# M5 — Finance screens: match the v2 mockup

Target: `docs/mockups/v2/finance.html` (+ `app.css`). M5-T34 says "Page matches finance.html in the v2 tokens". Found 2026-10-26 by comparing the mockup source with the built screens (lanes A, B, C merged).

## Rules for all lanes

- Use the mockup classes and tokens: `.head`/`.hd-actions`, `.pgtabs .tab`, `.card`, `.kpi` with `.ic`, `.dt` in `.tablewrap`, `.ct` card titles with aside, `.seg`, `.tag`, `.grid.two`, `.menuwrap .menu .mi`, modal `.mh` subtitle and footer note. No Tailwind `Card`/`Table`/legacy `ui/Modal` look and no `legacy-light` wrapper on any Finance tab.
- Labels and order follow the mockup wording (sentence case).
- Sample numbers in the mockup are not targets. Real data only.
- **Out of M5:** the "Agent found N things" cards (AI suggestion cards, M11). Leave them out; existing server insight cards may stay.
- **Keep (deviation on purpose):** the page date-range picker (M5-T34 needs a date range control). Put it in the header after Export. Per-partner "days to pay" stays (real rule).
- App-only extras not in the mockup: remove them, unless an M5 ticket's acceptance criteria need them. If one is needed, place it where it fits the mockup layout and say so in the report.
- Light and dark mode, 1440 px and 760 px. No dead buttons. Tests updated.

## Lane A — header, tab bar, Overview, header modals (only lane that edits `Financial.tsx`)

1. Header: title "Finance", subtitle built from data (month + what 3PLs and agents owe). Buttons: Add expense (opens Add expense modal), Record payout (opens partner payout modal), Export as `.btn pri` with icon and chevron. Export menu items as in the mockup; "More in Reports" with note "CSV and Excel, any dates".
2. Tab bar: `.pgtabs` pill tabs with icons (layout-dashboard, hand-coins, book-open, badge-percent, trending-up). Order: Overview, Agent collections, Accounting, Rep commissions, Cash-flow forecast. Counts: collections to verify; reps owed. Move `.pgtabs` CSS out of reports.css into a shared place.
3. Overview: Payout reconciliation and "Unpaid delivered orders — By age" (UnpaidByAgeCard) side by side in `.grid.two`. Short-row expansion shows the missing orders with "Message partner" and "Mark as received" actions (wire to existing APIs; if none exists, say so). Cost of failed deliveries as the mockup's two-column breakdown with a total row. Monthly P&L aside "Export CSV". Remove the "as of today" note line if the mockup has none.
4. Record a payout from a partner: reachable from the header; reuse `pages/deliveries/PartnerPayoutModal` with a "Paid by" select; mockup look.
5. Add expense modal: mockup look, "Save expense", footer note "Posts to account 5100"; keep the receipt upload.

## Lane B — Agent collections, Rep commissions, their modals

1. Collections tiles: 4 — Cash with agents and 3PLs, Overdue 8+ days, Collections to verify, Blocked.
2. "Cash exposure by partner" chart from the aging buckets.
3. Page-level "Collections to verify" card: select rows, "Reconcile selected", Review per row.
4. Aging table: "All partners" total row; actions as in the mockup row.
5. Review collection modal: one collection, receipt preview and facts side by side, reject reason from a select list plus a note.
6. Rep commissions: full restyle. Tiles: Commission owed, Paid this month, Per delivered confirmed order, Target rewards earned. Card title with rule aside. Columns as the mockup (Rep with avatar and Human/AI tag, Delivered, Commission, Upsell reward, Earned, Paid in month, Owed, Target reward, Last payout, Action). Payout history card. Fields with no data source yet: show "—" and say so in the report.
7. Record rep payout modal: mockup look, footer "Posts to 2020 Commissions payable".

## Lane C — Accounting, Cash-flow forecast

1. Accounting sub-nav as `.seg`: General ledger, Statements, Profit by product, Expenses.
2. General ledger: chart of accounts and account ledger side by side (`.card`/`.dt`), "New journal entry" button in the toolbar (no banner). Ledger columns Date, Entry, Description, Debit, Credit, Balance.
3. Statements: per-card "Export" buttons.
4. Profit by product: add the "last 3 months" chart (new read-only endpoint if needed, no schema change).
5. Expenses: "Expenses" table and "By category" bars side by side.
6. New journal entry modal: mockup look, Reference field, Empty/Balanced tag, "Post entry".
7. Forecast: one "Cash at bank and MoMo today" tile; remove the Revenue and expenses trend card.
