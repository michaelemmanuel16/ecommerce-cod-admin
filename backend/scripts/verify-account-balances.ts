#!/usr/bin/env ts-node
/**
 * verify-account-balances.ts
 *
 * Checks that every active GL account's stored currentBalance matches
 * the sum of its AccountTransaction history (within a 0.01 tolerance).
 *
 * Usage: npm run verify:balances
 * Exit code 0 = all balanced, exit code 1 = discrepancies found
 */

import { GLAccountService } from '../src/services/glAccountService';

async function main() {
  console.log('Verifying GL account balances...\n');

  const result = await GLAccountService.verifyAllAccountBalances();

  console.log(`Accounts checked: ${result.totalAccounts}`);
  console.log(`Unbalanced:       ${result.unbalanced.length}`);

  if (result.unbalanced.length === 0) {
    console.log('\nAll account balances verified. No discrepancies found.');
    process.exit(0);
  }

  console.log('\nDiscrepancies detected:');
  console.log('─'.repeat(55));
  for (const entry of result.unbalanced) {
    console.log(`  Account ${entry.code} (id=${entry.accountId}): difference = ${entry.difference.toFixed(4)}`);
  }
  console.log('─'.repeat(55));
  console.log(`Max difference: ${result.maxDifference.toFixed(4)}`);
  console.log('\nACTION REQUIRED: Run reconciliation or contact support.\n');

  process.exit(1);
}

main().catch((err) => {
  console.error('Error running balance verification:', err);
  process.exit(1);
});
