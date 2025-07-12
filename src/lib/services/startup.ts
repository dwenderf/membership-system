/**
 * Service Startup Manager
 * 
 * Initializes and manages background services for the application.
 * Handles payment completion processing, batch jobs, and other async services.
 */

import { paymentProcessor } from '../payment-completion-processor'

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

    console.log('🚀 Starting background services...')

    for (const [name, service] of this.services) {
      try {
        console.log(`🔧 Starting ${name}...`)
        const success = await service.start()
        
        if (success) {
          console.log(`✅ ${name} started successfully`)
        } else {
          console.log(`⚠️ ${name} failed to start`)
        }
      } catch (error) {
        console.error(`❌ Error starting ${name}:`, error)
      }
    }

    this.isStarted = true
    console.log('🎉 All background services startup complete')
  }

  /**
   * Stop all background services
   */
  async stopServices() {
    if (!this.isStarted) {
      console.log('🛑 Services not started')
      return
    }

    console.log('🛑 Stopping background services...')

    for (const [name, service] of this.services) {
      try {
        console.log(`🔧 Stopping ${name}...`)
        await service.stop()
        console.log(`✅ ${name} stopped successfully`)
      } catch (error) {
        console.error(`❌ Error stopping ${name}:`, error)
      }
    }

    this.isStarted = false
    console.log('🎉 All background services stopped')
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
    console.log('🌐 Client-side detected, skipping service initialization')
    return
  }

  await serviceManager.startServices()
}

/**
 * Graceful shutdown handler
 */
export async function shutdownServices() {
  await serviceManager.stopServices()
}

// Handle process termination
if (typeof process !== 'undefined') {
  process.on('SIGINT', async () => {
    console.log('🛑 Received SIGINT, shutting down services...')
    await shutdownServices()
    process.exit(0)
  })

  process.on('SIGTERM', async () => {
    console.log('🛑 Received SIGTERM, shutting down services...')
    await shutdownServices()
    process.exit(0)
  })
}