# Bulk Order Operations Documentation

This document outlines the technical details, limits, and validation rules for bulk order operations in the E-Commerce COD Admin Dashboard.

## Architecture

Bulk operations are handled through a combination of:
- **`bulkOrderController.ts`**: Handles file uploads (CSV/XCEL), initial validation, and multi-part form data parsing.
- **`orderService.ts`**: Orchestrates the database transactions, customer creation, and order placement.
- **`bulkOrderConfig.ts`**: Centralized configuration for all limits and constants.

## Limits & Constraints

To ensure system stability and prevent resource exhaustion, the following limits are enforced:

| Feature | Limit | Rationale |
|---------|-------|-----------|
| **Export Record Limit** | 500 records | Prevents memory issues on the server and client. |
| **Import File Size** | 10MB | Prevents DoS attacks and memory exhaustion. |
| **Import Batch Size** | 50 orders | Optimizes database transactions and socket progress updates. |
| **Duplicate Window** | 24 Hours | Prevents accidental double-imports of the same file. |

## Rate Limiting

Endpoints are protected by `express-rate-limit`:
- **Exports**: 5 requests per 5 minutes.
- **Imports**: 3 requests per 10 minutes.

## Validation Rules

### Input Sanitization
All inputs go through a multi-stage sanitization process:
1. **HTML Escaping**: All strings are escaped to prevent XSS.
2. **Name Stripping**: Customer names are stripped of non-alphabetic/Unicode characters and tags.
3. **Phone Sanitization**: Only digits, `+`, `-`, and spaces are preserved initially.

### Strict Validation (Post-Sanitization)
Orders are rejected if they do not meet these criteria after sanitization:
- **Phone Number**: Must contain between 10 and 15 digits.
- **Address**: Minimum 5 characters long.
- **Total Amount**: Must be a positive number greater than 0.

## Performance Optimization

### Parallel Processing
Bulk imports use **Parallel Batch Processing**. Within each batch (default 50), orders are processed concurrently using `Promise.allSettled()`. This provides a significant speedup over sequential processing while keeping database connection usage within safe bounds.

### User Experience
Real-time progress updates are emitted via WebSocket:
- Event: `bulk_import_progress`
- Data: `{ progress, processed, total, success, failed, duplicates }`
