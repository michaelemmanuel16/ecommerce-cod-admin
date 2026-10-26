-- M5-T07: a verified deposit records which collections it matched (FIFO), so a rejected deposit reverses exactly those.
ALTER TABLE "agent_deposits" ADD COLUMN "allocations" JSONB;
