/**
 * Admin Logs Page
 * 
 * Provides comprehensive log viewing and monitoring capabilities
 */

import { Metadata } from 'next'
import LogViewer from '@/components/admin/LogViewer'

export const metadata: Metadata = {
  title: 'Application Logs - Admin Dashboard',
  description: 'View and monitor application logs, errors, and system events'
}

export default function AdminLogsPage() {
  return (
    <div className="min-h-screen bg-gray-50">
      <LogViewer />
    </div>
  )
}