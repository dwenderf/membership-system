/**
 * Enhanced Batch Processing System
 * 
 * Provides intelligent retry logic, scheduling, performance optimizations,
 * and monitoring for batch operations.
 */

import { createAdminClient } from './supabase/server'
import { Database } from '@/types/database'

export interface BatchJob {
  id: string
  type: 'xero_sync' | 'email_batch' | 'cleanup'
  priority: 'high' | 'medium' | 'low'
  payload: any
  retry_count: number
  max_retries: number
  next_retry_at?: Date
  created_at: Date
  updated_at: Date
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled'
}

export interface RetryStrategy {
  maxRetries: number
  baseDelayMs: number
  maxDelayMs: number
  backoffMultiplier: number
  jitterMs: number
}

export class BatchProcessor {
  private supabase: ReturnType<typeof createAdminClient>
  private isProcessing = false
  private processingInterval?: NodeJS.Timeout

  // Default retry strategies for different operation types
  private readonly retryStrategies: Record<string, RetryStrategy> = {
    xero_api: {
      maxRetries: 5,
      baseDelayMs: 1000,      // Start with 1 second
      maxDelayMs: 300000,     // Max 5 minutes
      backoffMultiplier: 2,   // Double each time
      jitterMs: 1000          // Add randomness to prevent thundering herd
    },
    email: {
      maxRetries: 3,
      baseDelayMs: 5000,      // Start with 5 seconds
      maxDelayMs: 60000,      // Max 1 minute
      backoffMultiplier: 3,   // Triple each time
      jitterMs: 2000
    },
    database: {
      maxRetries: 2,
      baseDelayMs: 500,       // Start with 500ms
      maxDelayMs: 5000,       // Max 5 seconds
      backoffMultiplier: 4,   // Quadruple each time
      jitterMs: 500
    }
  }

  constructor() {
    this.supabase = createAdminClient()
  }

  /**
   * Calculate next retry delay using exponential backoff with jitter
   */
  calculateRetryDelay(
    retryCount: number, 
    strategy: RetryStrategy
  ): number {
    // Exponential backoff: baseDelay * (multiplier ^ retryCount)
    const exponentialDelay = strategy.baseDelayMs * Math.pow(strategy.backoffMultiplier, retryCount)
    
    // Cap at maximum delay
    const cappedDelay = Math.min(exponentialDelay, strategy.maxDelayMs)
    
    // Add jitter to prevent thundering herd
    const jitter = Math.random() * strategy.jitterMs
    
    return cappedDelay + jitter
  }

  /**
   * Retry an operation with intelligent backoff
   */
  async retryWithBackoff<T>(
    operation: () => Promise<T>,
    operationType: keyof typeof this.retryStrategies,
    context: string = 'Unknown operation'
  ): Promise<{ success: boolean; result?: T; error?: string }> {
    const strategy = this.retryStrategies[operationType]
    let lastError: any = null

    for (let attempt = 0; attempt <= strategy.maxRetries; attempt++) {
      try {
        console.log(`🔄 Attempting ${context} (attempt ${attempt + 1}/${strategy.maxRetries + 1})`)
        
        const result = await operation()
        
        if (attempt > 0) {
          console.log(`✅ ${context} succeeded after ${attempt + 1} attempts`)
        }
        
        return { success: true, result }
        
      } catch (error) {
        lastError = error
        console.log(`❌ ${context} failed on attempt ${attempt + 1}:`, error instanceof Error ? error.message : error)
        
        // If this was the last attempt, don't wait
        if (attempt === strategy.maxRetries) {
          break
        }
        
        // Calculate delay and wait
        const delay = this.calculateRetryDelay(attempt, strategy)
        console.log(`⏱️ Waiting ${Math.round(delay)}ms before retry...`)
        await this.delay(delay)
      }
    }

    const errorMessage = lastError instanceof Error ? lastError.message : String(lastError)
    console.log(`💥 ${context} failed after all retries: ${errorMessage}`)
    
    return { 
      success: false, 
      error: `Failed after ${strategy.maxRetries + 1} attempts: ${errorMessage}` 
    }
  }

  /**
   * Process items in batches with size limits and rate limiting
   */
  async processBatch<T, R>(
    items: T[],
    processor: (item: T) => Promise<R>,
    options: {
      batchSize?: number
      concurrency?: number
      delayBetweenBatches?: number
      retryFailures?: boolean
      operationType?: keyof typeof this.retryStrategies
      priorityField?: keyof T
      sortOrder?: 'asc' | 'desc'
      progressCallback?: (progress: { completed: number; total: number; successCount: number; failureCount: number }) => void
    } = {}
  ): Promise<{
    successful: R[]
    failed: { item: T; error: string }[]
    metrics: {
      totalItems: number
      successCount: number
      failureCount: number
      processingTimeMs: number
      averageItemTimeMs: number
      peakMemoryUsageMB?: number
    }
  }> {
    const {
      batchSize = 10,
      concurrency = 3,
      delayBetweenBatches = 100,
      retryFailures = true,
      operationType = 'xero_api',
      priorityField,
      sortOrder = 'asc',
      progressCallback
    } = options

    const startTime = Date.now()
    const successful: R[] = []
    const failed: { item: T; error: string }[] = []
    let peakMemoryUsageMB = 0

    console.log(`🔄 Processing ${items.length} items in batches of ${batchSize} with concurrency ${concurrency}`)

    // Sort items by priority if specified
    let sortedItems = [...items]
    if (priorityField) {
      sortedItems.sort((a, b) => {
        const aVal = a[priorityField]
        const bVal = b[priorityField]
        const multiplier = sortOrder === 'desc' ? -1 : 1
        
        if (aVal < bVal) return -1 * multiplier
        if (aVal > bVal) return 1 * multiplier
        return 0
      })
      console.log(`📊 Sorted ${items.length} items by ${String(priorityField)} (${sortOrder})`)
    }

    // Optimize batch size for large datasets
    const optimizedBatchSize = this.optimizeBatchSize(sortedItems.length, batchSize)
    const optimizedConcurrency = Math.min(concurrency, Math.ceil(optimizedBatchSize / 2))

    console.log(`🎯 Optimized batch size: ${optimizedBatchSize}, concurrency: ${optimizedConcurrency}`)

    // Split items into batches
    const batches = this.chunkArray(sortedItems, optimizedBatchSize)

    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i]
      console.log(`📦 Processing batch ${i + 1}/${batches.length} (${batch.length} items)`)

      // Process batch with limited concurrency
      const batchPromises = batch.map(async (item) => {
        try {
          let result: R

          if (retryFailures) {
            const retryResult = await this.retryWithBackoff(
              () => processor(item),
              operationType,
              `Processing item ${items.indexOf(item) + 1}`
            )

            if (!retryResult.success) {
              throw new Error(retryResult.error || 'Unknown error')
            }

            result = retryResult.result!
          } else {
            result = await processor(item)
          }

          return { success: true as const, result, item }
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error)
          return { success: false as const, error: errorMessage, item }
        }
      })

      // Execute with concurrency limit
      const batchResults = await this.limitConcurrency(batchPromises, optimizedConcurrency)

      // Collect results
      for (const result of batchResults) {
        if (result.success) {
          successful.push(result.result)
        } else {
          failed.push({ item: result.item, error: result.error })
        }
      }

      // Track memory usage for performance monitoring
      if (typeof process !== 'undefined' && process.memoryUsage) {
        const memUsage = process.memoryUsage()
        const currentMemoryMB = memUsage.heapUsed / 1024 / 1024
        peakMemoryUsageMB = Math.max(peakMemoryUsageMB, currentMemoryMB)
      }

      // Progress callback for monitoring
      if (progressCallback) {
        const completed = (i + 1) * optimizedBatchSize
        progressCallback({
          completed: Math.min(completed, sortedItems.length),
          total: sortedItems.length,
          successCount: successful.length,
          failureCount: failed.length
        })
      }

      // Delay between batches (except for the last batch)
      if (i < batches.length - 1 && delayBetweenBatches > 0) {
        await this.delay(delayBetweenBatches)
      }
    }

    const processingTimeMs = Date.now() - startTime
    const averageItemTimeMs = processingTimeMs / items.length
    const metrics = {
      totalItems: items.length,
      successCount: successful.length,
      failureCount: failed.length,
      processingTimeMs,
      averageItemTimeMs,
      peakMemoryUsageMB: peakMemoryUsageMB > 0 ? peakMemoryUsageMB : undefined
    }

    console.log(`✅ Batch processing completed:`, metrics)
    return { successful, failed, metrics }
  }

  /**
   * Start scheduled batch processing
   */
  async startScheduledProcessing(intervalMs: number = 60000): Promise<void> {
    if (this.isProcessing) {
      console.log('📋 Batch processing already running')
      return
    }

    console.log(`⏰ Starting scheduled batch processing every ${intervalMs}ms`)
    this.isProcessing = true

    this.processingInterval = setInterval(async () => {
      try {
        await this.processScheduledBatches()
      } catch (error) {
        console.error('❌ Error in scheduled batch processing:', error)
      }
    }, intervalMs)
  }

  /**
   * Stop scheduled batch processing
   */
  async stopScheduledProcessing(): Promise<void> {
    if (!this.isProcessing) {
      console.log('📋 Batch processing not running')
      return
    }

    console.log('🛑 Stopping scheduled batch processing')
    this.isProcessing = false

    if (this.processingInterval) {
      clearInterval(this.processingInterval)
      this.processingInterval = undefined
    }
  }

  /**
   * Process scheduled batches (to be implemented by specific processors)
   */
  protected async processScheduledBatches(): Promise<void> {
    console.log('🔄 Running scheduled batch processing...')
    
    // This would typically:
    // 1. Query for pending jobs/records
    // 2. Group by priority and type
    // 3. Process high-priority items first
    // 4. Use processBatch() for efficient processing
    
    console.log('🚧 Scheduled batch processing - to be implemented by specific processors')
  }

  /**
   * Optimize batch size based on dataset size
   */
  private optimizeBatchSize(totalItems: number, requestedBatchSize: number): number {
    // For small datasets, use requested size
    if (totalItems <= 100) {
      return Math.min(requestedBatchSize, totalItems)
    }
    
    // For medium datasets (100-1000), slightly increase batch size
    if (totalItems <= 1000) {
      return Math.min(requestedBatchSize * 1.5, 25)
    }
    
    // For large datasets (1000+), use larger batches for efficiency
    if (totalItems <= 10000) {
      return Math.min(requestedBatchSize * 2, 50)
    }
    
    // For very large datasets, use even larger batches
    return Math.min(requestedBatchSize * 3, 100)
  }

  /**
   * Split array into chunks of specified size
   */
  private chunkArray<T>(array: T[], chunkSize: number): T[][] {
    const chunks: T[][] = []
    for (let i = 0; i < array.length; i += chunkSize) {
      chunks.push(array.slice(i, i + chunkSize))
    }
    return chunks
  }

  /**
   * Limit concurrent promise execution
   */
  private async limitConcurrency<T>(
    promises: Promise<T>[],
    concurrency: number
  ): Promise<T[]> {
    const results: T[] = []
    
    for (let i = 0; i < promises.length; i += concurrency) {
      const batch = promises.slice(i, i + concurrency)
      const batchResults = await Promise.all(batch)
      results.push(...batchResults)
    }
    
    return results
  }

  /**
   * Add delay
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }

  /**
   * Process items with priority-based ordering
   */
  async processPriorityBatch<T extends { priority?: 'high' | 'medium' | 'low' }, R>(
    items: T[],
    processor: (item: T) => Promise<R>,
    options: {
      batchSize?: number
      concurrency?: number
      delayBetweenBatches?: number
      retryFailures?: boolean
      operationType?: keyof typeof this.retryStrategies
      progressCallback?: (progress: { completed: number; total: number; successCount: number; failureCount: number }) => void
    } = {}
  ): Promise<{
    successful: R[]
    failed: { item: T; error: string }[]
    metrics: {
      totalItems: number
      successCount: number
      failureCount: number
      processingTimeMs: number
      averageItemTimeMs: number
      peakMemoryUsageMB?: number
      priorityBreakdown: { high: number; medium: number; low: number }
    }
  }> {
    console.log('🎯 Processing batch with priority ordering...')
    
    // Separate items by priority
    const highPriority = items.filter(item => item.priority === 'high')
    const mediumPriority = items.filter(item => item.priority === 'medium')
    const lowPriority = items.filter(item => !item.priority || item.priority === 'low')
    
    const priorityBreakdown = {
      high: highPriority.length,
      medium: mediumPriority.length,
      low: lowPriority.length
    }
    
    console.log('📊 Priority breakdown:', priorityBreakdown)
    
    // Process in priority order: high -> medium -> low
    const orderedItems = [...highPriority, ...mediumPriority, ...lowPriority]
    
    const result = await this.processBatch(orderedItems, processor, options)
    
    return {
      ...result,
      metrics: {
        ...result.metrics,
        priorityBreakdown
      }
    }
  }

  /**
   * Create processing metrics log entry
   */
  async logProcessingMetrics(
    operationType: string,
    metrics: {
      totalItems: number
      successCount: number
      failureCount: number
      processingTimeMs: number
      averageItemTimeMs: number
      peakMemoryUsageMB?: number
    }
  ): Promise<void> {
    try {
      const logEntry = {
        operation_type: operationType,
        total_items: metrics.totalItems,
        success_count: metrics.successCount,
        failure_count: metrics.failureCount,
        processing_time_ms: metrics.processingTimeMs,
        average_item_time_ms: metrics.averageItemTimeMs,
        peak_memory_usage_mb: metrics.peakMemoryUsageMB,
        created_at: new Date().toISOString()
      }
      
      // Log to console for now - could be enhanced to write to database
      console.log('📊 Batch Processing Metrics:', logEntry)
      
      // TODO: Write to processing_metrics table if it exists
      
    } catch (error) {
      console.error('❌ Error logging processing metrics:', error)
    }
  }

  /**
   * Get processing status
   */
  getStatus() {
    return {
      isProcessing: this.isProcessing,
      hasInterval: !!this.processingInterval,
      retryStrategies: Object.keys(this.retryStrategies)
    }
  }
}

// Export singleton instance
export const batchProcessor = new BatchProcessor()