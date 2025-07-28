import { NextRequest, NextResponse } from 'next/server'
import { setupSentryUserContext, captureSentryError, captureSentryMessage } from '@/lib/sentry-helpers'
import { extractRequestInfo, getSimpleRequestInfo } from '@/lib/request-info'

export async function POST(request: NextRequest) {
  try {
    // Extract comprehensive request information
    const requestInfo = extractRequestInfo(request)
    const simpleInfo = getSimpleRequestInfo(request)
    
    console.log('📊 Request Information:', simpleInfo)
    
    // Set up Sentry user context
    await setupSentryUserContext(request)

    // Test different types of Sentry logging
    const { test_type } = await request.json()

    switch (test_type) {
      case 'error':
        // Test error capture with user context
        await captureSentryError(new Error('Test error with user context'), {
          tags: {
            test: 'sentry_enhancement',
            type: 'error_test'
          },
          extra: {
            test_data: 'This is a test error',
            timestamp: new Date().toISOString()
          }
        })
        break

      case 'message':
        // Test message capture with user context
        await captureSentryMessage('Test message with user context', 'info', {
          tags: {
            test: 'sentry_enhancement',
            type: 'message_test'
          },
          extra: {
            test_data: 'This is a test message',
            timestamp: new Date().toISOString()
          }
        })
        break

      case 'xero_error':
        // Simulate a Xero validation error
        const mockXeroError = new Error('Account code \'451.1\' is not a valid code for this document.')
        await captureSentryError(mockXeroError, {
          tags: {
            integration: 'xero',
            operation: 'invoice_sync',
            error_code: 'xero_validation_error',
            test: 'sentry_enhancement'
          },
          extra: {
            invoice_id: 'test-invoice-123',
            invoice_number: 'INV-001',
            payment_id: 'test-payment-456',
            tenant_id: 'test-tenant',
            tenant_name: 'Test Company',
            user_id: 'test-user-789',
            net_amount: 5000,
            error_code: 'xero_validation_error',
            error_message: 'Account code \'451.1\' is not a valid code for this document.',
            validation_errors: ['Account code \'451.1\' is not a valid code for this document.'],
            xero_error_details: {
              xeroErrorNumber: 400,
              xeroErrorType: 'ValidationException',
              validationErrors: [
                {
                  Message: 'Account code \'451.1\' is not a valid code for this document.',
                  FieldName: 'LineItems[0].AccountCode'
                }
              ]
            },
            line_items: [
              {
                description: 'Test Registration',
                accounting_code: '451.1',
                amount: 5000
              }
            ]
          }
        })
        break

      default:
        return NextResponse.json({ error: 'Invalid test type' }, { status: 400 })
    }

    return NextResponse.json({ 
      success: true, 
      message: `Sentry test '${test_type}' completed successfully`,
      timestamp: new Date().toISOString(),
      requestInfo: simpleInfo
    })

  } catch (error) {
    console.error('Error in Sentry test:', error)
    return NextResponse.json({ 
      error: 'Failed to test Sentry logging' 
    }, { status: 500 })
  }
} 