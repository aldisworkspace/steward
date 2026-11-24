#!/usr/bin/env bash
# Vercel Production build command: bash scripts/deploy-production.sh --deploy
# Configure the existing Steward project's Production environment first:
#   Vercel: CONVEX_DEPLOY_KEY (production key), DEMO_PASSCODE
#   Convex prod: ANTHROPIC_API_KEY, LLM_PROVIDER=anthropic, DEMO_PASSCODE
# The two DEMO_PASSCODE values must match. Never put secrets in CLI arguments.
# See https://docs.convex.dev/production/hosting/vercel
set +x
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: bash scripts/deploy-production.sh [--check|--deploy|--help]

--check   Validate local build prerequisites without network calls (default).
--deploy  Build Next.js against the target production URL and deploy Convex.
          Use as the Vercel Production build command; Vercel publishes the site.

This does not create projects, set remote secrets, seed data, or run smoke tests.
Configure matching DEMO_PASSCODE values in Vercel and Convex production first.
Verify Convex production has ANTHROPIC_API_KEY and LLM_PROVIDER=anthropic.
EOF
}

fail() { printf 'Deployment preflight failed: %s\n' "$1" >&2; exit 1; }

mode="${1:---check}"
[[ $# -le 1 ]] || { usage >&2; exit 2; }
case "$mode" in
  --help|-h) usage; exit 0 ;;
  --check|--deploy) ;;
  *) usage >&2; exit 2 ;;
esac

cd "$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
command -v node >/dev/null || fail 'Install Node.js and run npm ci.'
[[ -x node_modules/.bin/convex && -x node_modules/.bin/next ]] ||
  fail 'Dependencies are missing; run npm ci.'

# Reject a Vercel Preview/Development build rather than deploying production
# functions from a preview branch. No key values are echoed or passed as args.
if [[ -n "${VERCEL_ENV:-}" && "$VERCEL_ENV" != production ]]; then
  fail 'This script is for Vercel Production only; use a separate preview build command.'
fi
[[ -n "${CONVEX_DEPLOY_KEY:-}" ]] || fail 'Set a production CONVEX_DEPLOY_KEY in the build environment.'
case "$CONVEX_DEPLOY_KEY" in
  prod:*'|'*) ;;
  *) fail 'CONVEX_DEPLOY_KEY must be a production deployment key, not a dev or preview key.' ;;
esac
[[ -n "${DEMO_PASSCODE:-}" ]] || fail 'Set DEMO_PASSCODE in Vercel Production to protect seed/feed writes.'
if [[ -n "${NEXT_PUBLIC_DEMO_KEY:-}" && "$NEXT_PUBLIC_DEMO_KEY" != "$DEMO_PASSCODE" ]]; then
  fail 'NEXT_PUBLIC_DEMO_KEY must match DEMO_PASSCODE, or be omitted.'
fi

printf '%s\n' 'Local production build prerequisites passed; remote secrets and smoke tests are not verified.'
[[ "$mode" == --deploy ]] || exit 0

# Convex supplies the URL for this exact production deployment to the child
# build. A stale .env.local / dev URL must not be baked into the frontend.
exec node_modules/.bin/convex deploy \
  --cmd-url-env-var-name NEXT_PUBLIC_CONVEX_URL \
  --cmd 'npm run build'
