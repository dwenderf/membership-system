const { createClient } = require('@supabase/supabase-js')

async function debugUserSyncLogs(userId) {
  if (!userId) {
    console.error('❌ Error: user_id parameter is required')
    console.log('Usage: node debug-user-sync-logs.js <user_id>')
    console.log('Example: node debug-user-sync-logs.js 79e9a75e-2580-4d56-8d10-d1a6f8542118')
    return
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  )

  console.log('🔍 Debugging User Xero Sync Logs...\n')

  // Get user details
  const { data: user, error: userError } = await supabase
    .from('users')
    .select('id, first_name, last_name, email, member_id')
    .eq('id', userId)
    .single()

  if (userError) {
    console.error('❌ Error finding user:', userError.message)
    return
  }

  if (!user) {
    console.error('❌ User not found with ID:', userId)
    return
  }

  console.log(`✅ Found user: ${user.first_name} ${user.last_name} (${user.member_id})`)
  console.log(`📧 Email: ${user.email}`)
  console.log(`🆔 User ID: ${user.id}\n`)

  // Get user's payments to find payment IDs
  const { data: payments, error: paymentsError } = await supabase
    .from('payments')
    .select('id, final_amount, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: true })

  if (paymentsError) {
    console.error('❌ Error fetching payments:', paymentsError)
    return
  }

  const paymentIds = payments?.map(p => p.id) || []
  console.log(`💰 Found ${paymentIds.length} payments for sync log search`)

  // Get Xero sync logs for this user's payments
  const { data: syncLogs, error: syncLogsError } = await supabase
    .from('xero_sync_logs')
    .select('*')
    .in('entity_id', paymentIds)
    .order('created_at', { ascending: true })

  if (syncLogsError) {
    console.error('❌ Error fetching sync logs:', syncLogsError)
    return
  }

  console.log(`📋 Found ${syncLogs?.length || 0} sync logs:`)
  
  if (syncLogs && syncLogs.length > 0) {
    syncLogs.forEach(log => {
      const payment = payments?.find(p => p.id === log.entity_id)
      console.log(`  - ${log.operation_type} (${log.status}): ${log.entity_type} ${log.entity_id}`)
      console.log(`    Time: ${log.created_at}`)
      console.log(`    Xero ID: ${log.xero_id || 'None'}`)
      if (payment) {
        console.log(`    Payment Amount: $${payment.final_amount/100}`)
      }
      if (log.error_message) {
        console.log(`    Error: ${log.error_message}`)
      }
      console.log('')
    })
  } else {
    console.log('  No sync logs found for this user\'s payments')
  }

  // Check for any failed operations that might have been retried
  console.log('🔍 Checking for failed operations that might indicate retries...')
  const { data: failedLogs, error: failedLogsError } = await supabase
    .from('xero_sync_logs')
    .select('*')
    .eq('status', 'error')
    .in('entity_id', paymentIds)
    .order('created_at', { ascending: true })

  if (failedLogsError) {
    console.error('❌ Error fetching failed logs:', failedLogsError)
  } else {
    console.log(`❌ Found ${failedLogs?.length || 0} failed sync logs for this user's payments:`)
    
    failedLogs?.forEach(log => {
      const payment = payments?.find(p => p.id === log.entity_id)
      console.log(`  - ${log.operation_type} (ERROR): ${log.entity_type} ${log.entity_id}`)
      console.log(`    Time: ${log.created_at}`)
      console.log(`    Error: ${log.error_message}`)
      if (payment) {
        console.log(`    Payment Amount: $${payment.final_amount/100}`)
      }
      console.log('')
    })
  }

  // Check for duplicate operations (same entity_id, same operation_type, close timestamps)
  console.log('🔍 Checking for potential duplicate operations...')
  const duplicateOperations = []
  
  if (syncLogs && syncLogs.length > 1) {
    for (let i = 0; i < syncLogs.length; i++) {
      for (let j = i + 1; j < syncLogs.length; j++) {
        const log1 = syncLogs[i]
        const log2 = syncLogs[j]
        
        // Check if same entity and operation type
        if (log1.entity_id === log2.entity_id && log1.operation_type === log2.operation_type) {
          const timeDiff = Math.abs(new Date(log1.created_at) - new Date(log2.created_at))
          const timeDiffMs = timeDiff / (1000 * 60) // Convert to minutes
          
          // If operations are within 5 minutes of each other, consider them potential duplicates
          if (timeDiffMs < 5) {
            duplicateOperations.push({
              entity_id: log1.entity_id,
              operation_type: log1.operation_type,
              log1_time: log1.created_at,
              log2_time: log2.created_at,
              time_diff_ms: timeDiffMs,
              log1_xero_id: log1.xero_id,
              log2_xero_id: log2.xero_id
            })
          }
        }
      }
    }
  }

  if (duplicateOperations.length > 0) {
    console.log(`⚠️  Found ${duplicateOperations.length} potential duplicate operations:`)
    duplicateOperations.forEach(dup => {
      const payment = payments?.find(p => p.id === dup.entity_id)
      console.log(`  - ${dup.operation_type} for entity ${dup.entity_id}`)
      console.log(`    First: ${dup.log1_time} (Xero ID: ${dup.log1_xero_id || 'None'})`)
      console.log(`    Second: ${dup.log2_time} (Xero ID: ${dup.log2_xero_id || 'None'})`)
      console.log(`    Time difference: ${dup.time_diff_ms.toFixed(2)} minutes`)
      if (payment) {
        console.log(`    Payment Amount: $${payment.final_amount/100}`)
      }
      console.log('')
    })
  } else {
    console.log('✅ No duplicate operations detected')
  }

  // Summary
  console.log('📊 Summary:')
  console.log(`  - User: ${user.first_name} ${user.last_name} (${user.member_id})`)
  console.log(`  - Payments: ${payments?.length || 0}`)
  console.log(`  - Total Sync Logs: ${syncLogs?.length || 0}`)
  console.log(`  - Failed Operations: ${failedLogs?.length || 0}`)
  console.log(`  - Potential Duplicates: ${duplicateOperations.length}`)
}

// Get user ID from command line argument
const userId = process.argv[2]

if (!userId) {
  console.error('❌ Error: user_id parameter is required')
  console.log('Usage: node debug-user-sync-logs.js <user_id>')
  console.log('Example: node debug-user-sync-logs.js 79e9a75e-2580-4d56-8d10-d1a6f8542118')
  process.exit(1)
}

debugUserSyncLogs(userId).catch(console.error) 