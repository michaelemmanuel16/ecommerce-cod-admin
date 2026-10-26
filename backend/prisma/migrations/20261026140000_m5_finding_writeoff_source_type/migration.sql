-- M5: a written-off Finding (DR 5100, CR 1015 or 2040) gets its own source type, so a manual journal void can never reach it.
ALTER TYPE "JournalSourceType" ADD VALUE IF NOT EXISTS 'finding_writeoff';
