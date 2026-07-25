/**
 * サンプル記事投入スクリプト（デモ・検証用）。
 * `npm run db:seed` で実行する。実行のたびに既存の記事データを全削除してから再投入する。
 *
 * タイトルは「まとめ速報」風の仮タイトル。本格的なタイトル生成ロジックは Sprint 5 で実装する。
 */
import { PrismaClient } from "@prisma/client";
import type { ArticleBodyBlock } from "../src/lib/article-body";
import type { CategoryLabel } from "../src/lib/categories";
import { extractCommentAnchors } from "../src/lib/comments";

const prisma = new PrismaClient();

/** サンプルコメント（拡張E2）。オリジナルの創作テキスト（実在の書き込みの複製ではない）。
 * `replies`（拡張E8）: このコメントへの返信サンプル。1階層のみ・すべてオリジナル創作テキスト。
 * `good`/`bad`（拡張E8）: 👍/👎の初期件数サンプル。未指定は0件。 */
type SeedReply = { name: string; body: string; good?: number; bad?: number };
type SeedComment = { name: string; body: string; good?: number; bad?: number; replies?: SeedReply[] };

type SeedArticle = {
  slug: string;
  title: string;
  category: string;
  tags: string[];
  publishedAt: Date;
  viewCount: number;
  body: ArticleBodyBlock[];
  sources: { label: string; url: string }[];
  /** サンプルコメント（拡張E2）。未指定は0件。すべて安全フィルタ通過想定の穏当な内容にする。
   * Article.commentCount はこの配列の件数から自動算出する（実データと表示件数を一致させるため）。 */
  comments?: SeedComment[];
  /** 絵文字リアクションのサンプル件数（拡張E1）。未指定はリアクション行なし（=0件表示）。 */
  reactions?: { emoji: string; count: number }[];
  /** アイキャッチ画像URL（拡張E3・モック）。未指定はカテゴリ色のグラデーションプレースホルダーのまま。 */
  thumbnailUrl?: string;
};

function body(...blocks: ArticleBodyBlock[]): ArticleBodyBlock[] {
  return blocks;
}

// 値は lib/categories.ts の定義済みラベルに型で束縛し、表記ズレを防ぐ（ズレると型エラーになる）。
const CATEGORIES = {
  patch: "パッチ/メタ",
  ch5: "5chの反応",
  overseas: "海外の反応",
  esports: "eスポーツ",
  official: "公式ニュース",
} as const satisfies Record<string, CategoryLabel>;

const baseDate = new Date("2026-07-25T09:00:00+09:00");
function daysAgo(days: number, hours = 0): Date {
  const d = new Date(baseDate);
  d.setDate(d.getDate() - days);
  d.setHours(d.getHours() - hours);
  return d;
}

const articles: SeedArticle[] = [
  {
    slug: "patch-2614-jungle-nerf-hikkuri-kaeru",
    title: "【悲報】パッチ14.6でジャングル大幅弱体化、海外勢が阿鼻叫喚してる件",
    category: CATEGORIES.patch,
    tags: ["パッチノート", "ジャングル"],
    publishedAt: daysAgo(0, 1),
    viewCount: 4210,
    // アイキャッチ画像（拡張E3・モック）: ローカルSVGのオリジナル作成イメージ。未設定時はカテゴリ色プレースホルダーのまま。
    thumbnailUrl: "/mock-images/thumb-jungle-nerf.svg",
    reactions: [
      { emoji: "😡", count: 24 },
      { emoji: "😮", count: 11 },
      { emoji: "👍", count: 6 },
    ],
    body: body(
      { type: "heading", text: "パッチ14.6の変更点" },
      {
        type: "paragraph",
        text: "本日配信されたパッチ14.6では、ジャングルモンスターの経験値量が全体的に引き下げられ、序盤のレベル差がつきにくくなる調整が入った。",
      },
      {
        // 記事内画像（拡張E3・モック）: ローカルSVGのオリジナル作成イメージ図＋出典クレジット。
        type: "image",
        url: "/mock-images/article-patch-notes.svg",
        alt: "パッチ14.6のジャングル調整イメージ図（モック画像）",
        credit: "画像: LoLまとめ速報編集部（オリジナル作成のイメージ図・実際のパッチノート画面ではありません）",
      },
      { type: "heading", text: "海外コミュニティの反応" },
      {
        type: "quote",
        text: "これでジャングラーはますますキャリーしづらくなる。運営は何を考えているんだ。",
        source: "Reddit ユーザー",
      },
      {
        type: "paragraph",
        text: "海外フォーラムでは賛否両論の声が上がっており、特に高難度帯のジャングルメインプレイヤーから懸念の声が目立つ。一方でトップ・ミッドレーナーからは歓迎する意見も多い。",
      },
      { type: "heading", text: "まとめ" },
      {
        type: "paragraph",
        text: "次回のパッチでさらなる調整が入るかは今後の運営発表待ちとなる。",
      },
    ),
    sources: [
      { label: "Riot公式", url: "https://www.leagueoflegends.com/ja-jp/news/game-updates/patch-14-6-notes/" },
      { label: "Reddit", url: "https://www.reddit.com/r/leagueoflegends/" },
    ],
    comments: [
      { name: "名無しさん", body: "ジャングル経験値down、正直いい調整だと思う。序盤からレベル差つきすぎだった。", good: 8, bad: 1 },
      { name: "名無しさん", body: ">>1\nそれはそうだけど、ガンクの旨味が減って余計にファーミング特化になりそうなのが心配。", good: 3, bad: 2 },
      { name: "ジャングル勢", body: "個人的には序盤ガンクの成功率が上がる方向の調整の方が嬉しかったな。", good: 5 },
      { name: "名無しさん", body: ">>3\nわかる、経験値を下げるより「ガンク成功時のリターン」を上げる方向の方が試合が動きやすい気がする。", good: 4 },
      {
        name: "名無しさん",
        body: "次のパッチでどう調整されるか楽しみにしてる。",
        good: 2,
        // 返信スレッドのサンプル（拡張E8）: このコメントへの返信を1件付ける（すべてオリジナル創作テキスト）。
        replies: [
          { name: "ジャングル勢", body: "同意、次はサポート寄りの調整にも期待したいところ。", good: 1 },
        ],
      },
    ],
  },
  {
    slug: "5ch-yasuo-otp-densetsu-no-play",
    title: "【5ch】ヤスオOTP、ペンタキルより凄いプレイを見せてしまうｗｗｗ",
    category: CATEGORIES.ch5,
    tags: ["ヤスオ", "神プレイ"],
    publishedAt: daysAgo(0, 4),
    viewCount: 3890,
    reactions: [
      { emoji: "😂", count: 33 },
      { emoji: "👍", count: 19 },
    ],
    body: body(
      { type: "heading", text: "反応まとめ" },
      {
        // 埋め込みブロック（拡張E3・モック）: 実際のクリップ埋め込みは行わず、providerが分かる
        // プレースホルダーカード＋元URLへのリンクのみを表示する。URLはサンプル値。
        type: "embed",
        provider: "clip",
        url: "https://clips.twitch.tv/SampleHighlightClipDemo",
        caption: "話題になったプレイのクリップ（サンプルURL・実在の配信クリップではありません）",
      },
      {
        type: "reaction",
        number: 1,
        name: "国内プレイヤーさん",
        lines: [
          { text: "壁を5回飛び越えてキャリーだけ倒すとか意味わからん、マジで神プレイすぎるだろこれ。", emphasis: "red" },
        ],
      },
      {
        type: "reaction",
        number: 2,
        name: "国内プレイヤーさん",
        lines: [
          { text: ">>1", emphasis: "orange" },
          { text: "これは公式ハイライトに取り上げられるレベルだろ。" },
        ],
        anchors: [1],
      },
      {
        type: "reaction",
        number: 3,
        name: "国内プレイヤーさん",
        lines: [{ text: "相手チームが可哀想になってきたわ。" }],
      },
      {
        type: "reaction",
        number: 4,
        name: "国内プレイヤーさん",
        lines: [
          { text: ">>1", emphasis: "orange" },
          { text: "待って、これ相手のフラッシュ切れを完全に読んでコンボ組んでるよな。事故じゃなくて計算づくだと思う。" },
        ],
        anchors: [1],
      },
      {
        type: "reaction",
        number: 5,
        name: "国内プレイヤーさん",
        lines: [{ text: "いや普通に相手のポジション取りが悪かっただけじゃない?壁際に固まりすぎてた。" }],
      },
      {
        type: "reaction",
        number: 6,
        name: "国内プレイヤーさん",
        lines: [
          { text: ">>5", emphasis: "orange" },
          { text: "それはそうだけど、その隙を的確に突く判断力がヤバいって話でしょ。", emphasis: "red" },
        ],
        anchors: [5],
      },
      {
        type: "reaction",
        number: 7,
        name: "国内プレイヤーさん",
        lines: [{ text: "サモナースペルがフラッシュ+イグナイトなの、この場面だとTPの方が安全だった説ある。" }],
      },
      {
        type: "reaction",
        number: 8,
        name: "国内プレイヤーさん",
        lines: [
          { text: ">>7", emphasis: "orange" },
          { text: "TPだったら今回の壁抜けコンボ自体できてないぞ。択が刺さったからこそのプレイ。" },
        ],
        anchors: [7],
      },
      {
        type: "reaction",
        number: 9,
        name: "国内プレイヤーさん",
        lines: [{ text: "OTPだからこそ出せる択なんだろうな、他のレーンでこの動きは再現できない。" }],
      },
      {
        // 顔文字デモ（拡張E3）: 単純な顔文字は通常テキストのまま崩れず表示される（等幅化しない）。
        type: "reaction",
        number: 10,
        name: "国内プレイヤーさん",
        lines: [{ text: "これは祝勝ムード全開だわ(^^)/" }],
      },
      {
        // AA(アスキーアート)デモ（拡張E3・オリジナル創作の簡単な箱型AA）: 等幅フォント＋空白保持で
        // 位置合わせが崩れないように表示される。
        type: "reaction",
        number: 11,
        name: "国内プレイヤーさん",
        lines: [
          { text: "   _____" },
          { text: "  |     |" },
          { text: "  | GG! |" },
          { text: "  |_____|" },
        ],
      },
    ),
    sources: [{ label: "5ch", url: "https://leagueoflegends.5ch.net/" }],
    comments: [
      { name: "ヤスオ勢", body: "この動画何度見ても壁抜けのタイミングがおかしい、練習量が違う。" },
      { name: "名無しさん", body: ">>1\n同じく。フラッシュ温存の判断も含めてリプレイ研究の価値ある試合だと思う。" },
      { name: "名無しさん", body: "コンボ自体もすごいけど、ここまで持っていく前のレーン戦の差も地味に大きい気がする。" },
    ],
  },
  {
    slug: "worlds-2026-group-stage-draw-kekka",
    title: "【速報】World Championship 2026 グループステージ組み合わせ決定",
    category: CATEGORIES.esports,
    tags: ["世界大会", "eスポーツ"],
    publishedAt: daysAgo(1, 2),
    viewCount: 5210,
    thumbnailUrl: "/mock-images/thumb-worlds-draw.svg",
    reactions: [
      { emoji: "😮", count: 22 },
      { emoji: "👍", count: 14 },
    ],
    body: body(
      { type: "heading", text: "組み合わせ発表" },
      {
        type: "paragraph",
        text: "本日、World Championship 2026 のグループステージ組み合わせ抽選が行われ、各地域の強豪チームの対戦カードが決定した。",
      },
      {
        type: "embed",
        provider: "youtube",
        url: "https://www.youtube.com/watch?v=sample1234xyz",
        caption: "抽選会の様子（サンプルURL・実際の配信映像ではありません）",
      },
      { type: "heading", text: "注目カード" },
      {
        type: "paragraph",
        text: "昨年度優勝チームと準優勝チームが早くも同グループに入ったことで、開幕から激戦が予想される。",
      },
    ),
    sources: [{ label: "Riot公式", url: "https://lolesports.com/" }],
    comments: [
      { name: "名無しさん", body: "このグループ、ほぼ準決勝レベルの対戦カードで草。組み合わせ運が悪すぎる。" },
      { name: "名無しさん", body: ">>1\n逆に序盤から見応えありすぎて楽しみしかない。" },
      { name: "eスポーツ好き", body: "毎年この時期の抽選会が一番ワクワクする。今年もどの地域が伸びるか注目してる。" },
      { name: "名無しさん", body: ">>3\nわかる、抽選結果次第で優勝予想が全部ひっくり返るからな。" },
    ],
  },
  {
    slug: "overseas-tier-list-patch-146-hantei",
    title: "【海外の反応】最新Tierリスト、Sランクチャンピオンが総入れ替えと話題に",
    category: CATEGORIES.overseas,
    tags: ["Tierリスト", "メタ"],
    publishedAt: daysAgo(1, 6),
    viewCount: 2980,
    body: body(
      { type: "heading", text: "反応まとめ" },
      {
        // 記事内画像（拡張E3・モック）: ローカルSVGのオリジナル作成イメージ図＋出典クレジット。
        type: "image",
        url: "/mock-images/article-tier-list.svg",
        alt: "パッチ14.6後のTierリストイメージ図（モック画像）",
        credit: "画像: LoLまとめ速報編集部（オリジナル作成のイメージ図・実際のTierリスト画面ではありません）",
      },
      {
        // 埋め込みブロック（拡張E3・モック）: X投稿の実埋め込みは行わず、プレースホルダーカード＋
        // 元URLへのリンクのみを表示する。URLはサンプル値（実在の投稿ではない）。
        type: "embed",
        provider: "twitter",
        url: "https://x.com/example_lol_fan/status/1234567890123456789",
        caption: "Tierリストの急変を報告する海外ファンの投稿（サンプルURL・実在の投稿ではありません）",
      },
      {
        type: "reaction",
        number: 1,
        name: "海外プレイヤーさん",
        lines: [
          {
            text: "先週まで誰も使ってなかったチャンプが急にSランク入りしてて驚愕。",
            emphasis: "red",
            // 海外の反応の原文併記（拡張E3・オリジナル創作テキスト、実在の投稿の複製ではない）
            original: "I'm shocked that a champion nobody touched last week is suddenly ranked S-tier.",
          },
        ],
      },
      {
        type: "reaction",
        number: 2,
        name: "海外プレイヤーさん",
        lines: [
          { text: ">>1", emphasis: "orange" },
          { text: "急激すぎる変化で草。" },
        ],
        anchors: [1],
      },
      {
        type: "reaction",
        number: 3,
        name: "海外プレイヤーさん",
        lines: [
          {
            text: "個人的には妥当な調整だと思う。地味に強かったのがようやく評価されただけ。",
            original: "Honestly this feels like a fair adjustment. It was quietly strong and is finally getting recognized.",
          },
        ],
      },
      {
        type: "reaction",
        number: 4,
        name: "海外プレイヤーさん",
        lines: [
          { text: ">>3", emphasis: "orange" },
          { text: "いや数値だけ見ると明らかにやりすぎ調整だろ、勝率が跳ね上がりすぎてる。" },
        ],
        anchors: [3],
      },
      {
        type: "reaction",
        number: 5,
        name: "海外プレイヤーさん",
        lines: [{ text: "この手のTierリストって結局サンプル数が少ない段階の数字だから鵜呑みにしない方がいい。" }],
      },
      {
        type: "reaction",
        number: 6,
        name: "海外プレイヤーさん",
        lines: [
          { text: ">>4", emphasis: "orange" },
          { text: "同意。プロシーンで結果が出るまでは話半分で見た方がいいと思う。" },
        ],
        anchors: [4],
      },
      {
        type: "reaction",
        number: 7,
        name: "海外プレイヤーさん",
        lines: [{ text: "とはいえソロQだと数字通りに刺さってる印象はある、Ban上位に急浮上してるし。" }],
      },
      {
        type: "reaction",
        number: 8,
        name: "海外プレイヤーさん",
        lines: [
          { text: ">>7", emphasis: "orange" },
          { text: "Ban率が上がってるのは強さの証拠でもあるからな、しばらくはこのまま行きそう。" },
        ],
        anchors: [7],
      },
      {
        type: "reaction",
        number: 9,
        name: "海外プレイヤーさん",
        lines: [{ text: "次のパッチで即修正されそうな数値ではある、様子見が正解だと思う。" }],
      },
    ),
    sources: [{ label: "Reddit", url: "https://www.reddit.com/r/leagueoflegends/" }],
  },
  {
    slug: "official-new-champion-teaser-koukai",
    title: "【公式】新チャンピオンのティザー映像が公開、正体を巡り憶測合戦に",
    category: CATEGORIES.official,
    tags: ["新チャンピオン"],
    publishedAt: daysAgo(2, 1),
    viewCount: 6120,
    reactions: [
      { emoji: "😮", count: 40 },
      { emoji: "👍", count: 12 },
      { emoji: "😂", count: 3 },
    ],
    body: body(
      { type: "heading", text: "ティザー映像の内容" },
      {
        type: "paragraph",
        text: "Riot Games公式が新チャンピオンを示唆する短いティザー映像を公開し、SNS上で瞬く間に拡散された。",
      },
      { type: "heading", text: "ファンの反応" },
      {
        type: "paragraph",
        text: "映像内の断片的な情報から、能力やビジュアルコンセプトについて様々な憶測が飛び交っている。",
      },
    ),
    sources: [{ label: "Riot公式", url: "https://www.leagueoflegends.com/ja-jp/news/" }],
  },
  {
    slug: "5ch-support-item-change-giron",
    title: "【5ch】サポートアイテム改修、賛否両論で議論が白熱",
    category: CATEGORIES.ch5,
    tags: ["サポート", "アイテム"],
    publishedAt: daysAgo(2, 5),
    viewCount: 1870,
    body: body(
      { type: "heading", text: "反応まとめ" },
      {
        type: "reaction",
        number: 1,
        name: "国内プレイヤーさん",
        lines: [{ text: "これサポート差別化どころか余計格差広がるだろ、正直言い訳できないレベルの調整。", emphasis: "red" }],
      },
      {
        type: "reaction",
        number: 2,
        name: "国内プレイヤーさん",
        lines: [
          { text: ">>1", emphasis: "orange" },
          { text: "わかる、上位互換にしかなってない気がする。" },
        ],
        anchors: [1],
      },
      {
        type: "reaction",
        number: 3,
        name: "国内プレイヤーさん",
        lines: [{ text: "個人的には悪くない調整だと思うけどな。ピール性能上がったのは普通に助かる。" }],
      },
      {
        type: "reaction",
        number: 4,
        name: "国内プレイヤーさん",
        lines: [
          { text: ">>3", emphasis: "orange" },
          { text: "ピール強化はいいけど、それで一部アイテムだけ完全に選ばれなくなったのが問題。" },
        ],
        anchors: [3],
      },
      {
        type: "reaction",
        number: 5,
        name: "国内プレイヤーさん",
        lines: [{ text: "エンチャント系が軒並み弱体化した影響がでかい、アグロ系サポートが不遇すぎる。" }],
      },
      {
        type: "reaction",
        number: 6,
        name: "国内プレイヤーさん",
        lines: [
          { text: ">>5", emphasis: "orange" },
          { text: "そこは同意。エンゲージ系サポートだけ得してる調整に見える。" },
        ],
        anchors: [5],
      },
      {
        type: "reaction",
        number: 7,
        name: "国内プレイヤーさん",
        lines: [{ text: "結局は集団戦でピールできるかどうかが勝敗を分けるようになってきたって話だと思う。" }],
      },
      {
        type: "reaction",
        number: 8,
        name: "国内プレイヤーさん",
        lines: [
          { text: ">>7", emphasis: "orange" },
          { text: "それはそう、サポートのアイテム選択がそのままチームの立ち回り方針を決める感じになってる。" },
        ],
        anchors: [7],
      },
      {
        type: "reaction",
        number: 9,
        name: "国内プレイヤーさん",
        lines: [{ text: "次のバランスパッチでどう調整されるか注目だな。" }],
      },
    ),
    sources: [{ label: "5ch", url: "https://leagueoflegends.5ch.net/" }],
  },
  {
    slug: "esports-rookie-team-shock-win",
    title: "【衝撃】新人選手擁するチームが強豪撃破、eスポーツ界に激震",
    category: CATEGORIES.esports,
    tags: ["eスポーツ", "新人選手"],
    publishedAt: daysAgo(3, 3),
    viewCount: 3340,
    body: body(
      { type: "heading", text: "試合結果" },
      {
        type: "paragraph",
        text: "デビュー間もない新人選手を擁するチームが、優勝候補と目されていた強豪チームを下す結果となった。",
      },
      { type: "heading", text: "今後への期待" },
      {
        type: "paragraph",
        text: "解説陣・視聴者双方から今後の躍進に期待する声が上がっている。",
      },
    ),
    sources: [{ label: "Riot公式", url: "https://lolesports.com/" }],
  },
  {
    slug: "overseas-jungle-diff-funny-clip",
    title: "【海外の反応】ジャングル差が凄すぎるクリップにコメント欄が大盛り上がり",
    category: CATEGORIES.overseas,
    tags: ["ジャングル", "神プレイ"],
    publishedAt: daysAgo(4, 2),
    viewCount: 2140,
    body: body(
      { type: "heading", text: "反応まとめ" },
      {
        type: "reaction",
        number: 1,
        name: "海外プレイヤーさん",
        lines: [{ text: "同じゲームやってるとは思えないレベル差で衝撃。", emphasis: "red" }],
      },
      {
        type: "reaction",
        number: 2,
        name: "海外プレイヤーさん",
        lines: [
          { text: ">>1", emphasis: "orange" },
          { text: "これは伸びるわ、保存しておいた。" },
        ],
        anchors: [1],
      },
      {
        type: "reaction",
        number: 3,
        name: "海外プレイヤーさん",
        lines: [{ text: "このクリップ、負けてる方のジャングルが序盤ずっと上ばかり回ってたのが敗因だと思う。" }],
      },
      {
        type: "reaction",
        number: 4,
        name: "海外プレイヤーさん",
        lines: [
          { text: ">>3", emphasis: "orange" },
          { text: "いやボットが先にダイブされて崩壊してたから、上優先の判断自体は悪くなかったのでは。" },
        ],
        anchors: [3],
      },
      {
        type: "reaction",
        number: 5,
        name: "海外プレイヤーさん",
        lines: [{ text: "ワードだけでも置いてあればここまでの差にはならなかった気がする。" }],
      },
      {
        type: "reaction",
        number: 6,
        name: "海外プレイヤーさん",
        lines: [
          { text: ">>5", emphasis: "orange" },
          { text: "それはある。視界管理の差がそのままキル差に直結してる典型例。" },
        ],
        anchors: [5],
      },
      {
        type: "reaction",
        number: 7,
        name: "海外プレイヤーさん",
        lines: [{ text: "レーン側も一方的にプッシュしすぎて釣られてる感あるし、片方だけの責任じゃないと思う。" }],
      },
      {
        type: "reaction",
        number: 8,
        name: "海外プレイヤーさん",
        lines: [
          { text: ">>7", emphasis: "orange" },
          { text: "同意、ジャングルとレーンどっちも噛み合ってなかったのが本当の敗因な気がする。" },
        ],
        anchors: [7],
      },
      {
        type: "reaction",
        number: 9,
        name: "海外プレイヤーさん",
        lines: [{ text: "とにかくこの試合はダイジェストとして分かりやすすぎる。" }],
      },
    ),
    sources: [{ label: "Reddit", url: "https://www.reddit.com/r/leagueoflegends/" }],
  },
  {
    slug: "patch-146-adc-item-build-change",
    title: "【解説】パッチ14.6でADC定番ビルドが変化、新ルートが浸透中",
    category: CATEGORIES.patch,
    tags: ["パッチノート", "ADC", "ビルド"],
    publishedAt: daysAgo(5, 4),
    viewCount: 1560,
    body: body(
      { type: "heading", text: "アイテム調整の影響" },
      {
        type: "paragraph",
        text: "今回のパッチでいくつかのADC向けアイテムの数値が調整され、既存の定番ビルドに変化が生じている。",
      },
      { type: "heading", text: "新しいビルドルート" },
      {
        type: "paragraph",
        text: "海外の上位プレイヤーの間では、既に新しいアイテムルートを取り入れる動きが広がりつつある。",
      },
    ),
    sources: [{ label: "Riot公式", url: "https://www.leagueoflegends.com/ja-jp/news/game-updates/patch-14-6-notes/" }],
  },
  {
    slug: "official-anniversary-event-kaishi",
    title: "【公式】周年記念イベント開始、限定コンテンツ多数追加",
    category: CATEGORIES.official,
    tags: ["イベント"],
    publishedAt: daysAgo(6, 1),
    viewCount: 2670,
    body: body(
      { type: "heading", text: "イベント概要" },
      {
        type: "paragraph",
        text: "本日よりゲーム内で周年記念イベントが開始され、限定スキンやミッションが多数追加された。",
      },
      { type: "heading", text: "プレイヤーの反応" },
      {
        type: "paragraph",
        text: "SNS上では早速イベントコンテンツを楽しむプレイヤーの投稿が相次いでいる。",
      },
    ),
    sources: [{ label: "Riot公式", url: "https://www.leagueoflegends.com/ja-jp/news/" }],
  },
  {
    slug: "5ch-toplane-matchup-giron-atsui",
    title: "【5ch】トップレーンの某マッチアップが理不尽すぎると議論沸騰",
    category: CATEGORIES.ch5,
    tags: ["トップレーン"],
    publishedAt: daysAgo(7, 3),
    viewCount: 1320,
    body: body(
      { type: "heading", text: "反応まとめ" },
      {
        type: "reaction",
        number: 1,
        name: "国内プレイヤーさん",
        lines: [{ text: "このマッチアップだけは修正してほしい。" }],
      },
      {
        type: "reaction",
        number: 2,
        name: "国内プレイヤーさん",
        lines: [
          { text: ">>1", emphasis: "orange" },
          { text: "わかりみが深すぎる、レーン戦が試合にならん。", emphasis: "red" },
        ],
        anchors: [1],
      },
      {
        type: "reaction",
        number: 3,
        name: "国内プレイヤーさん",
        lines: [{ text: "とはいえアイテム選択でもう少し粘れた場面はあったと思う、初手から後手後手すぎた。" }],
      },
      {
        type: "reaction",
        number: 4,
        name: "国内プレイヤーさん",
        lines: [
          { text: ">>3", emphasis: "orange" },
          { text: "それは結果論だろ、あのマッチアップで序盤にできることなんてほぼ無い。" },
        ],
        anchors: [3],
      },
      {
        type: "reaction",
        number: 5,
        name: "国内プレイヤーさん",
        lines: [{ text: "TPをレーンに使わず早めに集団戦へ回した判断はむしろ正しかったと思う。" }],
      },
      {
        type: "reaction",
        number: 6,
        name: "国内プレイヤーさん",
        lines: [
          { text: ">>5", emphasis: "orange" },
          { text: "そこは同意。無理にレーン耐えるよりロームに切り替えたのは英断。" },
        ],
        anchors: [5],
      },
      {
        type: "reaction",
        number: 7,
        name: "国内プレイヤーさん",
        lines: [{ text: "結局このチャンプ対面はパッチで直接ナーフするしかないと思う、個人の立ち回りでどうにかなるレベルじゃない。" }],
      },
      {
        type: "reaction",
        number: 8,
        name: "国内プレイヤーさん",
        lines: [
          { text: ">>7", emphasis: "orange" },
          { text: "同意だけど、次のパッチまでは対面知識でどこまで粘れるか研究する価値はある。" },
        ],
        anchors: [7],
      },
      {
        type: "reaction",
        number: 9,
        name: "国内プレイヤーさん",
        lines: [{ text: "とりあえず次のパッチノートに期待するしかないな。" }],
      },
    ),
    sources: [{ label: "5ch", url: "https://leagueoflegends.5ch.net/" }],
  },
  {
    slug: "esports-mid-season-invitational-preview",
    title: "【展望】ミッドシーズン大会直前、各地域代表の仕上がり具合をチェック",
    category: CATEGORIES.esports,
    tags: ["eスポーツ", "大会"],
    publishedAt: daysAgo(8, 5),
    viewCount: 1980,
    body: body(
      { type: "heading", text: "大会直前の状況" },
      {
        type: "paragraph",
        text: "ミッドシーズンの国際大会開幕を目前に控え、各地域代表チームの仕上がり具合に注目が集まっている。",
      },
      { type: "heading", text: "注目チーム" },
      {
        type: "paragraph",
        text: "特に近年台頭してきた地域のチームが、強豪相手にどこまで通用するか注目される。",
      },
    ),
    sources: [{ label: "Riot公式", url: "https://lolesports.com/" }],
  },
];

async function main() {
  console.log(`シード投入開始: ${articles.length}件`);

  await prisma.articleComment.deleteMany();
  await prisma.articleReaction.deleteMany();
  await prisma.articleTag.deleteMany();
  await prisma.articleSource.deleteMany();
  await prisma.article.deleteMany();
  await prisma.tag.deleteMany();

  for (const a of articles) {
    const comments = a.comments ?? [];
    // コメント数（拡張E2）はトップレベル＋返信（拡張E8）の合計と一致させる。
    const totalCommentCount = comments.reduce((sum, c) => sum + 1 + (c.replies?.length ?? 0), 0);
    const created = await prisma.article.create({
      data: {
        slug: a.slug,
        title: a.title,
        category: a.category,
        body: a.body,
        thumbnailUrl: a.thumbnailUrl,
        publishedAt: a.publishedAt,
        viewCount: a.viewCount,
        commentCount: totalCommentCount,
        sources: { create: a.sources },
        tags: {
          create: a.tags.map((name) => ({
            tag: {
              connectOrCreate: {
                where: { name },
                create: { name },
              },
            },
          })),
        },
        reactions: a.reactions ? { create: a.reactions } : undefined,
      },
    });

    // サンプルコメント・返信（拡張E2・拡張E8）: すべて安全フィルタ通過前提の穏当な創作テキストのため
    // status="published" で直接投入する（本番の投稿経路は src/lib/comments-db.ts の createComment）。
    // トップレベル・返信で記事内の表示連番(number)を共有し、返信を投稿順（トップレベル直後）に採番する。
    const anchorsFor = (body: string) => {
      const anchors = extractCommentAnchors(body);
      return anchors.length > 0 ? anchors : undefined;
    };
    let nextNumber = 1;
    for (const c of comments) {
      const topComment = await prisma.articleComment.create({
        data: {
          articleId: created.id,
          number: nextNumber++,
          name: c.name,
          body: c.body,
          anchors: anchorsFor(c.body),
          status: "published",
          goodCount: c.good ?? 0,
          badCount: c.bad ?? 0,
        },
      });

      for (const r of c.replies ?? []) {
        await prisma.articleComment.create({
          data: {
            articleId: created.id,
            number: nextNumber++,
            parentId: topComment.id,
            name: r.name,
            body: r.body,
            anchors: anchorsFor(r.body),
            status: "published",
            goodCount: r.good ?? 0,
            badCount: r.bad ?? 0,
          },
        });
      }
    }
  }

  console.log("シード投入完了");
}

main()
  .catch((e) => {
    console.error("シード投入に失敗しました:", e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
