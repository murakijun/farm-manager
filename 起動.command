#!/bin/bash
cd "$(dirname "$0")"

echo "========================================="
echo "  農場 木管理システム 起動準備中..."
echo "========================================="

# Python3 確認
if ! command -v python3 &>/dev/null; then
  echo "❌ Python3 が見つかりません。インストールしてください。"
  read -p "Enterキーで閉じる..."
  exit 1
fi

# pip で Flask をインストール（まだなければ）
pip3 install -q -r requirements.txt

echo ""
echo "✅ 起動中... ブラウザが開きます"
echo "   終了するにはこのウィンドウを閉じてください"
echo ""

# ブラウザを少し遅らせて開く
(sleep 1.5 && open http://localhost:5100) &

python3 app.py
