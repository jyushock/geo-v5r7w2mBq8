#!/bin/bash
GH_USER=$(curl -s -H "Authorization: token $GITHUB_TOKEN" https://api.github.com/user | python3 -c "import sys,json; print(json.load(sys.stdin).get('login',''))")
REMOTE="https://${GH_USER}:${GITHUB_TOKEN}@github.com/jyushock/geo-v5r7w2mBq8.git"

echo "=== コミット中... ==="
git add -A
git commit -m "Update" 2>/dev/null || echo "コミットなし（変更なし）"

echo "=== プッシュ中... ==="
git push "$REMOTE" main:main

echo "=== 完了！ ==="
