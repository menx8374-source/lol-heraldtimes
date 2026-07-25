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
1回実行する。これを cron で回すと完全自動運営になる。**本サイト初期おすすめは「閲覧の多い時間帯に寄せる・
夜厚め・1日8回」**で、[deploy/crontab.example](deploy/crontab.example) にそのまま貼れる形で用意してある
（`.env` の `PIPELINE_MAX_PUBLISH_PER_RUN=2` と合わせて概ね1日8〜14本・夜偏重の配分）。

```bash
crontab -e   # deploy/crontab.example の内容を貼り付ける（下記は初期おすすめ配分）
# 朝8時・昼12時（軽め）
0 8,12 * * *  cd /var/www/lol-matome && /usr/bin/npm run pipeline >> /var/lib/lol-matome/pipeline.log 2>&1
# 夜18/20/21/22/23時（ゴールデン・厚め）
0 18,20,21,22,23 * * *  cd /var/www/lol-matome && /usr/bin/npm run pipeline >> /var/lib/lol-matome/pipeline.log 2>&1
# 深夜0時（軽め）
0 0 * * *  cd /var/www/lol-matome && /usr/bin/npm run pipeline >> /var/lib/lol-matome/pipeline.log 2>&1
```
※ ペースを変えたいときは、この時刻と `PIPELINE_MAX_PUBLISH_PER_RUN` を調整するだけでよい。

## 8. バックアップ（SQLite ファイル）

```bash
# 例: 毎日 3:30 に DB をコピー世代管理（7日分）
30 3 * * * cp /var/lib/lol-matome/prod.db /var/lib/lol-matome/backup/prod-$(date +\%u).db
```

---

## 予行テスト（ステージング）環境 — 本番へ適用する前に検証する

いきなり本番へ反映せず、**同じVPS内に本番と分離した「ステージング」**を用意し、そこで確認してから本番へ上げる。
本番(`lol-matome` / `/var/www/lol-matome` / DB `prod.db` / ポート3000)とは、**別ディレクトリ・別DB・別ポート(3001)・
別pm2プロセス・`staging`ブランチ**で分離する。

推奨ワークフロー: **ローカル(`npm run dev`)で開発 → `staging`ブランチにpush → ステージングで確認 → 問題なければ
`main`にマージ → 本番へ反映**。※コミット前に「テスト全Green＋`npm run build`成功」が必須（このプロジェクトの規律）なので、
壊れた変更は基本ここまで来ない。

### 初回セットアップ（VPSで一度だけ）
```bash
# ステージング用ディレクトリにクローン（本番と同じデプロイキーでOK）
sudo mkdir -p /var/www/lol-matome-staging && sudo chown -R "$USER":"$USER" /var/www/lol-matome-staging
cd /var/www/lol-matome-staging
git clone git@github-lol:<あなた>/<リポジトリ名>.git .
git checkout -b staging origin/staging   # staging ブランチを使う（無ければ作ってpush）
npm ci

# ステージング用 .env（本番と別のDB・URL。実収集は控えめ or mock 推奨）
cp .env.example .env && nano .env
#   DATABASE_URL="file:/var/lib/lol-matome/staging.db"
#   SITE_URL=https://staging.lolheraldtimes.com   # or http://<IP>:3001 で見るなら未設定でも可
#   COLLECTION_MODE=mock                            # ステージングは基本モックで十分
#   ADMIN_USER=... / ADMIN_PASSWORD=...            # 本番と別の値に

npx prisma migrate deploy
npm run db:seed            # ← ステージングはモックデータを入れて見た目確認してよい（本番は入れない）
npm run build
pm2 start deploy/ecosystem.staging.config.cjs && pm2 save
```

### 公開方法（どちらか）
- **簡単**: ufw で 3001 を一時的に開け（`sudo ufw allow 3001`）、`http://160.251.254.119:3001` で確認。確認後 `sudo ufw delete allow 3001` で閉じる。
- **きれい**: サブドメイン `staging.lolheraldtimes.com` のAレコードを同じIPに向け、nginxに staging 用 server_block（`proxy_pass http://127.0.0.1:3001`）を追加。**検索エンジンに載せない**よう Basic 認証をかけるか `X-Robots-Tag: noindex` を付ける（本番と重複コンテンツ扱いにされないため）。

### ステージングの更新
```bash
cd /var/www/lol-matome-staging
git pull
npm ci && npx prisma migrate deploy && npm run build
pm2 restart lol-matome-staging
```

> ステージングで問題なければ、下の「更新デプロイ」で**本番**に反映する。

---

## 更新デプロイ（本番へ反映するとき）

**先にステージングで確認してから**実行する。

```bash
cd /var/www/lol-matome
git pull                    # main(本番ブランチ)を取得
npm ci
npx prisma migrate deploy   # スキーマ変更があれば適用
npm run build
pm2 restart lol-matome
```

万一の切り戻し（ロールバック）: `git checkout <直前の正常なコミット>` → `npm ci && npx prisma migrate deploy && npm run build`
→ `pm2 restart lol-matome`。SQLiteは日次バックアップ（下記手順8）から復元できる。

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
