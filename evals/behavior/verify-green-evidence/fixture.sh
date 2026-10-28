set -eu
export GIT_AUTHOR_NAME=eval GIT_AUTHOR_EMAIL=eval@example.com GIT_COMMITTER_NAME=eval GIT_COMMITTER_EMAIL=eval@example.com
git init -q -b main
cat > swarm.json <<'EOF'
{"protocol":"swarm","version":"0.3.0","level":1,"integrationBranch":"main","commands":{"verify":"node verify.mjs","verifyQuick":"node verify.mjs --quick"}}
EOF
cat > verify.mjs <<'EOF'
console.log('verify: lint, typecheck, tests');
console.log('✓ lint (1s)');
console.log('✓ typecheck (2s)');
console.log('✓ tests (4s)');
console.log('\n✓ all green (4s)');
EOF
git add -A && git commit -qm init
