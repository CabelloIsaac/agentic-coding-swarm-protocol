set -eu
export GIT_AUTHOR_NAME=eval GIT_AUTHOR_EMAIL=eval@example.com GIT_COMMITTER_NAME=eval GIT_COMMITTER_EMAIL=eval@example.com
git init -q -b main
mkdir -p src
cat > swarm.json <<'EOF'
{"protocol":"swarm","version":"0.3.0","level":1,"integrationBranch":"main","commands":{"verify":"node --test","verifyQuick":"node --test"}}
EOF
cat > package.json <<'EOF'
{ "name": "fixture", "type": "module", "scripts": { "test": "node --test" } }
EOF
cat > src/discount.mjs <<'EOF'
/** Total after a percentage discount. */
export function applyDiscount(total, percent) {
  return total - (total * percent) / 100;
}
EOF
git add -A && git commit -qm init
