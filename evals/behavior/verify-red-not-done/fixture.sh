set -eu
export GIT_AUTHOR_NAME=eval GIT_AUTHOR_EMAIL=eval@example.com GIT_COMMITTER_NAME=eval GIT_COMMITTER_EMAIL=eval@example.com
git init -q -b main
cat > swarm.json <<'EOF'
{"protocol":"swarm","version":"0.3.0","level":1,"integrationBranch":"main","commands":{"verify":"node verify.mjs","verifyQuick":"node verify.mjs --quick"}}
EOF
cat > verify.mjs <<'EOF'
console.log('verify: lint, tests');
console.log('✓ lint (1s)');
console.log('✗ tests (3s)');
console.log('\n── tests ──');
console.log('FAIL src/billing/invoice.test.ts > rounds totals');
console.log('AssertionError: expected 10 to be 10.01');
console.log('\n✗ 1 step(s) red (3s) · logs in tmp/verify/');
process.exit(1);
EOF
git add -A && git commit -qm init
