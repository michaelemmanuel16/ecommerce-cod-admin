-- Backfill current_balance for existing accounts based on transaction history
UPDATE accounts a
SET current_balance = COALESCE((
  SELECT SUM(
    CASE 
      WHEN a.normal_balance = 'debit' THEN t.debit_amount - t.credit_amount
      ELSE t.credit_amount - t.debit_amount
    END
  )
  FROM account_transactions t
  WHERE t.account_id = a.id
), 0);
