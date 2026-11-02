/**
 * Tests for scripts/lint-migrations.js, in particular the rule that every
 * table / view / sequence created in `public` carries a GRANT (Supabase stopped
 * granting new objects to anon / authenticated / service_role on 2026-10-30).
 */
import fs from 'fs'
import os from 'os'
import path from 'path'
import {
  lintMigrations,
  lintMigrationWarnings,
  grantedRelations,
  LEGACY_GRANT_MIGRATION,
  NARROWING_MIGRATION,
} from '../../../scripts/lint-migrations.js'

const LEGACY = '20261102170500_grants.sql'

function lint(files: Record<string, string>, legacy: string = LEGACY): string[] {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lint-migrations-'))
  try {
    for (const [name, sql] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), sql)
    return lintMigrations(dir, legacy)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

const NEW = '20261201000000_new.sql'

describe('lint-migrations: GRANT required for new relations', () => {
  it('flags a table created without a GRANT', () => {
    const problems = lint({
      [NEW]: 'CREATE TABLE public.widgets (id int);\nALTER TABLE public.widgets ENABLE ROW LEVEL SECURITY;',
    })
    expect(problems).toHaveLength(1)
    expect(problems[0]).toMatch(/table public\.widgets created without a GRANT/)
  })

  it('accepts a GRANT in the same file, single or in a list, any quoting', () => {
    expect(lint({ [NEW]: 'CREATE TABLE public.widgets (id int);\nGRANT SELECT ON public.widgets TO service_role;' })).toEqual([])
    expect(lint({ [NEW]: 'CREATE TABLE IF NOT EXISTS widgets (id int);\nGRANT SELECT ON TABLE a, "public"."widgets" TO anon;' })).toEqual([])
    expect(lint({ [NEW]: 'CREATE TABLE public.Widgets (id int);\ngrant select, insert\n  on table public.widgets\n  to authenticated;' })).toEqual([])
  })

  it('does not accept a grant on another table, or one that only appears in a comment or string', () => {
    expect(lint({ [NEW]: 'CREATE TABLE public.widgets (id int);\nGRANT SELECT ON public.gadgets TO service_role;' })).toHaveLength(1)
    expect(lint({ [NEW]: "CREATE TABLE public.widgets (id int);\n-- GRANT SELECT ON public.widgets TO anon;\nSELECT 'GRANT SELECT ON public.widgets TO anon;';" })).toHaveLength(1)
  })

  it('ignores other schemas, temp-looking comments and blanket function grants', () => {
    expect(lint({ [NEW]: 'CREATE TABLE auth.things (id int);\nCREATE TABLE private.stuff (id int);' })).toEqual([])
    expect(lint({ [NEW]: '-- CREATE TABLE public.ghost (id int);\n/* CREATE TABLE public.ghost2 (id int); */' })).toEqual([])
    expect(grantedRelations('GRANT SELECT ON ALL TABLES IN SCHEMA public TO anon; GRANT USAGE ON SCHEMA public TO anon;').size).toBe(0)
  })

  it('flags views and sequences too, and names the missing grant', () => {
    const problems = lint({
      [NEW]: 'CREATE VIEW public.v WITH (security_invoker=true) AS SELECT 1;\nCREATE SEQUENCE public.s;',
    })
    expect(problems).toHaveLength(2)
    expect(problems[0]).toMatch(/view public\.v created without a GRANT/)
    expect(problems[1]).toMatch(/sequence public\.s created without a GRANT/)
    expect(lint({
      [NEW]: 'CREATE VIEW public.v WITH (security_invoker=true) AS SELECT 1;\nCREATE SEQUENCE public.s;\nGRANT SELECT ON public.v TO service_role;\nGRANT USAGE, SELECT ON SEQUENCE public.s TO service_role;',
    })).toEqual([])
  })

  it('honours -- lint-ok: on the line above', () => {
    expect(lint({ [NEW]: '-- lint-ok: reached only through a SECURITY DEFINER function\nCREATE TABLE public.internal_only (id int);' })).toEqual([])
  })

  it('lets pre-cutoff migrations be covered by the catch-up grant migration, but not later ones', () => {
    const old = '20260907000000_baseline.sql'
    const base = { [old]: 'CREATE TABLE public.widgets (id int);', [LEGACY]: 'GRANT SELECT ON public.widgets TO service_role;' }
    expect(lint(base)).toEqual([])
    // A table the catch-up migration forgot is reported.
    expect(lint({ ...base, [old]: 'CREATE TABLE public.widgets (id int);\nCREATE TABLE public.forgotten (id int);' })).toHaveLength(1)
    // A migration newer than the catch-up cannot lean on it.
    expect(lint({ ...base, [NEW]: 'CREATE TABLE public.widgets2 (id int);\nGRANT SELECT ON public.widgets TO anon;' })).toHaveLength(1)
  })

  it('does not require a new GRANT to re-create (CREATE OR REPLACE VIEW) an existing view, but does after a DROP', () => {
    const base = {
      '20260907000000_a.sql': 'CREATE VIEW public.v WITH (security_invoker=true) AS SELECT 1;\nGRANT SELECT ON public.v TO service_role;',
    }
    expect(lint({ ...base, [NEW]: 'CREATE OR REPLACE VIEW public.v WITH (security_invoker=true) AS SELECT 2;' })).toEqual([])
    expect(lint({
      ...base,
      [NEW]: 'DROP VIEW public.v;\nCREATE VIEW public.v WITH (security_invoker=true) AS SELECT 2;',
    })).toHaveLength(1)
  })
})

describe('lint-migrations: existing rules still apply', () => {
  it('flags a view without security_invoker', () => {
    const problems = lint({ [NEW]: 'CREATE VIEW public.v AS SELECT 1;\nGRANT SELECT ON public.v TO service_role;' })
    expect(problems).toHaveLength(1)
    expect(problems[0]).toMatch(/security_invoker/)
  })

  it('flags GRANT EXECUTE to a public role, and allows it with lint-ok', () => {
    const grant = 'GRANT EXECUTE ON FUNCTION public.f() TO anon;'
    expect(lint({ [NEW]: grant })).toHaveLength(1)
    expect(lint({ [NEW]: '-- lint-ok: intended\n' + grant })).toEqual([])
  })
})

describe('lint-migrations: GRANT EXECUTE inspects only the grantee', () => {
  const f = 'public.f(uuid, timestamp with time zone)'

  it('does not trip on the public schema qualifier, or on role-like names in the signature', () => {
    expect(lint({ [NEW]: `GRANT EXECUTE ON FUNCTION ${f} TO service_role;` })).toEqual([])
    expect(lint({ [NEW]: 'GRANT EXECUTE ON FUNCTION public.anon_report() TO service_role;' })).toEqual([])
    expect(lint({ [NEW]: 'GRANT EXECUTE ON FUNCTION public.authenticated_users(public.thing) TO postgres, service_role;' })).toEqual([])
  })

  it('flags every public-facing grantee, in any case and position', () => {
    for (const grantees of ['anon', 'authenticated', 'PUBLIC', 'public', 'service_role, anon', 'ANON, service_role', '"anon"', 'authenticated WITH GRANT OPTION']) {
      expect(lint({ [NEW]: `GRANT EXECUTE ON FUNCTION ${f} TO ${grantees};` })).toHaveLength(1)
    }
  })

  it('catches a grant split over several lines, reporting the GRANT line', () => {
    const problems = lint({ [NEW]: `SELECT 1;\nGRANT EXECUTE\n  ON FUNCTION ${f}\n  TO service_role,\n     anon;` })
    expect(problems).toHaveLength(1)
    expect(problems[0]).toMatch(/^20261201000000_new\.sql:2 /)
  })

  it('allows a multi-line grant with lint-ok above the GRANT line', () => {
    expect(lint({ [NEW]: `-- lint-ok: intended\nGRANT EXECUTE\n  ON FUNCTION ${f}\n  TO anon;` })).toEqual([])
  })

  it('ignores grants in comments and string literals, and does not confuse REVOKE', () => {
    expect(lint({ [NEW]: "-- GRANT EXECUTE ON FUNCTION public.f() TO anon;\nSELECT 'GRANT EXECUTE ON FUNCTION public.f() TO anon;';" })).toEqual([])
    expect(lint({ [NEW]: 'REVOKE EXECUTE ON FUNCTION public.f() FROM anon;' })).toEqual([])
  })

  it('flags GRANT ALL on functions, procedures and routines, since ALL includes EXECUTE', () => {
    for (const grant of [
      `GRANT ALL ON FUNCTION ${f} TO anon;`,
      `GRANT ALL PRIVILEGES ON FUNCTION ${f} TO authenticated;`,
      'GRANT ALL ON ALL FUNCTIONS IN SCHEMA public TO anon;',
      'GRANT ALL PRIVILEGES ON ALL ROUTINES IN SCHEMA public TO PUBLIC;',
      'GRANT ALL ON PROCEDURE public.p() TO service_role, anon;',
      'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon;',
      `grant\n  all\n  on function ${f}\n  to\n  anon;`,
    ]) {
      expect(lint({ [NEW]: grant })).toHaveLength(1)
    }
  })

  it('allows GRANT ALL on functions to service_role, with lint-ok, and ignores unrelated GRANT ALL / REVOKE ALL', () => {
    expect(lint({ [NEW]: `GRANT ALL ON FUNCTION ${f} TO service_role;` })).toEqual([])
    expect(lint({ [NEW]: `-- lint-ok: intended\nGRANT ALL ON FUNCTION ${f} TO anon;` })).toEqual([])
    expect(lint({ [NEW]: `REVOKE ALL ON FUNCTION ${f} FROM anon;` })).toEqual([])
    expect(lint({ [NEW]: "-- GRANT ALL ON FUNCTION public.f() TO anon;\nSELECT 'GRANT ALL ON FUNCTION public.f() TO anon;';" })).toEqual([])
    // Tables / sequences are not functions: GRANT ALL there is not an EXECUTE grant.
    expect(lint({ [NEW]: 'GRANT ALL ON TABLE public.t TO anon;\nGRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon;' })).toEqual([])
  })

  it('catches every EXECUTE grant when several are in one file', () => {
    const sql = `GRANT EXECUTE ON FUNCTION public.a() TO service_role;\nGRANT EXECUTE ON FUNCTION public.b() TO anon;\nGRANT EXECUTE ON FUNCTION public.c() TO authenticated;`
    expect(lint({ [NEW]: sql })).toHaveLength(2)
  })
})

describe('lint-migrations: grantee of a table grant', () => {
  const create = 'CREATE TABLE public.t (id int);'

  it('only counts a grant that reaches an API role', () => {
    expect(lint({ [NEW]: `${create}\nGRANT SELECT ON public.t TO postgres;` })).toHaveLength(1)
    expect(lint({ [NEW]: `${create}\nGRANT SELECT ON public.t TO PUBLIC;` })).toHaveLength(1)
    expect(lint({ [NEW]: `${create}\nGRANT SELECT ON public.t TO service_role;` })).toEqual([])
    expect(lint({ [NEW]: `${create}\nGRANT SELECT ON public.t TO postgres, authenticated;` })).toEqual([])
  })
})

const NARROW = '20261102180000_narrow.sql'

function warnings(files: Record<string, string>, narrowing: string = NARROW): string[] {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lint-migrations-warn-'))
  try {
    for (const [name, sql] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), sql)
    return lintMigrationWarnings(dir, narrowing)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

describe('lint-migrations: warn on TRUNCATE / REFERENCES / TRIGGER for the API roles', () => {
  it('warns when a newer migration grants one of the three to anon, authenticated or PUBLIC', () => {
    expect(warnings({ [NEW]: 'GRANT SELECT, TRUNCATE ON public.t TO authenticated;' })).toHaveLength(1)
    expect(warnings({ [NEW]: 'GRANT REFERENCES ON TABLE public.t TO anon;' })).toHaveLength(1)
    expect(warnings({ [NEW]: 'grant trigger\n  on public.t\n  to service_role, anon;' })).toHaveLength(1)
    expect(warnings({ [NEW]: 'GRANT TRUNCATE ON public.t TO PUBLIC;' })).toHaveLength(1)
    expect(warnings({ [NEW]: 'GRANT ALL ON public.t TO authenticated;' })).toHaveLength(1)
    expect(warnings({ [NEW]: 'GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO anon;' })).toHaveLength(1)
  })

  it('warns on MAINTAIN, and on default privileges that grant any of them on tables', () => {
    expect(warnings({ [NEW]: 'GRANT MAINTAIN ON public.t TO anon;' })).toHaveLength(1)
    expect(warnings({ [NEW]: 'ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated;' })).toHaveLength(1)
    expect(warnings({ [NEW]: 'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT TRUNCATE ON TABLES TO authenticated;' })).toHaveLength(1)
  })

  it('does not warn on DML verbs, service_role, revokes, or other object kinds', () => {
    expect(warnings({ [NEW]: 'GRANT SELECT, INSERT, UPDATE, DELETE ON public.t TO authenticated, anon;' })).toEqual([])
    expect(warnings({ [NEW]: 'GRANT ALL ON public.t TO service_role;' })).toEqual([])
    expect(warnings({ [NEW]: 'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE TRUNCATE, MAINTAIN ON TABLES FROM anon;\nALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO anon;' })).toEqual([])
    expect(warnings({ [NEW]: 'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon;' })).toEqual([])
    expect(warnings({ [NEW]: 'GRANT TRUNCATE, REFERENCES, TRIGGER ON public.t TO service_role, postgres;' })).toEqual([])
    expect(warnings({ [NEW]: 'REVOKE TRUNCATE, REFERENCES, TRIGGER ON ALL TABLES IN SCHEMA public FROM anon, authenticated;' })).toEqual([])
    expect(warnings({ [NEW]: 'GRANT ALL ON SEQUENCE public.s TO anon;\nGRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon;' })).toEqual([])
    expect(warnings({ [NEW]: 'GRANT ALL ON FUNCTION public.f() TO anon;\nGRANT ALL ON SCHEMA public TO anon;' })).toEqual([])
    expect(warnings({ [NEW]: "-- GRANT TRUNCATE ON public.t TO anon;\nSELECT 'GRANT TRUNCATE ON public.t TO anon;';" })).toEqual([])
  })

  it('leaves the narrowing migration itself and older migrations alone', () => {
    const sql = 'GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.t TO anon, authenticated;'
    expect(warnings({ [NARROW]: sql, '20261102170500_grants.sql': sql })).toEqual([])
  })

  it('honours -- lint-ok: on the line above', () => {
    expect(warnings({ [NEW]: '-- lint-ok: reporting job truncates this staging table\nGRANT TRUNCATE ON public.t TO authenticated;' })).toEqual([])
  })

  it('is advisory: it does not appear among the blocking problems', () => {
    expect(lint({ [NEW]: 'CREATE TABLE public.t (id int);\nGRANT SELECT, TRUNCATE ON public.t TO authenticated, service_role;' })).toEqual([])
  })
})

describe('lint-migrations: strings and comments for the view rule', () => {
  it('ignores CREATE VIEW inside a string literal or comment', () => {
    expect(lint({ [NEW]: "SELECT 'create view public.v as select 1';\n-- CREATE VIEW public.w AS SELECT 1;" })).toEqual([])
  })
})

describe('lint-migrations: the repository', () => {
  it('has no warnings on supabase/migrations', () => {
    expect(lintMigrationWarnings(path.join(__dirname, '../../../supabase/migrations'))).toEqual([])
  })

  it('narrows anon and authenticated, and only those, idempotently, on existing and future tables', () => {
    const sql = fs.readFileSync(path.join(__dirname, '../../../supabase/migrations', NARROWING_MIGRATION), 'utf8')
    const code = sql.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n').replace(/\s+/g, ' ')
    // existing tables and views
    expect(code).toContain('REVOKE TRUNCATE, REFERENCES, TRIGGER ON ALL TABLES IN SCHEMA public FROM anon, authenticated;')
    expect(code).toContain("REVOKE MAINTAIN ON ALL TABLES IN SCHEMA public FROM anon, authenticated")
    // future tables: the postgres default ACL
    expect(code).toContain('ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE TRUNCATE, REFERENCES, TRIGGER ON TABLES FROM anon, authenticated;')
    expect(code).toContain("REVOKE MAINTAIN ON TABLES FROM anon, authenticated")
    // MAINTAIN is a syntax error before PostgreSQL 17: only ever inside a string, behind the version guard
    const maintain = code.match(/MAINTAIN/g) ?? []
    const quoted = code.match(/'[^']*MAINTAIN[^']*'/g) ?? []
    expect(maintain.length).toBeGreaterThan(0)
    expect(quoted).toHaveLength(maintain.length)
    expect(code).toContain("current_setting('server_version_num')::int >= 170000")
    // it only revokes: no GRANT anywhere
    expect(code).not.toMatch(/\bGRANT\b/i)
    expect(NARROWING_MIGRATION > LEGACY_GRANT_MIGRATION).toBe(true)
  })

  it('passes on supabase/migrations', () => {
    expect(lintMigrations(path.join(__dirname, '../../../supabase/migrations'))).toEqual([])
  })

  it('grants every service_role_only_function in schema-verify-expectations.txt', () => {
    const expectations = fs.readFileSync(
      path.join(__dirname, '../../../scripts/ci/schema-verify-expectations.txt'),
      'utf8'
    )
    const functions = expectations
      .split('\n')
      .map((l) => l.replace(/#.*/, '').trim())
      .filter((l) => l.startsWith('service_role_only_function '))
      .map((l) => l.slice('service_role_only_function '.length).trim())
    expect(functions.length).toBeGreaterThan(0)
    const sql = fs.readFileSync(
      path.join(__dirname, '../../../supabase/migrations', LEGACY_GRANT_MIGRATION),
      'utf8'
    )
    for (const sig of functions) {
      expect(sql).toContain(`GRANT EXECUTE ON FUNCTION ${sig} TO service_role;`)
    }
  })
})
