#!/usr/bin/env bash
set -euo pipefail
docker exec happymonkey-site-1 sh -c 'grep -R "HappyMonkey" /app/dist 2>/dev/null | head -5; echo ---; grep -R "Blog Starter" /app/dist 2>/dev/null | head -5; echo ---; grep -R "\"projects\"" /app/dist/server 2>/dev/null | head -5; ls /app/dist/client /app/dist/server | head'
# Try emdash seed CLI inside container if present
docker exec happymonkey-site-1 sh -c 'ls node_modules/.bin/emdash 2>/dev/null; node -e "try{console.log(require.resolve(\"emdash/package.json\"))}catch(e){console.error(e.message)}"'
