import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'

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
    
    // Get pagination parameters
    const offset = parseInt(searchParams.get('offset') || '0')
    const limit = Math.min(parseInt(searchParams.get('limit') || '50'), 100) // Cap at 100
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

    // Get memberships data from membership-specific view (starts from memberships table)
    const { data: memberships, error: membershipsError } = await supabase
      .from('membership_reports_data')
      .select('*')
      .gte('invoice_created_at', startDate)
      .lte('invoice_created_at', endDate)

    if (membershipsError) {
      console.error('Error fetching memberships from reports view:', membershipsError)
    }

    // Group memberships by membership ID and calculate totals
    const membershipsByType = new Map<string, { 
      membershipId: string, 
      name: string, 
      count: number, 
      total: number,
      memberships: Array<{
        id: string,
        customerName: string,
        amount: number,
        date: string
      }>
    }>()

    memberships?.forEach(membership => {
      const membershipId = membership.membership_id || 'unknown'
      const membershipName = membership.membership_name || membership.description || 'Unknown Membership'
      const customerName = membership.customer_name || 'Unknown'
      const amount = membership.line_amount || 0

      const existing = membershipsByType.get(membershipId) || {
        membershipId,
        name: membershipName,
        count: 0,
        total: 0,
        memberships: [] as Array<{
          id: string,
          customerName: string,
          amount: number,
          date: string
        }>
      }

      existing.count += 1
      existing.total += amount
      existing.memberships.push({
        id: membership.line_item_id,
        customerName,
        amount,
        date: membership.invoice_created_at
      })

      membershipsByType.set(membershipId, existing)
    })

    // Convert to array, sort memberships by date (newest first), then sort by total amount
    const membershipsBreakdown = Array.from(membershipsByType.values())
      .map(membership => ({
        ...membership,
        memberships: membership.memberships.sort((a, b) => 
          new Date(b.date).getTime() - new Date(a.date).getTime()
        )
      }))
      .sort((a, b) => b.total - a.total)

    // Calculate memberships summary for backward compatibility
    const membershipSummary = new Map<string, { count: number; total: number }>()
    membershipsBreakdown.forEach(membership => {
      membershipSummary.set(membership.name, {
        count: membership.count,
        total: membership.total
      })
    })

    // Get registrations data from reports view
    const { data: registrations, error: registrationsError } = await supabase
      .from('reports_data')
      .select('*')
      .eq('line_item_type', 'registration')
      .gte('invoice_created_at', startDate)
      .lte('invoice_created_at', endDate)

    if (registrationsError) {
      console.error('Error fetching registrations from reports view:', registrationsError)
    }

    // Get discount usage from reports view
    const { data: discountUsage, error: discountError } = await supabase
      .from('reports_data')
      .select('*')
      .eq('line_item_type', 'discount')
      .gte('invoice_created_at', startDate)
      .lte('invoice_created_at', endDate)

    if (discountError) {
      console.error('Error fetching discount usage from reports view:', discountError)
    }

    // Group discount usage by category and calculate totals
    const discountUsageByCategory = new Map<string, { 
      categoryId: string, 
      name: string, 
      count: number, 
      total: number,
      usages: Array<{
        id: string,
        customerName: string,
        discountCode: string,
        amountSaved: number,
        date: string
      }>
    }>()

    discountUsage?.forEach(usage => {
      // For discounts, we'll group by description since we don't have category info in Xero line items
      const categoryId = usage.description || 'unknown'
      const name = usage.description || 'Unknown Discount'
      const customerName = usage.customer_name || 'Unknown'
      const discountCode = usage.description || 'Unknown Code' // Use description as discount code
      const amountSaved = usage.absolute_amount || 0 // Use the computed absolute amount from the view

      const existing = discountUsageByCategory.get(categoryId) || {
        categoryId,
        name,
        count: 0,
        total: 0,
        usages: [] as Array<{
          id: string,
          customerName: string,
          discountCode: string,
          amountSaved: number,
          date: string
        }>
      }

      existing.count += 1
      existing.total += amountSaved
      existing.usages.push({
        id: usage.line_item_id,
        customerName,
        discountCode,
        amountSaved,
        date: usage.invoice_created_at
      })

      discountUsageByCategory.set(categoryId, existing)
    })

    // Convert to array, sort usages by date (newest first), then sort by total amount
    const discountUsageBreakdown = Array.from(discountUsageByCategory.values())
      .map(category => ({
        ...category,
        usages: category.usages.sort((a, b) => 
          new Date(b.date).getTime() - new Date(a.date).getTime()
        )
      }))
      .sort((a, b) => b.total - a.total)

    // Calculate discount summary for backward compatibility
    const discountSummary = new Map<string, { count: number; total: number }>()
    discountUsageBreakdown.forEach(category => {
      discountSummary.set(category.name, {
        count: category.count,
        total: category.total
      })
    })

    // Get donations from reports view
    const { data: donations, error: donationsError } = await supabase
      .from('reports_data')
      .select('*')
      .eq('line_item_type', 'donation')
      .gte('invoice_created_at', startDate)
      .lte('invoice_created_at', endDate)

    if (donationsError) {
      console.error('Error fetching donations from reports view:', donationsError)
    }

    // Calculate donations from Xero line items
    let donationsReceived = 0
    let donationsGiven = 0
    let donationTransactionCount = 0
    const donationDetails: Array<{
      id: string,
      customerName: string,
      amount: number,
      date: string,
      type: 'received' | 'given'
    }> = []

    console.log('🔍 Donations data from Xero:', {
      totalDonations: donations?.length || 0,
      sampleDonation: donations?.[0] ? {
        amount: donations[0].line_amount,
        description: donations[0].description
      } : null
    })

    donations?.forEach(donation => {
      const customerName = donation.customer_name || 'Unknown'
      const amount = donation.line_amount || 0
      
      // For now, treat all donations as received
      // In the future, you might want to distinguish based on description or other metadata
      donationsReceived += amount
      donationTransactionCount++
      donationDetails.push({
        id: donation.line_item_id,
        customerName,
        amount,
        date: donation.invoice_created_at,
        type: 'received'
      })
    })

    console.log('📊 Donation calculation results:', {
      donationsReceived,
      donationTransactionCount,
      donationDetailsCount: donationDetails.length,
      sampleDonation: donationDetails[0]
    })

    // Sort donation details by date (newest first)
    donationDetails.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())

    // Get recent transactions using the new view
    console.log('🔍 Querying recent_transactions view with date range:', { startDate, endDate })
    
    const { data: recentTransactions, error: transactionsError } = await supabase
      .from('recent_transactions')
      .select('*')
      .gte('transaction_date', startDate)
      .lte('transaction_date', endDate)
      .order('transaction_date', { ascending: false })
      .range(offset, offset + limit - 1)

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
        .range(offset, offset + limit - 1)

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
      const registrationId = registration.description || 'unknown'
      const name = registration.description || 'Unknown Registration'
      const customerName = registration.customer_name || 'Unknown'
      const amount = registration.line_amount || 0

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
        id: registration.line_item_id,
        customerName,
        amount,
        date: registration.invoice_created_at
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
        discountUsageBreakdown: discountUsageBreakdown,
        donationsReceived: {
          transactionCount: donationTransactionCount,
          totalAmount: donationsReceived
        },
        donationsGiven: {
          transactionCount: 0, // You might need to implement this based on your business logic
          totalAmount: donationsGiven
        },
        donationDetails: donationDetails,
        memberships: Array.from(membershipSummary.entries()).map(([name, data]) => ({
          name,
          purchaseCount: data.count,
          totalAmount: data.total
        })),
        membershipsBreakdown: membershipsBreakdown,
        registrations: {
          purchaseCount: registrations?.length || 0,
          totalAmount: registrations?.reduce((sum, reg) => sum + (reg.line_amount || 0), 0) || 0,
          breakdown: registrationsBreakdown
        }
      },
      recentTransactions: processedTransactions
    }

    // Get active members by membership type using the view (with admin client to bypass RLS)
    const adminSupabase = createAdminClient()
    const { data: activeMembers, error: activeMembersError } = await adminSupabase
      .from('reports_active_memberships')
      .select('*')

    if (activeMembersError) {
      console.error('Error fetching active members:', activeMembersError)
    }

    // Process active members data (already grouped by membership type)
    const activeMembersByType = activeMembers?.map(membership => ({
      membershipId: membership.membership_id,
      name: membership.membership_name,
      count: membership.active_member_count
    })) || []

    // Data is already sorted by count from the view
    const activeMembersSummary = activeMembersByType

    // Add debugging for active members
    console.log('Active members data from view:', activeMembers)
    console.log('Processed active members:', activeMembersSummary)

    // Add some debugging info
    console.log('Report data generated:', {
      dateRange: `${startDate} to ${endDate}`,
      membershipCount: memberships?.length || 0,
      registrationCount: registrations?.length || 0,
      discountUsageCount: discountUsage?.length || 0,
      transactionCount: processedTransactions.length,
      activeMembersCount: activeMembers?.length || 0
    })

    return NextResponse.json({
      ...reportData,
      activeMembers: activeMembersSummary,
      pagination: {
        offset,
        limit,
        hasMore: processedTransactions.length === limit
      }
    })

  } catch (error) {
    console.error('Error generating reports:', error)
    return NextResponse.json({ 
      error: 'Failed to generate reports' 
    }, { status: 500 })
  }
} 