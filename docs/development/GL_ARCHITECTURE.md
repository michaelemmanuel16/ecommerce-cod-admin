# General Ledger System Architecture

This document outlines the technical design, data model, and safeguards implemented in the General Ledger (GL) system.

## 1. Core Principles

The system follows standard **Double-Entry Accounting** principles:
- **Balance Sheet Equality**: Assets = Liabilities + Equity.
- **Journal Entries**: Every entry must have at least two transactions (one debit, one credit) that balance to zero.
- **Normal Balances**:
    - **Debit Accounts**: Assets and Expenses (Debits increase, Credits decrease).
    - **Credit Accounts**: Liabilities, Equity, and Revenue (Credits increase, Debits decrease).

## 2. Data Model

### Accounts (`accounts` table)
Stores the Chart of Accounts with hierarchical parent-child relationships.
- `code`: 4-digit unique identifier (e.g., 1010 for Cash).
- `current_balance`: Atomic rolling balance updated via transactions.
- `is_system`: Boolean flag for protected accounts (e.g., Accounts Receivable) that cannot be deleted.

### Journal Entries (`journal_entries` table)
The header of an accounting transaction.
- `entry_number`: Unique sequential ID (e.g., JE-20260124-00001).
- `source_type`: Categorizes the origin (manual, sale, payout, reversal).

### Account Transactions (`account_transactions` table)
The individual line items (legs) of a journal entry.
- `debit_amount` / `credit_amount`: Decimal values (19,4 precision).
- `running_balance`: The account's balance *at the time* of this transaction, enabling historical ledger viewing.

## 3. Concurrency & Performance

### Row-Level Locking
To prevent race conditions during concurrent balance updates, the system implements **Pessimistic Locking**:
- When updating a balance, `SELECT ... FOR UPDATE` is used to lock the account row until the transaction commits.
- This ensures that if two orders are placed simultaneously, their ledger updates are serialized, maintaining data integrity.

### Pagination & Streaming
- **API Lists**: All account and ledger lists are paginated (default 50 items) to ensure fast response times as the dataset grows.
- **CSV Exports**: Large ledger exports are fetched in manageable chunks (2000 records) to prevent memory overflow.

## 4. Audit & Security

### High-Fidelity Logging
- Every manual journal entry stores the `createdBy` ID of the accountant who performed the adjustment.
- All structural changes (creating/deactivating accounts) are recorded in the global `audit_logs` table with full metadata.

### Voiding Strategy
- Journal entries are never physically deleted.
- Voiding an entry creates a **Reversing Entry** with swapped debits/credits, ensuring the audit trail accurately reflects the correction.
