/**
 * Subject prefix for non-production email sends. Loops templates don't
 * accept a subject override via the API — the prefix is passed as a
 * `testEmailPrefix` data variable and merged into each template's Subject
 * field in the Loops dashboard (e.g. "{testEmailPrefix}Welcome to My NYCPHA!").
 */
export function getTestEmailPrefix(): string {
  const vercelEnv = process.env.VERCEL_ENV
  const isProduction = vercelEnv
    ? vercelEnv === 'production'
    : process.env.NODE_ENV === 'production'
  return isProduction ? '' : '[TEST] '
}
