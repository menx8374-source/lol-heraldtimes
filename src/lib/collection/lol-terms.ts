/**
 * LoL固有語の判定（reactqual-S1 F-RQ1-2）。
 *
 * X検索クエリの裸`LoL`/`lol`は「lol＝笑」に誤ヒットし得るため、Xの関連判定（filter.ts）は
 * tweet全文にLoL固有語が含まれるかを再チェックする。ここに置く判定語は**曖昧でないLoL固有語のみ**
 * とし、裸"lol"・"笑"と紛らわしい単独語は含めない（誤混入の根絶が目的のため）。
 *
 * 収集層（collection/）に閉じ、generation層への逆importは行わない
 * （x.ts/filter.tsからのみ参照される想定）。
 */

/**
 * 部分一致で判定する語（すべて小文字）。多語フレーズ・日本語表記・ハッシュタグ・
 * チャンピオン名など、部分文字列一致でも誤爆しにくい語のみを置く。
 *
 * `msi`/`worlds`は英単語として曖昧（MSI=PCブランド、worlds=一般語）なため、
 * 単語境界一致にしても誤爆が残る（例:"MSI laptop"）。再チェックの安全網としては
 * 非LoLの文を通してしまう害の方が大きいため、ここには含めない
 *（config.tsのDEFAULT_LOL_KEYWORDS側の既定クエリには残してよい）。
 *
 * "アーリ"（チャンピオン名Aatroxのカタカナ略）は"アーリーアクセス"等に部分一致して
 * 誤爆するため、部分一致群からは除外する（単語境界一致にしても短いカタカナ語の
 * 境界性質上、誤爆を防ぎきれない）。
 */
export const LOL_SPECIFIC_TERMS: string[] = [
  "league of legends",
  "リーグ・オブ・レジェンド",
  "リーグオブレジェンド",
  "リグオブ",
  "#lol",
  "#leagueoflegends",
  "世界大会",
  // 主要チャンピオン（DEFAULT_LOL_KEYWORDSと同じ厳選ラインナップ。アーリは誤爆のため除外）。
  "yasuo",
  "ヤスオ",
  "アジール",
  "ゼド",
  "ジンクス",
  "リー・シン",
  "ルシアン",
  "カタリナ",
  "イレリア",
  "ヴェイン",
  "セト",
  "ヨネ",
  "アカリ",
];

/**
 * 単語境界一致で判定する語（すべて小文字）。ASCII略語で低曖昧だが、部分一致だと
 * 別の単語に埋め込まれて誤爆する（例:"election"⊃"lec"、"MSI"のような文脈と紛れる）。
 * `\bTERM\b`相当（ASCII英数字境界。日本語隣接は\wでないため境界成立）で判定する。
 */
const WORD_BOUNDARY_TERMS: string[] = ["ljl", "lck", "lpl", "lec"];

const wordBoundaryPatterns = WORD_BOUNDARY_TERMS.map(
  (term) => new RegExp(`\\b${term}\\b`, "i"),
);

/** textにLoL固有語（部分一致群・単語境界群のいずれか）が含まれるか。 */
export function containsLoLTerm(text: string): boolean {
  const lower = text.toLowerCase();
  if (LOL_SPECIFIC_TERMS.some((term) => lower.includes(term))) return true;
  return wordBoundaryPatterns.some((pattern) => pattern.test(text));
}
