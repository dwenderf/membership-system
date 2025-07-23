'use client'

interface ClientTimestampProps {
  timestamp: string | null
  className?: string
}

export default function ClientTimestamp({ timestamp, className = '' }: ClientTimestampProps) {
  if (!timestamp) return <span className={className}>Not set</span>
  
  // This runs on client-side, so timezone conversion works properly
  const date = new Date(timestamp)
  
  const formatted = date.toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric', 
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  })
  
  return <span className={className}>{formatted}</span>
}