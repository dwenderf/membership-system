#!/usr/bin/env node

/**
 * Keeps Supabase's magic-link email template in step with what this app can verify.
 *
 * One signInWithOtp() call in src/app/auth/login/page.tsx sends one email that
 * has to serve both sign-in methods the UI offers, so the template needs both:
 *
 *   - the 6-digit {{ .Token }}, typed into /auth/verify-otp
 *   - a link to /auth/magic-confirm?token_hash={{ .TokenHash }}&type=magiclink
 *
 * Supabase's default template has neither: it links to {{ .ConfirmationURL }},
 * a PKCE link (?code=...) that magic-confirm cannot verify. A template carrying
 * only one of the two half-works — whichever method the user picks on the login
 * screen, the email may not contain what that method needs. All of this is
 * dashboard-only state with no trace in schema.sql or the migrations, which is
 * why it stays broken until someone knows to look.
 *
 *   npm run auth:verify   # offline: is the template in this repo still valid?
 *   npm run auth:check    # does the live project's template match the rule?
 *   npm run auth:apply    # write this repo's template to the live project
 *
 * The two live modes need a Supabase personal access token in
 * SUPABASE_ACCESS_TOKEN (https://supabase.com/dashboard/account/tokens) and a
 * project ref, taken from --project-ref, SUPABASE_PROJECT_REF, or the hostname
 * in NEXT_PUBLIC_SUPABASE_URL. Values already in the environment win; otherwise
 * .env.local is read, so `vercel env pull` is enough to target your own project.
 *
 * Only the magic-link body is managed. The subject line, every other auth
 * template, and the rest of the auth config are left untouched.
 */

const fs = require('fs');
const path = require('path');

const API_BASE = 'https://api.supabase.com';
const TEMPLATE_FIELD = 'mailer_templates_magic_link_content';
const TEMPLATE_PATH = path.join(__dirname, '../supabase/auth-templates/magic-link.html');
const ENV_LOCAL_PATH = path.join(__dirname, '../.env.local');

// The one thing that has to be true. Tolerates {{.TokenHash}} without spaces and
// an HTML-escaped &amp;, both of which the dashboard editor can produce.
// Two link forms work, and projects in this org use both:
//   {{ .SiteURL }}/auth/magic-confirm?token_hash=...  always lands on the site
//   {{ .RedirectTo }}?token_hash=...                  honours the emailRedirectTo
//                                                     login passes, so a preview
//                                                     deployment's link comes back
//                                                     to that preview — but only if
//                                                     the URL is in the project's
//                                                     Redirect URLs allowlist.
// Neither is wrong, so accept both rather than churning a working project.
const REQUIRED_LINK =
  /(?:\/auth\/magic-confirm|\{\{\s*\.RedirectTo\s*\}\})\?token_hash=\{\{\s*\.TokenHash\s*\}\}&(?:amp;)?type=magiclink/;
const PKCE_LINK = /\{\{\s*\.ConfirmationURL\s*\}\}/;
// Not matched by {{ .TokenHash }} — the closing braces have to follow .Token.
const REQUIRED_CODE = /\{\{\s*\.Token\s*\}\}/;

const REQUIRED_LINK_EXAMPLE =
  '{{ .SiteURL }}/auth/magic-confirm?token_hash={{ .TokenHash }}&type=magiclink';

function fail(message) {
  console.error(`❌ ${message}`);
  process.exit(1);
}

/** Fills in vars from .env.local without overriding anything already exported. */
function loadEnvLocal() {
  if (!fs.existsSync(ENV_LOCAL_PATH)) return;

  for (const line of fs.readFileSync(ENV_LOCAL_PATH, 'utf8').split('\n')) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (process.env[key] !== undefined) continue;
    process.env[key] = rawValue.trim().replace(/^(['"])(.*)\1$/, '$2');
  }
}

function parseArgs(argv) {
  const options = { mode: 'verify', projectRef: null, dryRun: false, force: false };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--verify' || arg === '--check' || arg === '--apply') {
      options.mode = arg.slice(2);
    } else if (arg === '--project-ref') {
      options.projectRef = argv[++i];
    } else if (arg.startsWith('--project-ref=')) {
      options.projectRef = arg.split('=')[1];
    } else if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--force') {
      options.force = true;
    } else {
      fail(`Unknown argument: ${arg}\n    Usage: configure-auth-templates.js [--verify|--check|--apply] [--project-ref <ref>] [--dry-run] [--force]`);
    }
  }

  return options;
}

function resolveProjectRef(explicitRef) {
  if (explicitRef) return explicitRef;
  if (process.env.SUPABASE_PROJECT_REF) return process.env.SUPABASE_PROJECT_REF;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const ref = url && url.match(/^https:\/\/([a-z0-9]+)\.supabase\./)?.[1];
  if (ref) return ref;

  fail(
    'No Supabase project to target.\n' +
    '    Pass --project-ref <ref>, set SUPABASE_PROJECT_REF, or point\n' +
    '    NEXT_PUBLIC_SUPABASE_URL at the project (vercel env pull .env.local).'
  );
}

function requireAccessToken() {
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  if (!token) {
    fail(
      'SUPABASE_ACCESS_TOKEN is not set.\n' +
      '    Create a personal access token at https://supabase.com/dashboard/account/tokens\n' +
      '    and export it in your shell. It is a personal credential, not a project\n' +
      '    setting: never add it to Vercel, and note that `vercel env pull` would\n' +
      '    overwrite it out of .env.local anyway.'
    );
  }
  return token;
}

async function callManagementApi(method, projectRef, token, body) {
  const response = await fetch(`${API_BASE}/v1/projects/${projectRef}/config/auth`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  if (!response.ok) {
    const detail = await response.text();
    fail(
      `Supabase Management API returned ${response.status} for project ${projectRef}.\n` +
      `    ${detail.slice(0, 500)}\n` +
      '    A 401/403 usually means the token is wrong or lacks access to this project.'
    );
  }

  return response.json();
}

/** Returns the reasons this template can't sign anyone in. */
function problemsWith(content) {
  if (!content || !content.trim()) {
    return ['the project is using Supabase\'s default template (no custom content set)'];
  }

  const problems = [];
  if (!REQUIRED_LINK.test(content)) {
    problems.push(
      'no magic-confirm link — the "email me a link" path cannot work. Expected either\n' +
      `        ${REQUIRED_LINK_EXAMPLE}\n` +
      '        {{ .RedirectTo }}?token_hash={{ .TokenHash }}&type=magiclink'
    );
  }
  if (PKCE_LINK.test(content)) {
    problems.push('links to {{ .ConfirmationURL }}, which is a PKCE link (?code=...) this app cannot verify');
  }
  if (!REQUIRED_CODE.test(content)) {
    problems.push('no {{ .Token }} — the "email me a code" path has nothing to type into /auth/verify-otp');
  }
  return problems;
}

function readRepoTemplate() {
  if (!fs.existsSync(TEMPLATE_PATH)) {
    fail(`Template not found at ${path.relative(process.cwd(), TEMPLATE_PATH)}`);
  }
  return fs.readFileSync(TEMPLATE_PATH, 'utf8');
}

function verifyRepoTemplate() {
  const template = readRepoTemplate();
  const problems = problemsWith(template);

  if (problems.length > 0) {
    fail(
      `supabase/auth-templates/magic-link.html cannot sign anyone in:\n` +
      problems.map((p) => `      - ${p}`).join('\n') + '\n' +
      `    The link must be: ${REQUIRED_LINK_EXAMPLE}`
    );
  }

  console.log('✅ supabase/auth-templates/magic-link.html carries both the {{ .Token }} code and the magic-confirm link');
  return template;
}

async function checkLiveTemplate(projectRef) {
  const config = await callManagementApi('GET', projectRef, requireAccessToken());
  const live = config[TEMPLATE_FIELD];
  const problems = problemsWith(live);

  if (problems.length > 0) {
    console.error(`❌ Project ${projectRef}'s magic-link template is broken:\n`);
    problems.forEach((p) => console.error(`      - ${p}`));

    // Without this you have to open the dashboard to find out what is actually
    // there, which is most of the work of diagnosing it.
    console.error(`\n    What the project has now:\n`);
    console.error(
      live && live.trim()
        ? live.split('\n').map((l) => `      ${l}`).join('\n')
        : '      (empty — Supabase\'s default template)'
    );

    console.error(
      '\n    Fix it with:  npm run auth:apply -- --project-ref ' + projectRef + '\n' +
      '    or by hand in Authentication → Email Templates → Magic Link.'
    );
    process.exit(1);
  }

  console.log(`✅ Project ${projectRef}'s template carries both the {{ .Token }} code and the magic-confirm link`);
  return live;
}

async function applyTemplate(projectRef, template, { dryRun, force }) {
  const token = requireAccessToken();
  const config = await callManagementApi('GET', projectRef, token);
  const live = config[TEMPLATE_FIELD];

  if (live === template) {
    console.log(`✅ Project ${projectRef} already has this exact template; nothing to do`);
    return;
  }

  // A project whose template already works may be a branded one somebody wrote
  // by hand. Overwriting that silently would be a worse bug than the one this
  // script exists to fix.
  if (problemsWith(live).length === 0 && !force) {
    console.error(
      `❌ Project ${projectRef} already has a working magic-link template that differs from this repo's.\n\n` +
      '    Its current content:\n\n' +
      live.split('\n').map((l) => `      ${l}`).join('\n') +
      '\n\n    It passes the check, so it is probably a customized (e.g. branded) template.\n' +
      '    Re-run with --force to replace it, or copy your customizations into\n' +
      '    supabase/auth-templates/magic-link.html first.'
    );
    process.exit(1);
  }

  if (live && live.trim()) {
    console.log(`Replacing the current template on ${projectRef} (keep this if you want it back):\n`);
    console.log(live.split('\n').map((l) => `      ${l}`).join('\n'));
    console.log('');
  }

  if (dryRun) {
    console.log(`Would PATCH ${TEMPLATE_FIELD} on project ${projectRef}. No changes made (--dry-run).`);
    return;
  }

  await callManagementApi('PATCH', projectRef, token, { [TEMPLATE_FIELD]: template });
  console.log(`✅ Applied supabase/auth-templates/magic-link.html to project ${projectRef}`);
  console.log('   Verify by requesting a magic link and checking the URL in the email.');
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  // Always validate the file in the repo first: applying a broken template, or
  // checking a live project against one, is worse than doing nothing.
  const template = verifyRepoTemplate();
  if (options.mode === 'verify') return;

  loadEnvLocal();
  const projectRef = resolveProjectRef(options.projectRef);

  if (options.mode === 'check') {
    await checkLiveTemplate(projectRef);
  } else {
    await applyTemplate(projectRef, template, options);
  }
}

main().catch((error) => {
  fail(error.stack || String(error));
});
