-- M5: commission accrual entries (DR 5050, CR 2020) get their own source type, so a manual journal void can never reach them.
ALTER TYPE "JournalSourceType" ADD VALUE IF NOT EXISTS 'commission_accrual';
