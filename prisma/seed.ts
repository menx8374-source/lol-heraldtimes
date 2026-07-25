/**
 * サンプル記事投入スクリプト（デモ・検証用）。
 * `npm run db:seed` で実行する。実行のたびに既存の記事データを全削除してから再投入する。
 *
 * タイトルは「まとめ速報」風の仮タイトル。本格的なタイトル生成ロジックは Sprint 5 で実装する。
 */
import { PrismaClient } from "@prisma/client";
import type { ArticleBodyBlock } from "../src/lib/article-body";
import type { CategoryLabel } from "../src/lib/categories";

const prisma = new PrismaClient();

type SeedArticle = {
  slug: string;
  title: string;
  category: string;
  tags: string[];
  publishedAt: Date;
  viewCount: number;
  body: ArticleBodyBlock[];
  sources: { label: string; url: string }[];
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
    body: body(
      { type: "heading", text: "パッチ14.6の変更点" },
      {
        type: "paragraph",
        text: "本日配信されたパッチ14.6では、ジャングルモンスターの経験値量が全体的に引き下げられ、序盤のレベル差がつきにくくなる調整が入った。",
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
  },
  {
    slug: "5ch-yasuo-otp-densetsu-no-play",
    title: "【5ch】ヤスオOTP、ペンタキルより凄いプレイを見せてしまうｗｗｗ",
    category: CATEGORIES.ch5,
    tags: ["ヤスオ", "神プレイ"],
    publishedAt: daysAgo(0, 4),
    viewCount: 3890,
    body: body(
      { type: "heading", text: "反応まとめ" },
      {
        type: "reaction",
        number: 1,
        name: "国内プレイヤーさん",
        lines: [
          { text: "壁飛び5連続でキャリーとか草生える。", emphasis: "red" },
          { text: "マジで神プレイすぎるだろこれ。" },
        ],
      },
      {
        type: "reaction",
        number: 2,
        name: "国内プレイヤーさん",
        lines: [
          { text: ">>1", emphasis: "orange" },
          { text: "これは公式に取り上げられるレベルだろ。" },
        ],
        anchors: [1],
      },
      {
        type: "reaction",
        number: 3,
        name: "国内プレイヤーさん",
        lines: [{ text: "相手チームが可哀想になってきた。" }],
      },
    ),
    sources: [{ label: "5ch", url: "https://leagueoflegends.5ch.net/" }],
  },
  {
    slug: "worlds-2026-group-stage-draw-kekka",
    title: "【速報】World Championship 2026 グループステージ組み合わせ決定",
    category: CATEGORIES.esports,
    tags: ["世界大会", "eスポーツ"],
    publishedAt: daysAgo(1, 2),
    viewCount: 5210,
    body: body(
      { type: "heading", text: "組み合わせ発表" },
      {
        type: "paragraph",
        text: "本日、World Championship 2026 のグループステージ組み合わせ抽選が行われ、各地域の強豪チームの対戦カードが決定した。",
      },
      { type: "heading", text: "注目カード" },
      {
        type: "paragraph",
        text: "昨年度優勝チームと準優勝チームが早くも同グループに入ったことで、開幕から激戦が予想される。",
      },
    ),
    sources: [{ label: "Riot公式", url: "https://lolesports.com/" }],
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
        type: "reaction",
        number: 1,
        name: "海外プレイヤーさん",
        lines: [{ text: "先週までゴミ扱いされてたチャンプが急にSランク入りしてて笑う。", emphasis: "red" }],
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
        lines: [{ text: "個人的には妥当な調整だと思う。" }],
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
        lines: [{ text: "これサポート差別化どころか余計格差広がるだろ。", emphasis: "red" }],
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
        lines: [{ text: "個人的には悪くない調整だと思うけどな。" }],
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

  await prisma.articleTag.deleteMany();
  await prisma.articleSource.deleteMany();
  await prisma.article.deleteMany();
  await prisma.tag.deleteMany();

  for (const a of articles) {
    await prisma.article.create({
      data: {
        slug: a.slug,
        title: a.title,
        category: a.category,
        body: a.body,
        publishedAt: a.publishedAt,
        viewCount: a.viewCount,
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
      },
    });
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
