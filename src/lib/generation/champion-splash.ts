/**
 * チャンピオンの公式スプラッシュ画像URLに関する純粋関数群（拡張E38 F-E38-1）。
 * `@/lib/collection/adapters/http`（サーバー専用fetch）に依存しないため、クライアント
 * コンポーネント（サムネイル描画等）に安全に import できる。実ネット非依存（URL文字列の
 * 組み立てのみ）。
 *
 * `champion-thumbnail.ts` はこのモジュールの純粋関数を re-export するため、
 * `generate-article.ts` 等の既存の import 元はパス変更不要（挙動は不変）。
 */

/**
 * チャンピオンの公式スプラッシュ画像URL（1枚目, `_0`）を組み立てる。
 * 単純なURLテンプレートで、キー不要の公開CDN（拡張E20で一度削除したが本スプリントで再定義）。
 */
export function buildChampionSplashUrl(championId: string): string {
  return `https://ddragon.leagueoflegends.com/cdn/img/champion/splash/${championId}_0.jpg`;
}

/**
 * 決定論的フォールバック（拡張E37 F-E37-1、拡張E38 F-E38-3/4）用の、見栄えのする代表チャンピオン
 * ID固定プール。いずれも `_0`（1枚目）の公式スプラッシュが確実に存在するchampionId。
 */
export const CURATED_SPLASH_CHAMPION_IDS: readonly string[] = [
  "Ahri",
  "Yasuo",
  "Jinx",
  "LeeSin",
  "Lux",
  "Ezreal",
  "Zed",
  "Katarina",
  "MissFortune",
  "Thresh",
  "Garen",
  "Darius",
  "Vayne",
  "Kaisa",
  "Yone",
  "Sett",
  "Viego",
  "Jhin",
  "Akali",
  "Riven",
  "Irelia",
  "Lucian",
  "Kindred",
  "Aphelios",
];

/**
 * key（記事の安定キー。生成時は candidate.id、表示側フォールバックは slug を渡す想定）から
 * 決定論的にプール内indexを選ぶ。`Math.random`・`Date.now` は使わない（同じkeyなら常に同じ
 * indexになる）。
 */
function deterministicIndex(key: string, poolLength: number): number {
  let sum = 0;
  for (let i = 0; i < key.length; i++) {
    sum += key.charCodeAt(i);
  }
  return sum % poolLength;
}

/**
 * 反応記事（5ch/reddit）でチャンピオンが未検出/未保存のときの決定論フォールバック
 * （拡張E37 F-E37-1・拡張E38 F-E38-3/4）。key（生成時=candidate.id、表示側=slug）ごとに
 * 固定プールから1体を安定して選び、公式スプラッシュURLを返す。同じkeyなら常に同じチャンピオン、
 * 異なるkeyならプール内で分散する。実ネット非依存（URL文字列を組み立てるだけ）。
 */
export function pickDeterministicChampionSplashUrl(key: string): string {
  const index = deterministicIndex(key, CURATED_SPLASH_CHAMPION_IDS.length);
  return buildChampionSplashUrl(CURATED_SPLASH_CHAMPION_IDS[index]);
}

/**
 * ID不規則なチャンピオンを中心とした、表示名(日本語) → championId の純粋対応表（拡張E53 F-E53-2）。
 * 元は `champion-thumbnail.ts` の `FALLBACK_JP_NAME_TO_ID`（Data Dragon 取得失敗時のフォールバック表）
 * として定義されていたが、http非依存のこのモジュールに切り出し、`compose.ts`（detailedパッチ本文の
 * チャンピオン画像解決）からもhttp依存を持ち込まず参照できるようにする。`champion-thumbnail.ts` は
 * このモジュールから re-export して重複を避ける（既存挙動は不変）。
 */
export const JP_NAME_TO_CHAMPION_ID: Record<string, string> = {
  アリスター: "Alistar",
  アニビア: "Anivia",
  アニー: "Annie",
  アフェリオス: "Aphelios",
  アッシュ: "Ashe",
  アジール: "Azir",
  バード: "Bard",
  アムム: "Amumu",
  ブリッツクランク: "Blitzcrank",
  ブランド: "Brand",
  ブラウム: "Braum",
  ケイトリン: "Caitlyn",
  カミール: "Camille",
  キャシオペア: "Cassiopeia",
  チョガス: "Chogath",
  ダリウス: "Darius",
  ダイアナ: "Diana",
  ドレイヴン: "Draven",
  エコー: "Ekko",
  イブリン: "Evelynn",
  エズリアル: "Ezreal",
  フィオラ: "Fiora",
  フィズ: "Fizz",
  ガリオ: "Galio",
  ガングプランク: "Gangplank",
  ガレン: "Garen",
  グラガス: "Gragas",
  グレイブス: "Graves",
  グウェン: "Gwen",
  ヘカリム: "Hecarim",
  ハイマーディンガー: "Heimerdinger",
  イラオイ: "Illaoi",
  イレリア: "Irelia",
  ジャンナ: "Janna",
  ジャックス: "Jax",
  ジェイス: "Jayce",
  ジン: "Jhin",
  ジンクス: "Jinx",
  カイサ: "Kaisa",
  カリスタ: "Kalista",
  カルマ: "Karma",
  カーサス: "Karthus",
  カサディン: "Kassadin",
  カタリナ: "Katarina",
  ケイル: "Kayle",
  ケイン: "Kayn",
  ケネン: "Kennen",
  カジックス: "Khazix",
  キンドレッド: "Kindred",
  クレッド: "Kled",
  コグマウ: "KogMaw",
  ルブラン: "Leblanc",
  "リー・シン": "LeeSin",
  レオナ: "Leona",
  リリア: "Lillia",
  リサンドラ: "Lissandra",
  ルシアン: "Lucian",
  ルル: "Lulu",
  ラックス: "Lux",
  マルファイト: "Malphite",
  マルザハール: "Malzahar",
  マオカイ: "Maokai",
  マスターイー: "MasterYi",
  "ミス・フォーチュン": "MissFortune",
  ウーコン: "MonkeyKing",
  モルデカイザー: "Mordekaiser",
  モルガナ: "Morgana",
  ナミ: "Nami",
  ナサス: "Nasus",
  ノーティラス: "Nautilus",
  ニーコ: "Neeko",
  ニダリー: "Nidalee",
  ニーラ: "Nilah",
  ノクターン: "Nocturne",
  ヌヌ: "Nunu",
  オラフ: "Olaf",
  オリアナ: "Orianna",
  オーン: "Ornn",
  パンテオン: "Pantheon",
  ポッピー: "Poppy",
  パイク: "Pyke",
  キアナ: "Qiyana",
  クイン: "Quinn",
  ラカン: "Rakan",
  ラムス: "Rammus",
  "レク・サイ": "RekSai",
  レル: "Rell",
  レネクトン: "Renekton",
  レンガー: "Rengar",
  リヴェン: "Riven",
  ランブル: "Rumble",
  ライズ: "Ryze",
  サミーラ: "Samira",
  セジュアニ: "Sejuani",
  セナ: "Senna",
  セラフィン: "Seraphine",
  セト: "Sett",
  ショウコ: "Shaco",
  シェン: "Shen",
  シヴァーナ: "Shyvana",
  シンジド: "Singed",
  サイオン: "Sion",
  シヴィア: "Sivir",
  スカーナー: "Skarner",
  ソナ: "Sona",
  ソラカ: "Soraka",
  スウェイン: "Swain",
  サイラス: "Sylas",
  シンドラ: "Syndra",
  "タム・ケンチ": "TahmKench",
  タリヤ: "Taliyah",
  タロン: "Talon",
  タリック: "Taric",
  ティーモ: "Teemo",
  スレッシュ: "Thresh",
  トリスターナ: "Tristana",
  トランドル: "Trundle",
  トリンダメア: "Tryndamere",
  "ツイステッド・フェイト": "TwistedFate",
  トゥイッチ: "Twitch",
  ウディア: "Udyr",
  アーゴット: "Urgot",
  ヴァルス: "Varus",
  ヴェイン: "Vayne",
  ベイガー: "Veigar",
  ヴェルコズ: "Velkoz",
  ヴェックス: "Vex",
  ヴァイ: "Vi",
  ヴィエゴ: "Viego",
  ヴィクター: "Viktor",
  ヴラディミア: "Vladimir",
  ヴォリベア: "Volibear",
  ワーウィック: "Warwick",
  ザヤ: "Xayah",
  ゼラス: "Xerath",
  "シン・ジャオ": "XinZhao",
  ヤスオ: "Yasuo",
  ヨネ: "Yone",
  ヨリック: "Yorick",
  ユーミ: "Yuumi",
  ザック: "Zac",
  ゼド: "Zed",
  ゼリ: "Zeri",
  ジグス: "Ziggs",
  ジリアン: "Zilean",
  ゾーイ: "Zoe",
  ザイラ: "Zyra",
  アーリ: "Ahri",
  アカリ: "Akali",
  // title.ts の CHAMPIONS には含まれないが、IDが不規則で誤検出/未検出になりやすい代表例
  "ベル=ヴェス": "Belveth",
  "オレリオン・ソル": "AurelionSol",
  ジャーヴァンIV: "JarvanIV",
  "ドクター・ムンド": "DrMundo",
  "レナータ・グラスク": "Renata",
};

let cachedNameToIdMap: ReadonlyMap<string, string> | null = null;

/** JP_NAME_TO_CHAMPION_ID を Map化する（各エントリの championId 自身も検索対象に含める）。1回だけ構築しキャッシュする。 */
function nameToIdLookup(): ReadonlyMap<string, string> {
  if (cachedNameToIdMap) return cachedNameToIdMap;
  const map = new Map<string, string>();
  for (const [jpName, id] of Object.entries(JP_NAME_TO_CHAMPION_ID)) {
    map.set(jpName, id);
    map.set(id, id);
  }
  cachedNameToIdMap = map;
  return map;
}

/**
 * チャンピオン表示名（日本語名、またはchampionId自身の英語表記）→ championId の純粋関数
 * （拡張E53 F-E53-2）。実ネット非依存（`JP_NAME_TO_CHAMPION_ID` の固定表を引くだけ）。対応表に無い
 * 名前（未知チャンピオン・表記ゆれ）は null を返す（呼び出し側で画像を省略するなどのフォールバックに使う）。
 */
export function championNameToId(name: string): string | null {
  return nameToIdLookup().get(name) ?? null;
}
