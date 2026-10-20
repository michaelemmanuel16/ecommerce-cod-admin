# M1-T06 backfill counts

Script: `backend/scripts/backfill-order-timestamps.ts` (`npm run backfill:order-timestamps`). Dry run is the default; `--apply` writes.
Run on the local dev database `ecommerce_cod` (copy of production) on 2026-10-20. One run takes under 3 seconds.

## What "applies" means
"Applies" is the set of orders whose current status says the field should exist.

| Field | Applies to current status | Source row |
|---|---|---|
| confirmedAt (and confirmedById) | confirmed, preparing, ready_for_pickup, out_for_delivery, delivered, failed_delivery, returned | first `confirmed` history row |
| dispatchedAt | out_for_delivery, delivered, failed_delivery, returned | first `out_for_delivery` row, else first `delivered` row |
| firstContactAt | same as confirmedAt | earliest call of the order (every call has a rep) |
| returnedAt | returned | first `returned` history row, whatever the current status |

The fill does not look at the current status. An order that was returned and then moved on still gets `returnedAt`.
That is why some fills land "outside applies".
`confirmedById` is set only together with `confirmedAt`, and only when the history row's `changed_by` is a user.
A value that is already set is never overwritten. No source row means the field stays empty.

## Note: which fields are mostly empty
- `confirmedAt` is mostly empty. Only 629 of 7,026 orders have it. The old system rarely wrote a `confirmed` history row.
- `firstContactAt` is mostly empty. Only 465 of 7,026 orders have it. Most orders have no call record.
- `dispatchedAt` is mostly filled. 6,565 of 7,022 orders have it.
- `returnedAt` is full. 479 of 479 returned orders have it.

Empty rows are left out of medians. A median of "confirmed to dispatched" uses only the orders that have both values.
Today that is a small group (at most 659 orders), so it may not match the whole business.
A median of "time to first call" uses at most 1,147 orders.
Show the sample size next to each median. New orders will be complete, because M1-T08 writes these fields on every move.

## Dry run
```
MODE: dry run (no writes)
tenant 304c8ef8-88d4-44c4-a13d-d26d7fdc0fcb: 6 orders
  confirmedAt: applies 2, already set 0, would fill 0, still empty 2 (plus 1 would be filled on orders outside "applies")
  dispatchedAt: applies 2, already set 0, would fill 2, still empty 0 (plus 1 would be filled on orders outside "applies")
  firstContactAt: applies 2, already set 0, would fill 0, still empty 2
  returnedAt: applies 0, already set 0, would fill 0, still empty 0
tenant 86330bd5-7d44-40c5-98ad-e480a9882530: 15781 orders
  confirmedAt: applies 7024, already set 0, would fill 629, still empty 6395 (plus 29 would be filled on orders outside "applies")
  dispatchedAt: applies 7020, already set 0, would fill 6563, still empty 457 (plus 436 would be filled on orders outside "applies")
  firstContactAt: applies 7024, already set 0, would fill 465, still empty 6559 (plus 682 would be filled on orders outside "applies")
  returnedAt: applies 479, already set 0, would fill 479, still empty 0 (plus 19 would be filled on orders outside "applies")
Total: 15787 orders in 2 tenant(s)
  confirmedAt: applies 7026, already set 0, would fill 629, still empty 6397, would fill in all 659
  dispatchedAt: applies 7022, already set 0, would fill 6565, still empty 457, would fill in all 7002
  firstContactAt: applies 7026, already set 0, would fill 465, still empty 6561, would fill in all 1147
  returnedAt: applies 479, already set 0, would fill 479, still empty 0, would fill in all 498
npm run -s backfill:order-timestamps  1.84s user 0.19s system 145% cpu 1.390 total
```

## Real run
```
MODE: apply (writes)
tenant 304c8ef8-88d4-44c4-a13d-d26d7fdc0fcb: 6 orders
  confirmedAt: applies 2, already set 0, filled 0, still empty 2 (plus 1 filled on orders outside "applies")
  dispatchedAt: applies 2, already set 0, filled 2, still empty 0 (plus 1 filled on orders outside "applies")
  firstContactAt: applies 2, already set 0, filled 0, still empty 2
  returnedAt: applies 0, already set 0, filled 0, still empty 0
tenant 86330bd5-7d44-40c5-98ad-e480a9882530: 15781 orders
  confirmedAt: applies 7024, already set 0, filled 629, still empty 6395 (plus 29 filled on orders outside "applies")
  dispatchedAt: applies 7020, already set 0, filled 6563, still empty 457 (plus 436 filled on orders outside "applies")
  firstContactAt: applies 7024, already set 0, filled 465, still empty 6559 (plus 682 filled on orders outside "applies")
  returnedAt: applies 479, already set 0, filled 479, still empty 0 (plus 19 filled on orders outside "applies")
Total: 15787 orders in 2 tenant(s)
  confirmedAt: applies 7026, already set 0, filled 629, still empty 6397, filled in all 659
  dispatchedAt: applies 7022, already set 0, filled 6565, still empty 457, filled in all 7002
  firstContactAt: applies 7026, already set 0, filled 465, still empty 6561, filled in all 1147
  returnedAt: applies 479, already set 0, filled 479, still empty 0, filled in all 498
npm run -s backfill:order-timestamps -- --apply  1.83s user 0.20s system 75% cpu 2.680 total
```

## Real run again (must fill 0)
```
MODE: apply (writes)
tenant 304c8ef8-88d4-44c4-a13d-d26d7fdc0fcb: 6 orders
  confirmedAt: applies 2, already set 0, filled 0, still empty 2
  dispatchedAt: applies 2, already set 2, filled 0, still empty 0
  firstContactAt: applies 2, already set 0, filled 0, still empty 2
  returnedAt: applies 0, already set 0, filled 0, still empty 0
tenant 86330bd5-7d44-40c5-98ad-e480a9882530: 15781 orders
  confirmedAt: applies 7024, already set 629, filled 0, still empty 6395
  dispatchedAt: applies 7020, already set 6563, filled 0, still empty 457
  firstContactAt: applies 7024, already set 465, filled 0, still empty 6559
  returnedAt: applies 479, already set 479, filled 0, still empty 0
Total: 15787 orders in 2 tenant(s)
  confirmedAt: applies 7026, already set 629, filled 0, still empty 6397, filled in all 0
  dispatchedAt: applies 7022, already set 6565, filled 0, still empty 457, filled in all 0
  firstContactAt: applies 7026, already set 465, filled 0, still empty 6561, filled in all 0
  returnedAt: applies 479, already set 479, filled 0, still empty 0, filled in all 0
npm run -s backfill:order-timestamps -- --apply  1.78s user 0.18s system 149% cpu 1.306 total
```
