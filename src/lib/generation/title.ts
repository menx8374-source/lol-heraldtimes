/**
 * 煽り速報タイトル生成と品質チェッカー（F8, 中核差別化機能）。
 *
 * タイトルは2系統: (1) ルールベースの決定論生成 generateHookTitle（ラベル語彙・具体要素抽出・
 * 感情フック語尾・文字数を満たす。API キー不要。判定ロジックは checkTitleQuality と語彙・抽出関数を
 * 共有するためズレない）。(2) 拡張E24でLLM経由の generateHookTitleLLM を追加（本文の意味を踏まえた
 * 惹きつけるタイトルを生成し、checkLLMTitleQuality で検証。不通過・空・APIエラー時は必ず(1)へ
 * フォールバックする）。GENERATION_MODE=live かつ ANTHROPIC_API_KEY 設定時のみ(2)が本接続で動く。
 *
 * 「本文に存在しない固有名詞を捏造しない」を担保するため、具体要素は必ず
 * extractConcreteElements が sourceText から取り出した「そのままの部分文字列」だけを使う
 * （新しい文字列を組み立てて主張することはしない）。
 */
import { stripNgWords } from "@/lib/moderation/ng-words";
import type { LLMClient } from "@/lib/generation/llm-client";

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

/** 句読点等、テキストを自然に区切れる文字（この文字の直後で切れば読める形で完結する）。 */
const NATURAL_BREAK_CHARS = ["。", "、", "！", "？"];

/**
 * pool（本文+フィラー）から targetLen（全角相当）以内で、句読点等の自然な区切りまでの
 * テキストを切り出す（拡張E19: 省略記号「…」は使わず、完結した読める形にする）。
 * targetLen以内に自然な区切りが1つも見つからない場合は、単語の途中でぶつ切りにするより
 * 潔く諦めて空文字を返す（呼び出し側がフィラー無しの完結したタイトルにフォールバックする）。
 */
function buildCoreText(pool: string, targetLen: number): string {
  if (targetLen <= 0) return "";
  const taken = takeZenkaku(pool, targetLen);
  if (taken.length >= pool.length) return taken; // プール全体がそのまま収まった(フィラーが十分長いため通常は稀)

  for (let i = taken.length - 1; i >= 0; i--) {
    if (NATURAL_BREAK_CHARS.includes(taken[i])) {
      // 区切り文字自体は含めない(呼び出し側で「、」を付けてフックへ接続するため)。
      return taken.slice(0, i);
    }
  }
  return "";
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
 * 主語とフックを1つの文につなげる。フック自身が読点「、」から始まる場合（例「、ついに判明」）は
 * 主語側で重ねて読点を付けない（「主語、、フック」という不自然な二重読点を避ける。拡張E19 F-E19-4）。
 */
export function joinSubjectAndHook(subject: string, hook: string): string {
  return hook.startsWith("、") ? `${subject}${hook}` : `${subject}、${hook}`;
}

/**
 * 記事化候補（原題+本文）からまとめ速報型タイトルを1本生成する。
 * 冒頭に【ラベル】、本文由来の具体要素、末尾に感情フックを含み、文字数を20〜48（全角相当）に収める。
 * 省略記号「…」は使わない。文字数がMIN_TITLE_LENGTHに満たない場合でも、本文中に自然に切れる
 * 区切りが見つからなければ無理に埋めず、完結した「【ラベル】主語＋フック」を返す（拡張E19 F-E19-4）。
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

  const fixedText = `${prefix}${joinSubjectAndHook(subject, hook)}`;
  const fixedLen = zenkakuLength(fixedText);

  if (fixedLen > MAX_TITLE_LENGTH) {
    // 極端に長い主語・フックの組み合わせになった場合のみ、主語を切り詰めて再構成する。
    const overBy = fixedLen - MAX_TITLE_LENGTH;
    const targetSubjectLen = Math.max(1, zenkakuLength(subject) - overBy);
    const trimmedSubject = takeZenkaku(subject, targetSubjectLen) || subject.slice(0, 1);
    return `${prefix}${joinSubjectAndHook(trimmedSubject, hook)}`;
  }

  if (fixedLen >= MIN_TITLE_LENGTH) {
    return fixedText;
  }

  // 文字数が足りない場合、本文由来のテキスト(+安全な汎用フィラー)から自然な区切りまでを
  // 【主語】と【フック】の間に挟んで近づける。MAX_TITLE_LENGTHの許容枠いっぱいまでの範囲で
  // 直近の自然な区切り(句読点)を探す（できるだけMIN_TITLE_LENGTHに近づけるため）。
  // 自然に切れる箇所が全く見つからなければ「…」や不自然な埋め文字は使わず、
  // 完結した fixedText をそのまま返す(MIN_TITLE_LENGTH未満でも許容)。
  const maxCoreLen = MAX_TITLE_LENGTH - fixedLen;
  if (maxCoreLen <= 0) return fixedText;

  const contentPool = input.content.trim();
  const contextPool = stripNgWords(
    contentPool.length > 0 ? `${contentPool}。${FILLER_PADDING}` : FILLER_PADDING,
  );
  let core = buildCoreText(contextPool, maxCoreLen);
  if (core.length === 0) return fixedText;

  // core（本文抜粋）が subject（主語）と同じ語で始まる場合、独立した主語部分を組み込むと
  // 「主語、主語は…」のように重複してしまう（拡張E20 F-E20-1）。この場合は core 自体に
  // 主語が含まれているため、独立した主語部分を省いて組み立てる。判定は都度の core に対して
  // 行う（ガードループで core が主語より短く縮んだ場合は、独立主語を復活させて主語を残す）。
  const buildTitle = (c: string) =>
    c.startsWith(subject) ? `${prefix}${c}${hook}` : `${prefix}${subject}、${c}${hook}`;

  let title = buildTitle(core);

  // 丸め誤差(半角/全角混在)でMAXを僅かに超えるケースのみ、core を短縮して収める(「…」は付けない)。
  let guard = 0;
  while (zenkakuLength(title) > MAX_TITLE_LENGTH && core.length > 0 && guard < 100) {
    core = core.slice(0, -1);
    title = buildTitle(core);
    guard++;
  }
  if (core.length === 0) return fixedText;

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

/**
 * LLM(F-E24-2)に渡すタイトル生成プロンプトのsystem指示。本文はそのまま渡す(要約させない＝
 * タイトル生成のみ)。捏造禁止・文字数・ラベル・省略記号禁止をここで指示する。
 */
export const LLM_TITLE_SYSTEM_PROMPT =
  "あなたはLoLまとめ速報の編集者です。次に渡されるスレッド/投稿の内容（原題+本文）を踏まえて、" +
  "日本語で人を惹きつける完結したまとめ速報風タイトルを1つだけ作ってください。" +
  "冒頭に【速報】【悲報】【朗報】【議論】【海外の反応】等のラベルを【】付きで置いてください。" +
  "本文に存在しない固有名詞や事実を捏造しないでください。全角20〜48文字程度に収めてください。" +
  "省略記号「…」は使わないでください。出力はタイトルの文字列のみとし、説明や前置き、" +
  "引用符・改行は付けないでください。";

/**
 * LLM経由でタイトルを生成する（拡張E24 F-E24-2）。本文の意味を踏まえた「【ラベル】＋惹きつける
 * 完結タイトル」の生成をLLMClientに委ねるが、生成結果は必ず stripNgWords（NGワード除去）→
 * checkTitleQuality（ラベル/具体要素/フック/文字数の検証）を通す。
 * 検証不通過・空文字・APIエラー（LLMClient実装は失敗時に例外を投げず空文字を返す設計だが、
 * 念のためここでも例外を握りつぶす）の場合は必ずルールベースの generateHookTitle にフォールバックする
 * （＝呼び出し側から見てタイトルが空や例外になることはない）。
 */
/**
 * LLM生成タイトル用の緩めの品質判定（拡張E24）。ルールベースの固定フック語彙(HOOKS)への一致は
 * 要求しない（LLMは自然な言い回しの完結タイトルを作るため）。捏造防止のため本文由来の具体要素を
 * 1つ以上含むこと・冒頭に既定ラベル・文字数（MIN〜MAX）は引き続き必須とする。
 */
export function checkLLMTitleQuality(title: string, sourceText: string): boolean {
  const labelMatch = title.match(/^【([^】]+)】/);
  const hasLabel = !!labelMatch && (LABELS as readonly string[]).includes(labelMatch[1]);
  const hasConcreteElement = containsConcreteElement(title, sourceText);
  const length = zenkakuLength(title);
  const lengthOk = length >= MIN_TITLE_LENGTH && length <= MAX_TITLE_LENGTH;
  return hasLabel && hasConcreteElement && lengthOk;
}

export async function generateHookTitleLLM(
  llmClient: LLMClient,
  input: TitleGenInput,
): Promise<string> {
  const sourceText = `${input.title}\n${input.content}`;
  try {
    const raw = await llmClient.generate([
      { role: "system", content: LLM_TITLE_SYSTEM_PROMPT },
      { role: "user", content: sourceText },
    ]);
    const candidate = stripNgWords(raw.trim());
    if (candidate.length === 0) {
      return generateHookTitle(input);
    }
    // LLMは自然な言い回しの完結タイトルを作るため、ルールベースの固定フック語彙(HOOKS)への
    // 一致は要求しない（要求するとほぼ全てフォールバックし本来の意図＝LLMタイトル採用が達成できない）。
    // 捏造防止の具体要素・冒頭ラベル・文字数は checkLLMTitleQuality で引き続き必須とする（拡張E24）。
    if (!checkLLMTitleQuality(candidate, sourceText)) {
      return generateHookTitle(input);
    }
    return candidate;
  } catch {
    return generateHookTitle(input);
  }
}
