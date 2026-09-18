/**
 * Centralized Logging Service
 *
 * Provides structured logging with console output, file persistence,
 * integration with the admin log viewer, and automatic Sentry error reporting.
 *
 * FEATURES:
 * - Automatic Sentry reporting for all 'error' level logs
 * - Manual Sentry reporting for critical warnings
 * - Category-based filtering for different types of operations
 * - Rich context and metadata support
 * - Production-only Sentry integration (development safe)
 *
 * USAGE EXAMPLES:
 *
 * // Basic error logging (automatically reported to Sentry)
 * logger.error('payment-processing', 'stripe-webhook', 'Payment failed', { paymentId: 'pi_123' })
 *
 * // Critical warning (manually reported to Sentry)
 * logger.reportWarningToSentry('xero-sync', 'invoice-creation', 'Xero API rate limit approaching')
 *
 * // Manual Sentry reporting for any level
 * logger.reportToSentryManual('info', 'system', 'maintenance', 'Database backup completed')
 *
 * // Category-based logging methods
 * logger.logPaymentProcessing('webhook-received', 'Stripe webhook processed', { amount: 5000 })
 * logger.logXeroSync('contact-sync', 'Contact synced to Xero', { contactId: 'xero_123' })
 */

import { formatTime } from '@/lib/date-utils'

// Only import fs on server side, and only lazily so Next's build-time
// output-file tracing doesn't treat this module as an unconditional fs
// dependency for every route that imports the logger.
let fs: typeof import('fs') | null = null
let path: typeof import('path') | null = null

function ensureFsModules(): void {
  if (typeof window !== 'undefined') return
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- lazy load to avoid Next's build-time fs tracing
  if (!fs) fs = require('fs')
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- lazy load to avoid Next's build-time fs tracing
  if (!path) path = require('path')
}

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'
export type LogCategory = 
  | 'payment-processing' 
  | 'xero-sync' 
  | 'batch-processing' 
  | 'service-management'
  | 'admin-action'
  | 'system'

export type LogMetadata = Record<string, unknown>

export interface LogEntry {
  timestamp: string
  level: LogLevel
  category: LogCategory
  operation: string
  message: string
  metadata?: LogMetadata
  userId?: string
  requestId?: string
}

export class Logger {
  private static instance: Logger
  private logDir: string
  private maxFileSize = 10 * 1024 * 1024 // 10MB
  private maxFiles = 30 // Keep 30 days of logs

  static getInstance(): Logger {
    if (!Logger.instance) {
      Logger.instance = new Logger()
    }
    return Logger.instance
  }

  constructor() {
    ensureFsModules()
    if (typeof window === 'undefined' && path) {
      this.logDir = path.join(process.cwd(), 'logs')
      
      // Check if we're running on Vercel or similar serverless environment
      if (this.isServerlessEnvironment()) {
        console.log('🌐 Serverless environment detected, using console-only logging')
      } else {
        this.ensureLogDirectory()
      }
    } else {
      // Client-side or no fs available
      this.logDir = ''
    }
  }

  /**
   * Check if running in serverless environment (Vercel, Netlify, etc.)
   */
  private isServerlessEnvironment(): boolean {
    return !!(
      process.env.VERCEL ||
      process.env.NETLIFY ||
      process.env.AWS_LAMBDA_FUNCTION_NAME ||
      process.env.LAMBDA_TASK_ROOT ||
      process.env.FUNCTION_NAME
    )
  }

  /**
   * Ensure log directory exists
   */
  private ensureLogDirectory(): void {
    ensureFsModules()
    if (!fs || !path) return // Client-side or no fs available
    
    if (!fs.existsSync(/* turbopackIgnore: true */ this.logDir)) {
      fs.mkdirSync(/* turbopackIgnore: true */ this.logDir, { recursive: true })
    }
  }

  /**
   * Get current log file path
   */
  private getLogFilePath(category: LogCategory): string {
    ensureFsModules()
    if (!fs || !path) return '' // Client-side or no fs available
    const date = new Date().toISOString().split('T')[0] // YYYY-MM-DD
    return path.join(this.logDir, `${category}-${date}.log`)
  }

  /**
   * Create a structured log entry
   */
  private createLogEntry(
    level: LogLevel,
    category: LogCategory,
    operation: string,
    message: string,
    metadata?: LogMetadata,
    userId?: string,
    requestId?: string
  ): LogEntry {
    return {
      timestamp: new Date().toISOString(),
      level,
      category,
      operation,
      message,
      metadata,
      userId,
      requestId
    }
  }

  /**
   * Write log entry to file (skipped in serverless environments)
   */
  private writeToFile(entry: LogEntry): void {
    // Skip file writing in serverless environments
    if (this.isServerlessEnvironment()) {
      return
    }

    ensureFsModules()
    try {
      const filePath = this.getLogFilePath(entry.category)
      const logLine = JSON.stringify(entry) + '\n'
      
      // Check if file needs rotation
      if (fs && fs.existsSync(/* turbopackIgnore: true */ filePath)) {
        const stats = fs.statSync(/* turbopackIgnore: true */ filePath)
        if (stats.size > this.maxFileSize) {
          this.rotateLogFile(entry.category)
        }
      }

      if (fs) {
        fs.appendFileSync(/* turbopackIgnore: true */ filePath, logLine, 'utf8')
      }
    } catch (error) {
      console.error('Failed to write to log file:', error)
    }
  }

  /**
   * Rotate log file when it gets too large
   */
  private rotateLogFile(category: LogCategory): void {
    ensureFsModules()
    if (!fs || !path) return // Client-side or no fs available
    
    try {
      const date = new Date().toISOString().split('T')[0]
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
      const currentFile = path.join(this.logDir, `${category}-${date}.log`)
      const rotatedFile = path.join(this.logDir, `${category}-${date}-${timestamp}.log`)
      
      if (fs.existsSync(/* turbopackIgnore: true */ currentFile)) {
        // Rename current file
        fs.renameSync(/* turbopackIgnore: true */ currentFile, rotatedFile)
      }
      
      // Clean up old log files
      this.cleanupOldLogs(category)
    } catch (error) {
      console.error('Failed to rotate log file:', error)
    }
  }

  /**
   * Clean up old log files
   */
  private cleanupOldLogs(category: LogCategory): void {
    ensureFsModules()
    if (!fs || !path) return // Client-side or no fs available
    const fsModule = fs
    const pathModule = path

    try {
      const files = fsModule.readdirSync(/* turbopackIgnore: true */ this.logDir)
        .filter((file: string) => file.startsWith(`${category}-`) && file.endsWith('.log'))
        .map((file: string) => ({
          name: file,
          path: pathModule.join(this.logDir, file),
          mtime: fsModule.statSync(/* turbopackIgnore: true */ pathModule.join(this.logDir, file)).mtime
        }))
        .sort((a, b) => b.mtime.getTime() - a.mtime.getTime())

      // Keep only the most recent files
      const filesToDelete = files.slice(this.maxFiles)

      for (const file of filesToDelete) {
        fs.unlinkSync(/* turbopackIgnore: true */ file.path)
        console.log(`🗑️ Cleaned up old log file: ${file.name}`)
      }
    } catch (error) {
      console.error('Failed to cleanup old logs:', error)
    }
  }

  /**
   * ANSI color codes for terminal output
   */
  private readonly colors = {
    // Reset
    reset: '\x1b[0m',
    
    // Text colors
    black: '\x1b[30m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    magenta: '\x1b[35m',
    cyan: '\x1b[36m',
    white: '\x1b[37m',
    gray: '\x1b[90m',
    
    // Bright colors
    brightRed: '\x1b[91m',
    brightGreen: '\x1b[92m',
    brightYellow: '\x1b[93m',
    brightBlue: '\x1b[94m',
    brightMagenta: '\x1b[95m',
    brightCyan: '\x1b[96m',
    
    // Text styles
    bold: '\x1b[1m',
    dim: '\x1b[2m',
    underline: '\x1b[4m'
  }

  /**
   * Format console output with colors and emojis
   */
  private formatConsoleOutput(entry: LogEntry): string {
    const emojis = {
      debug: '🐛',
      info: 'ℹ️',
      warn: '⚠️',
      error: '❌'
    }
    
    const categoryEmojis = {
      'payment-processing': '💳',
      'xero-sync': '📊',
      'batch-processing': '📦',
      'service-management': '⚙️',
      'admin-action': '👨‍💼',
      'system': '🖥️'
    }

    // Level-based colors
    const levelColors = {
      debug: this.colors.gray,
      info: this.colors.blue,
      warn: this.colors.yellow,
      error: this.colors.red
    }

    // Category-based colors
    const categoryColors = {
      'payment-processing': this.colors.green,
      'xero-sync': this.colors.cyan,
      'batch-processing': this.colors.magenta,
      'service-management': this.colors.blue,
      'admin-action': this.colors.brightYellow,
      'system': this.colors.brightBlue
    }

    const emoji = emojis[entry.level]
    const categoryEmoji = categoryEmojis[entry.category]
    const timestamp = formatTime(entry.timestamp)
    
    // Build colored output
    const levelColor = levelColors[entry.level]
    const categoryColor = categoryColors[entry.category]
    
    let output = ''
    
    // Emoji and timestamp
    output += `${emoji} ${categoryEmoji} `
    output += `${this.colors.gray}[${timestamp}]${this.colors.reset} `
    
    // Operation name with category color
    output += `${categoryColor}${this.colors.bold}${entry.operation}${this.colors.reset}: `
    
    // Message with level color
    output += `${levelColor}${entry.message}${this.colors.reset}`
    
    // Metadata in dim gray
    if (entry.metadata && Object.keys(entry.metadata).length > 0) {
      output += ` ${this.colors.gray}| ${JSON.stringify(entry.metadata)}${this.colors.reset}`
    }
    
    // User ID if present
    if (entry.userId) {
      output += ` ${this.colors.dim}[user: ${entry.userId}]${this.colors.reset}`
    }
    
    // Request ID if present
    if (entry.requestId) {
      output += ` ${this.colors.dim}[req: ${entry.requestId}]${this.colors.reset}`
    }
    
    return output
  }

  /**
   * Log a debug message
   */
  debug(
    category: LogCategory,
    operation: string,
    message: string,
    metadata?: LogMetadata,
    userId?: string,
    requestId?: string
  ): void {
    const entry = this.createLogEntry('debug', category, operation, message, metadata, userId, requestId)
    console.log(this.formatConsoleOutput(entry))
    this.writeToFile(entry)
  }

  /**
   * Log an info message
   */
  info(
    category: LogCategory,
    operation: string,
    message: string,
    metadata?: LogMetadata,
    userId?: string,
    requestId?: string
  ): void {
    const entry = this.createLogEntry('info', category, operation, message, metadata, userId, requestId)
    console.log(this.formatConsoleOutput(entry))
    this.writeToFile(entry)
  }

  /**
   * Log a warning message
   */
  warn(
    category: LogCategory,
    operation: string,
    message: string,
    metadata?: LogMetadata,
    userId?: string,
    requestId?: string
  ): void {
    const entry = this.createLogEntry('warn', category, operation, message, metadata, userId, requestId)
    console.warn(this.formatConsoleOutput(entry))
    this.writeToFile(entry)
  }

  /**
   * Log an error message
   *
   * @param error The original caught error (if any), reported to Sentry with its
   *   real stack/type. `metadata.error` remains the human-readable string for
   *   console/file/admin-log display; this is a separate channel for Sentry only.
   */
  error(
    category: LogCategory,
    operation: string,
    message: string,
    metadata?: LogMetadata,
    userId?: string,
    requestId?: string,
    error?: unknown
  ): void {
    const entry = this.createLogEntry('error', category, operation, message, metadata, userId, requestId)
    console.error(this.formatConsoleOutput(entry))
    this.writeToFile(entry)

    // Automatically report errors to Sentry
    this.reportToSentry(entry, error)
  }

  /**
   * Report error to Sentry with enhanced context
   */
  private reportToSentry(entry: LogEntry, error?: unknown): void {
    try {
      // Only import Sentry if it's available (to avoid issues in local development)
      // Include both production and preview deployments (Vercel)
      if (typeof window === 'undefined' && (process.env.NODE_ENV === 'production' || process.env.VERCEL)) {
        // Use the real caught value when the call site has one - an Error gives
        // Sentry a real stack/type/cause chain, and even a non-Error (e.g. a
        // Supabase PostgrestError) still carries more detail than a bare message
        // string. Otherwise capture a stack right here, synchronously - by the
        // time the dynamic import below resolves we're in a later microtask and
        // the stack would point at that continuation instead of the call site.
        const hasRealError = error !== undefined
        const reportedError: unknown = hasRealError ? error : new Error(entry.message)
        if (!hasRealError) {
          Error.captureStackTrace?.(reportedError as Error, this.reportToSentry)
        }

        Promise.all([import('@sentry/nextjs'), import('@/lib/sentry-flush')]).then(([Sentry, { scheduleSentryFlush }]) => {
          // Set Sentry context with log entry details
          Sentry.setContext('log_entry', {
            category: entry.category,
            operation: entry.operation,
            timestamp: entry.timestamp,
            requestId: entry.requestId,
            ...entry.metadata
          })

          // Set user context if available
          if (entry.userId) {
            Sentry.setUser({ id: entry.userId })
          }

          // Add tags for better filtering
          Sentry.setTag('log_category', entry.category)
          Sentry.setTag('log_operation', entry.operation)
          Sentry.setTag('log_level', entry.level)

          // Report to Sentry
          Sentry.captureException(reportedError, {
            level: 'error',
            tags: {
              source: 'logger',
              category: entry.category,
              operation: entry.operation
            }
          })

          // Make sure the event actually reaches Sentry before Vercel freezes
          // this invocation - captureException only enqueues it (see #368).
          scheduleSentryFlush()
        }).catch(() => {
          // Silently fail if Sentry is not available
        })
      }
    } catch (err) {
      // Don't let Sentry reporting break the logging
      console.warn('Failed to report to Sentry:', err)
    }
  }

  /**
   * Report warning to Sentry for critical categories
   * This can be called manually for important warnings that should be tracked
   */
  reportWarningToSentry(
    category: LogCategory,
    operation: string,
    message: string,
    metadata?: LogMetadata,
    userId?: string,
    requestId?: string,
    error?: unknown
  ): void {
    // Only report warnings for critical categories
    const criticalCategories: LogCategory[] = ['payment-processing', 'xero-sync', 'system']

    if (criticalCategories.includes(category)) {
      this.reportToSentryManual('warn', category, operation, message, metadata, userId, requestId, error)
    }
  }

  /**
   * Manually report any log entry to Sentry
   * Useful for critical operations that should be tracked regardless of log level
   */
  reportToSentryManual(
    level: LogLevel,
    category: LogCategory,
    operation: string,
    message: string,
    metadata?: LogMetadata,
    userId?: string,
    requestId?: string,
    error?: unknown
  ): void {
    try {
      if (typeof window === 'undefined' && (process.env.NODE_ENV === 'production' || process.env.VERCEL)) {
        // See reportToSentry() above for why this is captured synchronously
        // rather than inside the .then() below, and why non-Error values are
        // still passed through as-is.
        const hasRealError = error !== undefined
        const reportedError: unknown = hasRealError ? error : new Error(`${level.toUpperCase()}: ${message}`)
        if (!hasRealError) {
          Error.captureStackTrace?.(reportedError as Error, this.reportToSentryManual)
        }

        Promise.all([import('@sentry/nextjs'), import('@/lib/sentry-flush')]).then(([Sentry, { scheduleSentryFlush }]) => {
          Sentry.setContext('log_entry', {
            category,
            operation,
            timestamp: new Date().toISOString(),
            requestId,
            ...metadata
          })

          if (userId) {
            Sentry.setUser({ id: userId })
          }

          Sentry.setTag('log_category', category)
          Sentry.setTag('log_operation', operation)
          Sentry.setTag('log_level', level)
          Sentry.setTag('source', 'logger')

          Sentry.captureException(reportedError, {
            level: level === 'error' ? 'error' : level === 'warn' ? 'warning' : 'info',
            tags: {
              source: 'logger',
              category,
              operation
            }
          })

          // Make sure the event actually reaches Sentry before Vercel freezes
          // this invocation - captureException only enqueues it (see #368).
          scheduleSentryFlush()
        }).catch(() => {
          // Silently fail if Sentry is not available
        })
      }
    } catch (err) {
      console.warn('Failed to report to Sentry manually:', err)
    }
  }

  /**
   * Log payment processing events
   *
   * @param error The original caught error, forwarded to Sentry when level is 'error'.
   */
  logPaymentProcessing(
    operation: string,
    message: string,
    metadata?: LogMetadata,
    level: LogLevel = 'info',
    error?: unknown
  ): void {
    if (level === 'error') {
      this.error('payment-processing', operation, message, metadata, undefined, undefined, error)
    } else {
      this[level]('payment-processing', operation, message, metadata)
    }
  }

  /**
   * Log Xero sync events
   *
   * @param error The original caught error, forwarded to Sentry when level is 'error'.
   */
  logXeroSync(
    operation: string,
    message: string,
    metadata?: LogMetadata,
    level: LogLevel = 'info',
    error?: unknown
  ): void {
    if (level === 'error') {
      this.error('xero-sync', operation, message, metadata, undefined, undefined, error)
    } else {
      this[level]('xero-sync', operation, message, metadata)
    }
  }

  /**
   * Log batch processing events
   *
   * @param error The original caught error, forwarded to Sentry when level is 'error'.
   */
  logBatchProcessing(
    operation: string,
    message: string,
    metadata?: LogMetadata,
    level: LogLevel = 'info',
    error?: unknown
  ): void {
    if (level === 'error') {
      this.error('batch-processing', operation, message, metadata, undefined, undefined, error)
    } else {
      this[level]('batch-processing', operation, message, metadata)
    }
  }

  /**
   * Log service management events
   *
   * @param error The original caught error, forwarded to Sentry when level is 'error'.
   */
  logServiceManagement(
    operation: string,
    message: string,
    metadata?: LogMetadata,
    level: LogLevel = 'info',
    error?: unknown
  ): void {
    if (level === 'error') {
      this.error('service-management', operation, message, metadata, undefined, undefined, error)
    } else {
      this[level]('service-management', operation, message, metadata)
    }
  }

  /**
   * Log admin actions
   *
   * @param error The original caught error, forwarded to Sentry when level is 'error'.
   */
  logAdminAction(
    operation: string,
    message: string,
    metadata?: LogMetadata,
    userId?: string,
    level: LogLevel = 'info',
    error?: unknown
  ): void {
    if (level === 'error') {
      this.error('admin-action', operation, message, metadata, userId, undefined, error)
    } else {
      this[level]('admin-action', operation, message, metadata, userId)
    }
  }

  /**
   * Log system events
   *
   * @param error The original caught error, forwarded to Sentry when level is 'error'.
   */
  logSystem(
    operation: string,
    message: string,
    metadata?: LogMetadata,
    level: LogLevel = 'info',
    error?: unknown
  ): void {
    if (level === 'error') {
      this.error('system', operation, message, metadata, undefined, undefined, error)
    } else {
      this[level]('system', operation, message, metadata)
    }
  }

  /**
   * Read log entries from files (returns empty array in serverless environments)
   */
  async readLogs(
    category?: LogCategory,
    level?: LogLevel,
    startDate?: string,
    endDate?: string,
    limit?: number
  ): Promise<LogEntry[]> {
    // Return empty array in serverless environments
    if (this.isServerlessEnvironment()) {
      console.warn('📁 File-based log reading not available in serverless environment')
      return []
    }

    ensureFsModules()
    if (!fs || !path) return [] // Client-side or no fs available

    try {
      const logs: LogEntry[] = []
      const files = fs.readdirSync(/* turbopackIgnore: true */ this.logDir)
        .filter((file: string) => {
          if (!file.endsWith('.log')) return false
          if (category && !file.startsWith(`${category}-`)) return false
          return true
        })
        .sort()

      for (const file of files) {
        const filePath = path.join(this.logDir, file)
        const content = fs.readFileSync(/* turbopackIgnore: true */ filePath, 'utf8')
        
        const lines = content.trim().split('\n').filter((line: string) => line.trim())
        
        for (const line of lines) {
          try {
            const entry: LogEntry = JSON.parse(line as string)
            
            // Apply filters
            if (level && entry.level !== level) continue
            if (startDate && entry.timestamp < startDate) continue
            if (endDate && entry.timestamp > endDate) continue
            
            logs.push(entry)
          } catch {
            console.warn('Failed to parse log line:', line)
          }
        }
      }

      // Sort by timestamp (newest first) and apply limit
      logs.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      
      return limit ? logs.slice(0, limit) : logs
    } catch (error) {
      console.error('Failed to read logs:', error)
      return []
    }
  }

  /**
   * Get log statistics
   */
  async getLogStats(): Promise<{
    totalEntries: number
    entriesByLevel: Record<LogLevel, number>
    entriesByCategory: Record<LogCategory, number>
    oldestEntry?: string
    newestEntry?: string
  }> {
    const logs = await this.readLogs()
    
    const stats = {
      totalEntries: logs.length,
      entriesByLevel: { debug: 0, info: 0, warn: 0, error: 0 } as Record<LogLevel, number>,
      entriesByCategory: {
        'payment-processing': 0,
        'xero-sync': 0,
        'batch-processing': 0,
        'service-management': 0,
        'admin-action': 0,
        'system': 0
      } as Record<LogCategory, number>,
      oldestEntry: logs.length > 0 ? logs[logs.length - 1].timestamp : undefined,
      newestEntry: logs.length > 0 ? logs[0].timestamp : undefined
    }

    for (const log of logs) {
      stats.entriesByLevel[log.level]++
      stats.entriesByCategory[log.category]++
    }

    return stats
  }
}

// Export singleton instance
export const logger = Logger.getInstance()