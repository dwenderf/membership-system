import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { searchParams } = new URL(request.url)
    
    // Check if user is authenticated and is admin
    const { data: { user }, error: userError } = await supabase.auth.getUser()
    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Check if user is admin
    const { data: userData, error: userDataError } = await supabase
      .from('users')
      .select('is_admin')
      .eq('id', user.id)
      .single()

    if (userDataError || !userData?.is_admin) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
    }

    // Get time range parameter
    const range = searchParams.get('range') || '7d'
    let timeRange: number
    
    switch (range) {
      case '24h':
        timeRange = 24 * 60 * 60 * 1000
        break
      case '7d':
        timeRange = 7 * 24 * 60 * 60 * 1000
        break
      case '30d':
        timeRange = 30 * 24 * 60 * 60 * 1000
        break
      case '90d':
        timeRange = 90 * 24 * 60 * 60 * 1000
        break
      default:
        timeRange = 7 * 24 * 60 * 60 * 1000
    }

    const startDate = new Date(Date.now() - timeRange).toISOString()
    const endDate = new Date().toISOString()

    // Get memberships by type
    const { data: memberships, error: membershipsError } = await supabase
      .from('user_memberships')
      .select(`
        amount_paid,
        purchased_at,
        memberships (
          name
        )
      `)
      .gte('purchased_at', startDate)
      .lte('purchased_at', endDate)
      .eq('payment_status', 'paid')

    if (membershipsError) {
      console.error('Error fetching memberships:', membershipsError)
    }

    // Aggregate memberships by type
    const membershipSummary = new Map<string, { count: number; total: number }>()
    memberships?.forEach(membership => {
      const membershipData = Array.isArray(membership.memberships) ? membership.memberships[0] : membership.memberships
      const name = membershipData?.name || 'Unknown'
      const existing = membershipSummary.get(name) || { count: 0, total: 0 }
      membershipSummary.set(name, {
        count: existing.count + 1,
        total: existing.total + (membership.amount_paid || 0)
      })
    })

    // Get registrations data with registration details
    const { data: registrations, error: registrationsError } = await supabase
      .from('user_registrations')
      .select(`
        id,
        amount_paid,
        registered_at,
        registrations (
          id,
          name,
          season_id
        ),
        users (
          first_name,
          last_name
        )
      `)
      .gte('registered_at', startDate)
      .lte('registered_at', endDate)
      .eq('payment_status', 'paid')

    if (registrationsError) {
      console.error('Error fetching registrations:', registrationsError)
    }

    // Get discount usage
    const { data: discountUsage, error: discountError } = await supabase
      .from('discount_usage')
      .select(`
        amount_saved,
        used_at,
        discount_categories (
          name
        )
      `)
      .gte('used_at', startDate)
      .lte('used_at', endDate)

    if (discountError) {
      console.error('Error fetching discount usage:', discountError)
    }

    // Aggregate discount usage by category
    const discountSummary = new Map<string, { count: number; total: number }>()
    discountUsage?.forEach(usage => {
      const categoryData = Array.isArray(usage.discount_categories) ? usage.discount_categories[0] : usage.discount_categories
      const category = categoryData?.name || 'Unknown'
      const existing = discountSummary.get(category) || { count: 0, total: 0 }
      discountSummary.set(category, {
        count: existing.count + 1,
        total: existing.total + (usage.amount_saved || 0)
      })
    })

    // Get donations from user_memberships with donation amounts
    const { data: membershipDonations, error: membershipDonationsError } = await supabase
      .from('user_memberships')
      .select(`
        amount_paid,
        purchased_at,
        stripe_payment_intent_id
      `)
      .gte('purchased_at', startDate)
      .lte('purchased_at', endDate)
      .eq('payment_status', 'paid')

    if (membershipDonationsError) {
      console.error('Error fetching membership donations:', membershipDonationsError)
    }

    // Get donation amounts from Stripe payment intents (we'll need to fetch this separately)
    // For now, we'll use a simplified approach based on payment amounts
    let donationsReceived = 0
    let donationsGiven = 0
    let donationTransactionCount = 0

    // Calculate donations based on membership payments that include donation components
    membershipDonations?.forEach(membership => {
      // This is a simplified calculation - in a real implementation, you'd want to
      // fetch the actual donation amounts from Stripe metadata or store them separately
      // For now, we'll estimate based on common donation patterns
      if (membership.amount_paid && membership.amount_paid > 5000) { // $50 in cents
        // Assume any amount over $50 might include a donation
        const estimatedDonation = Math.min(membership.amount_paid - 5000, 2000) // Cap at $20
        if (estimatedDonation > 0) {
          donationsReceived += estimatedDonation
          donationTransactionCount++
        }
      }
    })

    // Get recent transactions using the new view
    console.log('🔍 Querying recent_transactions view with date range:', { startDate, endDate })
    
    const { data: recentTransactions, error: transactionsError } = await supabase
      .from('recent_transactions')
      .select('*')
      .gte('transaction_date', startDate)
      .lte('transaction_date', endDate)
      .order('transaction_date', { ascending: false })
      .limit(20)

    if (transactionsError) {
      console.error('❌ Error fetching recent transactions:', transactionsError)
    }

    // Debug: Log what we found
    console.log('📊 Recent transactions query results:', {
      found: recentTransactions?.length || 0,
      error: transactionsError ? transactionsError.message : null,
      sample: recentTransactions?.[0] ? {
        transactionId: recentTransactions[0].transaction_id,
        invoiceNumber: recentTransactions[0].invoice_number,
        amount: recentTransactions[0].amount,
        status: recentTransactions[0].status,
        customerName: `${recentTransactions[0].first_name} ${recentTransactions[0].last_name}`,
        type: recentTransactions[0].transaction_type,
        date: recentTransactions[0].transaction_date
      } : null,
      allData: recentTransactions?.slice(0, 3) // Show first 3 records for debugging
    })

    // Process recent transactions from the view
    let processedTransactions = recentTransactions?.map(transaction => {
      const customerName = transaction.first_name && transaction.last_name 
        ? `${transaction.first_name} ${transaction.last_name}`.trim() 
        : 'Unknown'

      return {
        id: transaction.transaction_id,
        invoiceNumber: transaction.invoice_number || 'N/A',
        customerName,
        amount: transaction.amount || 0,
        type: transaction.transaction_type || 'unknown',
        date: transaction.transaction_date,
        status: transaction.status || 'UNKNOWN'
      }
    }) || []

    // If no transactions found in the view, fall back to payments table
    if (processedTransactions.length === 0) {
      console.log('No transactions found in view, falling back to payments table')
      
      const { data: fallbackPayments, error: fallbackError } = await supabase
        .from('payments')
        .select(`
          id,
          final_amount,
          created_at,
          users (
            first_name,
            last_name
          )
        `)
        .gte('created_at', startDate)
        .lte('created_at', endDate)
        .eq('status', 'completed')
        .order('created_at', { ascending: false })
        .limit(20)

      if (fallbackError) {
        console.error('Error fetching fallback payments:', fallbackError)
      } else {
        processedTransactions = fallbackPayments?.map(payment => {
          const userData = Array.isArray(payment.users) ? payment.users[0] : payment.users
          const customerName = userData ? `${userData.first_name} ${userData.last_name}`.trim() : 'Unknown'
          
          return {
            id: payment.id,
            invoiceNumber: 'N/A',
            customerName,
            amount: payment.final_amount || 0,
            type: 'payment',
            date: payment.created_at,
            status: 'COMPLETED'
          }
        }) || []
      }
    }

    // Group registrations by registration type and calculate totals
    const registrationsByType = new Map<string, { 
      registrationId: string, 
      name: string, 
      count: number, 
      total: number,
      registrations: Array<{
        id: string,
        customerName: string,
        amount: number,
        date: string
      }>
    }>()

    registrations?.forEach(registration => {
      const registrationData = Array.isArray(registration.registrations) ? registration.registrations[0] : registration.registrations
      const userData = Array.isArray(registration.users) ? registration.users[0] : registration.users
      
      const registrationId = registrationData?.id || 'unknown'
      const name = registrationData?.name || 'Unknown Registration'
      const customerName = userData ? `${userData.first_name} ${userData.last_name}`.trim() : 'Unknown'
      const amount = registration.amount_paid || 0

      const existing = registrationsByType.get(registrationId) || {
        registrationId,
        name,
        count: 0,
        total: 0,
        registrations: [] as Array<{
          id: string,
          customerName: string,
          amount: number,
          date: string
        }>
      }

      existing.count += 1
      existing.total += amount
      existing.registrations.push({
        id: registration.id,
        customerName,
        amount,
        date: registration.registered_at
      })

      registrationsByType.set(registrationId, existing)
    })

    // Convert to array, sort registrations by date (newest first), then sort by total amount
    const registrationsBreakdown = Array.from(registrationsByType.values())
      .map(registration => ({
        ...registration,
        registrations: registration.registrations.sort((a, b) => 
          new Date(b.date).getTime() - new Date(a.date).getTime()
        )
      }))
      .sort((a, b) => b.total - a.total)

    const reportData = {
      dateRange: {
        start: startDate,
        end: endDate
      },
      summary: {
        discountUsage: Array.from(discountSummary.entries()).map(([category, data]) => ({
          category,
          timesUsed: data.count,
          totalAmount: data.total
        })),
        donationsReceived: {
          transactionCount: donationTransactionCount,
          totalAmount: donationsReceived
        },
        donationsGiven: {
          transactionCount: 0, // You might need to implement this based on your business logic
          totalAmount: donationsGiven
        },
        memberships: Array.from(membershipSummary.entries()).map(([name, data]) => ({
          name,
          purchaseCount: data.count,
          totalAmount: data.total
        })),
        registrations: {
          purchaseCount: registrations?.length || 0,
          totalAmount: registrations?.reduce((sum, reg) => sum + (reg.amount_paid || 0), 0) || 0,
          breakdown: registrationsBreakdown
        }
      },
      recentTransactions: processedTransactions
    }

    // Add some debugging info
    console.log('Report data generated:', {
      dateRange: `${startDate} to ${endDate}`,
      membershipCount: memberships?.length || 0,
      registrationCount: registrations?.length || 0,
      discountUsageCount: discountUsage?.length || 0,
      transactionCount: processedTransactions.length
    })

    return NextResponse.json(reportData)

  } catch (error) {
    console.error('Error generating reports:', error)
    return NextResponse.json({ 
      error: 'Failed to generate reports' 
    }, { status: 500 })
  }
} 