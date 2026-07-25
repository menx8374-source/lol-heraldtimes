# 本番デプロイ手順（VPS ＋ SQLite）

LoLまとめ速報サイトを VPS（さくらVPS / ConoHa / Xserver VPS 等・Ubuntu想定）に、SQLite のまま公開・
無人運営するための手順書。運用方針は「逐語転載（①）」・DBは「SQLite（永続ディスク）」。

> 注意（コンテンツ方針の前提）: 逐語転載モデルは著作権・各媒体規約・AdSenseポリシーに抵触し得る。
> 削除依頼窓口（`CONTACT_EMAIL`）を必ず機能させ、依頼には迅速対応すること。5ch の直接スクレイピングは
> 特にリスクが高いため、収集は API 経由（Reddit/Riot 等）を主にする。詳細は README / reference/learnings.md。

---

## 0. 事前に用意するもの（あなたの作業）

- **VPS 契約**（月¥600〜1,500目安。メモリ1GB以上を推奨）。SSHログインできる状態に。
- **独自ドメイン**（¥1,000〜2,000/年）。DNS の A レコードを VPS の IP に向ける。
- （収集の本接続をする段階で）**Reddit API / Riot API のキー**等。※初回デプロイは mock のままで可。

---

## 1. サーバーの初期セットアップ

```bash
# Node.js 20 系（Next.js 16 の要件を満たすLTS）を導入
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs git

# アプリ用ディレクトリとデータ用ディレクトリ
sudo mkdir -p /var/www/lol-matome /var/lib/lol-matome
sudo chown -R "$USER":"$USER" /var/www/lol-matome /var/lib/lol-matome
```

## 2. コード配置

このリポジトリを VPS に置く（GitHub 等へ push → clone するのが簡単。※このパイプラインは自動 push しない
設計なので、リモートへの push はあなたが行う）。

```bash
cd /var/www/lol-matome
git clone <あなたのリポジトリURL> .
npm ci               # postinstall で prisma generate も走る
```

## 3. 環境変数（.env）

`.env.example` をコピーして本番値を設定する。**`.env` はコミットしない**（`ADMIN_PASSWORD` 等は秘密）。

```bash
cp .env.example .env
nano .env
```

最低限の本番設定例（値は自分のものに置き換える）:

```dotenv
# SQLite ファイルは永続ディレクトリに絶対パスで置く（バックアップしやすい）
DATABASE_URL="file:/var/lib/lol-matome/prod.db"
# 公開ドメイン（OGP/sitemap/robots の絶対URLに使う）
SITE_URL=https://example.com
# 管理画面(/admin)のBasic認証（必ず強固な値に）
ADMIN_USER=your-admin
ADMIN_PASSWORD=長くて推測されにくいパスワード
# 削除依頼の連絡先（転載運用では必須。届いたら迅速対応）
CONTACT_EMAIL=contact@example.com
# 収集/生成モード。初回は mock で基盤検証 → 本接続実装後に live へ
COLLECTION_MODE=mock
GENERATION_MODE=mock
# 広告(審査通過後に各枠へタグを設定。未設定の枠は非表示)・GA4(任意)
# AD_SLOT_ARTICLE_TOP=...
# NEXT_PUBLIC_GA_MEASUREMENT_ID=G-XXXXXXX
```

## 4. DB 初期化とビルド

```bash
# スキーマ（マイグレーション）を本番DBに適用（テーブル作成）
npx prisma migrate deploy

# ⚠ 本番では db:seed（モックの創作記事投入）は実行しない。
#   空DBから起動し、パイプラインが実データを溜めていく運用にする。
#   （挙動確認だけしたい場合のみ一時的に npm run db:seed してよい）

npm run build
```

## 5. アプリを常駐させる（pm2）

```bash
sudo npm install -g pm2
pm2 start deploy/ecosystem.config.cjs
pm2 save
pm2 startup      # 表示されたコマンドを実行し、再起動後も自動起動するように
```

アプリは `127.0.0.1:3000` で待ち受ける（外部公開は次の nginx 経由）。

## 6. リバースプロキシ ＋ HTTPS（nginx ＋ Let's Encrypt）

```bash
sudo apt-get install -y nginx
sudo cp deploy/nginx.conf.example /etc/nginx/sites-available/lol-matome
sudo nano /etc/nginx/sites-available/lol-matome   # server_name をドメインに書き換え
sudo ln -s /etc/nginx/sites-available/lol-matome /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx

# 無料TLS証明書（自動更新される）
sudo apt-get install -y certbot python3-certbot-nginx
sudo certbot --nginx -d example.com -d www.example.com
```

## 7. 無人運営（cron でパイプライン定期実行）

`npm run pipeline` が「収集→重複排除→生成→タイトル→安全フィルタ→公開」＋**予約公開の昇格**まで
1回実行する。これを cron で回すと完全自動運営になる。

```bash
crontab -e
# 例: 4時間ごとに実行（deploy/crontab.example 参照）
0 */4 * * * cd /var/www/lol-matome && /usr/bin/npm run pipeline >> /var/lib/lol-matome/pipeline.log 2>&1
```

## 8. バックアップ（SQLite ファイル）

```bash
# 例: 毎日 3:30 に DB をコピー世代管理（7日分）
30 3 * * * cp /var/lib/lol-matome/prod.db /var/lib/lol-matome/backup/prod-$(date +\%u).db
```

---

## 更新デプロイ（コード変更を反映するとき）

```bash
cd /var/www/lol-matome
git pull
npm ci
npx prisma migrate deploy   # スキーマ変更があれば適用
npm run build
pm2 restart lol-matome
```

---

## 本番稼働前チェックリスト

- [ ] `.env` に本番値（DATABASE_URL絶対パス・SITE_URL・ADMIN_USER/PASSWORD・CONTACT_EMAIL）
- [ ] `prisma migrate deploy` 済み・`db:seed`（モックデータ）は入れていない
- [ ] pm2 で常駐＋再起動後も自動起動（pm2 startup / save）
- [ ] nginx ＋ HTTPS（certbot）で `https://ドメイン` が表示される
- [ ] cron で `npm run pipeline` が定期実行（ログ出力先を確認）
- [ ] `/admin` が Basic 認証で保護されている（強固なパスワード）
- [ ] 削除依頼の連絡先（CONTACT_EMAIL）が有効で、受信を確認できる
- [ ] 運営者情報・特商法表記（広告収益がある場合）を掲載（別途ページ追記が必要なら対応可）
- [ ] SQLite の定期バックアップ
- [ ] （収益化）AdSense または代替アドネットワークの申請・タグ設定
- [ ] （本接続）COLLECTION_MODE=live ＋ 実 SourceAdapter 実装後に実データ収集へ切替
