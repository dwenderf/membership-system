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
    <>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">System Logs</h1>
        <p className="mt-1 text-sm text-gray-600">
          Monitor application logs, errors, and system events
        </p>
      </div>
      <LogViewer />
    </>
  )
}