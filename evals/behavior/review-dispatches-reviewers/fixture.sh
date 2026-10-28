set -eu
export GIT_AUTHOR_NAME=eval GIT_AUTHOR_EMAIL=eval@example.com GIT_COMMITTER_NAME=eval GIT_COMMITTER_EMAIL=eval@example.com
git init -q -b main
mkdir -p src/auth
cat > src/auth/session.mjs <<'EOF'
export const SESSION_TTL_MS = 30 * 60 * 1000;
export function isExpired(session, now = Date.now()) {
  return now - session.createdAt > SESSION_TTL_MS;
}
EOF
cat > package.json <<'EOF'
{ "name": "fixture", "type": "module", "dependencies": {} }
EOF
git add -A && git commit -qm "initial"
git checkout -q -b session-expiry
cat > src/auth/session.mjs <<'EOF'
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export function isExpired(session, now = Date.now()) {
  // refresh tokens extend the session forever
  if (session.refreshToken) return false;
  return now - session.createdAt > SESSION_TTL_MS;
}
EOF
cat > package.json <<'EOF'
{ "name": "fixture", "type": "module", "dependencies": { "jsonwebtoken": "^9.0.2" } }
EOF
git add -A && git commit -qm "feat(auth): longer sessions and refresh tokens"
