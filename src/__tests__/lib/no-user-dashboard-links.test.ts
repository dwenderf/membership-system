/**
 * There is no /user/dashboard route (the member dashboard is /user), so any
 * email dashboardUrl pointing there 404s. Guard against it coming back.
 */
import fs from 'fs'
import path from 'path'

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name !== '__tests__') walk(full, out)
    } else if (/\.(ts|tsx|js)$/.test(entry.name)) {
      out.push(full)
    }
  }
  return out
}

describe('dashboard links', () => {
  it('the /user/dashboard route does not exist', () => {
    expect(fs.existsSync(path.join(process.cwd(), 'src/app/(user)/user/dashboard'))).toBe(false)
    expect(fs.existsSync(path.join(process.cwd(), 'src/app/(user)/user/page.tsx'))).toBe(true)
  })

  it('no source file links to /user/dashboard', () => {
    const offenders = walk(path.join(process.cwd(), 'src')).filter((f) =>
      fs.readFileSync(f, 'utf8').includes('/user/dashboard')
    )
    expect(offenders).toEqual([])
  })
})
