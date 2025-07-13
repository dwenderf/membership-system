export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    // Initialize logging first
    const { logger } = await import('./src/lib/logging/logger')
    
    logger.logSystem(
      'server-startup',
      'Next.js server starting up (Node.js runtime)',
      {
        nodeVersion: process.version,
        platform: process.platform,
        arch: process.arch,
        environment: process.env.NODE_ENV,
        pid: process.pid
      }
    )

    try {
      // Initialize Sentry
      await import('./sentry.server.config')
      logger.logSystem('sentry-init', 'Sentry monitoring initialized')
      
      // Initialize background services for payment processing
      const { initializeServices } = await import('./src/lib/services/startup')
      await initializeServices()
      
      logger.logSystem(
        'server-ready',
        'Next.js server fully initialized and ready',
        { runtime: 'nodejs' }
      )
    } catch (error) {
      logger.logSystem(
        'server-startup-error',
        'Error during server initialization',
        { 
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined
        },
        'error'
      )
      throw error
    }
  }

  if (process.env.NEXT_RUNTIME === 'edge') {
    // Edge runtime doesn't support file system operations, so we'll use console
    console.log('🌟 Next.js Edge Runtime starting up')
    
    try {
      await import('./sentry.edge.config')
      console.log('🔍 Sentry Edge monitoring initialized')
    } catch (error) {
      console.error('❌ Error initializing Edge runtime:', error)
      throw error
    }
  }
}