import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import UserNavigation from '@/components/UserNavigation'

export default async function UserLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = await createClient()
  
  const { data: { user } } = await supabase.auth.getUser()
  
  if (!user) {
    redirect('/auth/login')
  }

  const { data: userProfile } = await supabase
    .from('users')
    .select('*')
    .eq('id', user.id)
    .single()

  // If user profile doesn't exist or onboarding not completed, redirect to onboarding
  if (!userProfile || !userProfile.onboarding_completed_at) {
    redirect('/onboarding')
  }

  return (
    <div className="flex flex-col min-h-screen bg-gray-50">
      <UserNavigation user={userProfile} useToggle={true} />
      <main className="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8 flex-1">
        {children}
      </main>
    </div>
  )
}