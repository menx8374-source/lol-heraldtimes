/**
 * 翻訳用のLoLスラング英日対訳表（成長G4 F-G4-2）。
 *
 * ⚠ これは reddit反応記事のレス翻訳（compose.ts の `REACTION_TRANSLATE_SYSTEM_PROMPT`）専用の
 * 「用語統一のための対訳データ」であり、`src/lib/lol-data/glossary.ts`（用語ページ表示用の日本語解説
 * 辞典）とは無関係。このファイルは glossary.ts をimportしないし、glossary.ts からもimportされない。
 *
 * 収録基準: 誤解の余地がなく、日本のプレイヤーコミュニティで定着した言い回しに一意に対応付けられる
 * スラングのみを収録する（曖昧・文脈依存で訳が割れるものは入れない）。
 */

export type TranslationGlossaryEntry = {
  /** 英語スラング・略語（表記ゆれの代表形）。 */
  en: string;
  /** 日本のプレイヤーが使う自然な言い回し・ニュアンス。 */
  ja: string;
};

export const TRANSLATION_GLOSSARY: TranslationGlossaryEntry[] = [
  { en: "inting / int / intentional feeding", ja: "わざと負け(利敵行為)" },
  { en: "diff (例: \"mid diff\")", ja: "（レーン/ロール）差でボロ負け" },
  { en: "hard stuck", ja: "万年〇〇帯から上がれない" },
  { en: "gap", ja: "力量差" },
  { en: "throw", ja: "勝ち試合を落とす" },
  { en: "smurf", ja: "サブ垢の格上" },
  { en: "griefing", ja: "味方妨害" },
  { en: "ff", ja: "降参" },
  { en: "gg", ja: "お疲れ/good game" },
  { en: "nerf", ja: "弱体化" },
  { en: "buff", ja: "強化" },
  { en: "broken", ja: "ぶっ壊れ" },
  { en: "OP (overpowered)", ja: "強すぎ" },
  { en: "gutted", ja: "過剰弱体でゴミ化" },
  { en: "feed", ja: "敵に塩(キル)を献上" },
  { en: "clutch", ja: "大事な場面での好プレー" },
  { en: "carry", ja: "試合を牽引" },
  { en: "tilt / tilted", ja: "熱くなって崩れる" },
];

/**
 * 対訳表を system プロンプトに差し込む用の箇条書きテキストへ整形する純関数（決定論）。
 * 日付・乱数など動的な値は一切含めない（プレフィックスキャッシュのためsystemを完全にフリーズする）。
 */
export function buildTranslationGlossaryText(): string {
  const lines = TRANSLATION_GLOSSARY.map((entry) => `- ${entry.en} → ${entry.ja}`);
  return lines.join("\n");
}
