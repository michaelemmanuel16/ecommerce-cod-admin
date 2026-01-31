-- Insert Commissions Payable GL account for Net Collection Accountability
-- This account tracks commissions owed to Sales Representatives
-- Agents are accountable for Gross - Agent Commission, so Sales Rep commissions become a liability

INSERT INTO "Account" (code, name, "accountType", "normalBalance", "currentBalance", "createdAt", "updatedAt")
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