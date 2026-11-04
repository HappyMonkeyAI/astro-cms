#!/usr/bin/env bash
set -euo pipefail
SITE=/home/stephen/sites/happymonkey
BASE=http://127.0.0.1:4510
TOKEN=$(grep ADMIN_TOKEN= "$SITE/credentials.txt" | cut -d= -f2-)
AUTH=(-H "Authorization: Bearer $TOKEN" -H "X-EmDash-Request: 1" -H "Origin: $BASE" -H "Content-Type: application/json")

create=$(curl -s -o /tmp/hm-create.json -w '%{http_code}' -X POST "$BASE/_emdash/api/content/posts" \
  "${AUTH[@]}" \
  -d '{"slug":"dogfood-agent-note-2","status":"draft","data":{"title":"Dogfood agent note 2","excerpt":"Created on staging by dogfood script","content":[{"_type":"block","style":"normal","children":[{"_type":"span","text":"Agent write path verified.","_key":"s0"}],"_key":"b0"}]}}')
echo "create:$create"
head -c 400 /tmp/hm-create.json; echo
slug=dogfood-agent-note-2
pub=$(curl -s -o /tmp/hm-pub.json -w '%{http_code}' -X POST \
  "$BASE/_emdash/api/content/posts/$slug/publish" "${AUTH[@]}" -d '{}')
echo "publish:$pub"
head -c 200 /tmp/hm-pub.json; echo
curl -s -o /dev/null -w "public:%{http_code}\n" "$BASE/posts/$slug"
[[ "$create" == "201" && "$pub" == "200" ]]
