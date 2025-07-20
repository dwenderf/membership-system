'use client'

import { createContext, useContext, useState, ReactNode } from 'react'
import Toast, { ToastProps } from '@/components/Toast'

export interface ToastData {
  title: string
  message?: string
  type: 'success' | 'error' | 'warning' | 'info'
  duration?: number
}

interface ToastContextType {
  showToast: (toast: ToastData) => void
  showSuccess: (title: string, message?: string) => void
  showError: (title: string, message?: string) => void
  showWarning: (title: string, message?: string) => void
  showInfo: (title: string, message?: string) => void
}

const ToastContext = createContext<ToastContextType | undefined>(undefined)

export function useToast() {
  const context = useContext(ToastContext)
  if (context === undefined) {
    throw new Error('useToast must be used within a ToastProvider')
  }
  return context
}

interface ToastProviderProps {
  children: ReactNode
}

export function ToastProvider({ children }: ToastProviderProps) {
  const [toasts, setToasts] = useState<(ToastData & { id: string })[]>([])

  const generateId = () => Math.random().toString(36).substr(2, 9)

  const showToast = (toast: ToastData) => {
    const id = generateId()
    setToasts(prev => [...prev, { ...toast, id }])
  }

  const showSuccess = (title: string, message?: string) => {
    showToast({ title, message, type: 'success' })
  }

  const showError = (title: string, message?: string) => {
    showToast({ title, message, type: 'error' })
  }

  const showWarning = (title: string, message?: string) => {
    showToast({ title, message, type: 'warning' })
  }

  const showInfo = (title: string, message?: string) => {
    showToast({ title, message, type: 'info' })
  }

  const removeToast = (id: string) => {
    setToasts(prev => prev.filter(toast => toast.id !== id))
  }

  return (
    <ToastContext.Provider value={{ showToast, showSuccess, showError, showWarning, showInfo }}>
      {children}
      
      {/* Toast Container - Fixed position */}
      <div className="fixed top-4 right-4 z-50 max-w-sm w-full">
        {toasts.map(toast => (
          <Toast
            key={toast.id}
            id={toast.id}
            title={toast.title}
            message={toast.message}
            type={toast.type}
            duration={toast.duration}
            onClose={removeToast}
          />
        ))}
      </div>
    </ToastContext.Provider>
  )
}