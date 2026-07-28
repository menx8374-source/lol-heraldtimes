/**
 * 公式パッチノートHTMLの「DOM構造をそのまま辿る」純関数パーサ（パッチ記事刷新S1 F-S1-2、
 * S6で構造網羅・堅牢化）。
 *
 * 背景（docs/patch-accuracy-research.md §1〜§3）: 現行の `stripHtmlToText`（riot-datadragon.ts）は
 * 全タグを潰して平テキスト化するため、DOMの親子関係（どのチャンピオン配下の・どのスキルの・どの
 * ステータスか）が失われ、リスト外チャンピオン（例: コーキ）の変更が直前のチャンピオン節へ誤帰属する。
 * 本モジュールは平テキスト化を経由せず、生HTMLから対象ブロック単位で対象を直接抽出することで
 * 誤帰属をゼロにする（対象IDもアイコンURLのファイル名から取るため、名前マップの欠落に依存しない）。
 *
 * S6で判明した実データ（過去5パッチ26.10〜26.14）の追加パターン（docs/sprints/patch-s6-brief.md参照）:
 * - `⇒`（矢印）を含まない「記述式変更」（数値化できない仕様変更・バグ修正文）が多数を占める。
 * - `<h3 class="change-title">`（対象名）が無いブロックが毎パッチ複数ある（システム/アリーナ等）。
 *   その場合はブロック先頭の非スキルh4を対象名に、それも無ければ直近h2セクション名を対象名にする。
 * - `patch-change-block` ですらない `<div class="white-stone accent-before">` 直下ブロック
 *   （バグ修正＆QoLの変更・アリーナ等）がある。
 * - h4見出しはスキルキー（Q/W/E/R/パッシブ/固有スキル/基本ステータス）以外に、カテゴリ・小見出し
 *   （「オーグメント」「Q1 - 響掌」等）が多数来る。スキルキー判定に該当しないh4は「小見出しグループ」
 *   として扱う（abilityKeyは付与しない）。
 *
 * 設計方針:
 * - AI不使用・純ルールのみ（DOMパース・分類・URL判定）。
 * - 新規npm依存を追加しない（`patch-change-block`/`white-stone`/`change-title`/`change-detail-title`
 *   等のセマンティッククラスは安定しており、正規表現ベースの限定スキャンで十分。research §8-1参照）。
 * - 逐語維持・捏造禁止: stat/before/after/text/intent はHTML本文の文字をタグ除去・エンティティ復号
 *   するだけで、値を作らない・書き換えない。
 * - 失敗に強い: 個々のブロックの構造不一致はそのブロックをスキップ（best-effort）、入力全体が
 *   不正・空でも例外を投げず `[]` を返す（本体を止めない）。
 */
import { decodeHtmlEntities } from "@/lib/collection/adapters/riot-datadragon";
import { isSafeImageUrl } from "@/lib/image-url";

export type PatchAbilityKey = "passive" | "Q" | "W" | "E" | "R" | "base";

/**
 * 1件の変更点（パッチ記事刷新S6 F-S6-2で記述式変更にも対応、後方互換）。
 * - 数値変更（`li`内に`⇒`あり）: `stat`/`before`/`after` を持つ（本文の文字そのまま）。
 * - 記述式変更（`⇒`なし）: `text`（本文の文字そのまま）を持つ。先頭に`<strong>ラベル</strong>：`が
 *   あれば `stat` にラベルを入れる（無ければ`stat`は付けない）。数値化・要約はしない（捏造禁止）。
 */
export type PatchChange = {
  /** 変更対象のステータス名、または記述式変更のラベル（例 "レベルアップごとの攻撃力"）。本文の文字そのまま。 */
  stat?: string;
  /** 変更前の値（本文の文字そのまま。捏造しない）。数値変更のみ。 */
  before?: string;
  /** 変更後の値（本文の文字そのまま。捏造しない）。数値変更のみ。 */
  after?: string;
  /** 記述式変更の本文（本文の文字そのまま。要約・数値化しない）。 */
  text?: string;
};

export type PatchChangeGroup = {
  /** h4見出し先頭トークンから判定したスキルキー（"R - …"→R、"基本ステータス"→base、"パッシブ"→passive）。判定できなければ未設定。 */
  abilityKey?: PatchAbilityKey;
  /** h4見出しのテキスト全体（例 "R - 連発ミサイル"）。 */
  abilityName?: string;
  /** h4内の`<img src>`（スキル/パッシブアイコン。基本ステータスは無し）。 */
  abilityIconUrl?: string;
  changes: PatchChange[];
};

export type PatchChangeTarget = {
  /** 直近の`<h2>`セクション見出し（"チャンピオン"/"アイテム"/"システム"/"バグ修正…" 等）。 */
  section?: string;
  /** `h3.change-title`のテキスト（例 "コーキ"）。h3が無いブロックはフォールバック（下記実装コメント参照）。 */
  name: string;
  /** アイコンURLのパス/セクション名から判定した対象種別（S6でarena/augmentを追加）。 */
  kind: "champion" | "item" | "rune" | "system" | "bugfix" | "arena" | "augment" | "other";
  /** アイコンURLのファイル名（例 "Corki"/"3168"）。名前マップに依存しないため、リスト外チャンピオンも解決できる。 */
  id?: string;
  /** ブロック先頭の対象アイコンURL。 */
  iconUrl?: string;
  /** `blockquote`のテキスト（変更意図）。複数ある場合は全て結合する（本文の文字そのまま、S6）。 */
  intent?: string;
  groups: PatchChangeGroup[];
};

/** `<script>`/`<style>` の中身をまるごと落とす（`__NEXT_DATA__`のシリアライズHTMLやCSSセレクタ文字列の
 * 誤マッチを避ける。既存 `stripHtmlToText` と異なり `<header>` 等は落とさない — セクション見出しの
 * `<h2>` が `<header class="header-primary">` に包まれているため）。 */
function stripScriptsAndStyles(html: string): string {
  return html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ");
}

/** HTML断片からタグを除去しエンティティを復号したプレーンテキストを返す（前後空白のみtrim、内部の空白は改変しない）。 */
function textOf(fragment: string): string {
  return decodeHtmlEntities(fragment.replace(/<[^>]+>/g, "")).trim();
}

/** 断片内の最初の`<img src="...">`のURLを返す（無ければundefined）。 */
function firstImgSrc(fragment: string): string | undefined {
  const m = fragment.match(/<img[^>]+src=["']([^"']+)["']/i);
  return m ? decodeHtmlEntities(m[1]) : undefined;
}

/** `am-a.akamaihd.net/image?f=<url>` ラッパー形式を検出する正規表現（パッチ記事刷新S3 F-S3-1）。 */
const AKAMAIHD_IMAGE_WRAPPER_RE = /^https?:\/\/[\w.-]*akamaihd\.net\/image\?f=(.+)$/i;

/**
 * 公式パッチノートHTMLに埋め込まれたアイコンURLを正規化する（パッチ記事刷新S3 F-S3-1）。
 * `am-a.akamaihd.net/image?f=<DDragon直URL>` ラッパー形式を検出したら `f=` パラメータを
 * デコードしてDDragon直URLを返す（URLエンコードされていてもいなくても対応）。既にDDragon直URL・
 * その他の https 画像URLはそのまま返す。`isSafeImageUrl`（https/データURI/ローカルのみ）を
 * 満たさないURL（非https等）は undefined（表示しない。呼び出し側でid/kindはURL正規化前の
 * 生値から取得済みのため、表示だけを諦めれば済む＝記事は壊れない）。
 */
export function normalizePatchIconUrl(url: string | undefined | null): string | undefined {
  if (!url || typeof url !== "string") return undefined;
  const trimmed = url.trim();
  if (!trimmed) return undefined;

  const wrapped = trimmed.match(AKAMAIHD_IMAGE_WRAPPER_RE);
  let candidate = trimmed;
  if (wrapped) {
    try {
      candidate = decodeURIComponent(wrapped[1]);
    } catch {
      candidate = wrapped[1];
    }
  }

  return isSafeImageUrl(candidate) ? candidate : undefined;
}

/** DDragon版のURLに埋め込まれたバージョン文字列（例 "16.13.1"）を取り出す正規表現。 */
const DDRAGON_VERSION_RE = /\/cdn\/(\d+\.\d+\.\d+)\//;

/**
 * 抽出済みの対象配列（同一パッチの全対象）から、既存アイコンURLに埋め込まれたDDragonバージョン
 * （例 "16.13.1"）を推定する（パッチ記事刷新S3 F-S3-3）。同じパッチ内のアイコンはすべて同一
 * バージョンを使うため、1件でも正規化済みアイコンURLが見つかればそれを使う。見つからなければ
 * undefined（フォールバック画像の組み立てをあきらめる＝記事は壊れない）。
 */
export function inferDdragonVersionFromTargets(targets: PatchChangeTarget[]): string | undefined {
  for (const target of targets) {
    if (target.iconUrl) {
      const m = target.iconUrl.match(DDRAGON_VERSION_RE);
      if (m) return m[1];
    }
    for (const group of target.groups) {
      if (group.abilityIconUrl) {
        const m = group.abilityIconUrl.match(DDRAGON_VERSION_RE);
        if (m) return m[1];
      }
    }
  }
  return undefined;
}

/** DDragon チャンピオンsquareアイコンURLを組み立てる（パッチ記事刷新S3 F-S3-3、純関数）。 */
export function buildChampionSquareIconUrl(championId: string, version: string): string {
  return `https://ddragon.leagueoflegends.com/cdn/${version}/img/champion/${championId}.png`;
}

/** DDragon アイテムアイコンURLを組み立てる（パッチ記事刷新S3 F-S3-3、純関数）。 */
export function buildItemIconUrl(itemId: string, version: string): string {
  return `https://ddragon.leagueoflegends.com/cdn/${version}/img/item/${itemId}.png`;
}

/** アイコンURLのパスから種別とID(ファイル名, 拡張子なし)を判定する（対象IDは名前マップ非依存）。 */
function classifyIconUrl(iconUrl: string): { kind: "champion" | "item" | "rune"; id: string } | null {
  const m = iconUrl.match(/\/img\/(champion|item|rune)\/([^/?"']+)\.(?:png|jpg|jpeg|webp|svg)/i);
  if (!m) return null;
  return { kind: m[1].toLowerCase() as "champion" | "item" | "rune", id: m[2] };
}

/** セクション見出し文字列から対象種別を推定する（アイコンが無い/判定できないブロックのフォールバック、
 * パッチ記事刷新S6で アリーナ/オーグメント/ルーン を追加）。 */
function kindFromSection(section: string | undefined): PatchChangeTarget["kind"] {
  if (!section) return "other";
  if (section.includes("チャンピオン")) return "champion";
  if (section.includes("アイテム")) return "item";
  if (section.includes("バグ修正")) return "bugfix";
  if (section.includes("アリーナ")) return "arena";
  if (section.includes("オーグメント")) return "augment";
  if (section.includes("ルーン")) return "rune";
  if (section.includes("システム")) return "system";
  return "other";
}

/**
 * h4見出しテキストの先頭からスキルキーを判定する（判定できなければundefined＝小見出しグループ）。
 * パッチ記事刷新S6 決定ルール: `パッシブ/固有スキル/基本ステータス/[QWER]([ -－].*)?` に一致する場合のみ
 * スキルグループとする。「Q1 - 響掌」「P - 鷲匠」のように単独のQ/W/E/Rトークンに一致しない表記
 * （実データ確認済み: アリーナのスキル分割・"P"表記のパッシブ等）は捏造を避けるため未判定のままにする
 * （小見出しグループとして表示。誤ってQ等のキーを付けない）。
 */
function abilityKeyFromName(abilityName: string): PatchAbilityKey | undefined {
  if (!abilityName) return undefined;
  if (abilityName.startsWith("パッシブ")) return "passive";
  if (abilityName.startsWith("固有スキル")) return "passive";
  if (abilityName === "基本ステータス" || abilityName.startsWith("基本ステータス")) return "base";
  const m = abilityName.match(/^([QWER])(?:[\s\-－].*)?$/);
  if (m) return m[1] as PatchAbilityKey;
  return undefined;
}

/**
 * li内(または⇒前のhtml断片内)から「ラベル+コロン」を探す（パッチ記事刷新S6）。
 * ラベルとみなす条件は次のいずれか:
 *   (a) `<strong>ラベル：</strong>`のようにコロンがstrongタグの内側にある。
 *   (b) `<strong>ラベル</strong>：`のようにコロンがstrongタグの直後（空白/`&nbsp;`のみ挟んで）にある。
 * 実データには`<span><strong>NEW</strong></span>&nbsp;<strong>本当のラベル</strong>：本文` のような
 * 装飾バッジ（NEW/削除）が本来のラベルの前に付くケース（アリーナ/オーグメント）があるため、
 * 先頭から`<strong>`を順に走査し、上記(a)(b)いずれにも一致しない（＝バッジ等）strongはスキップして
 * 次のstrongを試す。どのstrongも条件を満たさなければnull（捏造しないため、無理に分割しない）。
 */
function findLabelBeforeColon(html: string): { label: string; afterIndex: number } | null {
  const strongRe = /<strong>([\s\S]*?)<\/strong>/g;
  let m: RegExpExecArray | null;
  while ((m = strongRe.exec(html))) {
    const content = textOf(m[1]);
    const endIdx = m.index + m[0].length;
    if (/[:：]\s*$/.test(content)) {
      return { label: content.replace(/[:：]\s*$/, "").trim(), afterIndex: endIdx };
    }
    const rest = html.slice(endIdx);
    const skipMatch = rest.match(/^(?:\s|&nbsp;)*/);
    const skipLen = skipMatch ? skipMatch[0].length : 0;
    if (rest[skipLen] === ":" || rest[skipLen] === "：") {
      return { label: content.trim(), afterIndex: endIdx + skipLen + 1 };
    }
    // このstrongはラベルではない（装飾バッジ等）とみなし、次のstrongを試す。
  }
  return null;
}

/**
 * `<li>...</li>` 1件からPatchChangeを抽出する（逐語維持・捏造禁止、パッチ記事刷新S6で全面改訂）。
 * - `⇒` を含む → 数値変更（`stat`/`before`/`after`）。ラベルは`findLabelBeforeColon`で特定し、
 *   見つからない場合はS1同様の素朴なフォールバック（先頭strong＋フラット化テキストの最後のコロン）を使う
 *   （取りこぼさないための安全側）。`after` は「⇒」直後の`<strong>`（無ければ残りテキスト全体）。
 * - `⇒` を含まない → 記述式変更（`text`。ラベルが見つかれば`stat`に入れる）。本文はタグ除去・
 *   エンティティ復号するだけで要約・数値化はしない。
 * どちらの経路でも本体のテキストが空になる場合は抽出不能としてnullを返す。
 */
function parseChangeLi(liInner: string): PatchChange | null {
  const arrowIdx = liInner.indexOf("⇒");
  if (arrowIdx !== -1) {
    const beforeHtml = liInner.slice(0, arrowIdx);
    const afterHtml = liInner.slice(arrowIdx + 1);
    const labelInfo = findLabelBeforeColon(beforeHtml);

    let stat: string;
    let before: string;
    if (labelInfo) {
      stat = labelInfo.label;
      before = textOf(beforeHtml.slice(labelInfo.afterIndex)).trim();
    } else {
      // フォールバック（S1ロジック踏襲）: 先頭strongをstatの候補にし、フラット化テキスト中の
      // 最後のコロンで前後を分割する（既存の抽出可能なケースを取りこぼさないための安全側）。
      const strongMatch = beforeHtml.match(/<strong>([\s\S]*?)<\/strong>/);
      const statRaw = strongMatch ? textOf(strongMatch[1]) : "";
      stat = statRaw.replace(/[:：]\s*$/, "").trim();
      const beforeText = textOf(beforeHtml);
      const colonIdx = Math.max(beforeText.lastIndexOf("："), beforeText.lastIndexOf(":"));
      if (colonIdx !== -1) {
        before = beforeText.slice(colonIdx + 1).trim();
      } else if (stat && beforeText.startsWith(stat)) {
        before = beforeText.slice(stat.length).trim();
      } else {
        before = beforeText.trim();
      }
    }

    const afterStrongMatch = afterHtml.match(/^\s*<strong>([\s\S]*?)<\/strong>/);
    const after = afterStrongMatch ? textOf(afterStrongMatch[1]) : textOf(afterHtml);

    if (stat && before && after) return { stat, before, after };
    // S7 F-S7-1: ラベル（stat）を特定できない場合、before/afterへの機械的な分割は不確かなため
    // 数値変更にはせず、行全体（⇒含む）を逐語の記述式変更にフォールバックする（欠落ゼロ）。
    // 実データ確認済み: ミッドパッチアップデート/ランダムミッド：メイヘム等の記述行は<strong>による
    // ラベル装飾が一切無いものが多く（例「メイヘム進行状況 ティア4：初期ゴールドx300 ⇒ 黄金のリロール」）、
    // 従来はstatが空文字になりnullで丸ごと捨てられていた（欠落）。
    const wholeText = textOf(liInner).trim();
    return wholeText ? { text: wholeText } : null;
  }

  // 記述式変更（⇒なし）: ラベルが見つかれば`label＋text`、無ければ`text`のみ（本文の文字そのまま）。
  const labelInfo = findLabelBeforeColon(liInner);
  if (labelInfo) {
    const text = textOf(liInner.slice(labelInfo.afterIndex)).trim();
    if (text) return { stat: labelInfo.label, text };
  }
  const text = textOf(liInner).trim();
  return text ? { text } : null;
}

/** `<ul>...</ul>`の中身(innerHtml)から`<li>`ごとにPatchChangeを抽出する。 */
function extractChangesFromUl(ulInner: string): PatchChange[] {
  const changes: PatchChange[] = [];
  const liRe = /<li>([\s\S]*?)<\/li>/g;
  let liM: RegExpExecArray | null;
  while ((liM = liRe.exec(ulInner))) {
    const change = parseChangeLi(liM[1]);
    if (change) changes.push(change);
  }
  return changes;
}

/** html断片内の全ての`<ul>...</ul>`からPatchChangeを集めて返す（パッチ記事刷新S6）。
 * 実データには1つの見出し配下に`<p><strong>個別名</strong></p><ul>...</ul>`が複数回繰り返される
 * 構造（例: アリーナのチャンピオン/アイテム一覧）があり、最初の`<ul>`だけを見ると大半を取りこぼす
 * ため、区間内の`<ul>`を全て走査する（個別名への細分はしないが、変更の欠落は防ぐ）。 */
function extractAllUlChanges(html: string): PatchChange[] {
  const changes: PatchChange[] = [];
  const ulRe = /<ul[^>]*>([\s\S]*?)<\/ul>/g;
  let ulM: RegExpExecArray | null;
  while ((ulM = ulRe.exec(html))) {
    changes.push(...extractChangesFromUl(ulM[1]));
  }
  return changes;
}

/** ブロック（またはその一部区間）内の`<h4 class="change-detail-title...">`をすべて見つける
 * （S7 F-S7-1で`extractGroups`から切り出し、対象の区切り判定（`findEntityHeadings`）でも再利用する）。 */
function findH4Matches(html: string): { start: number; end: number; inner: string }[] {
  const h4Re = /<h4 class="change-detail-title[^"]*"[^>]*>([\s\S]*?)<\/h4>/g;
  const matches: { start: number; end: number; inner: string }[] = [];
  let m: RegExpExecArray | null;
  while ((m = h4Re.exec(html))) {
    matches.push({ start: m.index, end: m.index + m[0].length, inner: m[1] });
  }
  return matches;
}

/** `<p><strong>個別名</strong></p>`（h3/h4でない中間ラベル。オーグメント/アリーナの個別名・
 * サブ項目名等、S7 F-S7-1）を検出する。`<p>`直下が（前置の空白/`<br>`を挟んで）`<strong>`のみという
 * 単純な段落だけを対象にする（説明文の`<p>`は他の語やタグを含むため誤検出しない）。 */
function findMidLabels(html: string): { start: number; end: number; name: string }[] {
  const re = /<p>(?:\s|<br\s*\/?>)*<strong>([\s\S]*?)<\/strong>(?:\s|<br\s*\/?>)*<\/p>/g;
  const labels: { start: number; end: number; name: string }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const name = textOf(m[1]);
    if (name) labels.push({ start: m.index, end: m.index + m[0].length, name });
  }
  return labels;
}

/**
 * 区間（h4見出し1件分、またはh4が無いブロック全体）からグループを組み立てる（S7 F-S7-1で新設）。
 * 区間内に`<p><strong>個別名</strong></p>`という中間ラベルがあれば、それ以降の`<ul>`をその個別名の
 * 別グループに分割して紐づける（1グループに潰さない・逐語維持）。中間ラベルが無ければ、区間全体を
 * `headingName`（親h4見出し。無ければ無名）の単一グループとして扱う（S6までの挙動を維持）。
 */
function extractGroupsFromRegion(
  regionHtml: string,
  headingName: string | undefined,
  headingKey: PatchAbilityKey | undefined,
  headingIconUrl: string | undefined,
): PatchChangeGroup[] {
  function buildHeadingGroup(changes: PatchChange[]): PatchChangeGroup {
    const group: PatchChangeGroup = { changes };
    if (headingName) group.abilityName = headingName;
    if (headingKey) group.abilityKey = headingKey;
    if (headingIconUrl) group.abilityIconUrl = headingIconUrl;
    return group;
  }

  const labels = findMidLabels(regionHtml);
  if (labels.length === 0) {
    const changes = extractAllUlChanges(regionHtml);
    return changes.length > 0 ? [buildHeadingGroup(changes)] : [];
  }

  const groups: PatchChangeGroup[] = [];
  const introChanges = extractAllUlChanges(regionHtml.slice(0, labels[0].start));
  if (introChanges.length > 0) groups.push(buildHeadingGroup(introChanges));
  for (let i = 0; i < labels.length; i++) {
    const label = labels[i];
    const subEnd = i + 1 < labels.length ? labels[i + 1].start : regionHtml.length;
    const changes = extractAllUlChanges(regionHtml.slice(label.end, subEnd));
    if (changes.length === 0) continue; // 変更が取れない個別名（blockquoteのみ等）はゴーストとして捨てる
    groups.push({ abilityName: label.name, changes });
  }
  return groups;
}

/**
 * ブロック内の`<h4 class="change-detail-title...">`をすべて見つけ、各h4の「次のh4手前まで」の区間から
 * グループを組み立てる（パッチ記事刷新S6: 区間内の`<ul>`は全て拾う。変更が1件も取れないh4は
 * 見出しだけのゴーストグループを作らないよう捨てる。S7 F-S7-1で中間ラベル（`extractGroupsFromRegion`）
 * 対応を追加）。h4が1つも無いブロック（実データ確認済み: 一部アイテム・バグ修正＆QoLの変更の
 * white-stoneブロック等はh4無しでblockquote/ulが直結・繰り返す）は、ブロック全体を同様に扱う
 * （中間ラベルがあれば個別名ごとに分割、無ければ無名の単一グループとして拾い、変更を取りこぼさない）。
 */
function extractGroups(blockHtml: string): PatchChangeGroup[] {
  const h4Matches = findH4Matches(blockHtml);

  if (h4Matches.length === 0) {
    return extractGroupsFromRegion(blockHtml, undefined, undefined, undefined);
  }

  const groups: PatchChangeGroup[] = [];
  for (let i = 0; i < h4Matches.length; i++) {
    const h4 = h4Matches[i];
    const regionEnd = i + 1 < h4Matches.length ? h4Matches[i + 1].start : blockHtml.length;
    const region = blockHtml.slice(h4.end, regionEnd);
    const abilityName = textOf(h4.inner) || undefined;
    const abilityKey = abilityName ? abilityKeyFromName(abilityName) : undefined;
    // 正規化（akamaihdラッパー→DDragon直URL）はS3 F-S3-1で表示URLに適用する。壊れURL/非https等は
    // undefinedになり、group.abilityIconUrl自体を持たない（画像なしで崩れない）。
    const abilityIconUrl = normalizePatchIconUrl(firstImgSrc(h4.inner));
    groups.push(...extractGroupsFromRegion(region, abilityName, abilityKey, abilityIconUrl));
  }
  return groups;
}

/** ブロック内の`<blockquote>`を全て集めて結合したテキストを返す（パッチ記事刷新S6決定ルール:
 * 「blockquoteは全て拾い、対象の意図として結合（複数可）」。実データ確認済み: バグ修正＆QoLの変更の
 * white-stoneブロックは意図→変更→意図→変更と複数回繰り返す）。1つも無ければundefined。 */
function extractCombinedIntent(blockHtml: string): string | undefined {
  const bqRe = /<blockquote[^>]*>([\s\S]*?)<\/blockquote>/g;
  const parts: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = bqRe.exec(blockHtml))) {
    const text = textOf(m[1]);
    if (text) parts.push(text);
  }
  return parts.length > 0 ? parts.join(" ") : undefined;
}

/** `patch-change-block`/`white-stone`ブロック1件（`blockHtml`）から1 `PatchChangeTarget` を組み立てる。
 * 有効な変更が1件も取れないブロック（スキン紹介・パッチハイライト等の装飾のみのwhite-stoneブロック）は
 * nullを返す（空カードを作らない）。 */
function parseBlock(blockHtml: string, section: string | undefined): PatchChangeTarget | null {
  const h3Match = blockHtml.match(/<h3 class="change-title"[^>]*>([\s\S]*?)<\/h3>/);
  const h3Name = h3Match ? textOf(h3Match[1]) : undefined;

  const intent = extractCombinedIntent(blockHtml);

  // 対象アイコンは h3（または先頭h4、h3が無い場合）より前の領域から探す。
  // アイテム/システム節では h4 が h3/blockquote より先に来ることがある(research実データ確認済み)ため、
  // 「h3の開始位置」を境界にする(h3が無ければブロック全体を境界=最初のh4検索で十分)。
  const h4FirstMatch = blockHtml.match(/<h4 class="change-detail-title[^"]*"[^>]*>/);
  const iconSearchEnd = h3Match
    ? h3Match.index!
    : h4FirstMatch
      ? h4FirstMatch.index!
      : blockHtml.length;
  // 種別/ID判定（classifyIconUrl）はakamaihdラッパーで包まれた生の値でも`/img/xxx/yyy.png`パターンを
  // そのまま検出できるため、正規化前の生URLに対して行う（非https等で正規化が失敗しても対象IDは
  // 解決できるようにする）。表示用のtarget.iconUrlはS3 F-S3-1で正規化した値を使う（壊れURL/非https
  // は undefined になり画像を表示しないだけで、対象の識別は失われない）。
  const rawIconUrl = firstImgSrc(blockHtml.slice(0, iconSearchEnd));
  const iconUrl = normalizePatchIconUrl(rawIconUrl);

  let groups = extractGroups(blockHtml);

  // 対象名の決定（パッチ記事刷新S6 決定ルール、S7 F-S7-2で文脈解決を追加）:
  // ①h3.change-title ②h3が無ければブロック先頭の非スキルh4のテキスト（候補名）
  // ③それも無ければ直近のh2セクション名（例: バグ修正＆QoLの変更のwhite-stoneブロック）
  //
  // S7 F-S7-2: ②の候補名は、まだ`extractGroups`で中間ラベル（S7 F-S7-1）に分割される前の
  // 「ブロック先頭h4の生テキスト」を使う（h4見出しが個別名の中間ラベルで細分された結果の
  // groups[0]は個別実体名（例「アカリ」）になり得るため、名前決定はそれと切り離す）。
  // 候補名が「チャンピオン/アイテム/オーグメント/システム/ルーン/バグ修正/アリーナ」等の
  // 総称バケット語そのもの（`kindFromSection(candidate) !== "other"`で判定）の場合は、対象全体が
  // 実際には複数種別・複数対象にまたがる集約ブロック（実データ確認済み: アリーナ）であることが
  // 多く、その総称をそのまま対象名にすると誤解を招くため使わず、セクション名にフォールバックする
  // （例:「アリーナ」節の対象名が「チャンピオン」になってしまう問題の解消）。
  let name = h3Name;
  if (!name) {
    const firstH4 = findH4Matches(blockHtml)[0];
    const candidate = firstH4 ? textOf(firstH4.inner) || undefined : undefined;
    const candidateKey = candidate ? abilityKeyFromName(candidate) : undefined;
    const consumeCandidate = () => {
      name = candidate;
      // 対象名として消費した見出しは、先頭グループの見出しとしての二重表示を避けるため無名に戻す
      // （S6からの既存挙動を維持。中間ラベル分割で先頭グループの見出しが既に個別名等へ変わっている
      // 場合はこの限りではない＝abilityNameが候補と一致する場合のみ戻す）。
      if (groups[0] && groups[0].abilityName === candidate) {
        groups = [{ changes: groups[0].changes }, ...groups.slice(1)];
      }
    };
    if (candidate && !candidateKey && kindFromSection(candidate) === "other") {
      consumeCandidate();
    } else if (section && section.trim().length > 0) {
      name = section.trim();
    } else if (candidate && !candidateKey) {
      // セクション名すら無い最終手段: 総称であっても候補名を使う（何も無いよりまし、捏造しない）
      consumeCandidate();
    }
  }
  if (!name) return null; // 対象名を一切取得できない場合は抽出不能として捨てる(捏造しない)

  // 有効な変更が1件も無いブロックは装飾のみ(スキン紹介・パッチハイライト等)とみなして捨てる
  // (実データ確認済み: white-stoneブロックの検出範囲を広げたことで混入する非パッチ変更ノイズの除外)。
  const totalChanges = groups.reduce((sum, g) => sum + g.changes.length, 0);
  if (totalChanges === 0) return null;

  let kind: PatchChangeTarget["kind"];
  let id: string | undefined;
  const classified = rawIconUrl ? classifyIconUrl(rawIconUrl) : null;
  if (classified) {
    kind = classified.kind;
    id = classified.id;
  } else {
    kind = kindFromSection(section);
  }

  const target: PatchChangeTarget = { name, kind, groups };
  if (section) target.section = section;
  if (id) target.id = id;
  if (iconUrl) target.iconUrl = iconUrl;
  if (intent) target.intent = intent;
  return target;
}

/**
 * `<h3 class="change-detail-title...ability-title...">`や`<h4 class="change-detail-title...ability-title...">`
 * のうち、内部の`<img>`がチャンピオン/アイテムアイコン（DDragon `/img/champion|item/...`）に解決できる
 * ものを検出する（S7 F-S7-1）。大型パッチの「ミッドパッチアップデート」節等、`h3.change-title`を
 * 使わずに複数のチャンピオン/アイテムの変更を1つのブロックへ連続して列挙する構造
 * （実データ確認済み: 26.1/26.3）に対応するため、これらの見出しを対象の区切りとして扱う
 * （新規実装のためnpm依存追加なし、正規表現ベースの限定スキャンのみ）。
 * スキル見出し（Q/W/E/R/パッシブ等、spell/passiveアイコン）はclassifyIconUrlが
 * champion/item以外を返すため対象外（従来どおりextractGroupsのグループ内スキル見出しとして扱われる）。
 * 新アイテム等のCMSホスト画像（DDragon形式に一致しない）も対象外（従来どおり単一対象内のh4見出しのまま）。
 */
function findEntityHeadings(
  blockHtml: string,
): { start: number; end: number; name: string; kind: "champion" | "item"; id: string; rawIconUrl: string }[] {
  const re = /<h[34] class="change-detail-title[^"]*"[^>]*>([\s\S]*?)<\/h[34]>/g;
  const out: { start: number; end: number; name: string; kind: "champion" | "item"; id: string; rawIconUrl: string }[] =
    [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(blockHtml))) {
    const rawIconUrl = firstImgSrc(m[1]);
    if (!rawIconUrl) continue;
    const classified = classifyIconUrl(rawIconUrl);
    if (!classified || (classified.kind !== "champion" && classified.kind !== "item")) continue;
    const name = textOf(m[1]);
    if (!name) continue;
    out.push({ start: m.index, end: m.index + m[0].length, name, kind: classified.kind, id: classified.id, rawIconUrl });
  }
  return out;
}

/**
 * `h3.change-title`を持たないブロックの中に、チャンピオン/アイテムアイコン付きの見出し
 * （`findEntityHeadings`）が1件以上見つかった場合に、そのブロックを複数の独立した
 * `PatchChangeTarget`（対象ごと）に分割する（S7 F-S7-1: 大型パッチの「ミッドパッチアップデート」節
 * 実データ確認済み。従来はこれらが1つのブロックとして扱われ、複数チャンピオン/アイテムのスキル別
 * 変更グループが対象名不明瞭のまま1つの対象に混在していた＝誤帰属に近い問題を解消）。
 * エンティティ見出し以外の見出し（スキルキー見出しを除く「プレーンなh4」、例: 実データ確認済みの
 * 「Clash最新スケジュール」「バグ修正」「既知の問題」等）も区切りとして扱い、直前のエンティティの
 * 変更に混入させない（対象名はF-S7-2と同じ総称バケット語の判定＋セクション名フォールバックを使う）。
 * 最初のエンティティ見出しより前の内容（導入のblockquote等）は対象を組み立てられないため無視する。
 */
function splitEntityBlock(
  blockHtml: string,
  section: string | undefined,
  entityHeadings: ReturnType<typeof findEntityHeadings>,
): PatchChangeTarget[] {
  const h4Matches = findH4Matches(blockHtml);
  type Boundary =
    | { start: number; end: number; kind: "entity"; name: string; entityKind: "champion" | "item"; id: string; rawIconUrl: string }
    | { start: number; end: number; kind: "plain"; name: string };

  const entityStarts = new Set(entityHeadings.map((e) => e.start));
  const plainBoundaries: Boundary[] = h4Matches
    .filter((h4) => h4.start > entityHeadings[0].start && !entityStarts.has(h4.start))
    .filter((h4) => !abilityKeyFromName(textOf(h4.inner)))
    .map((h4) => ({ start: h4.start, end: h4.end, kind: "plain" as const, name: textOf(h4.inner) }));

  const boundaries: Boundary[] = [
    ...entityHeadings.map((e) => ({
      start: e.start,
      end: e.end,
      kind: "entity" as const,
      name: e.name,
      entityKind: e.kind,
      id: e.id,
      rawIconUrl: e.rawIconUrl,
    })),
    ...plainBoundaries,
  ].sort((a, b) => a.start - b.start);

  const targets: PatchChangeTarget[] = [];
  for (let i = 0; i < boundaries.length; i++) {
    const b = boundaries[i];
    const regionEnd = i + 1 < boundaries.length ? boundaries[i + 1].start : blockHtml.length;
    const region = blockHtml.slice(b.end, regionEnd);
    const groups = extractGroups(region);
    const totalChanges = groups.reduce((sum, g) => sum + g.changes.length, 0);
    if (totalChanges === 0) continue; // 見出しのみ・変更が取れない区切りはゴーストとして捨てる
    const intent = extractCombinedIntent(region);

    let name: string | undefined;
    let kind: PatchChangeTarget["kind"];
    let id: string | undefined;
    let iconUrl: string | undefined;
    if (b.kind === "entity") {
      name = b.name;
      kind = b.entityKind;
      id = b.id;
      iconUrl = normalizePatchIconUrl(b.rawIconUrl);
    } else {
      // F-S7-2と同じ判定: 総称バケット語ならセクション名にフォールバックする
      const candidateKey = abilityKeyFromName(b.name);
      if (b.name && !candidateKey && kindFromSection(b.name) === "other") {
        name = b.name;
      } else if (section && section.trim().length > 0) {
        name = section.trim();
      } else {
        name = b.name;
      }
      kind = kindFromSection(section);
    }
    if (!name) continue;

    const target: PatchChangeTarget = { name, kind, groups };
    if (section) target.section = section;
    if (id) target.id = id;
    if (iconUrl) target.iconUrl = iconUrl;
    if (intent) target.intent = intent;
    targets.push(target);
  }
  return targets;
}

/**
 * 公式パッチノートの生HTMLから `PatchChangeTarget[]` を抽出する（純関数・AI不使用）。
 * `<h2>` を辿ってセクション見出しを保持し、対象ブロック単位で対象を組み立てる。対象ブロックは
 * `patch-change-block` に加え、`patch-change-block`クラスを持たない`white-stone accent-before`
 * 直下ブロック（実データ確認済み: バグ修正＆QoLの変更・アリーナ等）も対象にする（パッチ記事刷新S6）。
 * 取得失敗・構造不一致・空入力では例外を投げず `[]` を返す（呼び出し側は既存の平テキスト経路に
 * フォールバックできる）。
 */
export function parsePatchNotesHtml(html: string): PatchChangeTarget[] {
  try {
    if (!html || typeof html !== "string") return [];
    const cleaned = stripScriptsAndStyles(html);

    type Marker = { index: number; kind: "section" | "block"; section?: string };
    const markers: Marker[] = [];

    const h2Re = /<h2[^>]*>([\s\S]*?)<\/h2>/g;
    let hm: RegExpExecArray | null;
    while ((hm = h2Re.exec(cleaned))) {
      const label = textOf(hm[1]);
      if (label) markers.push({ index: hm.index, kind: "section", section: label });
    }

    const blockRe = /<div class="(?:patch-change-block\b[^"]*|white-stone accent-before)"/g;
    const blockStarts: number[] = [];
    let bm: RegExpExecArray | null;
    while ((bm = blockRe.exec(cleaned))) {
      blockStarts.push(bm.index);
      markers.push({ index: bm.index, kind: "block" });
    }
    if (blockStarts.length === 0) return [];

    markers.sort((a, b) => a.index - b.index);

    const targets: PatchChangeTarget[] = [];
    let currentSection: string | undefined;
    for (const marker of markers) {
      if (marker.kind === "section") {
        currentSection = marker.section;
        continue;
      }
      // "block"マーカー: このブロックの終端は次のブロック開始位置(無ければ末尾)。
      const nextBlockStart = blockStarts.find((idx) => idx > marker.index);
      const blockHtml = cleaned.slice(marker.index, nextBlockStart ?? cleaned.length);
      try {
        // h3.change-titleを持たないブロックにチャンピオン/アイテムアイコン付き見出しが見つかれば、
        // 複数対象への分割を優先する（S7 F-S7-1、大型パッチのミッドパッチアップデート節対応）。
        const hasH3ChangeTitle = /<h3 class="change-title"[^>]*>/.test(blockHtml);
        const entityHeadings = hasH3ChangeTitle ? [] : findEntityHeadings(blockHtml);
        if (entityHeadings.length > 0) {
          targets.push(...splitEntityBlock(blockHtml, currentSection, entityHeadings));
        } else {
          const target = parseBlock(blockHtml, currentSection);
          if (target) targets.push(target);
        }
      } catch {
        // 1ブロックの構造不一致は読み飛ばす(本体を止めない・他ブロックの抽出は継続する)
        continue;
      }
    }
    return targets;
  } catch {
    return [];
  }
}
