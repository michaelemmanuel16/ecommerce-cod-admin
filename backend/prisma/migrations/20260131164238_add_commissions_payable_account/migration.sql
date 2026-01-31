-- Insert Commissions Payable GL account for Net Collection Accountability
-- This account tracks commissions owed to Sales Representatives
-- Agents are accountable for Gross - Agent Commission, so Sales Rep commissions become a liability

INSERT INTO accounts (code, name, account_type, normal_balance, current_balance, created_at, updated_at)
VALUES (
  '2020', 
  'Commissions Payable', 
  'liability', 
  'credit', 
  0, 
  NOW(), 
  NOW()
)
ON CONFLICT (code) DO NOTHING;