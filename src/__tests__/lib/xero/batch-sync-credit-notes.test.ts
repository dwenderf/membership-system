/**
 * Integration tests for XeroBatchSyncManager.syncXeroCreditNotes error handling
 * (see issue #46). Covers the four scenarios called out in that issue:
 * per-item validation errors, partial batch failures thrown by the Xero API,
 * database failures after a successful Xero sync, and synced/failed count
 * tracking across all of the above.
 */

jest.mock('@/lib/supabase/admin', () => ({
  createAdminClient: jest.fn()
}))

jest.mock('@/lib/xero/client', () => ({
  logXeroSync: jest.fn(),
  getAuthenticatedXeroClient: jest.fn(),
  getActiveTenant: jest.fn(),
  validateXeroConnection: jest.fn()
}))

jest.mock('@/lib/xero/contacts', () => ({
  getOrCreateXeroContact: jest.fn(),
  generateContactName: jest.fn()
}))

jest.mock('@/lib/logging/logger', () => ({
  logger: {
    logXeroSync: jest.fn(),
    logSystem: jest.fn(),
    logPaymentProcessing: jest.fn()
  }
}))

jest.mock('@/lib/sentry-flush', () => ({
  scheduleSentryFlush: jest.fn()
}))

jest.mock('@sentry/nextjs', () => ({
  captureException: jest.fn()
}))

import { XeroBatchSyncManager } from '@/lib/xero/batch-sync-xero'
import { createAdminClient } from '@/lib/supabase/admin'
import { logXeroSync } from '@/lib/xero/client'
import * as Sentry from '@sentry/nextjs'
import { scheduleSentryFlush } from '@/lib/sentry-flush'

type ChainResult = { data: unknown; error: unknown }

function makeChain(result: ChainResult) {
  const chain: Record<string, jest.Mock> & { then: (resolve: (v: ChainResult) => unknown, reject?: (e: unknown) => unknown) => Promise<unknown> } =
    {} as never
  ;['select', 'insert', 'update', 'eq', 'order', 'in'].forEach((method) => {
    chain[method] = jest.fn(() => chain)
  })
  chain.single = jest.fn(() => Promise.resolve(result))
  chain.then = (resolve, reject) => Promise.resolve(result).then(resolve, reject)
  return chain
}

/** Returns a `.from('xero_invoices')` mock that hands out one chain per call, in order. */
function queueXeroInvoicesFrom(chains: ReturnType<typeof makeChain>[]) {
  const queue = [...chains]
  return jest.fn(() => {
    const chain = queue.shift()
    if (!chain) {
      throw new Error("Unexpected supabase.from('xero_invoices') call - no queued response left")
    }
    return chain
  })
}

function invoiceRecord(id: string) {
  return { id } as never
}

describe('XeroBatchSyncManager.syncXeroCreditNotes', () => {
  let mockAdminSupabase: { from: jest.Mock }
  let manager: XeroBatchSyncManager
  const xeroApi = { accountingApi: { createCreditNotes: jest.fn() } }

  beforeEach(() => {
    jest.clearAllMocks()
    mockAdminSupabase = { from: jest.fn() }
    ;(createAdminClient as jest.Mock).mockReturnValue(mockAdminSupabase)
    manager = new XeroBatchSyncManager()
  })

  describe('validation errors on an otherwise-successful API response', () => {
    it('marks the record failed with the Xero validation message and does not count it as synced', async () => {
      xeroApi.accountingApi.createCreditNotes.mockResolvedValue({
        body: {
          creditNotes: [
            { hasErrors: true, validationErrors: [{ message: 'AccountCode is not a valid code' }] }
          ]
        }
      })

      const failChain = makeChain({ data: null, error: null })
      mockAdminSupabase.from = queueXeroInvoicesFrom([failChain])

      const result = await manager.syncXeroCreditNotes(
        [{ xeroCreditNote: {} as never, invoiceRecord: invoiceRecord('record-1') }],
        xeroApi as never,
        'tenant-1'
      )

      expect(result).toEqual({ success: true, synced: 0, failed: 1 })
      expect(failChain.update).toHaveBeenCalledWith(
        expect.objectContaining({
          sync_status: 'failed',
          sync_error: 'Xero validation error: AccountCode is not a valid code'
        })
      )
      expect(failChain.eq).toHaveBeenCalledWith('id', 'record-1')

      expect(logXeroSync).toHaveBeenCalledWith(
        expect.objectContaining({
          record_id: 'record-1',
          success: false,
          tenant_id: 'tenant-1'
        })
      )
    })
  })

  describe('batch errors thrown by the Xero API (partial failures)', () => {
    it('marks failed items from ValidationErrors and synced items from succeeding Elements, with accurate counts', async () => {
      xeroApi.accountingApi.createCreditNotes.mockRejectedValue({
        body: {
          Elements: [
            { ValidationErrors: [{ Message: 'Contact is required' }] },
            { CreditNoteID: 'xero-cn-2', CreditNoteNumber: 'CN-0002' }
          ]
        }
      })

      const failChain = makeChain({ data: null, error: null })
      const syncChain = makeChain({ data: [{ id: 'record-2', sync_status: 'synced' }], error: null })
      mockAdminSupabase.from = queueXeroInvoicesFrom([failChain, syncChain])

      const result = await manager.syncXeroCreditNotes(
        [
          { xeroCreditNote: {} as never, invoiceRecord: invoiceRecord('record-1') },
          { xeroCreditNote: {} as never, invoiceRecord: invoiceRecord('record-2') }
        ],
        xeroApi as never,
        'tenant-1'
      )

      expect(result).toEqual({ success: false, synced: 1, failed: 1 })

      expect(failChain.update).toHaveBeenCalledWith(
        expect.objectContaining({ sync_status: 'failed', sync_error: 'Xero validation error: Contact is required' })
      )
      expect(failChain.eq).toHaveBeenCalledWith('id', 'record-1')

      expect(syncChain.update).toHaveBeenCalledWith(
        expect.objectContaining({ xero_invoice_id: 'xero-cn-2', invoice_number: 'CN-0002', sync_status: 'synced' })
      )
      expect(syncChain.eq).toHaveBeenCalledWith('id', 'record-2')
    })

    it('skips a succeeding element whose CreditNoteID is the Xero placeholder GUID', async () => {
      xeroApi.accountingApi.createCreditNotes.mockRejectedValue({
        body: {
          Elements: [
            { CreditNoteID: '00000000-0000-0000-0000-000000000000', CreditNoteNumber: 'CN-0003' }
          ]
        }
      })

      mockAdminSupabase.from = queueXeroInvoicesFrom([])

      const result = await manager.syncXeroCreditNotes(
        [{ xeroCreditNote: {} as never, invoiceRecord: invoiceRecord('record-3') }],
        xeroApi as never,
        'tenant-1'
      )

      expect(result).toEqual({ success: false, synced: 0, failed: 0 })
      expect(mockAdminSupabase.from).not.toHaveBeenCalled()
    })
  })

  describe('database failure after a successful Xero sync', () => {
    it('marks the item failed with an actionable message and reports the error to Sentry with the critical tag', async () => {
      xeroApi.accountingApi.createCreditNotes.mockResolvedValue({
        body: {
          creditNotes: [
            { creditNoteID: 'xero-cn-9', creditNoteNumber: 'CN-0009', status: 'AUTHORISED' }
          ]
        }
      })

      const markSyncedChain = makeChain({ data: null, error: { message: 'connection terminated', code: '57P01' } })
      const markFailedChain = makeChain({ data: null, error: null })
      mockAdminSupabase.from = queueXeroInvoicesFrom([markSyncedChain, markFailedChain])

      const result = await manager.syncXeroCreditNotes(
        [{ xeroCreditNote: {} as never, invoiceRecord: invoiceRecord('record-9') }],
        xeroApi as never,
        'tenant-1'
      )

      // The credit note WAS created in Xero, but the DB update failure means
      // it must still be surfaced to the admin as a failure needing action.
      expect(result).toEqual({ success: true, synced: 0, failed: 1 })

      expect(markFailedChain.update).toHaveBeenCalledWith(
        expect.objectContaining({
          sync_status: 'failed',
          sync_error: expect.stringContaining('Credit note synced to Xero (CN-0009) but database update failed: Failed to mark invoice as synced in database: connection terminated')
        })
      )

      expect(Sentry.captureException).toHaveBeenCalledWith(
        expect.objectContaining({ message: expect.stringContaining('connection terminated') }),
        expect.objectContaining({
          level: 'error',
          tags: expect.objectContaining({
            component: 'xero-batch-sync',
            operation: 'batch_credit_note_sync_success',
            critical: 'true'
          })
        })
      )
      expect(scheduleSentryFlush).toHaveBeenCalled()
    })
  })

  describe('count tracking accuracy', () => {
    it('produces synced/failed counts that match a mix of successful and validation-failed items', async () => {
      xeroApi.accountingApi.createCreditNotes.mockResolvedValue({
        body: {
          creditNotes: [
            { creditNoteID: 'xero-cn-1', creditNoteNumber: 'CN-0001', status: 'AUTHORISED' },
            { hasErrors: true, validationErrors: [{ message: 'Bad line item' }] },
            { creditNoteID: 'xero-cn-3', creditNoteNumber: 'CN-0003', status: 'AUTHORISED' }
          ]
        }
      })

      const syncChain1 = makeChain({ data: [{ id: 'record-1' }], error: null })
      const failChain2 = makeChain({ data: null, error: null })
      const syncChain3 = makeChain({ data: [{ id: 'record-3' }], error: null })
      mockAdminSupabase.from = queueXeroInvoicesFrom([syncChain1, failChain2, syncChain3])

      const result = await manager.syncXeroCreditNotes(
        [
          { xeroCreditNote: {} as never, invoiceRecord: invoiceRecord('record-1') },
          { xeroCreditNote: {} as never, invoiceRecord: invoiceRecord('record-2') },
          { xeroCreditNote: {} as never, invoiceRecord: invoiceRecord('record-3') }
        ],
        xeroApi as never,
        'tenant-1'
      )

      expect(result).toEqual({ success: true, synced: 2, failed: 1 })
    })
  })
})
