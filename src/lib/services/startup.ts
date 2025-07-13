/**
 * Service Startup Manager
 * 
 * Initializes and manages background services for the application.
 * Handles payment completion processing, batch jobs, and other async services.
 */

import { paymentProcessor } from '../payment-completion-processor'
import { scheduledBatchProcessor } from '../scheduled-batch-processor'
import { logger } from '../logging/logger'

export class ServiceManager {
  private static instance: ServiceManager
  private services: Map<string, { start: () => Promise<boolean>, stop: () => Promise<void> }> = new Map()
  private isStarted = false

  static getInstance(): ServiceManager {
    if (!ServiceManager.instance) {
      ServiceManager.instance = new ServiceManager()
    }
    return ServiceManager.instance
  }

  constructor() {
    // Register all background services
    this.registerService('payment-processor', {
      start: () => paymentProcessor.startListening(),
      stop: () => paymentProcessor.stopListening()
    })
    
    this.registerService('scheduled-batch-processor', {
      start: async () => {
        await scheduledBatchProcessor.startScheduledProcessing()
        return true
      },
      stop: () => scheduledBatchProcessor.stopScheduledProcessing()
    })
  }

  /**
   * Register a background service
   */
  private registerService(
    name: string, 
    service: { start: () => Promise<boolean>, stop: () => Promise<void> }
  ) {
    this.services.set(name, service)
  }

  /**
   * Start all background services
   */
  async startServices() {
    if (this.isStarted) {
      console.log('🔄 Services already started')
      return
    }

    logger.logServiceManagement(
      'services-start',
      'Starting background services',
      { serviceCount: this.services.size, services: Array.from(this.services.keys()) }
    )

    for (const [name, service] of this.services) {
      try {
        console.log(`🔧 Starting ${name}...`)
        const success = await service.start()
        
        if (success) {
          logger.logServiceManagement(
            'service-started',
            `Service ${name} started successfully`,
            { serviceName: name }
          )
        } else {
          logger.logServiceManagement(
            'service-start-failed',
            `Service ${name} failed to start`,
            { serviceName: name },
            'warn'
          )
        }
      } catch (error) {
        logger.logServiceManagement(
          'service-start-error',
          `Error starting service ${name}`,
          { serviceName: name, error: error instanceof Error ? error.message : String(error) },
          'error'
        )
      }
    }

    this.isStarted = true
    logger.logServiceManagement(
      'services-started',
      'All background services startup complete',
      { totalServices: this.services.size }
    )
  }

  /**
   * Stop all background services
   */
  async stopServices() {
    if (!this.isStarted) {
      logger.logServiceManagement(
        'services-stop-skip',
        'Services not started, skipping stop',
        { isStarted: this.isStarted }
      )
      return
    }

    logger.logServiceManagement(
      'services-stop',
      'Stopping background services',
      { serviceCount: this.services.size, services: Array.from(this.services.keys()) }
    )

    const stopResults = { successful: 0, failed: 0, errors: [] as string[] }

    for (const [name, service] of this.services) {
      try {
        logger.logServiceManagement(
          'service-stopping',
          `Stopping service ${name}`,
          { serviceName: name }
        )
        
        await service.stop()
        
        logger.logServiceManagement(
          'service-stopped',
          `Service ${name} stopped successfully`,
          { serviceName: name }
        )
        
        stopResults.successful++
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error)
        stopResults.failed++
        stopResults.errors.push(`${name}: ${errorMessage}`)
        
        logger.logServiceManagement(
          'service-stop-error',
          `Error stopping service ${name}`,
          { 
            serviceName: name, 
            error: errorMessage,
            stack: error instanceof Error ? error.stack : undefined
          },
          'error'
        )
      }
    }

    this.isStarted = false
    
    logger.logServiceManagement(
      'services-stopped',
      'Background services stop completed',
      {
        successful: stopResults.successful,
        failed: stopResults.failed,
        totalServices: this.services.size,
        errors: stopResults.errors
      },
      stopResults.failed > 0 ? 'warn' : 'info'
    )
  }

  /**
   * Restart all services
   */
  async restartServices() {
    await this.stopServices()
    await this.startServices()
  }

  /**
   * Get service status
   */
  getStatus() {
    return {
      isStarted: this.isStarted,
      serviceCount: this.services.size,
      services: Array.from(this.services.keys())
    }
  }
}

// Export singleton instance
export const serviceManager = ServiceManager.getInstance()

/**
 * Initialize services for server-side usage
 * Call this in API routes or server components where needed
 */
export async function initializeServices() {
  // Only start services in server environment
  if (typeof window !== 'undefined') {
    logger.logSystem(
      'service-init-skip',
      'Client-side detected, skipping service initialization',
      { environment: 'browser' }
    )
    return
  }

  logger.logSystem(
    'service-init-start',
    'Initializing background services for server environment',
    {
      environment: 'server',
      nodeEnv: process.env.NODE_ENV,
      processId: process.pid
    }
  )

  try {
    await serviceManager.startServices()
    
    logger.logSystem(
      'service-init-complete',
      'All background services initialized successfully'
    )
  } catch (error) {
    logger.logSystem(
      'service-init-error',
      'Failed to initialize background services',
      { 
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined
      },
      'error'
    )
    throw error
  }
}

/**
 * Graceful shutdown handler
 */
export async function shutdownServices() {
  logger.logSystem(
    'server-shutdown-start',
    'Initiating graceful server shutdown',
    {
      uptime: process.uptime(),
      memoryUsage: process.memoryUsage(),
      pid: process.pid
    }
  )

  try {
    await serviceManager.stopServices()
    
    logger.logSystem(
      'server-shutdown-complete',
      'Graceful shutdown completed successfully',
      { totalUptime: process.uptime() }
    )
  } catch (error) {
    logger.logSystem(
      'server-shutdown-error',
      'Error during graceful shutdown',
      { 
        error: error instanceof Error ? error.message : String(error),
        uptime: process.uptime()
      },
      'error'
    )
    throw error
  }
}

// Handle process termination
if (typeof process !== 'undefined') {
  process.on('SIGINT', async () => {
    logger.logSystem(
      'signal-sigint',
      'Received SIGINT signal, initiating graceful shutdown',
      { signal: 'SIGINT', pid: process.pid }
    )
    
    try {
      await shutdownServices()
      logger.logSystem(
        'signal-sigint-complete',
        'SIGINT shutdown completed, exiting process'
      )
      process.exit(0)
    } catch (error) {
      logger.logSystem(
        'signal-sigint-error',
        'Error during SIGINT shutdown',
        { error: error instanceof Error ? error.message : String(error) },
        'error'
      )
      process.exit(1)
    }
  })

  process.on('SIGTERM', async () => {
    logger.logSystem(
      'signal-sigterm',
      'Received SIGTERM signal, initiating graceful shutdown',
      { signal: 'SIGTERM', pid: process.pid }
    )
    
    try {
      await shutdownServices()
      logger.logSystem(
        'signal-sigterm-complete',
        'SIGTERM shutdown completed, exiting process'
      )
      process.exit(0)
    } catch (error) {
      logger.logSystem(
        'signal-sigterm-error',
        'Error during SIGTERM shutdown',
        { error: error instanceof Error ? error.message : String(error) },
        'error'
      )
      process.exit(1)
    }
  })

  // Handle uncaught exceptions
  process.on('uncaughtException', (error) => {
    logger.logSystem(
      'uncaught-exception',
      'Uncaught exception detected',
      {
        error: error.message,
        stack: error.stack,
        name: error.name
      },
      'error'
    )
    
    // Try to shutdown gracefully, but don't wait too long
    setTimeout(() => {
      logger.logSystem(
        'force-exit',
        'Forcing process exit after uncaught exception',
        {},
        'error'
      )
      process.exit(1)
    }, 5000)
    
    shutdownServices().finally(() => process.exit(1))
  })

  // Handle unhandled promise rejections
  process.on('unhandledRejection', (reason, promise) => {
    logger.logSystem(
      'unhandled-rejection',
      'Unhandled promise rejection detected',
      {
        reason: reason instanceof Error ? reason.message : String(reason),
        stack: reason instanceof Error ? reason.stack : undefined,
        promise: promise.toString()
      },
      'error'
    )
  })

  // Log memory warnings
  process.on('warning', (warning) => {
    logger.logSystem(
      'process-warning',
      'Process warning detected',
      {
        name: warning.name,
        message: warning.message,
        stack: warning.stack
      },
      'warn'
    )
  })
}