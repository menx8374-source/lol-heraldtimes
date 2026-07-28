/**
 * 公式パッチノートHTMLの「DOM構造をそのまま辿る」純関数パーサ（パッチ記事刷新S1 F-S1-2）。
 *
 * 背景（docs/patch-accuracy-research.md §1〜§3）: 現行の `stripHtmlToText`（riot-datadragon.ts）は
 * 全タグを潰して平テキスト化するため、DOMの親子関係（どのチャンピオン配下の・どのスキルの・どの
 * ステータスか）が失われ、リスト外チャンピオン（例: コーキ）の変更が直前のチャンピオン節へ誤帰属する。
 * 本モジュールは平テキスト化を経由せず、生HTMLから `patch-change-block` 単位で対象を直接抽出することで
 * 誤帰属をゼロにする（対象IDもアイコンURLのファイル名から取るため、名前マップの欠落に依存しない）。
 *
 * 設計方針:
 * - AI不使用・純ルールのみ（DOMパース・分類・URL判定）。
 * - 新規npm依存を追加しない（`patch-change-block`/`change-title`/`change-detail-title` 等の
 *   セマンティッククラスは安定しており、正規表現ベースの限定スキャンで十分。research §8-1参照）。
 * - 逐語維持・捏造禁止: stat/before/after/intent はHTML本文の文字をタグ除去・エンティティ復号する
 *   だけで、値を作らない・書き換えない。
 * - 失敗に強い: 個々のブロックの構造不一致はそのブロックをスキップ（best-effort）、入力全体が
 *   不正・空でも例外を投げず `[]` を返す（本体を止めない）。
 */
import { decodeHtmlEntities } from "@/lib/collection/adapters/riot-datadragon";
import { isSafeImageUrl } from "@/lib/image-url";

export type PatchAbilityKey = "passive" | "Q" | "W" | "E" | "R" | "base";

export type PatchChange = {
  /** 変更対象のステータス名（例 "レベルアップごとの攻撃力"）。本文の文字そのまま。 */
  stat: string;
  /** 変更前の値（本文の文字そのまま。捏造しない）。 */
  before: string;
  /** 変更後の値（本文の文字そのまま。捏造しない）。 */
  after: string;
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
  /** アイコンURLのパス/セクション名から判定した対象種別。 */
  kind: "champion" | "item" | "rune" | "system" | "bugfix" | "other";
  /** アイコンURLのファイル名（例 "Corki"/"3168"）。名前マップに依存しないため、リスト外チャンピオンも解決できる。 */
  id?: string;
  /** ブロック先頭の対象アイコンURL。 */
  iconUrl?: string;
  /** `blockquote`のテキスト（変更意図）。 */
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

/** セクション見出し文字列から対象種別を推定する（アイコンが無い/判定できないブロックのフォールバック）。 */
function kindFromSection(section: string | undefined): PatchChangeTarget["kind"] {
  if (!section) return "other";
  if (section.includes("チャンピオン")) return "champion";
  if (section.includes("アイテム")) return "item";
  if (section.includes("バグ修正")) return "bugfix";
  if (section.includes("システム")) return "system";
  return "other";
}

/** h4見出しテキストの先頭トークンからスキルキーを判定する（判定できなければundefined）。 */
function abilityKeyFromName(abilityName: string): PatchAbilityKey | undefined {
  if (!abilityName) return undefined;
  if (abilityName.includes("パッシブ")) return "passive";
  if (abilityName === "基本ステータス" || abilityName.startsWith("基本ステータス")) return "base";
  const firstToken = abilityName.split(/[\s-]/)[0];
  if (firstToken === "Q" || firstToken === "W" || firstToken === "E" || firstToken === "R") return firstToken;
  return undefined;
}

/**
 * `<li>...</li>` 1件から stat/before/after を抽出する（逐語維持・捏造禁止）。
 * `stat` = li内先頭`<strong>`のテキスト（末尾の「：」「:」は区切り文字なので除去）。
 * `before` = 「：」または「:」と「⇒」の間のテキスト（コロンが無ければ先頭strong以降の残り全体）。
 * `after` = 「⇒」以降の`<strong>`のテキスト（無ければ⇒以降の残りテキスト全体）。
 * 「⇒」を含まない・stat/before/afterが空になる場合は抽出不能としてnullを返す（捏造しないため）。
 */
function parseChangeLi(liInner: string): PatchChange | null {
  const rawArrowIdx = liInner.indexOf("⇒");
  if (rawArrowIdx === -1) return null;

  const strongMatch = liInner.match(/<strong>([\s\S]*?)<\/strong>/);
  const statRaw = strongMatch ? textOf(strongMatch[1]) : "";
  const stat = statRaw.replace(/[:：]\s*$/, "").trim();

  const beforeRawHtml = liInner.slice(0, rawArrowIdx);
  const beforeText = textOf(beforeRawHtml);
  const colonIdx = Math.max(beforeText.lastIndexOf("："), beforeText.lastIndexOf(":"));
  let before: string;
  if (colonIdx !== -1) {
    before = beforeText.slice(colonIdx + 1).trim();
  } else if (stat && beforeText.startsWith(stat)) {
    before = beforeText.slice(stat.length).trim();
  } else {
    before = beforeText.trim();
  }

  const afterRawHtml = liInner.slice(rawArrowIdx + 1);
  const afterStrongMatch = afterRawHtml.match(/^\s*<strong>([\s\S]*?)<\/strong>/);
  const after = afterStrongMatch ? textOf(afterStrongMatch[1]) : textOf(afterRawHtml);

  if (!stat || !before || !after) return null;
  return { stat, before, after };
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

/**
 * ブロック内の`<h4 class="change-detail-title...">`をすべて見つけ、各h4の「次のh4手前まで」の区間から
 * グループを組み立てる。h4が1つも無いブロック(実データ確認済み: 一部アイテムはh4無しで
 * h3→blockquote→ulと直結する)は、ブロック全体から最初の`<ul>`を無名(abilityName無し)の
 * 単一グループとして拾う(変更を取りこぼさない)。
 */
function extractGroups(blockHtml: string): PatchChangeGroup[] {
  const h4Re = /<h4 class="change-detail-title[^"]*"[^>]*>([\s\S]*?)<\/h4>/g;
  const h4Matches: { start: number; end: number; inner: string }[] = [];
  let m: RegExpExecArray | null;
  while ((m = h4Re.exec(blockHtml))) {
    h4Matches.push({ start: m.index, end: m.index + m[0].length, inner: m[1] });
  }

  if (h4Matches.length === 0) {
    const ulMatch = blockHtml.match(/<ul[^>]*>([\s\S]*?)<\/ul>/);
    if (!ulMatch) return [];
    const changes = extractChangesFromUl(ulMatch[1]);
    return changes.length > 0 ? [{ changes }] : [];
  }

  const groups: PatchChangeGroup[] = [];
  for (let i = 0; i < h4Matches.length; i++) {
    const h4 = h4Matches[i];
    const regionEnd = i + 1 < h4Matches.length ? h4Matches[i + 1].start : blockHtml.length;
    const region = blockHtml.slice(h4.end, regionEnd);
    const ulMatch = region.match(/<ul[^>]*>([\s\S]*?)<\/ul>/);
    const changes = ulMatch ? extractChangesFromUl(ulMatch[1]) : [];
    const abilityName = textOf(h4.inner);
    // 正規化（akamaihdラッパー→DDragon直URL）はS3 F-S3-1で表示URLに適用する。壊れURL/非https等は
    // undefinedになり、group.abilityIconUrl自体を持たない（画像なしで崩れない）。
    const abilityIconUrl = normalizePatchIconUrl(firstImgSrc(h4.inner));
    const group: PatchChangeGroup = { changes };
    if (abilityName) {
      group.abilityName = abilityName;
      const key = abilityKeyFromName(abilityName);
      if (key) group.abilityKey = key;
    }
    if (abilityIconUrl) group.abilityIconUrl = abilityIconUrl;
    groups.push(group);
  }
  return groups;
}

/** `patch-change-block`1件（`blockHtml`）から1 `PatchChangeTarget` を組み立てる。構造不一致はnullを返す。 */
function parseBlock(blockHtml: string, section: string | undefined): PatchChangeTarget | null {
  const h3Match = blockHtml.match(/<h3 class="change-title"[^>]*>([\s\S]*?)<\/h3>/);
  const h3Name = h3Match ? textOf(h3Match[1]) : undefined;

  const blockquoteMatch = blockHtml.match(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/);
  const intent = blockquoteMatch ? textOf(blockquoteMatch[1]) || undefined : undefined;

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

  const groups = extractGroups(blockHtml);

  // h3が無いブロック(実データ確認済み: システム節の一部)は、最初のグループのabilityNameを
  // 対象名として流用する(総称に潰さず・捏造もしない。名前情報がDOM上そこにしか無いため)。
  const name = h3Name || groups.find((g) => g.abilityName)?.abilityName || "";
  if (!name) return null; // 対象名を一切取得できない場合は抽出不能として捨てる(捏造しない)

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
 * 公式パッチノートの生HTMLから `PatchChangeTarget[]` を抽出する（純関数・AI不使用）。
 * `<h2>` を辿ってセクション見出しを保持し、`patch-change-block` 単位で対象を組み立てる。
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

    const blockRe = /<div class="patch-change-block[^"]*"/g;
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
        const target = parseBlock(blockHtml, currentSection);
        if (target) targets.push(target);
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
