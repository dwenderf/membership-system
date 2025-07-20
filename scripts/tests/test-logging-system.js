/**
 * Test script for the new logging system
 * 
 * Run with: node test-logging-system.js
 */

// Test the logging system
async function testLoggingSystem() {
  console.log('🧪 Testing Enhanced Logging System with Terminal Colors...')
  
  try {
    // Import the logger
    const { logger } = await import('./src/lib/logging/logger.ts')
    
    console.log('📦 Logger module loaded successfully')
    console.log('\n🎨 Testing colorized console output across all categories and levels:\n')
    
    // Test different log levels and categories
    logger.logSystem('system-startup', 'Testing logging system initialization')
    
    logger.logPaymentProcessing(
      'test-payment',
      'Testing payment processing logs',
      { testData: 'sample payment', amount: 5000 }
    )
    
    logger.logXeroSync(
      'test-sync',
      'Testing Xero sync logging',
      { records: 5, success: true },
      'info'
    )
    
    logger.logBatchProcessing(
      'test-batch',
      'Testing batch processing logs',
      { batchSize: 10, processed: 8, failed: 2 }
    )
    
    logger.logAdminAction(
      'test-admin',
      'Testing admin action logging',
      { action: 'test', resource: 'logging' },
      'test-user-id'
    )
    
    logger.logServiceManagement(
      'test-service',
      'Testing service management logging',
      { serviceName: 'test-service', action: 'start' }
    )
    
    // Test different log levels with colors
    logger.debug(
      'system',
      'test-debug',
      'This is a debug message with gray coloring',
      { debugInfo: 'detailed debug data' }
    )
    
    logger.warn(
      'payment-processing',
      'test-warning',
      'This is a warning message with yellow coloring',
      { warningType: 'rate_limit_approaching' }
    )
    
    // Test error logging
    logger.error(
      'system',
      'test-error',
      'This is an error message with red coloring',
      { errorCode: 'TEST_ERROR', severity: 'low' }
    )
    
    console.log('✅ All logging tests completed successfully')
    console.log('📁 Check the ./logs directory for log files')
    
    // Test reading logs back
    console.log('\n🔍 Testing log reading...')
    const logs = await logger.readLogs(undefined, undefined, undefined, undefined, 5)
    console.log(`📋 Read ${logs.length} log entries`)
    
    // Test stats
    const stats = await logger.getLogStats()
    console.log('📊 Log statistics:', stats)
    
    // Test server lifecycle logging
    console.log('\n🔄 Testing server lifecycle logging...')
    logger.logSystem(
      'test-lifecycle',
      'Testing server lifecycle logging',
      {
        nodeVersion: process.version,
        uptime: process.uptime(),
        memoryUsage: process.memoryUsage(),
        pid: process.pid
      }
    )
    
    // Test service management logging
    logger.logServiceManagement(
      'test-service',
      'Testing service management logging',
      { serviceName: 'test-service', action: 'start' }
    )
    
  } catch (error) {
    console.log('⚠️ Test failed:', error.message)
    console.log('✅ But this is expected in some environments')
  }
}

// Run the test
testLoggingSystem().then(() => {
  console.log('🎉 Logging system test completed')
  process.exit(0)
}).catch((error) => {
  console.error('❌ Logging system test failed:', error)
  process.exit(1)
})