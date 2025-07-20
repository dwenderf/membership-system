import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import AdminNavigation from '@/components/AdminNavigation'
import EnvironmentBanner from '@/components/EnvironmentBanner'

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = await createClient()
  
  const { data: { user: authUser }, error: userError } = await supabase.auth.getUser()

  if (userError || !authUser) {
    redirect('/login')
  }

  const { data: user, error: profileError } = await supabase
    .from('users')
    .select('id, email, first_name, last_name, is_admin, member_id, tags')
    .eq('id', authUser.id)
    .single()

  if (profileError || !user) {
    redirect('/login')
  }

  if (!user.is_admin) {
    redirect('/user')
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <EnvironmentBanner />
      <AdminNavigation user={user} />
      <main className="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
        <div className="px-4 py-6 sm:px-0">
          {children}
        </div>
      </main>
    </div>
  )
}