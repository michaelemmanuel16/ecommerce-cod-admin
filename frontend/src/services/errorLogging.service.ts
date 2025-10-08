interface ErrorLog {
  message: string
  stack?: string
  componentStack?: string
  timestamp: string
  url: string
  userAgent: string
  userId?: string
  context?: Record<string, any>
}

class ErrorLoggingService {
  private logs: ErrorLog[] = []
  private maxLogs = 100

  /**
   * Log an error to the service
   */
  log(error: Error | string, context?: Record<string, any>) {
    const errorLog: ErrorLog = {
      message: typeof error === 'string' ? error : error.message,
      stack: typeof error === 'string' ? undefined : error.stack,
      timestamp: new Date().toISOString(),
      url: window.location.href,
      userAgent: navigator.userAgent,
      context,
    }

    // Store in memory (limited)
    this.logs.push(errorLog)
    if (this.logs.length > this.maxLogs) {
      this.logs.shift()
    }

    // Log to console in development
    if (import.meta.env.DEV) {
      console.error('[ErrorLogging]', errorLog)
    }

    // Send to backend or third-party service in production
    if (import.meta.env.PROD) {
      this.sendToBackend(errorLog)
    }
  }

  /**
   * Log a warning
   */
  warn(message: string, context?: Record<string, any>) {
    console.warn('[Warning]', message, context)

    if (import.meta.env.PROD) {
      // Optionally send warnings to backend
      this.sendToBackend({
        message,
        timestamp: new Date().toISOString(),
        url: window.location.href,
        userAgent: navigator.userAgent,
        context: { ...context, level: 'warning' },
      })
    }
  }

  /**
   * Send error to backend
   */
  private async sendToBackend(errorLog: ErrorLog) {
    try {
      // Use navigator.sendBeacon for better reliability
      if (navigator.sendBeacon) {
        const blob = new Blob([JSON.stringify(errorLog)], {
          type: 'application/json',
        })
        navigator.sendBeacon('/api/errors/log', blob)
      } else {
        // Fallback to fetch
        await fetch('/api/errors/log', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(errorLog),
          keepalive: true,
        }).catch(() => {
          // Silently fail - don't want error logging to cause more errors
        })
      }
    } catch (error) {
      // Silently fail
      console.error('Failed to send error log:', error)
    }
  }

  /**
   * Get recent logs (for debugging)
   */
  getRecentLogs(): ErrorLog[] {
    return [...this.logs]
  }

  /**
   * Clear logs
   */
  clearLogs() {
    this.logs = []
  }

  /**
   * Set user context for error tracking
   */
  setUser(userId: string) {
    // Store user ID for context in future errors
    this.logs.forEach((log) => {
      log.userId = userId
    })
  }
}

// Singleton instance
const errorLoggingService = new ErrorLoggingService()

// Global error handlers
window.addEventListener('error', (event) => {
  errorLoggingService.log(event.error || event.message, {
    type: 'window.error',
    filename: event.filename,
    lineno: event.lineno,
    colno: event.colno,
  })
})

window.addEventListener('unhandledrejection', (event) => {
  errorLoggingService.log(event.reason, {
    type: 'unhandledRejection',
  })
})

export default errorLoggingService
