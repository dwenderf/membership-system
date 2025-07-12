export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./sentry.server.config')
    
    // Initialize background services for payment processing
    const { initializeServices } = await import('./src/lib/services/startup')
    await initializeServices()
  }

  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('./sentry.edge.config')
  }
}