// Shared storage for re-authentication verification codes
// In production, this should be replaced with Redis or a database table

interface CodeData {
  code: string
  expiresAt: number
}

const verificationCodes = new Map<string, CodeData>()

// Clean up expired codes periodically
setInterval(() => {
  const now = Date.now()
  for (const [userId, data] of verificationCodes.entries()) {
    if (data.expiresAt < now) {
      verificationCodes.delete(userId)
    }
  }
}, 60000) // Clean up every minute

export function storeCode(userId: string, code: string, expiresAt: number): void {
  verificationCodes.set(userId, { code, expiresAt })
}

export function getCode(userId: string): CodeData | undefined {
  return verificationCodes.get(userId)
}

export function deleteCode(userId: string): void {
  verificationCodes.delete(userId)
}
