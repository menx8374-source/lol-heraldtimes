import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ArticleBodyView } from "@/components/article-body-view";
import type { ArticleBodyBlock } from "@/lib/article-body";

const blocks: ArticleBodyBlock[] = [
  { type: "heading", text: "見出し" },
  { type: "paragraph", text: "これは自サイトが生成した本文段落です。" },
  { type: "quote", text: "海外の反応: とても強いチャンピオンだ", source: "Redditの反応" },
];

describe("ArticleBodyView", () => {
  const html = renderToStaticMarkup(<ArticleBodyView blocks={blocks} />);

  it("引用ブロックを blockquote で描画し、自サイト生成の段落とは別要素にする（F15）", () => {
    expect(html).toContain("<blockquote");
    expect(html).toContain("海外の反応: とても強いチャンピオンだ");
  });

  it("引用に「引用」ラベルと出典元表記を明示する（F15）", () => {
    expect(html).toContain("引用");
    expect(html).toContain("Redditの反応");
  });

  it("通常の段落は blockquote に含まれない", () => {
    const paragraphIndex = html.indexOf("これは自サイトが生成した本文段落です。");
    const blockquoteOpenIndex = html.indexOf("<blockquote");
    const blockquoteCloseIndex = html.indexOf("</blockquote>");
    // 段落の出現位置が blockquote の外側（開始タグより前 or 終了タグより後）であることを確認する。
    const insideBlockquote =
      paragraphIndex > blockquoteOpenIndex && paragraphIndex < blockquoteCloseIndex;
    expect(insideBlockquote).toBe(false);
  });
});

describe("ArticleBodyView（reactionブロック=まとめ速報レス形式）", () => {
  const reactionBlocks: ArticleBodyBlock[] = [
    {
      type: "reaction",
      number: 1,
      name: "国内プレイヤーさん",
      lines: [{ text: "普通の行" }, { text: "神プレイすぎる", emphasis: "red" }],
    },
    {
      type: "reaction",
      number: 2,
      name: "国内プレイヤーさん",
      lines: [{ text: ">>1", emphasis: "orange" }],
      anchors: [1],
    },
  ];
  const html = renderToStaticMarkup(<ArticleBodyView blocks={reactionBlocks} />);

  it("「番号: 名前」を表示し、名前は緑系クラスで描画する", () => {
    expect(html).toContain("1: ");
    expect(html).toContain("国内プレイヤーさん");
    expect(html).toContain("text-green-700");
  });

  it("重要行を赤クラスで、アンカー(>>N)行をオレンジクラスで強調する", () => {
    expect(html).toContain("神プレイすぎる");
    expect(html).toContain("text-red-600");
    // ">>1" はHTMLエスケープされて "&gt;&gt;1" として出力される
    expect(html).toContain("&gt;&gt;1");
    expect(html).toContain("text-orange-600");
  });

  it("複数レスを出現順に描画する", () => {
    expect(html.indexOf("1: ")).toBeLessThan(html.indexOf("2: "));
  });
});

describe("ArticleBodyView（連続レスの1枠統合, 拡張E12）", () => {
  it("連続する reaction ブロックは1つのコンテナ(divide-y)にまとまり、区切り線で仕切られる", () => {
    const blocks: ArticleBodyBlock[] = [
      { type: "reaction", number: 1, name: "国内プレイヤーさん", lines: [{ text: "レス1" }] },
      { type: "reaction", number: 2, name: "国内プレイヤーさん", lines: [{ text: "レス2" }] },
      { type: "reaction", number: 3, name: "国内プレイヤーさん", lines: [{ text: "レス3" }] },
    ];
    const html = renderToStaticMarkup(<ArticleBodyView blocks={blocks} />);
    // 3レスとも1つの区切り線コンテナ内に収まっている（レスごとの独立した角丸ボックスではない）
    expect(html.match(/divide-y/g)?.length).toBe(1);
    expect(html.indexOf("1: ")).toBeLessThan(html.indexOf("2: "));
    expect(html.indexOf("2: ")).toBeLessThan(html.indexOf("3: "));
  });

  it("heading等を挟んで非連続な reaction は、まとまりごとに別枠になる", () => {
    const blocks: ArticleBodyBlock[] = [
      { type: "reaction", number: 1, name: "国内プレイヤーさん", lines: [{ text: "レス1" }] },
      { type: "reaction", number: 2, name: "国内プレイヤーさん", lines: [{ text: "レス2" }] },
      { type: "heading", text: "次の話題" },
      { type: "reaction", number: 3, name: "国内プレイヤーさん", lines: [{ text: "レス3" }] },
    ];
    const html = renderToStaticMarkup(<ArticleBodyView blocks={blocks} />);
    // 2つの独立したグループ(枠)ができる
    expect(html.match(/divide-y/g)?.length).toBe(2);
  });

  it("reaction以外のブロック(heading/paragraph/quote/image/embed)の表示は従来どおり", () => {
    const blocks: ArticleBodyBlock[] = [
      { type: "heading", text: "見出し" },
      { type: "paragraph", text: "段落本文" },
      { type: "reaction", number: 1, name: "国内プレイヤーさん", lines: [{ text: "レス1" }] },
    ];
    const html = renderToStaticMarkup(<ArticleBodyView blocks={blocks} />);
    expect(html).toContain("<h2");
    expect(html).toContain("見出し");
    expect(html).toContain("段落本文");
  });
});

describe("ArticleBodyView（画像ブロック, 拡張E3）", () => {
  const blocksWithImage: ArticleBodyBlock[] = [
    { type: "image", url: "/mock-images/sample.svg", alt: "サンプル画像の説明", credit: "画像: 編集部" },
  ];
  const html = renderToStaticMarkup(<ArticleBodyView blocks={blocksWithImage} />);

  it("<img>にsrc/alt/loading=lazy/decoding=asyncを設定する", () => {
    expect(html).toContain('src="/mock-images/sample.svg"');
    expect(html).toContain('alt="サンプル画像の説明"');
    expect(html).toContain('loading="lazy"');
    expect(html).toContain('decoding="async"');
  });

  it("クレジット(出典)をキャプションとして表示する", () => {
    expect(html).toContain("<figcaption");
    expect(html).toContain("画像: 編集部");
  });

  it("dangerouslySetInnerHTMLをprop(JSX属性)として使わない(コンポーネントソースにも不在)", async () => {
    const fs = await import("node:fs/promises");
    const src = await fs.readFile(new URL("../article-body-view.tsx", import.meta.url), "utf-8");
    // コメント文中の言及(「〜は使わない」という注記)は許容し、実際の属性使用(`dangerouslySetInnerHTML=`)のみを禁止する。
    expect(src).not.toContain("dangerouslySetInnerHTML=");
  });
});

describe("ArticleBodyView（linkButtonブロック, 拡張E42）", () => {
  it("<a>にhref/target=_blank/rel=noopener noreferrerを設定し、labelを表示する(URL文字列自体は出さない)", () => {
    const blocks: ArticleBodyBlock[] = [
      { type: "linkButton", url: "https://www.leagueoflegends.com/patch-notes", label: "▶ パッチ26.14 公式パッチノートを読む" },
    ];
    const html = renderToStaticMarkup(<ArticleBodyView blocks={blocks} />);
    expect(html).toContain('href="https://www.leagueoflegends.com/patch-notes"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain("▶ パッチ26.14 公式パッチノートを読む");
    // URLの文字列自体は表示テキストとしては出さない(hrefのみ)
    expect(html.replace('href="https://www.leagueoflegends.com/patch-notes"', "")).not.toContain(
      "https://www.leagueoflegends.com/patch-notes",
    );
  });

  it("画像ブロックは従来どおり<img>で描画される(linkButtonと混在しても回帰なし)", () => {
    const blocks: ArticleBodyBlock[] = [
      { type: "image", url: "https://example.com/banner.jpg", alt: "バナー画像" },
      { type: "linkButton", url: "https://example.com/notes", label: "公式サイトへ" },
    ];
    const html = renderToStaticMarkup(<ArticleBodyView blocks={blocks} />);
    expect(html).toContain('src="https://example.com/banner.jpg"');
    expect(html).toContain("公式サイトへ");
    expect(html.indexOf("<img")).toBeLessThan(html.indexOf("公式サイトへ"));
  });
});

describe("ArticleBodyView（埋め込みブロック, 拡張E3）", () => {
  it("正当なprovider/urlで実iframe化に失敗する場合はプレースホルダーカードとして表示し、元URLへのリンクを含む(X-embedで誤解文言は撤廃)", () => {
    const blocks: ArticleBodyBlock[] = [
      { type: "embed", provider: "youtube", url: "https://www.youtube.com/watch?v=abc", caption: "サンプル動画" },
    ];
    const html = renderToStaticMarkup(<ArticleBodyView blocks={blocks} />);
    expect(html).toContain("YouTube");
    expect(html).toContain("サンプル動画");
    expect(html).toContain("https://www.youtube.com/watch?v=abc");
    expect(html).toContain("YouTubeで見る");
    expect(html).not.toContain("本番接続時に表示されます");
    // 実iframe/scriptを読み込まない
    expect(html).not.toContain("<iframe");
    expect(html).not.toContain("<script");
  });

  it("ホワイトリスト外のURLを持つ埋め込みブロックは描画しない(不正データが混入した場合の二重防御)", () => {
    // parseArticleBodyを経由せず直接不正な埋め込みブロックをArticleBodyViewに渡すケースを想定
    const blocks = [
      { type: "embed", provider: "youtube", url: "https://evil.example/watch" },
    ] as unknown as ArticleBodyBlock[];
    const html = renderToStaticMarkup(<ArticleBodyView blocks={blocks} />);
    expect(html).not.toContain("evil.example");
  });
});

describe("ArticleBodyView（埋め込みブロックの実iframe化, 拡張E22）", () => {
  it("正規のYouTube動画IDを持つURLは youtube-nocookie.com/embed のiframeとして描画する", () => {
    const blocks: ArticleBodyBlock[] = [
      { type: "embed", provider: "youtube", url: "https://youtu.be/dQw4w9WgXcQ", caption: "神プレイ集" },
    ];
    const html = renderToStaticMarkup(<ArticleBodyView blocks={blocks} />);
    expect(html).toContain("<iframe");
    expect(html).toContain("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ");
    expect(html).toContain("神プレイ集");
    expect(html).not.toContain("<script");
  });

  it("正規のTwitchクリップURLは clips.twitch.tv/embed のiframeとして描画する", () => {
    const blocks: ArticleBodyBlock[] = [
      { type: "embed", provider: "clip", url: "https://clips.twitch.tv/SampleClip" },
    ];
    const html = renderToStaticMarkup(<ArticleBodyView blocks={blocks} />);
    expect(html).toContain("<iframe");
    expect(html).toContain("https://clips.twitch.tv/embed?clip=SampleClip");
  });

  it("動画IDの抽出に失敗するURL(不正な形式)は従来のプレースホルダーカードにフォールバックする(誤解文言なし)", () => {
    const blocks: ArticleBodyBlock[] = [
      { type: "embed", provider: "youtube", url: "https://www.youtube.com/watch?v=abc", caption: "サンプル動画" },
    ];
    const html = renderToStaticMarkup(<ArticleBodyView blocks={blocks} />);
    expect(html).not.toContain("<iframe");
    expect(html).not.toContain("本番接続時に表示されます");
    expect(html).toContain("YouTubeで見る");
  });

  it("iframeにはloading=lazy・allowfullscreen・referrerpolicyを設定する(dangerouslySetInnerHTMLは使わない)", () => {
    const blocks: ArticleBodyBlock[] = [
      { type: "embed", provider: "youtube", url: "https://youtu.be/dQw4w9WgXcQ" },
    ];
    const html = renderToStaticMarkup(<ArticleBodyView blocks={blocks} />);
    expect(html).toContain('loading="lazy"');
    expect(html).toContain('allowFullScreen=""');
    expect(html).toContain('referrerPolicy="strict-origin-when-cross-origin"');
  });
});

describe("ArticleBodyView（Xツイートの実iframe化・サンドボックス化埋め込み, X-embed F-XE-1〜F-XE-2）", () => {
  it("検証済みのtweetステータスURLはplatform.twitter.com/embed/Tweet.htmlの実iframeとして描画し、誤解文言が無い", () => {
    const blocks: ArticleBodyBlock[] = [
      {
        type: "embed",
        provider: "twitter",
        url: "https://x.com/example_user/status/1234567890",
        caption: "話題のツイート",
      },
    ];
    const html = renderToStaticMarkup(<ArticleBodyView blocks={blocks} />);
    expect(html).toContain("<iframe");
    expect(html).toContain("https://platform.twitter.com/embed/Tweet.html?id=1234567890");
    expect(html).toContain("話題のツイート");
    expect(html).not.toContain("<script");
    expect(html).not.toContain("本番接続時に表示されます");
  });

  it("ツイートiframeにsandbox（allow-scripts allow-popups allow-same-origin）・referrerPolicy・loading=lazy・titleを設定する", () => {
    const blocks: ArticleBodyBlock[] = [
      { type: "embed", provider: "twitter", url: "https://x.com/example_user/status/1234567890" },
    ];
    const html = renderToStaticMarkup(<ArticleBodyView blocks={blocks} />);
    expect(html).toContain('sandbox="allow-scripts allow-popups allow-same-origin"');
    expect(html).toContain('referrerPolicy="strict-origin-when-cross-origin"');
    expect(html).toContain('loading="lazy"');
    expect(html).toContain('title="X（Twitter）投稿の埋め込み"');
  });

  it("不正なtweet URL(プロフィール等・status形式でない)はカードにフォールバックし、iframeは描画されない(誤解文言も無い)", () => {
    const blocks: ArticleBodyBlock[] = [
      { type: "embed", provider: "twitter", url: "https://x.com/example_user" },
    ];
    const html = renderToStaticMarkup(<ArticleBodyView blocks={blocks} />);
    expect(html).not.toContain("<iframe");
    expect(html).toContain("Xで見る");
    expect(html).not.toContain("本番接続時に表示されます");
  });

  it("youtube/clipの実iframe化は従来どおり回帰しない(twitter対応追加後も他providerは不変)", () => {
    const blocks: ArticleBodyBlock[] = [
      { type: "embed", provider: "youtube", url: "https://youtu.be/dQw4w9WgXcQ", caption: "神プレイ集" },
      { type: "embed", provider: "clip", url: "https://clips.twitch.tv/SampleClip" },
    ];
    const html = renderToStaticMarkup(<ArticleBodyView blocks={blocks} />);
    expect(html).toContain("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ");
    expect(html).toContain("https://clips.twitch.tv/embed?clip=SampleClip");
    // youtube/clipにはtwitter専用のsandbox属性を付けない(回帰なし)
    expect(html).not.toContain("sandbox=");
  });

  it("dangerouslySetInnerHTMLは使わない(twitter埋め込み対応後もコンポーネントソースに不在)", async () => {
    const fs = await import("node:fs/promises");
    const src = await fs.readFile(new URL("../article-body-view.tsx", import.meta.url), "utf-8");
    expect(src).not.toContain("dangerouslySetInnerHTML=");
  });
});

describe("ArticleBodyView（レス単位の重要レス強調, 拡張E25 F-E25-2／黒字統一, 拡張E36 F-E36-2）", () => {
  it("emphasisフラグのみ(emphasisColor無し)のレスは通常サイズ・非太字・黒字で描画する(拡張E36)", () => {
    const blocks: ArticleBodyBlock[] = [
      { type: "reaction", number: 1, name: "国内プレイヤーさん", lines: [{ text: "重要な反応" }], emphasis: true },
    ];
    const html = renderToStaticMarkup(<ArticleBodyView blocks={blocks} />);
    expect(html).toContain("重要な反応");
    expect(html).toContain("data-res-emphasis");
    // 色付き強調ではないので「大きく＋太字」クラス(sm:text-lg)は付かない
    expect(html).not.toContain("text-lg");
    expect(html).toContain("text-neutral-800");
  });

  it("emphasisフラグが無いレスも同様に通常クラスで描画する(後方互換)", () => {
    const blocks: ArticleBodyBlock[] = [
      { type: "reaction", number: 1, name: "国内プレイヤーさん", lines: [{ text: "普通の反応" }] },
    ];
    const html = renderToStaticMarkup(<ArticleBodyView blocks={blocks} />);
    expect(html).toContain("普通の反応");
    expect(html).not.toContain("data-res-emphasis");
    expect(html).not.toContain("text-lg");
  });

  it("行単位の強調(red)はemphasisColor無しのレスでも従来どおり効くが、レス全体は大きく＋太字にならない(拡張E36)", () => {
    const blocks: ArticleBodyBlock[] = [
      {
        type: "reaction",
        number: 1,
        name: "国内プレイヤーさん",
        lines: [{ text: "神プレイすぎる", emphasis: "red" }],
        emphasis: true,
      },
    ];
    const html = renderToStaticMarkup(<ArticleBodyView blocks={blocks} />);
    expect(html).toContain("text-red-600");
    expect(html).not.toContain("text-lg");
  });
});

describe("ArticleBodyView（強調レスの色分け, 拡張E32 F-E32-1／緑廃止・紫追加, 拡張E36 F-E36-1）", () => {
  it("emphasisColor='blue'のとき青系クラス＋大きく太字で描画し、data-res-emphasis-colorも付く", () => {
    const blocks: ArticleBodyBlock[] = [
      {
        type: "reaction",
        number: 1,
        name: "国内プレイヤーさん",
        lines: [{ text: "注目の反応" }],
        emphasis: true,
        emphasisColor: "blue",
      },
    ];
    const html = renderToStaticMarkup(<ArticleBodyView blocks={blocks} />);
    expect(html).toContain("text-blue-600");
    expect(html).toContain('data-res-emphasis-color="blue"');
    expect(html).toContain("text-lg");
    expect(html).toContain("font-bold");
  });

  it("emphasisColor='purple'のとき紫系クラス＋大きく太字で描画する(拡張E36、緑の代替)", () => {
    const blocks: ArticleBodyBlock[] = [
      {
        type: "reaction",
        number: 1,
        name: "国内プレイヤーさん",
        lines: [{ text: "補足の反応" }],
        emphasis: true,
        emphasisColor: "purple",
      },
    ];
    const html = renderToStaticMarkup(<ArticleBodyView blocks={blocks} />);
    expect(html).toContain("text-purple-600");
    expect(html).toContain("text-lg");
  });

  it("emphasisColor='orange'のときオレンジ系クラスで描画する(拡張E36)", () => {
    const blocks: ArticleBodyBlock[] = [
      {
        type: "reaction",
        number: 1,
        name: "国内プレイヤーさん",
        lines: [{ text: "強めの反応" }],
        emphasis: true,
        emphasisColor: "orange",
      },
    ];
    const html = renderToStaticMarkup(<ArticleBodyView blocks={blocks} />);
    expect(html).toContain("text-orange-600");
  });

  it("article-body-view.tsxはレス強調色として green を扱わない(拡張E36、名前見出しの緑とは独立)", async () => {
    const fs = await import("node:fs/promises");
    const src = await fs.readFile(new URL("../article-body-view.tsx", import.meta.url), "utf-8");
    // レス単位の強調色パレット(RES_EMPHASIS_COLOR_CLASS)の型・キーとしてgreenは登場しない
    // (ResHeaderの名前色`text-green-700 dark:text-green-400`は別用途で残るため、その値自体では判定しない)。
    expect(src).not.toMatch(/"red"\s*\|\s*"blue"\s*\|\s*"green"/);
    expect(src).not.toContain("green: ");
  });

  it("emphasisColor無し(emphasisのみ)は通常サイズ・非太字・黒字クラスで描画する(拡張E36 F-E36-2)", () => {
    const blocks: ArticleBodyBlock[] = [
      { type: "reaction", number: 1, name: "国内プレイヤーさん", lines: [{ text: "重要な反応" }], emphasis: true },
    ];
    const html = renderToStaticMarkup(<ArticleBodyView blocks={blocks} />);
    expect(html).toContain("text-neutral-800");
    expect(html).not.toContain("data-res-emphasis-color");
    expect(html).not.toContain("text-lg");
  });

  it("行単位の強調(red)とレス単位の色(blue)は併存する(行単位が優先されつつ両方存在)", () => {
    const blocks: ArticleBodyBlock[] = [
      {
        type: "reaction",
        number: 1,
        name: "国内プレイヤーさん",
        lines: [{ text: "神プレイすぎる", emphasis: "red" }, { text: "他の行" }],
        emphasis: true,
        emphasisColor: "blue",
      },
    ];
    const html = renderToStaticMarkup(<ArticleBodyView blocks={blocks} />);
    // 行単位emphasis(red)がある行は赤のまま
    expect(html).toContain("text-red-600");
    // 行単位emphasisが無い行はレス単位の色(blue)になる
    expect(html).toContain("text-blue-600");
  });
});

describe("ArticleBodyView（目次(toc)＋見出しanchor, 成長G3 F-G3-4）", () => {
  it("anchor付きheadingは<h2 id=anchor>で描画する", () => {
    const blocks: ArticleBodyBlock[] = [{ type: "heading", text: "主な強化", anchor: "sec-1" }];
    const html = renderToStaticMarkup(<ArticleBodyView blocks={blocks} />);
    expect(html).toContain('id="sec-1"');
    expect(html).toContain("主な強化");
  });

  it("anchor無しの既存headingは従来どおりidが付かない(回帰なし)", () => {
    const blocks: ArticleBodyBlock[] = [{ type: "heading", text: "見出し" }];
    const html = renderToStaticMarkup(<ArticleBodyView blocks={blocks} />);
    expect(html).not.toContain("id=");
    expect(html).toContain("見出し");
  });

  it("tocブロックをnav(aria-label=目次)＋各itemへのページ内リンク(#anchor)として描画する", () => {
    const blocks: ArticleBodyBlock[] = [
      {
        type: "toc",
        items: [
          { label: "主な強化", anchor: "sec-1" },
          { label: "アジール", anchor: "sec-2" },
        ],
      },
      { type: "heading", text: "主な強化", anchor: "sec-1" },
      { type: "heading", text: "アジール", anchor: "sec-2" },
    ];
    const html = renderToStaticMarkup(<ArticleBodyView blocks={blocks} />);
    expect(html).toContain('aria-label="目次"');
    expect(html).toContain('<nav');
    expect(html).toContain('href="#sec-1"');
    expect(html).toContain('href="#sec-2"');
    expect(html).toContain("id=\"sec-1\"");
    expect(html).toContain("id=\"sec-2\"");
  });

  it("未知の型が混入しても既存の網羅的ハンドリングでクラッシュしない(tocも含め全ブロック型が描画対象になる)", () => {
    const blocks: ArticleBodyBlock[] = [
      { type: "toc", items: [{ label: "見出し", anchor: "sec-1" }] },
      { type: "heading", text: "見出し", anchor: "sec-1" },
      { type: "paragraph", text: "本文" },
    ];
    expect(() => renderToStaticMarkup(<ArticleBodyView blocks={blocks} />)).not.toThrow();
  });
});

describe("ResLines（AA・原文併記, 拡張E3）", () => {
  it("AAらしい行は等幅フォント(font-mono)クラスを付与する", () => {
    const blocks: ArticleBodyBlock[] = [
      {
        type: "reaction",
        number: 1,
        name: "国内プレイヤーさん",
        lines: [{ text: "   _____" }, { text: "  | GG! |" }],
      },
    ];
    const html = renderToStaticMarkup(<ArticleBodyView blocks={blocks} />);
    expect(html).toContain("font-mono");
  });

  it("単純な顔文字はfont-monoクラスを付与しない(崩れず通常テキスト表示)", () => {
    const blocks: ArticleBodyBlock[] = [
      {
        type: "reaction",
        number: 1,
        name: "国内プレイヤーさん",
        lines: [{ text: "祝勝ムード全開だわ(^^)/" }],
      },
    ];
    const html = renderToStaticMarkup(<ArticleBodyView blocks={blocks} />);
    expect(html).not.toContain("font-mono");
    expect(html).toContain("(^^)/");
  });

  it("originalがある行は「原文: ...（英語）」を日本語訳の前に表示する", () => {
    const blocks: ArticleBodyBlock[] = [
      {
        type: "reaction",
        number: 1,
        name: "海外プレイヤーさん",
        lines: [{ text: "強すぎる。", original: "It is too strong." }],
      },
    ];
    const html = renderToStaticMarkup(<ArticleBodyView blocks={blocks} />);
    expect(html).toContain("原文: It is too strong.（英語）");
    const originalIndex = html.indexOf("原文: It is too strong.");
    const translatedIndex = html.indexOf("強すぎる。");
    expect(originalIndex).toBeLessThan(translatedIndex);
  });
});

describe("ArticleBodyView（patchChangeブロック、パッチ記事刷新S2 F-S2-4・素朴レンダリング）", () => {
  const blocks: ArticleBodyBlock[] = [
    {
      type: "patchChange",
      targetName: "コーキ",
      targetKind: "champion",
      direction: "buff",
      intent: "試合終盤のコーキの出撃時の火力を少し高めました。",
      groups: [
        {
          abilityKey: "base",
          changes: [{ stat: "レベルアップごとの攻撃力", before: "2", after: "2.5" }],
        },
        {
          abilityKey: "R",
          abilityName: "R - 連発ミサイル",
          changes: [
            { stat: "通常攻撃による残りリチャージ時間短縮量", before: "2秒～4秒", after: "2秒～6秒" },
          ],
        },
      ],
    },
  ];
  const html = renderToStaticMarkup(<ArticleBodyView blocks={blocks} />);

  it("対象名・directionラベル・意図(intent)を表示する", () => {
    expect(html).toContain("コーキ");
    expect(html).toContain("強化");
    expect(html).toContain("試合終盤のコーキの出撃時の火力を少し高めました。");
  });

  it("各groupのスキルキー/abilityName・before ⇒ afterをstatとともに表示する（S4で色分け用にspan分割されても逐語の内容は不変）", () => {
    expect(html).toContain("R - 連発ミサイル");
    expect(html).toContain("レベルアップごとの攻撃力");
    const stripped = html.replace(/<[^>]+>/g, "");
    expect(stripped).toContain("2 ⇒ 2.5");
    expect(stripped).toContain("2秒～4秒 ⇒ 2秒～6秒");
  });

  it("data-patch-change / data-patch-direction属性を付与する", () => {
    expect(html).toContain("data-patch-change");
    expect(html).toContain('data-patch-direction="buff"');
  });

  it("既存ブロック(見出し・段落等)の表示は不変(他ブロックと混在しても壊れない)", () => {
    const mixedBlocks: ArticleBodyBlock[] = [
      { type: "heading", text: "見出し" },
      { type: "paragraph", text: "段落テキスト" },
      ...blocks,
    ];
    const mixedHtml = renderToStaticMarkup(<ArticleBodyView blocks={mixedBlocks} />);
    expect(mixedHtml).toContain("見出し");
    expect(mixedHtml).toContain("段落テキスト");
    expect(mixedHtml).toContain("data-patch-change");
  });
});

describe("ArticleBodyView（patchChangeブロックのアイコン表示、パッチ記事刷新S3 F-S3-2）", () => {
  const corkiIconBlock: ArticleBodyBlock = {
    type: "patchChange",
    targetName: "コーキ",
    targetIconUrl: "https://ddragon.leagueoflegends.com/cdn/16.13.1/img/champion/Corki.png",
    targetKind: "champion",
    direction: "buff",
    groups: [
      {
        abilityKey: "R",
        abilityName: "R - 連発ミサイル",
        abilityIconUrl: "https://ddragon.leagueoflegends.com/cdn/16.13.1/img/spell/MissileBarrage.png",
        changes: [{ stat: "通常攻撃による残りリチャージ時間短縮量", before: "2秒～4秒", after: "2秒～6秒" }],
      },
      {
        // アイコン欠落group(基本ステータス相当)は画像なしで崩れないことを確認する
        abilityKey: "base",
        changes: [{ stat: "レベルアップごとの攻撃力", before: "2", after: "2.5" }],
      },
    ],
  };
  const html = renderToStaticMarkup(<ArticleBodyView blocks={[corkiIconBlock]} />);

  it("対象アイコンを表示し、altに対象名を付与する", () => {
    expect(html).toContain('src="https://ddragon.leagueoflegends.com/cdn/16.13.1/img/champion/Corki.png"');
    expect(html).toContain('alt="コーキ"');
  });

  it("スキルアイコンを表示し、altにabilityNameを付与する", () => {
    expect(html).toContain('src="https://ddragon.leagueoflegends.com/cdn/16.13.1/img/spell/MissileBarrage.png"');
    expect(html).toContain('alt="R - 連発ミサイル"');
  });

  it("画像の出典クレジットを1回表示する", () => {
    expect(html).toContain("画像: Riot Games / Data Dragon");
  });

  it("アイコン欠落group(基本ステータス)は画像なしで表示が崩れない", () => {
    expect(html).toContain("レベルアップごとの攻撃力");
    expect(html.replace(/<[^>]+>/g, "")).toContain("2 ⇒ 2.5");
  });

  it("対象/スキルのアイコンURLが両方欠落しても画像タグを出さず崩れない", () => {
    const noIconBlock: ArticleBodyBlock = {
      type: "patchChange",
      targetName: "ブルーバフ",
      targetKind: "system",
      direction: "adjust",
      groups: [{ changes: [{ stat: "スキルヘイスト", before: "10", after: "10 / 15 / 20" }] }],
    };
    const noIconHtml = renderToStaticMarkup(<ArticleBodyView blocks={[noIconBlock]} />);
    expect(noIconHtml).not.toContain("<img");
    expect(noIconHtml).toContain("ブルーバフ");
    expect(noIconHtml).toContain("スキルヘイスト");
  });

  it("複数のpatchChangeブロックがあっても出典クレジットは最初の1ブロックだけに表示される(重複表示しない)", () => {
    const secondBlock: ArticleBodyBlock = { ...corkiIconBlock, targetName: "ガレン" };
    const multiHtml = renderToStaticMarkup(<ArticleBodyView blocks={[corkiIconBlock, secondBlock]} />);
    const matches = multiHtml.match(/画像: Riot Games \/ Data Dragon/g) ?? [];
    expect(matches.length).toBe(1);
  });
});

describe("ArticleBodyView（記述式変更の表示、パッチ記事刷新S6 F-S6-4）", () => {
  const descriptiveBlock: ArticleBodyBlock = {
    type: "patchChange",
    targetName: "アジール",
    targetKind: "champion",
    direction: "adjust",
    groups: [
      {
        abilityKey: "W",
        abilityName: "W - 目覚めよ！",
        changes: [
          { stat: "ダブルタップ", text: "「征服者」が通常攻撃時に1ではなく2スタックを適用するようになりました" },
          { text: "ラベル無しの記述式変更本文" },
          { stat: "通常攻撃による残りリチャージ時間短縮量", before: "2秒～4秒", after: "2秒～6秒" },
        ],
      },
    ],
  };
  const html = renderToStaticMarkup(<ArticleBodyView blocks={[descriptiveBlock]} />);

  it("ラベル付き記述式変更は「label：text」で表示される(逐語のまま)", () => {
    expect(html).toContain("ダブルタップ");
    const stripped = html.replace(/<[^>]+>/g, "");
    expect(stripped).toContain("ダブルタップ：「征服者」が通常攻撃時に1ではなく2スタックを適用するようになりました");
  });

  it("ラベル無し記述式変更はtextのみ表示される", () => {
    expect(html).toContain("ラベル無しの記述式変更本文");
  });

  it("記述式変更にはbefore/after/矢印の色分け要素(data-patch-before等)が付かない(中立表示)", () => {
    // 同じブロック内に数値変更(短縮量)も混在するため、記述式変更の行だけを見て判定する
    expect(html).toContain("data-patch-descriptive");
    expect(html).toContain("data-patch-before"); // 数値変更(短縮量)側には引き続き付く
    const descriptiveLiMatch = html.match(/<li data-patch-descriptive[^>]*>[\s\S]*?<\/li>/g)!;
    for (const li of descriptiveLiMatch) {
      expect(li).not.toContain("data-patch-before");
      expect(li).not.toContain("data-patch-after");
    }
  });

  it("数値変更(短縮量)は引き続きbefore⇒afterで色分け表示される(既存挙動を維持)", () => {
    const stripped = html.replace(/<[^>]+>/g, "");
    expect(stripped).toContain("通常攻撃による残りリチャージ時間短縮量：2秒～4秒 ⇒ 2秒～6秒");
  });
});

describe("ArticleBodyView（LoL公式風パッチ意匠、パッチ記事刷新S4）", () => {
  const buffBlock: ArticleBodyBlock = {
    type: "patchChange",
    targetName: "コーキ",
    targetIconUrl: "https://ddragon.leagueoflegends.com/cdn/16.13.1/img/champion/Corki.png",
    targetKind: "champion",
    direction: "buff",
    intent: "試合終盤の火力を少し高めました。",
    groups: [
      {
        abilityKey: "R",
        abilityName: "R - 連発ミサイル",
        abilityIconUrl: "https://ddragon.leagueoflegends.com/cdn/16.13.1/img/spell/MissileBarrage.png",
        changes: [{ stat: "ダメージ", before: "100", after: "120" }],
      },
    ],
  };
  const nerfBlock: ArticleBodyBlock = {
    type: "patchChange",
    targetName: "アジール",
    targetKind: "champion",
    direction: "nerf",
    groups: [{ changes: [{ stat: "クールダウン", before: "10", after: "14" }] }],
  };
  const adjustBlock: ArticleBodyBlock = {
    type: "patchChange",
    targetName: "ブルーバフ",
    targetKind: "system",
    direction: "adjust",
    groups: [{ changes: [{ stat: "スキルヘイスト", before: "10", after: "15" }] }],
  };

  it("patchChangeブロックを含む本文は data-lol-patch でラップされ、黒/紺地のグラデ・金文字クラスが付く(F-S4-1)", () => {
    const html = renderToStaticMarkup(<ArticleBodyView blocks={[buffBlock]} />);
    expect(html).toContain("data-lol-patch");
    expect(html).toContain("from-[#091428]");
    expect(html).toContain("to-[#010A13]");
    expect(html).toContain("text-[#CDBE91]");
  });

  it("patchChangeブロックを含まない本文（他記事）には data-lol-patch が一切漏れない(スコープ確認)", () => {
    const blocks: ArticleBodyBlock[] = [
      { type: "heading", text: "見出し" },
      { type: "paragraph", text: "通常の記事本文" },
      { type: "toc", items: [{ label: "見出し", anchor: "sec-1" }] },
      { type: "linkButton", url: "https://example.com/", label: "公式サイトへ" },
    ];
    const html = renderToStaticMarkup(<ArticleBodyView blocks={blocks} />);
    expect(html).not.toContain("data-lol-patch");
    // toc/linkButtonも従来の（LoL化されていない）配色のまま
    expect(html).toContain("bg-sky-700");
    expect(html).toContain("text-sky-700");
  });

  it("対象アイコン(金枠・円形)・スキルアイコン(金枠・角丸)を表示する(F-S4-2)", () => {
    const html = renderToStaticMarkup(<ArticleBodyView blocks={[buffBlock]} />);
    expect(html).toContain("border-[#C8AA6E]");
    expect(html).toContain("rounded-full");
    expect(html).toContain("border-[#785A28]");
  });

  it("directionバッジ（強化=teal/弱体化=赤/調整=金）が付く(F-S4-2)", () => {
    const buffHtml = renderToStaticMarkup(<ArticleBodyView blocks={[buffBlock]} />);
    expect(buffHtml).toContain("data-patch-direction-badge");
    expect(buffHtml).toContain("bg-[#0AC8B9]");

    const nerfHtml = renderToStaticMarkup(<ArticleBodyView blocks={[nerfBlock]} />);
    expect(nerfHtml).toContain("bg-[#E84057]");

    const adjustHtml = renderToStaticMarkup(<ArticleBodyView blocks={[adjustBlock]} />);
    expect(adjustHtml).toContain("bg-[#C8AA6E]");
  });

  it("before=グレー弱め・after=direction色（buff=teal/nerf=赤/adjust=金）・⇒矢印(金)で色分けされる(F-S4-2)", () => {
    const buffHtml = renderToStaticMarkup(<ArticleBodyView blocks={[buffBlock]} />);
    expect(buffHtml).toContain("data-patch-before");
    expect(buffHtml).toContain("text-[#9AA0A6]");
    expect(buffHtml).toContain("data-patch-arrow");
    expect(buffHtml).toContain("data-patch-after");
    expect(buffHtml).toContain('<span data-patch-after="true" class="text-[#0AC8B9]">120</span>');

    const nerfHtml = renderToStaticMarkup(<ArticleBodyView blocks={[nerfBlock]} />);
    expect(nerfHtml).toContain('<span data-patch-after="true" class="text-[#E84057]">14</span>');

    const adjustHtml = renderToStaticMarkup(<ArticleBodyView blocks={[adjustBlock]} />);
    expect(adjustHtml).toContain('<span data-patch-after="true" class="text-[#C8AA6E]">15</span>');
  });

  it("3グループ見出し（チャンピオンの強化=teal下線・チャンピオンの弱体化=赤下線・チャンピオンの調整=金下線）が付く(F-S4-3、パッチ記事刷新S9)", () => {
    const blocks: ArticleBodyBlock[] = [
      { type: "heading", text: "チャンピオンの強化" },
      buffBlock,
      { type: "heading", text: "チャンピオンの弱体化" },
      nerfBlock,
      { type: "heading", text: "チャンピオンの調整" },
      adjustBlock,
    ];
    const html = renderToStaticMarkup(<ArticleBodyView blocks={blocks} />);
    const buffHeadingIndex = html.indexOf("チャンピオンの強化");
    const nerfHeadingIndex = html.indexOf("チャンピオンの弱体化");
    const adjustHeadingIndex = html.indexOf("チャンピオンの調整");
    // 各見出し<h2>直前のclass属性を大まかに検証(下線色クラスが含まれる)
    const buffH2Start = html.lastIndexOf("<h2", buffHeadingIndex);
    const nerfH2Start = html.lastIndexOf("<h2", nerfHeadingIndex);
    const adjustH2Start = html.lastIndexOf("<h2", adjustHeadingIndex);
    expect(html.slice(buffH2Start, buffHeadingIndex)).toContain("border-[#0AC8B9]");
    expect(html.slice(nerfH2Start, nerfHeadingIndex)).toContain("border-[#E84057]");
    expect(html.slice(adjustH2Start, adjustHeadingIndex)).toContain("border-[#C8AA6E]");
  });

  it("冒頭サマリ段落(最初のparagraph)は紺地金文字のカードになる(F-S4-3)", () => {
    const blocks: ArticleBodyBlock[] = [
      { type: "paragraph", text: "強化2体・弱体1体・調整1体のパッチです。" },
      { type: "toc", items: [{ label: "主な強化", anchor: "sec-1" }] },
      { type: "heading", text: "主な強化", anchor: "sec-1" },
      buffBlock,
    ];
    const html = renderToStaticMarkup(<ArticleBodyView blocks={blocks} />);
    const summaryIndex = html.indexOf("強化2体・弱体1体・調整1体のパッチです。");
    const pStart = html.lastIndexOf("<p", summaryIndex);
    expect(html.slice(pStart, summaryIndex)).toContain("bg-[#091428]");
    expect(html.slice(pStart, summaryIndex)).toContain("text-[#F0E6D2]");
  });

  it("目次(toc)が紺地・金見出し・tealリンクのLoL意匠になる(F-S4-3)", () => {
    const blocks: ArticleBodyBlock[] = [
      { type: "toc", items: [{ label: "主な強化", anchor: "sec-1" }] },
      { type: "heading", text: "主な強化", anchor: "sec-1" },
      buffBlock,
    ];
    const html = renderToStaticMarkup(<ArticleBodyView blocks={blocks} />);
    expect(html).toContain("text-[#0AC8B9]");
    expect(html).toContain("bg-[#091428]");
    expect(html).toContain('href="#sec-1"');
  });

  it("公式リンクボタンが紺地・金枠・金文字のLoL意匠になり、▶ラベルを保つ(F-S4-3)", () => {
    const blocks: ArticleBodyBlock[] = [
      buffBlock,
      { type: "linkButton", url: "https://www.leagueoflegends.com/patch-notes", label: "▶ パッチ26.14 公式パッチノートを読む" },
    ];
    const html = renderToStaticMarkup(<ArticleBodyView blocks={blocks} />);
    expect(html).toContain("border-[#C8AA6E]");
    expect(html).toContain("hover:bg-[#C8AA6E]");
    expect(html).toContain("▶ パッチ26.14 公式パッチノートを読む");
    expect(html).not.toContain("bg-sky-700");
  });

  it("画像はmax-width:100%を保ち、レスポンシブ崩れの土台を保つ(F-S4-4、既存ImageBlockViewの回帰なし)", () => {
    const blocks: ArticleBodyBlock[] = [
      { type: "image", url: "https://example.com/banner.jpg", alt: "バナー" },
      buffBlock,
    ];
    const html = renderToStaticMarkup(<ArticleBodyView blocks={blocks} />);
    expect(html).toContain("max-width:100%");
  });
});

describe("ArticleBodyView（redditSourceブロック、Reddit-source F-RS-3）", () => {
  it("タイトル＋by u/author in r/subreddit＋元スレへのリンクを表示する", () => {
    const blocks: ArticleBodyBlock[] = [
      {
        type: "redditSource",
        title: "Is Kiriko going to be meta until the end of existence?",
        author: "Jetnjet",
        subreddit: "leagueoflegends",
        url: "https://www.reddit.com/r/leagueoflegends/comments/abc123/is_kiriko_meta/",
      },
    ];
    const html = renderToStaticMarkup(<ArticleBodyView blocks={blocks} />);
    expect(html).toContain("<blockquote");
    expect(html).toContain("Is Kiriko going to be meta until the end of existence?");
    expect(html).toContain("by u/Jetnjet");
    expect(html).toContain("in r/leagueoflegends");
    expect(html).toContain('href="https://www.reddit.com/r/leagueoflegends/comments/abc123/is_kiriko_meta/"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer nofollow"');
    expect(html).toContain("Redditで見る");
  });

  it("author/subredditが無くても崩れずタイトル＋リンクだけ表示する(任意項目)", () => {
    const blocks: ArticleBodyBlock[] = [
      { type: "redditSource", title: "元スレタイトルのみ", url: "https://www.reddit.com/r/lol/comments/xyz/thread/" },
    ];
    const html = renderToStaticMarkup(<ArticleBodyView blocks={blocks} />);
    expect(html).toContain("元スレタイトルのみ");
    expect(html).not.toContain("by u/");
    expect(html).not.toContain("in r/");
    expect(html).toContain("Redditで見る");
  });

  it("サムネ・アイコン画像は含まない(<img>タグが無い、参考どおりシンプルなテキスト引用)", () => {
    const blocks: ArticleBodyBlock[] = [
      { type: "redditSource", title: "サムネ無しテスト", url: "https://www.reddit.com/r/lol/comments/xyz/thread/" },
    ];
    const html = renderToStaticMarkup(<ArticleBodyView blocks={blocks} />);
    expect(html).not.toContain("<img");
  });
});

describe("ArticleBodyView（X反応記事の元ポストembed→反応まとめ, X-reply-S3 F-XR3-3）", () => {
  const blocks: ArticleBodyBlock[] = [
    { type: "heading", text: "Xでの反応" },
    { type: "paragraph", text: "導入段落。" },
    { type: "embed", provider: "twitter", url: "https://x.com/lol_jp_fan/status/1234567890" },
    { type: "heading", text: "反応まとめ" },
    {
      type: "reaction",
      number: 1,
      name: "@na_fan1 ・ 👍1,234 💬56 [返信]",
      lines: [{ text: "序盤の集団戦が全てだった" }],
    },
    {
      type: "reaction",
      number: 2,
      name: "@jp_fan2 ・ 👍10 💬2 [引用]",
      lines: [{ text: "このピック強い" }],
    },
    { type: "paragraph", text: "結び段落。" },
  ];
  const html = renderToStaticMarkup(<ArticleBodyView blocks={blocks} />);

  it("元ポストのtwitter embed(iframe)が描画される", () => {
    expect(html).toContain("<iframe");
    expect(html).toContain("https://platform.twitter.com/embed/Tweet.html?id=1234567890");
  });

  it("反応まとめ見出しの後にreaction群が1枠(divide-y)にまとまる", () => {
    const headingIndex = html.indexOf("反応まとめ");
    const groupIndex = html.indexOf("divide-y");
    expect(headingIndex).toBeGreaterThan(-1);
    expect(groupIndex).toBeGreaterThan(headingIndex);
    expect(html.match(/divide-y/g)?.length).toBe(1);
  });

  it("@handle・評価(👍/💬)・引用/返信ラベルが読める(name表示に含まれる)", () => {
    expect(html).toContain("@na_fan1");
    expect(html).toContain("👍1,234");
    expect(html).toContain("💬56");
    expect(html).toContain("[返信]");
    expect(html).toContain("@jp_fan2");
    expect(html).toContain("[引用]");
  });

  it("dangerouslySetInnerHTMLは使わない(コンポーネントソースに不在、既存確認の再掲)", async () => {
    const fs = await import("node:fs/promises");
    const src = await fs.readFile(new URL("../article-body-view.tsx", import.meta.url), "utf-8");
    expect(src).not.toContain("dangerouslySetInnerHTML=");
  });

  it("崩れずレンダリングされる(例外を投げない)", () => {
    expect(() => renderToStaticMarkup(<ArticleBodyView blocks={blocks} />)).not.toThrow();
  });
});
