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

import { writeFileSync, appendFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'fs'
import { join } from 'path'

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'
export type LogCategory = 
  | 'payment-processing' 
  | 'xero-sync' 
  | 'batch-processing' 
  | 'service-management'
  | 'admin-action'
  | 'system'

export interface LogEntry {
  timestamp: string
  level: LogLevel
  category: LogCategory
  operation: string
  message: string
  metadata?: Record<string, any>
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
    this.logDir = join(process.cwd(), 'logs')
    
    // Check if we're running on Vercel or similar serverless environment
    if (this.isServerlessEnvironment()) {
      console.log('🌐 Serverless environment detected, using console-only logging')
    } else {
      this.ensureLogDirectory()
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
    if (!existsSync(this.logDir)) {
      mkdirSync(this.logDir, { recursive: true })
    }
  }

  /**
   * Get current log file path
   */
  private getLogFilePath(category: LogCategory): string {
    const date = new Date().toISOString().split('T')[0] // YYYY-MM-DD
    return join(this.logDir, `${category}-${date}.log`)
  }

  /**
   * Create a structured log entry
   */
  private createLogEntry(
    level: LogLevel,
    category: LogCategory,
    operation: string,
    message: string,
    metadata?: Record<string, any>,
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

    try {
      const filePath = this.getLogFilePath(entry.category)
      const logLine = JSON.stringify(entry) + '\n'
      
      // Check if file needs rotation
      if (existsSync(filePath)) {
        const stats = statSync(filePath)
        if (stats.size > this.maxFileSize) {
          this.rotateLogFile(entry.category)
        }
      }
      
      appendFileSync(filePath, logLine, 'utf8')
    } catch (error) {
      console.error('Failed to write to log file:', error)
    }
  }

  /**
   * Rotate log file when it gets too large
   */
  private rotateLogFile(category: LogCategory): void {
    try {
      const date = new Date().toISOString().split('T')[0]
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
      const currentFile = join(this.logDir, `${category}-${date}.log`)
      const rotatedFile = join(this.logDir, `${category}-${date}-${timestamp}.log`)
      
      if (existsSync(currentFile)) {
        // Rename current file
        const fs = require('fs')
        fs.renameSync(currentFile, rotatedFile)
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
    try {
      const files = readdirSync(this.logDir)
        .filter(file => file.startsWith(`${category}-`) && file.endsWith('.log'))
        .map(file => ({
          name: file,
          path: join(this.logDir, file),
          mtime: statSync(join(this.logDir, file)).mtime
        }))
        .sort((a, b) => b.mtime.getTime() - a.mtime.getTime())

      // Keep only the most recent files
      const filesToDelete = files.slice(this.maxFiles)
      
      for (const file of filesToDelete) {
        const fs = require('fs')
        fs.unlinkSync(file.path)
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
    const timestamp = new Date(entry.timestamp).toLocaleTimeString()
    
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
    metadata?: Record<string, any>,
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
    metadata?: Record<string, any>,
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
    metadata?: Record<string, any>,
    userId?: string,
    requestId?: string
  ): void {
    const entry = this.createLogEntry('warn', category, operation, message, metadata, userId, requestId)
    console.warn(this.formatConsoleOutput(entry))
    this.writeToFile(entry)
  }

  /**
   * Log an error message
   */
  error(
    category: LogCategory,
    operation: string,
    message: string,
    metadata?: Record<string, any>,
    userId?: string,
    requestId?: string
  ): void {
    const entry = this.createLogEntry('error', category, operation, message, metadata, userId, requestId)
    console.error(this.formatConsoleOutput(entry))
    this.writeToFile(entry)
    
    // Automatically report errors to Sentry
    this.reportToSentry(entry)
  }

  /**
   * Report error to Sentry with enhanced context
   */
  private reportToSentry(entry: LogEntry): void {
    try {
      // Only import Sentry if it's available (to avoid issues in development)
      if (typeof window === 'undefined' && process.env.NODE_ENV === 'production') {
        import('@sentry/nextjs').then((Sentry) => {
          // Create error object from log entry
          const error = new Error(entry.message)
          
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
          Sentry.captureException(error, {
            level: 'error',
            tags: {
              source: 'logger',
              category: entry.category,
              operation: entry.operation
            }
          })
        }).catch(() => {
          // Silently fail if Sentry is not available
        })
      }
    } catch (error) {
      // Don't let Sentry reporting break the logging
      console.warn('Failed to report to Sentry:', error)
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
    metadata?: Record<string, any>,
    userId?: string,
    requestId?: string
  ): void {
    // Only report warnings for critical categories
    const criticalCategories: LogCategory[] = ['payment-processing', 'xero-sync', 'system']
    
    if (criticalCategories.includes(category)) {
      this.reportToSentryManual('warn', category, operation, message, metadata, userId, requestId)
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
    metadata?: Record<string, any>,
    userId?: string,
    requestId?: string
  ): void {
    try {
      if (typeof window === 'undefined' && process.env.NODE_ENV === 'production') {
        import('@sentry/nextjs').then((Sentry) => {
          const error = new Error(`${level.toUpperCase()}: ${message}`)
          
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

          Sentry.captureException(error, {
            level: level === 'error' ? 'error' : level === 'warn' ? 'warning' : 'info',
            tags: {
              source: 'logger',
              category,
              operation
            }
          })
        }).catch(() => {
          // Silently fail if Sentry is not available
        })
      }
    } catch (error) {
      console.warn('Failed to report to Sentry manually:', error)
    }
  }

  /**
   * Log payment processing events
   */
  logPaymentProcessing(
    operation: string,
    message: string,
    metadata?: Record<string, any>,
    level: LogLevel = 'info'
  ): void {
    this[level]('payment-processing', operation, message, metadata)
  }

  /**
   * Log Xero sync events
   */
  logXeroSync(
    operation: string,
    message: string,
    metadata?: Record<string, any>,
    level: LogLevel = 'info'
  ): void {
    this[level]('xero-sync', operation, message, metadata)
  }

  /**
   * Log batch processing events
   */
  logBatchProcessing(
    operation: string,
    message: string,
    metadata?: Record<string, any>,
    level: LogLevel = 'info'
  ): void {
    this[level]('batch-processing', operation, message, metadata)
  }

  /**
   * Log service management events
   */
  logServiceManagement(
    operation: string,
    message: string,
    metadata?: Record<string, any>,
    level: LogLevel = 'info'
  ): void {
    this[level]('service-management', operation, message, metadata)
  }

  /**
   * Log admin actions
   */
  logAdminAction(
    operation: string,
    message: string,
    metadata?: Record<string, any>,
    userId?: string,
    level: LogLevel = 'info'
  ): void {
    this[level]('admin-action', operation, message, metadata, userId)
  }

  /**
   * Log system events
   */
  logSystem(
    operation: string,
    message: string,
    metadata?: Record<string, any>,
    level: LogLevel = 'info'
  ): void {
    this[level]('system', operation, message, metadata)
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

    try {
      const logs: LogEntry[] = []
      const files = readdirSync(this.logDir)
        .filter(file => {
          if (!file.endsWith('.log')) return false
          if (category && !file.startsWith(`${category}-`)) return false
          return true
        })
        .sort()

      for (const file of files) {
        const filePath = join(this.logDir, file)
        const fs = require('fs')
        const content = fs.readFileSync(filePath, 'utf8')
        
        const lines = content.trim().split('\n').filter((line: string) => line.trim())
        
        for (const line of lines) {
          try {
            const entry: LogEntry = JSON.parse(line as string)
            
            // Apply filters
            if (level && entry.level !== level) continue
            if (startDate && entry.timestamp < startDate) continue
            if (endDate && entry.timestamp > endDate) continue
            
            logs.push(entry)
          } catch (parseError) {
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