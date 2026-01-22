/**
 * Configuration constants for bulk order operations
 */

export const BULK_ORDER_CONFIG = {
  // Export limits
  EXPORT_MAX_RECORDS: 500, // Maximum records per export to prevent memory issues

  // Import processing
  IMPORT_BATCH_SIZE: 50, // Number of orders to process in each batch

  // File size limits (in bytes)
  MAX_FILE_SIZE: 10 * 1024 * 1024, // 10MB max file size

  // Duplicate detection window (in milliseconds)
  DUPLICATE_DETECTION_WINDOW: 24 * 60 * 60 * 1000, // 24 hours

  RATE_LIMIT: {
    EXPORT: {
      WINDOW_MS: 5 * 60 * 1000, // 5 minutes
      MAX_REQUESTS: 5
    },
    IMPORT: {
      WINDOW_MS: 5 * 60 * 1000, // 5 minutes (reduced from 10 for easier testing)
      MAX_REQUESTS: 10 // Increased from 3 for testing
    }
  },

  // Validation
  PHONE_NUMBER: {
    MIN_LENGTH: 10,
    MAX_LENGTH: 20,
    DIGITS_MIN: 10,
    DIGITS_MAX: 15
  },

  ADDRESS: {
    MIN_LENGTH: 5,
    MAX_LENGTH: 500
  },

  NAME: {
    MAX_LENGTH: 100
  },

  NOTES: {
    MAX_LENGTH: 1000
  }
} as const;
