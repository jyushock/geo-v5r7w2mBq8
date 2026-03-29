#!/bin/bash
REMOTE="https://oauth2:$GITHUB_TOKEN@github.com/jyushock/geo-v5r7w2mBq8.git"

echo "=== コミット中... ==="
git add -A
git commit -m "Update" 2>/dev/null || echo "コミットなし（変更なし）"

echo "=== プッシュ中... ==="
git push "$REMOTE"

echo "=== 完了！ ==="
