// Regression coverage for a bug caught in review of PR #375: this app never
// sets a `userId` property on Loops contacts (they're only ever created
// implicitly via sendTransactionalEmail/sendEvent, keyed by email), so
// deleting by userId always 404s and silently deletes nothing.

process.env.LOOPS_API_KEY = 'test-loops-key'

const mockDeleteContact = jest.fn()

jest.mock('loops', () => {
  const actual = jest.requireActual('loops')
  return {
    ...actual,
    LoopsClient: jest.fn().mockImplementation(() => ({
      deleteContact: mockDeleteContact,
    })),
  }
})

import { APIError } from 'loops'
import { emailService } from '@/lib/email/service'

describe('emailService.deleteLoopsContact', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('deletes the Loops contact by email, not userId', async () => {
    mockDeleteContact.mockResolvedValue({ success: true, message: 'Contact deleted.' })

    await emailService.deleteLoopsContact('real@example.com')

    expect(mockDeleteContact).toHaveBeenCalledWith({ email: 'real@example.com' })
  })

  it('treats an already-deleted contact (404) as success', async () => {
    mockDeleteContact.mockRejectedValue(new APIError(404, { success: false, message: 'Contact not found' }))

    await expect(emailService.deleteLoopsContact('real@example.com')).resolves.toBeUndefined()
  })

  it('propagates other failures', async () => {
    mockDeleteContact.mockRejectedValue(new APIError(500, { success: false, message: 'Internal error' }))

    await expect(emailService.deleteLoopsContact('real@example.com')).rejects.toThrow()
  })
})
