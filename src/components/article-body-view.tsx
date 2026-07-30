import { Fragment } from "react";
import {
  groupArticleBodyBlocksForDisplay,
  type ArticleBodyBlock,
  type ArticleBodyReactionBlock,
} from "@/lib/article-body";
import { AdSlot } from "@/components/ad-slot";
import { isAsciiArtLine } from "@/lib/aa";
import { isAllowedEmbedUrl, embedIframeSrc, EMBED_PROVIDER_LABELS, type EmbedProvider } from "@/lib/embed";
import { getSiteUrl } from "@/lib/site";

/** 強調(赤/オレンジ)を持つレス本文行のテキストカラー。未指定は通常色。 */
const LINE_EMPHASIS_CLASS: Record<"red" | "orange", string> = {
  red: "font-bold text-red-600",
  orange: "font-bold text-orange-600",
};

/** レス単位の強調色（拡張E32、おばにゅー流、拡張E36で緑を廃止し紫を追加）のテキストカラー。
 * 名前見出し（ResHeader）の緑と被らないよう、ここでは緑を使わない。ダーク/ライト両対応。 */
const RES_EMPHASIS_COLOR_CLASS: Record<"red" | "blue" | "purple" | "orange", string> = {
  red: "text-red-600 dark:text-red-400",
  blue: "text-blue-600 dark:text-blue-400",
  purple: "text-purple-600 dark:text-purple-400",
  orange: "text-orange-600 dark:text-orange-400",
};

/** レスの「番号: 名前」見出し行（名前は緑）。まとめ本文の reaction ブロック描画でのみ使う
 * （拡張E12でコメント欄は専用ヘッダーに差別化したため、このファイル内ローカル関数に降格）。 */
function ResHeader({ number, name }: { number: number; name: string }) {
  return (
    <div className="mb-1 font-bold">
      <span className="text-neutral-700 dark:text-neutral-300">{number}: </span>
      <span className="text-green-700 dark:text-green-400">{name}</span>
    </div>
  );
}

/**
 * レス本文の複数行。重要行は赤、">>N"アンカー行はオレンジで強調する。記事本文・コメント欄で共用する。
 * AA（アスキーアート）らしい行（拡張E3・`isAsciiArtLine`で判定）は等幅フォント＋空白保持で
 * 崩れないように表示する。単純な顔文字（"(^^)/" 等）はAAと判定されず通常テキストのまま表示される。
 * `original`（拡張E3・海外の反応の原文併記）がある行は、日本語訳の前に「原文: ...（英語）」を表示する。
 * `emphasisColor`（拡張E32、拡張E36で緑を廃止し紫を追加）が指定されているレスのみ、行単位の
 * emphasis(red/orange)が無い行を「大きく＋太字＋色（赤/青/紫/オレンジ）」で目立たせる
 * （拡張E36 F-E36-2: 色付き強調と黒字を区別するため、黒字（無色、emphasisColor無し）は常に
 * 通常サイズ・非太字にする。レス単位の`emphasis`フラグ自体は`data-res-emphasis`属性の付与にのみ
 * 使い、色が無ければ見た目には影響しない）。行単位のemphasis(red/orange)がある行はそちらの色を
 * 優先する（役割が違うため上書きしない）。
 */
export function ResLines({
  lines,
  emphasisColor,
}: {
  lines: { text: string; emphasis?: "red" | "orange"; original?: string }[];
  emphasisColor?: "red" | "blue" | "purple" | "orange";
}) {
  // 「大きく＋太字」は色付き強調（emphasisColor有り）のときだけ（拡張E36 F-E36-2）。
  // emphasisのみ（色無し）は黒字・通常サイズ・非太字に統一する。
  const sizeClass = emphasisColor ? " text-base sm:text-lg font-bold" : "";
  const baseColorClass = emphasisColor
    ? RES_EMPHASIS_COLOR_CLASS[emphasisColor]
    : "text-neutral-800 dark:text-neutral-200";
  return (
    <div className="flex flex-col gap-0.5">
      {lines.map((line, i) => {
        const aaClass = isAsciiArtLine(line.text) ? " whitespace-pre-wrap font-mono text-xs sm:text-sm" : "";
        return (
          <div key={i}>
            {line.original && (
              <p className="text-xs italic text-neutral-500 dark:text-neutral-400">
                原文: {line.original}（英語）
              </p>
            )}
            <p
              className={(line.emphasis ? LINE_EMPHASIS_CLASS[line.emphasis] : baseColorClass) + sizeClass + aaClass}
            >
              {line.text}
            </p>
          </div>
        );
      })}
    </div>
  );
}

/** 記事内画像ブロック（拡張E3）。遅延読み込み・レスポンシブ表示＋出典クレジットのキャプション。
 * url はローカルSVG/データURI等のモック画像のみを想定（parseArticleBodyで検証済み）。 */
function ImageBlockView({ block }: { block: Extract<ArticleBodyBlock, { type: "image" }> }) {
  return (
    <figure className="my-1">
      {/* eslint-disable-next-line @next/next/no-img-element -- ローカルSVG/データURIのモック画像のみ（parseArticleBodyで検証済み） */}
      <img
        src={block.url}
        alt={block.alt}
        loading="lazy"
        decoding="async"
        className="block max-w-full rounded border border-neutral-200 dark:border-neutral-700"
        style={{ maxWidth: "100%", height: "auto" }}
      />
      {block.credit && (
        <figcaption className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">{block.credit}</figcaption>
      )}
    </figure>
  );
}

/** 大きく目立つボタン風の外部リンクブロック（拡張E42）。パッチ記事の公式パッチノートリンク等に使う。
 * ラベルのみを表示しURL文字列は出さない（すっきりした見た目にする）。ダーク/ライト両対応、
 * ホバーで少し暗くなる程度。外部リンクのため target="_blank" + rel="noopener noreferrer"。
 * `lol`（パッチ記事刷新S4 F-S4-3）が真のときだけ、パッチ記事本文（`[data-lol-patch]`スコープ）専用の
 * LoL公式風（紺地・金枠・金文字＋ホバーで金地反転）に切り替える。それ以外（一般のRiotニュース記事等）は
 * 従来の青ボタンのまま（このブロックはパッチ記事専用ではなく共用のため、呼び出し元がisPatchArticleを渡す）。 */
function LinkButtonBlockView({
  block,
  lol,
}: {
  block: Extract<ArticleBodyBlock, { type: "linkButton" }>;
  lol?: boolean;
}) {
  return (
    <div className="my-1 flex justify-center">
      <a
        href={block.url}
        target="_blank"
        rel="noopener noreferrer"
        data-link-button
        className={
          lol
            ? "inline-block rounded-lg border border-[#C8AA6E] bg-[#091428] px-8 py-3 text-center text-base font-bold text-[#C8AA6E] shadow transition-colors hover:bg-[#C8AA6E] hover:text-[#091428]"
            : "inline-block rounded-lg bg-sky-700 px-8 py-3 text-center text-base font-bold text-white shadow transition-colors hover:bg-sky-800 dark:bg-sky-600 dark:hover:bg-sky-500"
        }
      >
        {block.label}
      </a>
    </div>
  );
}

/**
 * 目次（TOC）ブロック（成長G3 F-G3-4）。記事内の章見出し（`<h2 id={anchor}>`）へのページ内リンク一覧。
 * `aria-label="目次"` の nav 要素にすることでスクリーンリーダー等からも目次と識別できる。
 * `lol`（パッチ記事刷新S4 F-S4-3）が真のときは、パッチ記事本文専用のLoL公式風（紺地・金見出し・
 * tealリンク）に切り替える（toc自体はパッチ以外の記事でも使われる共用ブロックのため条件分岐する）。
 */
function TocBlockView({
  block,
  lol,
}: {
  block: Extract<ArticleBodyBlock, { type: "toc" }>;
  lol?: boolean;
}) {
  return (
    <nav
      aria-label="目次"
      data-article-toc
      className={
        lol
          ? "rounded-lg border border-[#463714] bg-[#091428] p-3 text-sm"
          : "rounded border border-neutral-300 bg-neutral-50 p-3 text-sm dark:border-neutral-700 dark:bg-neutral-900"
      }
    >
      <p className={lol ? "mb-1 font-bold text-[#F0E6D2]" : "mb-1 font-bold text-neutral-700 dark:text-neutral-300"}>
        目次
      </p>
      <ol className="list-decimal space-y-0.5 pl-5">
        {block.items.map((item, i) => (
          <li key={i}>
            <a
              href={`#${item.anchor}`}
              className={
                lol
                  ? "text-[#0AC8B9] underline hover:text-[#5CE1D3]"
                  : "text-sky-700 underline dark:text-sky-400"
              }
            >
              {item.label}
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
}

/** patchChangeブロックのdirection表示ラベル（パッチ記事刷新S2 F-S2-4、素朴表示）。 */
const PATCH_DIRECTION_LABEL: Record<"buff" | "nerf" | "adjust", string> = {
  buff: "強化",
  nerf: "弱体化",
  adjust: "調整",
};

/** パッチアイコン画像の出典クレジット文言（パッチ記事刷新S3 F-S3-2）。パッチ本文内に1箇所だけ表示する。 */
const PATCH_ICON_CREDIT = "画像: Riot Games / Data Dragon";

/**
 * パッチ変更カード（PatchChangeBlockView）・3グループ見出しのLoL公式風カラートークン
 * （パッチ記事刷新S4 F-S4-2・F-S4-3、research §5.1・公式CSS実測: 金#C8AA6E・区切り#3b4353）。
 * direction（強化=teal/弱体化=赤/調整=金）ごとに、directionバッジ・変更後(after)値の強調色・
 * 3グループ見出しの下線色を1箇所にまとめる。各クラス文字列はTailwindの静的スキャン対象になるよう
 * 完全な形でここに書く（実行時の文字列結合では生成CSSが漏れるため行わない）。
 * PatchChangeBlockViewはpatchChangeブロック専用（=常にパッチ記事本文内でのみ描画される）ため、
 * `[data-lol-patch]`スコープの内外を条件分岐せず直接この固定色で描画してよい。
 */
const PATCH_DIRECTION_STYLE: Record<
  "buff" | "nerf" | "adjust",
  { badgeClass: string; afterClass: string; headingBorderClass: string }
> = {
  buff: {
    badgeClass: "bg-[#0AC8B9] text-[#010A13]",
    afterClass: "text-[#0AC8B9]",
    headingBorderClass: "border-[#0AC8B9]",
  },
  nerf: {
    badgeClass: "bg-[#E84057] text-[#010A13]",
    afterClass: "text-[#E84057]",
    headingBorderClass: "border-[#E84057]",
  },
  adjust: {
    badgeClass: "bg-[#C8AA6E] text-[#010A13]",
    afterClass: "text-[#C8AA6E]",
    headingBorderClass: "border-[#C8AA6E]",
  },
};

/**
 * 3グループ見出し（パッチ記事刷新S4 F-S4-3）の下線色を、見出しテキストの先頭一致で判定する純関数
 * （compose.ts側の固定文言「チャンピオンの強化」「チャンピオンの弱体化」に対応。パッチ記事刷新S9で
 * 「主な〜」から文言変更。それ以外＝「チャンピオンの調整」・アイテム/システム等のセクション見出しは
 * 金下線を既定にする）。
 */
function patchHeadingDirectionStyle(headingText: string): (typeof PATCH_DIRECTION_STYLE)["adjust"] {
  if (headingText.startsWith("チャンピオンの強化")) return PATCH_DIRECTION_STYLE.buff;
  if (headingText.startsWith("チャンピオンの弱体化")) return PATCH_DIRECTION_STYLE.nerf;
  return PATCH_DIRECTION_STYLE.adjust;
}

/**
 * patchChangeブロックの対象アイコン/スキルアイコン用の小さな正方画像（パッチ記事刷新S3 F-S3-2、
 * S4 F-S4-2でLoL公式風の金枠に変更）。URLは既にarticle-body.ts側（`isSafeImageUrl`）で検証済み
 * （https/データURI/ローカルのみ）。srcが無ければ何も描画しない（アイコン無しgroupが画像なしで
 * 崩れないようにする）。既存のImageBlockViewと同様プレーンな`<img>`表示（Next Imageは使わない＝
 * 既存の画像表示方法に合わせる）。対象アイコンは目立つ金の太枠（円形）、スキル/パッシブアイコンは
 * 控えめな金枠（角丸）にする。
 */
function PatchIconImg({
  src,
  alt,
  size,
}: {
  src?: string;
  alt: string;
  size: "target" | "ability";
}) {
  if (!src) return null;
  const sizeClass =
    size === "target"
      ? "h-8 w-8 rounded-full border-2 border-[#C8AA6E]"
      : "h-5 w-5 rounded border border-[#785A28]";
  return (
    // eslint-disable-next-line @next/next/no-img-element -- 既存の画像表示方法(通常img、ホットリンク・ローカル保存しない)に合わせる
    <img
      src={src}
      alt={alt}
      loading="lazy"
      decoding="async"
      className={`${sizeClass} shrink-0 bg-[#1E2328] object-contain`}
    />
  );
}

/**
 * パッチ変更「対象単位」ブロックのLoL公式風レンダリング（パッチ記事刷新S2 F-S2-4で素朴表示として導入、
 * S3 F-S3-2でアイコン追加、S4 F-S4-2でLoL公式パッチノート風の意匠に変更）。
 * 対象名＋directionバッジ・対象アイコン（金枠）・各groupのスキルキー/abilityName・スキルアイコン
 * （金枠）・`stat：before ⇒ after`（before=グレー弱め・after=direction色で強調）・intentを表示する。
 * 逐語のテキスト（stat/before/after/intent等）自体は変更しない（色分けのためspan要素で囲むのみ）。
 * 画像が欠落しているgroup/対象は画像なしで崩れない。`showCredit`が真のブロックだけ出典クレジットを
 * 1回表示する（呼び出し元のArticleBodyViewが記事内最初のpatchChangeブロックにのみ渡す）。
 * このコンポーネントはpatchChangeブロック専用（=常にパッチ記事本文内）のため、`[data-lol-patch]`
 * スコープの内外に関わらず直接LoL固定色で描画する。
 */
function PatchChangeBlockView({
  block,
  showCredit,
}: {
  block: Extract<ArticleBodyBlock, { type: "patchChange" }>;
  showCredit?: boolean;
}) {
  const style = PATCH_DIRECTION_STYLE[block.direction];
  return (
    <div
      data-patch-change
      data-patch-direction={block.direction}
      className="rounded-lg border border-[#463714] border-t-2 border-t-[#C89B3C] bg-[#091428] p-3 text-sm text-[#CDBE91]"
    >
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <PatchIconImg src={block.targetIconUrl} alt={block.targetName} size="target" />
        <span className="font-bold text-[#F0E6D2]">{block.targetName}</span>
        <span
          data-patch-direction-badge
          className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${style.badgeClass}`}
        >
          {PATCH_DIRECTION_LABEL[block.direction]}
        </span>
      </div>
      {block.intent && <p className="mb-2 text-xs italic text-[#C8AA6E]">{block.intent}</p>}
      <div className="flex flex-col gap-2">
        {block.groups.map((g, gi) => (
          <div key={gi}>
            {(g.abilityName || g.abilityKey) && (
              <p className="mb-0.5 flex items-center gap-1 text-xs font-bold text-[#F0E6D2]">
                <PatchIconImg src={g.abilityIconUrl} alt={g.abilityName ?? g.abilityKey ?? ""} size="ability" />
                <span>{g.abilityName ?? g.abilityKey}</span>
              </p>
            )}
            <ul className="list-disc pl-5 marker:text-[#785A28]">
              {g.changes.map((c, ci) => (
                <li key={ci} data-patch-descriptive={c.text !== undefined || undefined}>
                  {c.text !== undefined ? (
                    // 記述式変更（パッチ記事刷新S6 F-S6-4）: before⇒afterの色分けをせず中立表示
                    // （ラベルは金、本文は基本の文字色）。逐語のテキスト自体は変更しない。
                    <>
                      {c.stat && <span className="text-[#C8AA6E]">{c.stat}：</span>}
                      {c.text}
                    </>
                  ) : (
                    <>
                      {c.stat}：<span data-patch-before className="text-[#9AA0A6]">{c.before}</span>
                      <span data-patch-arrow className="text-[#C8AA6E]">{" ⇒ "}</span>
                      <span data-patch-after className={style.afterClass}>{c.after}</span>
                    </>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      {showCredit && <p className="mt-2 text-[10px] text-[#785A28]">{PATCH_ICON_CREDIT}</p>}
    </div>
  );
}

const EMBED_PROVIDER_ICON: Record<EmbedProvider, string> = { twitter: "X", youtube: "▶", clip: "🎬" };

/** カードフォールバック時のリンク文言（provider別、X-embedで誤解を招く「本番接続時に表示されます」文言を撤廃）。
 * 中立に「〜で見る」と表記し、元URLへの外部リンク自体は変わらない。 */
const EMBED_FALLBACK_LINK_TEXT: Record<EmbedProvider, string> = {
  twitter: "Xで見る",
  youtube: "YouTubeで見る",
  clip: "Twitchで見る",
};

/**
 * Twitter公式のサンドボックス化iframe（`platform.twitter.com/embed/Tweet.html`）に付与するsandbox属性
 * （X-embed セキュリティ方針）。実際に埋め込みが機能する最小権限に絞る:
 * - `allow-scripts`: Twitter公式のTweet.html自体が動くために必要（当サイトのDOM/originでは実行されない）。
 * - `allow-popups`: ツイート内リンク/いいね等のクリックで新規タブを開けるようにする。
 * - `allow-same-origin`: iframe srcが `platform.twitter.com`（cross-origin）のため、付与してもTwitter側
 *   originの権限に閉じる（当サイトoriginの権限にはならない）。
 * camera/microphone等の`allow`は一切付けない。
 */
const TWITTER_IFRAME_SANDBOX = "allow-scripts allow-popups allow-same-origin";

/**
 * SNS/動画の埋め込みブロック（拡張E3、拡張E22で実再生対応、X-embedでtwitterも実iframe化）。
 * provider が youtube/clip/twitter のときは、embed.ts の厳格なID抽出関数で組み立てた src
 * （youtube-nocookie.com / clips.twitch.tv / platform.twitter.com の許可ドメインのみ、
 * widgets.js等の外部スクリプトは読み込まない）で実際にiframeを描画する。
 * 生URLをそのままsrcに使うことはなく、抽出に失敗した場合（不正なID等）は従来の
 * プレースホルダーカードにフォールバックする（記事は壊れない。dangerouslySetInnerHTMLは使わない）。
 * tweetは16:9ではなく高さが可変のため、twitterのみ `aspect-video` を使わず、
 * min-height＋max-height＋overflow-autoの専用コンテナ（崩れ防止。origin検証が必要なpostMessage
 * resizeは使わず静的な高さ制約のみで対応する）にする。
 * parseArticleBody時点でホワイトリスト検証済みだが、表示前にも再検証し不正値は描画しない（二重防御）。
 */
function EmbedBlockView({ block }: { block: Extract<ArticleBodyBlock, { type: "embed" }> }) {
  if (!isAllowedEmbedUrl(block.provider, block.url)) return null;

  // iframe化可能なproviderの列挙は embedIframeSrc に一元化し、ここでは戻り値の有無だけで
  // 実iframeとカードを分岐する（真実源を1箇所に保つ）。
  const src = embedIframeSrc(block.provider, block.url, new URL(getSiteUrl()).hostname);
  if (src) {
    const isTwitter = block.provider === "twitter";
    return (
      <div className="flex flex-col gap-1">
        <div
          className={
            isTwitter
              ? "w-full overflow-y-auto rounded border border-neutral-300 dark:border-neutral-700"
              : "aspect-video w-full overflow-hidden rounded border border-neutral-300 dark:border-neutral-700"
          }
          style={isTwitter ? { minHeight: 300, maxHeight: 750 } : undefined}
        >
          <iframe
            src={src}
            loading="lazy"
            {...(isTwitter
              ? { sandbox: TWITTER_IFRAME_SANDBOX }
              : { allow: "autoplay; encrypted-media; picture-in-picture; web-share", allowFullScreen: true })}
            referrerPolicy="strict-origin-when-cross-origin"
            title={EMBED_PROVIDER_LABELS[block.provider]}
            className={isTwitter ? "h-full min-h-[300px] w-full border-0" : "h-full w-full border-0"}
          />
        </div>
        {block.caption && <p className="text-sm text-neutral-600 dark:text-neutral-400">{block.caption}</p>}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1 rounded border border-dashed border-neutral-400 bg-neutral-50 p-3 text-sm dark:border-neutral-600 dark:bg-neutral-900">
      <div className="flex items-center gap-2 font-bold text-neutral-700 dark:text-neutral-300">
        <span
          aria-hidden="true"
          className="flex h-5 w-5 items-center justify-center rounded bg-neutral-300 text-[10px] dark:bg-neutral-700"
        >
          {EMBED_PROVIDER_ICON[block.provider]}
        </span>
        <span>{EMBED_PROVIDER_LABELS[block.provider]}</span>
      </div>
      {block.caption && <p className="text-neutral-600 dark:text-neutral-400">{block.caption}</p>}
      <a
        href={block.url}
        target="_blank"
        rel="noopener noreferrer"
        className="break-all text-sky-700 underline dark:text-sky-400"
      >
        {EMBED_FALLBACK_LINK_TEXT[block.provider]}
      </a>
    </div>
  );
}

/**
 * reddit反応記事の先頭に出す、参考サイト風のソース引用ブロック（Reddit-source F-RS-3）。
 * 元スレタイトル（強調）＋`by u/{author} in r/{subreddit}`（author/subredditがあるときのみ）＋
 * 元スレへのリンク（新規タブ・"Redditで見る"）を、サムネ・アイコンなしのテキスト引用カードで表示する。
 * 逐語表示のため`dangerouslySetInnerHTML`は使わない（プレーンテキストとしてJSXに渡すだけ）。
 */
function RedditSourceBlockView({ block }: { block: Extract<ArticleBodyBlock, { type: "redditSource" }> }) {
  return (
    <blockquote
      data-reddit-source
      className="border-l-4 border-orange-400 bg-orange-50 py-2 pl-3 text-sm dark:border-orange-600 dark:bg-neutral-900"
    >
      <span className="mb-1 inline-block rounded bg-orange-200 px-1.5 py-0.5 text-[10px] font-bold text-orange-800 dark:bg-orange-900 dark:text-orange-200">
        Reddit
      </span>
      <p className="font-bold text-neutral-800 dark:text-neutral-100">{block.title}</p>
      {(block.author || block.subreddit) && (
        <p className="mt-0.5 text-xs text-neutral-600 dark:text-neutral-400">
          {block.author && `by u/${block.author}`}
          {block.author && block.subreddit && " "}
          {block.subreddit && `in r/${block.subreddit}`}
        </p>
      )}
      <a
        href={block.url}
        target="_blank"
        rel="noopener noreferrer nofollow"
        className="mt-1 inline-block text-xs text-sky-700 underline dark:text-sky-400"
      >
        Redditで見る
      </a>
    </blockquote>
  );
}

/** 連続するまとめ速報レス（reactionブロック）群を1つの枠にまとめて描画する（拡張E12）。
 * 各レスは枠内で縦に連続し、レス間は薄い区切り線（divide-y）で仕切る（レスごとの独立ボックスにしない）。
 * 各レスの中身（番号:名前緑＋本文行＋赤/オレンジ強調＋">>N"アンカー）は従来どおり。 */
function ReactionGroupView({ blocks }: { blocks: ArticleBodyReactionBlock[] }) {
  return (
    <div
      data-reaction-group
      className="flex flex-col divide-y divide-neutral-200 rounded border border-neutral-300 bg-white text-sm sm:text-base dark:divide-neutral-800 dark:border-neutral-700 dark:bg-neutral-900"
    >
      {blocks.map((block, i) => (
        <div
          key={i}
          className="px-3 py-2"
          {...(block.emphasis ? { "data-res-emphasis": true } : {})}
          {...(block.emphasisColor ? { "data-res-emphasis-color": block.emphasisColor } : {})}
        >
          <ResHeader number={block.number} name={block.name} />
          <ResLines lines={block.lines} emphasisColor={block.emphasisColor} />
        </div>
      ))}
    </div>
  );
}

/** 本文ブロック配列中、見出しブロックが何番目(blocksのindex)にあるかを列挙する純関数。 */
function headingBlockIndices(blocks: ArticleBodyBlock[]): number[] {
  return blocks.flatMap((block, index) => (block.type === "heading" ? [index] : []));
}

export function ArticleBodyView({ blocks }: { blocks: ArticleBodyBlock[] }) {
  // 本文中(見出し間)の広告枠（F12）は中央の見出しの直前に差し込む。見出し数に依存せず
  // 「記事の真ん中あたり」に収まるよう、見出し数の中央インデックスを使う（3見出しなら2番目＝従来と同じ）。
  const headings = headingBlockIndices(blocks);
  const adBeforeBlockIndex = headings.length > 0 ? headings[Math.floor(headings.length / 2)] : -1;
  // patchChangeブロックのアイコン出典クレジット（パッチ記事刷新S3 F-S3-2）は記事内で1箇所だけ表示する
  // ため、最初のpatchChangeブロックのindexだけを求める（複数対象があっても重複表示しない）。
  const firstPatchChangeIndex = blocks.findIndex((block) => block.type === "patchChange");
  // パッチ記事刷新S4 F-S4-1: patchChangeブロックを1つでも含む本文＝公式パッチノート由来のdetailed
  // パッチ記事、と判定し、その場合だけ本文全体をLoL公式風ダーク意匠（[data-lol-patch]）でラップする。
  // それ以外（反応記事・fact/summary記事・パッチ以外のRiotニュース等）は従来のライト基調のまま
  // （サイト全体・他記事・ヘッダ/フッタには一切影響しないスコープ限定）。
  const isPatchArticle = firstPatchChangeIndex !== -1;
  // 冒頭サマリ段落（パッチ記事刷新S4 F-S4-3）は、パッチ記事本文中で最初に出現するparagraphブロック
  // （compose.ts側で画像バナーの直後・目次/本文の直前に1つだけ組み立てられる）。それだけを紺地金文字の
  // サマリカードにする。パッチ記事でない場合はこの判定自体を行わない（他記事の段落に影響させない）。
  const firstParagraphIndex = isPatchArticle ? blocks.findIndex((block) => block.type === "paragraph") : -1;
  // 連続する reaction ブロックを1枠にまとめる（拡張E12）。それ以外のブロックは従来どおり1件ずつ描画する。
  const groups = groupArticleBodyBlocksForDisplay(blocks);

  const content = (
    <div className="flex flex-col gap-3">
      {groups.map((group) => {
        if (group.kind === "reaction-group") {
          return <ReactionGroupView key={`reaction-group-${group.startIndex}`} blocks={group.blocks} />;
        }
        const { block, index } = group;
        if (block.type === "heading") {
          // 3グループ見出し（強化=teal下線／弱体化=赤下線／その他の調整=金下線、パッチ記事刷新S4 F-S4-3）。
          const headingClassName = isPatchArticle
            ? `mt-2 border-b-2 pb-1 text-base font-bold text-[#F0E6D2] sm:text-lg ${patchHeadingDirectionStyle(block.text).headingBorderClass}`
            : "mt-2 text-base font-bold sm:text-lg";
          return (
            <Fragment key={index}>
              {index === adBeforeBlockIndex && <AdSlot position="article-in-body" />}
              <h2 id={block.anchor} className={headingClassName}>
                {block.text}
              </h2>
            </Fragment>
          );
        }
        if (block.type === "toc") {
          return <TocBlockView key={index} block={block} lol={isPatchArticle} />;
        }
        if (block.type === "quote") {
          // 引用（掲示板/SNSの原文要約）は自サイト生成文（見出し・段落）と視覚的に区別する（F15）:
          // 枠線・背景色・斜体に加え、「引用」ラベルと出典元表記を明示する。
          return (
            <blockquote
              key={index}
              data-article-quote
              className="border-l-4 border-neutral-400 bg-neutral-50 py-2 pl-3 text-sm italic text-neutral-700 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-300"
            >
              <span className="mb-1 inline-block rounded bg-neutral-200 px-1.5 py-0.5 text-[10px] font-bold not-italic text-neutral-500 dark:bg-neutral-700 dark:text-neutral-300">
                引用
              </span>
              <p>{block.text}</p>
              {block.source && (
                <footer className="mt-1 text-xs not-italic text-neutral-500 dark:text-neutral-400">
                  — {block.source}
                </footer>
              )}
            </blockquote>
          );
        }
        if (block.type === "image") {
          return <ImageBlockView key={index} block={block} />;
        }
        if (block.type === "embed") {
          return <EmbedBlockView key={index} block={block} />;
        }
        if (block.type === "linkButton") {
          return <LinkButtonBlockView key={index} block={block} lol={isPatchArticle} />;
        }
        if (block.type === "patchChange") {
          return (
            <PatchChangeBlockView key={index} block={block} showCredit={index === firstPatchChangeIndex} />
          );
        }
        if (block.type === "redditSource") {
          return <RedditSourceBlockView key={index} block={block} />;
        }
        // 冒頭サマリ段落（パッチ記事のみ、F-S4-3）は紺地金文字のカードにする。それ以外の段落は従来どおり。
        return (
          <p
            key={index}
            className={
              index === firstParagraphIndex
                ? "rounded-lg border border-[#463714] bg-[#091428] p-3 text-sm font-bold text-[#F0E6D2] sm:text-base"
                : "text-sm leading-relaxed sm:text-base"
            }
          >
            {block.text}
          </p>
        );
      })}
    </div>
  );

  if (!isPatchArticle) {
    return content;
  }

  // パッチ記事本文ラッパ（パッチ記事刷新S4 F-S4-1）。紺〜黒のグラデ地・LoLゴールドの本文色。
  // `[data-lol-patch]`のdata属性はglobals.css側のトークン定義（文書化用）とも対応するスコープの目印。
  return (
    <div
      data-lol-patch
      className="rounded-lg bg-gradient-to-b from-[#091428] to-[#010A13] p-4 text-[#CDBE91] sm:p-6"
    >
      {content}
    </div>
  );
}
