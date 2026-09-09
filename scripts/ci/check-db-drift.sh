#!/usr/bin/env bash
#
# Compares supabase/migrations/ in this checkout against a database's
# supabase_migrations.schema_migrations, and fails if the database is
# missing anything the repo carries.
#
# Shared by db-drift-check.yml (scheduled, catches drift from anywhere --
# including SQL applied outside the repo) and db-migration-preflight.yml
# (a required PR check, catches a migration that was merged but never
# applied before someone tries to merge on top of it).
#
# Usage: TARGET=<label> SUPABASE_DB_URL=<connection string> check-db-drift.sh
set -euo pipefail

TARGET="${TARGET:?TARGET is required}"
SUMMARY="${GITHUB_STEP_SUMMARY:-/dev/null}"

if [ -z "${SUPABASE_DB_URL:-}" ]; then
  echo "::warning::SUPABASE_DB_URL is not configured for '$TARGET'; skipping. See README 'Automating migrations'."
  echo "### Drift check skipped — \`$TARGET\` has no SUPABASE_DB_URL secret" >> "$SUMMARY"
  exit 0
fi

trimmed="$(printf '%s' "$SUPABASE_DB_URL" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')"
if [ "$trimmed" != "$SUPABASE_DB_URL" ]; then
  echo "::error::SUPABASE_DB_URL for '$TARGET' has leading or trailing whitespace. GitHub's secret field preserves it invisibly -- re-save the secret without it."
  exit 1
fi

case "$SUPABASE_DB_URL" in
  postgresql://*|postgres://*) ;;
  *)
    echo "::error::SUPABASE_DB_URL for '$TARGET' does not start with postgresql:// or postgres:// -- psql will treat it as a plain database name and try the local Unix socket instead of connecting to Supabase. Check for a copied 'psql ' prefix or surrounding quotes."
    exit 1
    ;;
esac

# Neither the username nor the host is secret; the project ref is already in AGENTS.md.
echo "user/host: $(printf '%s' "$SUPABASE_DB_URL" | sed -E 's#^[a-z]+://([^:]+):[^@]*@#\1@#')"

psql --version >/dev/null 2>&1 || { sudo apt-get update && sudo apt-get install -y postgresql-client; }

# Versions this repo carries, from the filename prefix.
ls supabase/migrations/*.sql \
  | xargs -n1 basename \
  | sed 's/_.*//' \
  | sort > /tmp/repo_versions

# Versions the database says it has applied.
psql "$SUPABASE_DB_URL" -tAc \
  "select version from supabase_migrations.schema_migrations order by version" \
  | sed '/^$/d' | sort > /tmp/db_versions

unapplied=$(comm -23 /tmp/repo_versions /tmp/db_versions)
unknown=$(comm -13 /tmp/repo_versions /tmp/db_versions)

{
  echo "## Migration status — \`$TARGET\`"
  echo
  echo "- migration files in repo: $(wc -l < /tmp/repo_versions)"
  echo "- applied in database:     $(wc -l < /tmp/db_versions)"
} >> "$SUMMARY"

if [ -n "$unknown" ]; then
  {
    echo
    echo "### Applied in the database but not in this repo"
    echo '```'
    echo "$unknown"
    echo '```'
    echo "Someone applied SQL outside the repo, or a migration file was deleted."
  } >> "$SUMMARY"
  echo "::warning::$TARGET has migrations not present in this repo: $(echo $unknown | tr '\n' ' ')"
fi

if [ -n "$unapplied" ]; then
  {
    echo
    echo "### Not yet applied to \`$TARGET\`"
    echo '```'
    echo "$unapplied"
    echo '```'
    echo "Apply them with the *Apply database migrations* workflow, then re-run this check."
  } >> "$SUMMARY"
  echo "::error::$TARGET is behind: $(echo $unapplied | tr '\n' ' ')"
  exit 1
fi

echo "### ✅ \`$TARGET\` is up to date" >> "$SUMMARY"
