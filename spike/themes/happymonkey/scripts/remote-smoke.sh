#!/usr/bin/env bash
set -euo pipefail
BASE=http://127.0.0.1:4510
pass=0
fail=0
ok() { echo "PASS $1"; pass=$((pass+1)); }
bad() { echo "FAIL $1"; fail=$((fail+1)); }

code=$(curl -s -o /tmp/hm.html -w '%{http_code}' "$BASE/")
[[ "$code" == "200" ]] && ok "home-$code" || bad "home-$code"
grep -q 'Happy Monkey AI' /tmp/hm.html && ok "home-hero" || bad "home-hero"
grep -q 'ZeroGTerminal' /tmp/hm.html && ok "home-projects" || bad "home-projects"
grep -q 'Start a conversation' /tmp/hm.html && ok "home-contact" || bad "home-contact"
grep -q 'Tools' /tmp/hm.html && ok "home-tools" || bad "home-tools"

for path in /projects /posts /search; do
  c=$(curl -s -o /dev/null -w '%{http_code}' "$BASE$path")
  [[ "$c" == "200" ]] && ok "$path-$c" || bad "$path-$c"
done

# discover a post slug from HTML
slug=$(grep -oE 'href="/posts/[^"]+"' /tmp/hm.html | head -1 | sed 's/href="//;s/"$//' || true)
if [[ -n "${slug:-}" ]]; then
  c=$(curl -s -o /dev/null -w '%{http_code}' "$BASE$slug")
  [[ "$c" == "200" ]] && ok "post-detail-$c" || bad "post-detail-$c ($slug)"
else
  # try listing posts page
  curl -s -o /tmp/hm-posts.html "$BASE/posts"
  slug=$(grep -oE 'href="/posts/[^"]+"' /tmp/hm-posts.html | head -1 | sed 's/href="//;s/"$//' || true)
  if [[ -n "${slug:-}" ]]; then
    c=$(curl -s -o /dev/null -w '%{http_code}' "$BASE$slug")
    [[ "$c" == "200" ]] && ok "post-detail-$c" || bad "post-detail-$c ($slug)"
  else
    bad "no-post-slug-found"
  fi
fi

for path in /pages/privacy-policy /pages/cookie-policy /pages/terms-conditions; do
  c=$(curl -s -o /dev/null -w '%{http_code}' "$BASE$path")
  [[ "$c" == "200" ]] && ok "$path-$c" || bad "$path-$c"
done

cd /home/stephen/sites/happymonkey
./backup.sh >/tmp/hm-backup.log 2>&1 && ok "backup" || bad "backup"

TOKEN=$(grep '^ADMIN_TOKEN=' credentials.txt | cut -d= -f2-)
# List content via admin API to confirm seed
curl -s -o /tmp/hm-api-posts.json -w 'api-posts:%{http_code}\n' \
  -H "Authorization: Bearer $TOKEN" -H "X-EmDash-Request: 1" -H "Origin: $BASE" \
  "$BASE/_emdash/api/content/posts?limit=5" || true
head -c 400 /tmp/hm-api-posts.json; echo

curl -s -o /tmp/hm-api-projects.json -w 'api-projects:%{http_code}\n' \
  -H "Authorization: Bearer $TOKEN" -H "X-EmDash-Request: 1" -H "Origin: $BASE" \
  "$BASE/_emdash/api/content/projects?limit=3" || true
head -c 300 /tmp/hm-api-projects.json; echo

echo "TOTAL pass=$pass fail=$fail"
[[ "$fail" -eq 0 ]]
