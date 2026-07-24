/**
 * 煽り速報タイトル生成と品質チェッカー（F8, 中核差別化機能）。
 *
 * ⚠ このスプリントもLLMはモック実装（ユーザー決定 2026-07-25）。タイトル生成は LLMClient を
 * 経由せず、ラベル語彙・具体要素抽出・感情フック語尾・文字数を満たすルールベースの決定論ロジックで
 * 行う（API キー不要）。判定ロジック（ラベル/具体要素/感情フック/文字数）は generateHookTitle（生成）と
 * checkTitleQuality（採点）の両方が同じ語彙・抽出関数を参照するため、生成した語彙をチェッカーが
 * 認識できないというズレは起きない。
 *
 * 「本文に存在しない固有名詞を捏造しない」を担保するため、具体要素は必ず
 * extractConcreteElements が sourceText から取り出した「そのままの部分文字列」だけを使う
 * （新しい文字列を組み立てて主張することはしない）。
 */
import { stripNgWords } from "@/lib/moderation/ng-words";

/** 冒頭ラベル語彙。生成タイトルは必ずこの中から1つを【】で囲んで先頭に付ける。 */
export const LABELS = ["速報", "悲報", "朗報", "朗報か？", "議論", "海外の反応"] as const;
export type Label = (typeof LABELS)[number];

/** 感情フック（好奇心ギャップ／驚き／煽りの語尾）。生成側はこの中から1つを選び末尾に付ける。 */
export const HOOKS = [
  "だった件",
  "がヤバいと話題に",
  "、ついに判明",
  "で大荒れ",
  "に阿鼻叫喚",
  "、まさかの展開に",
  "に賛否両論",
  "、衝撃の内容が判明",
  "が話題に",
  "を巡り議論に",
] as const;

/** 感情フックの判定パターン（チェッカー用）。HOOKS の各要素は必ずこのいずれかにマッチする。 */
export const HOOK_PATTERNS: RegExp[] = [
  /だった件/,
  /がヤバい/,
  /ヤバいと話題/,
  /判明/,
  /で大荒れ/,
  /阿鼻叫喚/,
  /まさかの/,
  /賛否両論/,
  /衝撃/,
  /が話題に/,
  /を巡り議論/,
];

/** タイトル文字数（全角相当）の許容範囲。 */
export const MIN_TITLE_LENGTH = 20;
export const MAX_TITLE_LENGTH = 48;

// 具体要素や文脈の穴埋めは 5ch/Reddit 等ユーザー投稿由来の生コンテンツから抜き出すため、
// 差別的・攻撃的表現の混入防止に F9 の moderation/ng-words.ts の stripNgWords を直接適用する
// （NGワード語彙は moderation 側に一元化。ここで別途語彙を持たない）。

/** ASCII(半角)は0.5、それ以外(全角)は1として数える「全角文字相当」の長さ。 */
export function zenkakuLength(text: string): number {
  let total = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    total += code <= 0xff ? 0.5 : 1;
  }
  return total;
}

// --- 具体要素抽出（すべて sourceText の部分文字列そのものを返す。捏造しない） ---

const PATCH_WITH_LABEL = /パッチ\s?\d{1,2}(?:\.\d{1,2}){1,2}/;
const VERSION_BARE = /\d{1,2}\.\d{1,2}(?:\.\d{1,2})?/;
const NUMBER_WITH_UNIT = /\d+(?:\.\d+)?\s?(?:%|パーセント|ダメージ|秒|体力|人|連勝|位|万|億|回)/;
const BARE_NUMBER = /\d{2,}/;

/** LoLチャンピオン名（日本語表記/英語表記）。網羅的ではないが主要チャンピオンをカバーする。 */
const CHAMPIONS = [
  "アリスター", "アニビア", "アニー", "アフェリオス", "アッシュ", "アジール", "バード", "アムム",
  "ブリッツクランク", "ブランド", "ブラウム", "ケイトリン", "カミール", "キャシオペア", "チョガス",
  "ダリウス", "ダイアナ", "ドレイヴン", "エコー", "イブリン", "エズリアル", "フィオラ", "フィズ",
  "ガリオ", "ガングプランク", "ガレン", "グラガス", "グレイブス", "グウェン", "ヘカリム",
  "ハイマーディンガー", "イラオイ", "イレリア", "ジャンナ", "ジャックス", "ジェイス", "ジン",
  "ジンクス", "カイサ", "カリスタ", "カルマ", "カーサス", "カサディン", "カタリナ", "ケイル", "ケイン",
  "ケネン", "カジックス", "キンドレッド", "クレッド", "コグマウ", "ルブラン", "リー・シン", "レオナ",
  "リリア", "リサンドラ", "ルシアン", "ルル", "ラックス", "マルファイト", "マルザハール", "マオカイ",
  "マスターイー", "ミス・フォーチュン", "ウーコン", "モルデカイザー", "モルガナ", "ナミ", "ナサス",
  "ノーティラス", "ニーコ", "ニダリー", "ニーラ", "ノクターン", "ヌヌ", "オラフ", "オリアナ", "オーン",
  "パンテオン", "ポッピー", "パイク", "キアナ", "クイン", "ラカン", "ラムス", "レク・サイ", "レル",
  "レネクトン", "レンガー", "リヴェン", "ランブル", "ライズ", "サミーラ", "セジュアニ", "セナ",
  "セラフィン", "セト", "ショウコ", "シェン", "シヴァーナ", "シンジド", "サイオン", "シヴィア",
  "スカーナー", "ソナ", "ソラカ", "スウェイン", "サイラス", "シンドラ", "タム・ケンチ", "タリヤ",
  "タロン", "タリック", "ティーモ", "スレッシュ", "トリスターナ", "トランドル", "トリンダメア",
  "ツイステッド・フェイト", "トゥイッチ", "ウディア", "アーゴット", "ヴァルス", "ヴェイン",
  "ベイガー", "ヴェルコズ", "ヴェックス", "ヴァイ", "ヴィエゴ", "ヴィクター", "ヴラディミア",
  "ヴォリベア", "ワーウィック", "ザヤ", "ゼラス", "シン・ジャオ", "ヤスオ", "ヨネ", "ヨリック",
  "ユーミ", "ザック", "ゼド", "ゼリ", "ジグス", "ジリアン", "ゾーイ", "ザイラ", "アーリ", "アカリ",
  "Yasuo", "Zed", "Ahri", "Jinx", "Lux", "Akali", "Ezreal", "Vayne", "Thresh", "Viego", "Sett",
];

/** 大会・イベント名。 */
const TOURNAMENTS = [
  "Worlds", "MSI", "LCK", "LPL", "LEC", "LCS", "世界大会", "全国大会", "選手権", "リージョナルファイナル",
];

/** 一般的なゲーム用語（固有名詞ではない）を汎用カタカナ抽出の誤検知から除外するための除外リスト。 */
const PROPER_NOUN_STOPLIST = new Set([
  "パッチ", "ノート", "コメント", "システム", "レベル", "ダメージ", "モンスター", "バランス",
  "アップデート", "ユーザー", "プレイヤー", "チーム", "スキル", "アイテム", "ゲーム", "ランク",
  "シーズン", "マップ", "エリア", "ライン", "ジャングル", "サポート", "スレッド", "リプレイ",
  "サーバー", "クライアント", "ロール", "キャラ", "ポイント", "レジェンド",
]);

function firstMatchFromList(sourceText: string, list: readonly string[]): string | null {
  for (const item of list) {
    if (sourceText.includes(item)) return item;
  }
  return null;
}

function findGenericProperNoun(sourceText: string): string | null {
  const katakanaMatches = sourceText.match(/[ァ-ヶー・]{3,}/gu) ?? [];
  for (const m of katakanaMatches) {
    if (!PROPER_NOUN_STOPLIST.has(m)) return m;
  }
  const englishMatches = sourceText.match(/[A-Z][a-zA-Z0-9]{1,}/g) ?? [];
  return englishMatches[0] ?? null;
}

/**
 * sourceText（記事化候補の原題+本文）から、タイトルに使える「実在する具体要素」の候補を
 * 優先度順（パッチ番号 > チャンピオン名 > 大会名 > バージョン番号 > 数値+単位 > 固有名詞 > 裸の数値）に
 * 抽出する。返す値はすべて sourceText の部分文字列そのもの（新規に文字列を組み立てない＝捏造しない）。
 */
export function extractConcreteElements(sourceText: string): string[] {
  const found: string[] = [];

  const patchMatch = sourceText.match(PATCH_WITH_LABEL)?.[0];
  if (patchMatch) found.push(patchMatch);

  const champion = firstMatchFromList(sourceText, CHAMPIONS);
  if (champion) found.push(champion);

  const tournament = firstMatchFromList(sourceText, TOURNAMENTS);
  if (tournament) found.push(tournament);

  const versionMatch = sourceText.match(VERSION_BARE)?.[0];
  if (versionMatch) found.push(versionMatch);

  const numberUnitMatch = sourceText.match(NUMBER_WITH_UNIT)?.[0];
  if (numberUnitMatch) found.push(numberUnitMatch);

  const properNoun = findGenericProperNoun(sourceText);
  if (properNoun) found.push(properNoun);

  const bareNumberMatch = sourceText.match(BARE_NUMBER)?.[0];
  if (bareNumberMatch) found.push(bareNumberMatch);

  return Array.from(new Set(found));
}

/** タイトルが sourceText 由来の具体要素を最低1つ含むか。 */
export function containsConcreteElement(title: string, sourceText: string): boolean {
  return extractConcreteElements(sourceText).some((el) => title.includes(el));
}

function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (Math.imul(h, 31) + s.charCodeAt(i)) >>> 0;
  }
  return h;
}

function pickFromArray<T>(arr: readonly T[], seed: string): T {
  const idx = hashString(seed) % arr.length;
  return arr[idx];
}

/** 内容穴埋め用の安全な汎用フィラー文（本文からの抽出が短すぎる場合の文字数調整に使う）。 */
const FILLER_PADDING =
  "詳しい経緯や反応の広がりについて多くのプレイヤーやファンから注目が集まっている。続報にも注目したい。";

/** text の先頭から、全角相当で targetLen を超えない範囲を切り出す。 */
function takeZenkaku(text: string, targetLen: number): string {
  if (targetLen <= 0) return "";
  let acc = "";
  let accLen = 0;
  for (const ch of text) {
    const w = zenkakuLength(ch);
    if (accLen + w > targetLen + 1e-9) break;
    acc += ch;
    accLen += w;
  }
  return acc;
}

/**
 * pool（本文+フィラー）から targetLen（全角相当）ぶんの文脈テキストを切り出す。
 * text-utils.ts の gistOf と同じ慣習で、途中で切れた場合は末尾に「…」を付け、
 * 生の文字列が単語の途中でぶつ切りになったまま見えるのを避ける。
 */
function buildCoreText(pool: string, targetLen: number): string {
  if (targetLen <= 0) return "";
  const taken = takeZenkaku(pool, Math.max(0, targetLen - 1));
  return taken.length < pool.length ? `${taken}…` : taken;
}

export type TitleGenInput = { title: string; content: string };

function fallbackSubject(input: TitleGenInput): string {
  const trimmedTitle = input.title.trim();
  if (trimmedTitle.length > 0) {
    const cut = takeZenkaku(trimmedTitle, 8);
    return cut.length > 0 ? cut : trimmedTitle.slice(0, 4);
  }
  return "今回の話題";
}

/**
 * 記事化候補（原題+本文）からまとめ速報型タイトルを1本生成する。
 * 冒頭に【ラベル】、本文由来の具体要素、末尾に感情フックを含み、文字数を20〜48（全角相当）に収める。
 */
export function generateHookTitle(input: TitleGenInput): string {
  const sourceText = `${input.title}\n${input.content}`;
  const elements = extractConcreteElements(sourceText);
  const rawSubject = elements[0] ?? fallbackSubject(input);
  const safeSubject = stripNgWords(rawSubject);
  const subject = safeSubject.length > 0 ? safeSubject : fallbackSubject(input);

  const label = pickFromArray(LABELS, sourceText);
  const hook = pickFromArray(HOOKS, `${sourceText}::hook`);
  const prefix = `【${label}】`;

  const fixedText = `${prefix}${subject}、${hook}`;
  const fixedLen = zenkakuLength(fixedText);

  if (fixedLen > MAX_TITLE_LENGTH) {
    // 極端に長い主語・フックの組み合わせになった場合のみ、主語を切り詰めて再構成する。
    const overBy = fixedLen - MAX_TITLE_LENGTH;
    const targetSubjectLen = Math.max(1, zenkakuLength(subject) - overBy);
    const trimmedSubject = takeZenkaku(subject, targetSubjectLen) || subject.slice(0, 1);
    return `${prefix}${trimmedSubject}、${hook}`;
  }

  if (fixedLen >= MIN_TITLE_LENGTH) {
    return fixedText;
  }

  // 文字数が足りない場合、本文由来のテキスト(+安全な汎用フィラー)で【主語】と【フック】の間を埋める。
  const minCoreLen = MIN_TITLE_LENGTH - fixedLen;
  const maxCoreLen = MAX_TITLE_LENGTH - fixedLen;
  const desiredCoreLen = Math.min(maxCoreLen, minCoreLen + 4);
  const contentPool = input.content.trim();
  const contextPool = stripNgWords(
    contentPool.length > 0 ? `${contentPool}。${FILLER_PADDING}` : FILLER_PADDING,
  );
  let core = buildCoreText(contextPool, desiredCoreLen);

  let title = `${prefix}${subject}、${core}${hook}`;

  // 丸め誤差(半角/全角混在)で範囲を僅かに外れるケースのみ、最終ガードとして微調整する。
  let guard = 0;
  while (zenkakuLength(title) < MIN_TITLE_LENGTH && guard < 20) {
    core += "。";
    title = `${prefix}${subject}、${core}${hook}`;
    guard++;
  }
  guard = 0;
  while (zenkakuLength(title) > MAX_TITLE_LENGTH && core.length > 0 && guard < 100) {
    core = core.slice(0, -1);
    title = `${prefix}${subject}、${core}${hook}`;
    guard++;
  }

  return title;
}

export type TitleQualityResult = {
  hasLabel: boolean;
  hasConcreteElement: boolean;
  hasEmotionalHook: boolean;
  lengthOk: boolean;
  length: number;
  passed: boolean;
};

/**
 * タイトル品質チェッカー（F8）。LLM非依存の決定論ロジックで、
 * ラベル有無／具体要素有無／感情フック合致／文字数範囲の4点を判定する。
 * sourceText には、そのタイトルの元になった記事化候補の原題+本文を渡す。
 */
export function checkTitleQuality(title: string, sourceText: string): TitleQualityResult {
  const labelMatch = title.match(/^【([^】]+)】/);
  const hasLabel = !!labelMatch && (LABELS as readonly string[]).includes(labelMatch[1]);
  const hasConcreteElement = containsConcreteElement(title, sourceText);
  const hasEmotionalHook = HOOK_PATTERNS.some((re) => re.test(title));
  const length = zenkakuLength(title);
  const lengthOk = length >= MIN_TITLE_LENGTH && length <= MAX_TITLE_LENGTH;

  return {
    hasLabel,
    hasConcreteElement,
    hasEmotionalHook,
    lengthOk,
    length,
    passed: hasLabel && hasConcreteElement && hasEmotionalHook && lengthOk,
  };
}
