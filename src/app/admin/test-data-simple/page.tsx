'use client'

import { createClient } from '@/lib/supabase/client'
import { useState, useEffect } from 'react'

export default function SimpleTestDataPage() {
  const [memberships, setMemberships] = useState<any[]>([])
  const [currentMemberships, setCurrentMemberships] = useState<any[]>([])
  const [user, setUser] = useState<any>(null)
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')

  const supabase = createClient()

  useEffect(() => {
    loadData()
  }, [])

  async function loadData() {
    // Get current user
    const { data: { user: currentUser } } = await supabase.auth.getUser()
    setUser(currentUser)
    console.log('Current user:', currentUser)

    // Get available memberships
    const { data: membershipData, error: membershipError } = await supabase
      .from('memberships')
      .select('*')
      .order('name')
    
    console.log('Memberships:', membershipData, 'Error:', membershipError)
    setMemberships(membershipData || [])

    // Get current user memberships
    if (currentUser) {
      const { data: userMembershipData, error: userMembershipError } = await supabase
        .from('user_memberships')
        .select(`
          *,
          membership:memberships(name)
        `)
        .eq('user_id', currentUser.id)
        .order('valid_until', { ascending: false })
      
      console.log('User memberships:', userMembershipData, 'Error:', userMembershipError)
      setCurrentMemberships(userMembershipData || [])
    }
  }

  async function addTestMembership(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setLoading(true)
    setMessage('')

    const formData = new FormData(e.currentTarget)
    const membershipId = formData.get('membership_id') as string
    const months = parseInt(formData.get('months') as string)
    const startDate = formData.get('start_date') as string

    console.log('Form data:', { membershipId, months, startDate, userId: user?.id })

    if (!user) {
      setMessage('Error: No user logged in')
      setLoading(false)
      return
    }

    try {
      const validFrom = new Date(startDate)
      const validUntil = new Date(validFrom)
      validUntil.setMonth(validUntil.getMonth() + months)

      // Get membership details for pricing
      const { data: membership, error: membershipError } = await supabase
        .from('memberships')
        .select('*')
        .eq('id', membershipId)
        .single()

      if (membershipError) {
        console.error('Error fetching membership:', membershipError)
        setMessage(`Error fetching membership: ${membershipError.message}`)
        setLoading(false)
        return
      }

      console.log('Found membership:', membership)

      const amountPaid = months === 12 ? membership.price_annual : membership.price_monthly * months

      const insertData = {
        user_id: user.id,
        membership_id: membershipId,
        valid_from: validFrom.toISOString().split('T')[0],
        valid_until: validUntil.toISOString().split('T')[0],
        months_purchased: months,
        payment_status: 'paid',
        amount_paid: amountPaid,
        purchased_at: new Date().toISOString()
      }

      console.log('Inserting data:', insertData)

      const { data: insertResult, error } = await supabase
        .from('user_memberships')
        .insert(insertData)
        .select()

      if (error) {
        console.error('Error inserting:', error)
        setMessage(`Error: ${error.message}`)
      } else {
        console.log('Success:', insertResult)
        setMessage('Successfully added test membership!')
        loadData() // Refresh the data
        // Reset form
        ;(e.target as HTMLFormElement).reset()
      }
    } catch (err) {
      console.error('Unexpected error:', err)
      setMessage(`Unexpected error: ${err}`)
    }

    setLoading(false)
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
        <div className="px-4 py-6 sm:px-0">
          <div className="mb-8">
            <h1 className="text-3xl font-bold text-gray-900">Simple Test Data</h1>
            <p className="mt-1 text-sm text-gray-600">
              Client-side test membership creation with full error visibility
            </p>
            {user && <p className="text-sm text-gray-500">Logged in as: {user.email}</p>}
          </div>

          {message && (
            <div className={`mb-4 p-4 rounded ${
              message.includes('Error') ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'
            }`}>
              {message}
            </div>
          )}

          {/* Add Test Membership */}
          <div className="bg-white shadow rounded-lg mb-8">
            <div className="px-6 py-4 border-b border-gray-200">
              <h2 className="text-lg font-medium text-gray-900">Add Test Membership</h2>
            </div>
            <div className="px-6 py-4">
              <form onSubmit={addTestMembership} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700">
                    Membership Type
                  </label>
                  <select 
                    name="membership_id" 
                    required
                    className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2"
                  >
                    <option value="">Select membership...</option>
                    {memberships.map((membership) => (
                      <option key={membership.id} value={membership.id}>
                        {membership.name}
                      </option>
                    ))}
                  </select>
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700">
                    Duration
                  </label>
                  <select 
                    name="months" 
                    required
                    className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2"
                  >
                    <option value="3">3 months</option>
                    <option value="6">6 months</option>
                    <option value="12">12 months</option>
                  </select>
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700">
                    Start Date
                  </label>
                  <input 
                    type="date" 
                    name="start_date" 
                    required
                    defaultValue={new Date().toISOString().split('T')[0]}
                    className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2"
                  />
                </div>
                
                <button
                  type="submit"
                  disabled={loading}
                  className="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white px-4 py-2 rounded-md text-sm font-medium"
                >
                  {loading ? 'Adding...' : 'Add Test Membership'}
                </button>
              </form>
            </div>
          </div>

          {/* Current Memberships */}
          <div className="bg-white shadow rounded-lg">
            <div className="px-6 py-4 border-b border-gray-200">
              <h2 className="text-lg font-medium text-gray-900">Your Current Memberships</h2>
            </div>
            <div className="px-6 py-4">
              {currentMemberships.length > 0 ? (
                <div className="space-y-3">
                  {currentMemberships.map((membership) => (
                    <div key={membership.id} className="flex justify-between items-center border border-gray-200 rounded p-3">
                      <div>
                        <span className="font-medium">{membership.membership?.name}</span>
                        <div className="text-sm text-gray-500">
                          {membership.valid_from} → {membership.valid_until} ({membership.months_purchased} months)
                        </div>
                      </div>
                      <div className="text-sm">
                        <span className={`inline-flex px-2 py-1 rounded-full text-xs font-medium ${
                          membership.payment_status === 'paid' ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'
                        }`}>
                          {membership.payment_status}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-gray-500">No memberships found</p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}