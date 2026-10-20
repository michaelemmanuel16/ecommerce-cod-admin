# M1-T05 phone normalization: counts

Script: `backend/scripts/normalize-customer-phones.ts` (`npm run normalize:customer-phones`).
Run 2026-10-20 on the local dev database (production dump copy). Dry run is the default; `--apply` writes.

Collision report: `backend/scripts/output/phone-collisions-2026-10-20.csv` (832 rows plus header; git-ignored).
Nothing was merged. Collision rows kept their old phone value (and their alternate phone).

## 1. Dry run

```
MODE: dry run (no writes; pass --apply to write)
tenant 86330bd5-...: 13823 customers, would change 12698, unchanged 111, unparseable 182, collision groups 413 (832 rows), alternate phones would change 10185
tenant 304c8ef8-...: 6 customers, would change 0, unchanged 0, unparseable 6, collision groups 0 (0 rows), alternate phones would change 1
Total: 13829 customers, would change 12698, unchanged 111, unparseable 188, collision groups 413, collision rows 832, alternate phones would change 10186
```

## 2. First `--apply`

```
MODE: apply (writes)
tenant 86330bd5-...: 13823 customers, changed 12698, unchanged 111, unparseable 182, collision groups 413 (832 rows), alternate phones changed 10185
tenant 304c8ef8-...: 6 customers, changed 0, unchanged 0, unparseable 6, collision groups 0 (0 rows), alternate phones changed 1
Total: 13829 customers, changed 12698, unchanged 111, unparseable 188, collision groups 413, collision rows 832, alternate phones changed 10186
```

## 3. Second `--apply` (idempotent)

```
MODE: apply (writes)
tenant 86330bd5-...: 13823 customers, changed 0, unchanged 12809, unparseable 182, collision groups 413 (832 rows), alternate phones changed 0
tenant 304c8ef8-...: 6 customers, changed 0, unchanged 0, unparseable 6, collision groups 0 (0 rows), alternate phones changed 0
Total: 13829 customers, changed 0, unchanged 12809, unparseable 188, collision groups 413, collision rows 832, alternate phones changed 0
```

## Notes

- "unchanged" counts customers already in E.164 and not in a collision group. On run 2 it is 12,698 + 111 = 12,809.
- Unparseable (188) are real bad values: an extra or missing digit (`02444384819`), the letter O for zero (`O548531809`), text ("Hallo die Conny"), 8-digit and 6-digit fragments. They keep their stored value.
- Collision groups are customers of one tenant whose numbers normalize to the same value (for example `0242947101` and `+233242947101` as two rows). The report lists customer id, tenant id, stored phone, normalized phone and order count so the owner can decide what to merge by hand.
