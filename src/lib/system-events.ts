import { createAdminClient } from '@/lib/supabase/server'

export interface SystemEventData {
  event_type: string
  status: 'success' | 'failed' | 'partial'
  initiator: string
  started_at: Date
  completed_at?: Date
  records_processed?: number
  records_successful?: number
  records_failed?: number
  error_message?: string
  metadata?: Record<string, any>
}

/**
 * Log a system event to the system_events table
 */
export async function logSystemEvent(eventData: SystemEventData): Promise<void> {
  try {
    const supabase = createAdminClient()
    
    await supabase
      .from('system_events')
      .insert({
        event_type: eventData.event_type,
        status: eventData.status,
        initiator: eventData.initiator,
        started_at: eventData.started_at.toISOString(),
        completed_at: eventData.completed_at?.toISOString(),
        records_processed: eventData.records_processed || 0,
        records_successful: eventData.records_successful || 0,
        records_failed: eventData.records_failed || 0,
        error_message: eventData.error_message,
        metadata: eventData.metadata
      })
  } catch (error) {
    // Don't throw - system event logging shouldn't break the main operation
    console.error('Failed to log system event:', error)
  }
}

/**
 * Get the last successful sync event for a given event type
 */
export async function getLastSuccessfulSync(eventType: string): Promise<{
  completed_at: string
  records_processed: number
  records_successful: number
  records_failed: number
} | null> {
  try {
    const supabase = createAdminClient()
    
    const { data, error } = await supabase
      .from('system_events')
      .select('completed_at, records_processed, records_successful, records_failed')
      .eq('event_type', eventType)
      .eq('status', 'success')
      .order('completed_at', { ascending: false })
      .limit(1)
      .single()
    
    if (error || !data) {
      return null
    }
    
    return {
      completed_at: data.completed_at,
      records_processed: data.records_processed || 0,
      records_successful: data.records_successful || 0,
      records_failed: data.records_failed || 0
    }
  } catch (error) {
    console.error('Failed to get last successful sync:', error)
    return null
  }
}

/**
 * Helper function to create a system event for sync operations
 */
export async function logSyncEvent(
  eventType: 'email_sync' | 'xero_sync',
  initiator: string,
  startTime: Date,
  results: {
    processed: number
    successful: number
    failed: number
    errors?: string[]
  },
  error?: string
): Promise<void> {
  const endTime = new Date()
  const status = error ? 'failed' : (results.failed > 0 && results.successful > 0) ? 'partial' : 'success'
  
  await logSystemEvent({
    event_type: eventType,
    status,
    initiator,
    started_at: startTime,
    completed_at: endTime,
    records_processed: results.processed,
    records_successful: results.successful,
    records_failed: results.failed,
    error_message: error,
    metadata: {
      errors: results.errors,
      duration_ms: endTime.getTime() - startTime.getTime()
    }
  })
} 