/**
 * 用語集データ（拡張E6）。
 *
 * ⚠ 用語（ガンク・CS等）はLoLコミュニティで一般的に使われる名詞をそのまま採用するが、
 * 定義文はすべて当サイトが独自に平易な言葉で書き起こしたオリジナルの解説であり、
 * 外部Wiki・攻略サイトの説明文を複製したものではない。
 */

export type GlossaryTerm = {
  /** URL用スラッグ（ASCII安全・一意）。 */
  slug: string;
  term: string;
  /** 五十音順ソート用の読み（ひらがな）。 */
  kana: string;
  definition: string;
};

export const GLOSSARY_TERMS: GlossaryTerm[] = [
  { slug: "aggro", term: "アグロ", kana: "あぐろ", definition: "モンスターやミニオンから狙われている状態のこと。位置取りを誤ると詠唱中や振り向きざまに反撃を受ける。" },
  { slug: "ultimate", term: "アルティメット(アルト)", kana: "あるてぃめっと", definition: "各チャンピオンが持つ最も強力な奥義スキル。クールダウンが長く、使いどころの見極めが勝敗を左右する。" },
  { slug: "engage", term: "エンゲージ", kana: "えんげーじ", definition: "味方から集団戦の口火を切ること。相手の陣形が整う前に仕掛けると有利を取りやすい。" },
  { slug: "objective", term: "オブジェクト", kana: "おぶじぇくと", definition: "ドラゴンやバロンなど、討伐すると恩恵を得られるマップ上の中立モンスターやタワー等の総称。" },
  { slug: "gank", term: "ガンク", kana: "がんく", definition: "自分のレーンを離れ、隣接レーンの味方に加勢して数的有利を作りに行く行動。" },
  { slug: "carry", term: "キャリー", kana: "きゃりー", definition: "終盤に高い火力や影響力を発揮し、試合を勝利に導く役割やチャンピオンのこと。" },
  { slug: "cs", term: "CS(クリープスコア)", kana: "しーえす", definition: "自分の手でとどめを刺したミニオンの数。ゴールド収入の主要な源であり、上手さの目安にもされる。" },
  { slug: "jungle", term: "ジャングル", kana: "じゃんぐる", definition: "レーンの間に広がる森のエリア、またはそこを拠点に立ち回るロールの通称。" },
  { slug: "snowball", term: "スノーボール", kana: "すのーぼーる", definition: "小さな有利が雪だるま式に大きな有利へと膨らんでいく現象。序盤のリードは早めに活かすほど拡大しやすい。" },
  { slug: "zoning", term: "ゾーニング", kana: "ぞーにんぐ", definition: "威圧や射程の広さで相手を特定の範囲(CS等)に近づけさせないようにする立ち回り。" },
  { slug: "tower-dive", term: "タワーダイブ", kana: "たわーだいぶ", definition: "敵タワーの攻撃を受けながら、その射程内にいる敵チャンピオンを討ちに行くリスクの高い行動。" },
  { slug: "tilt", term: "ティルト", kana: "てぃると", definition: "劣勢や不運が続いて冷静さを欠いた精神状態。判断ミスを誘発しやすいため注意が必要とされる。" },
  { slug: "teleport", term: "テレポート(TP)", kana: "てれぽーと", definition: "指定した地点に一定時間後にワープする召喚士呪文。レーン復帰やマップの奇襲移動に使われる。" },
  { slug: "execute", term: "処刑(エクゼキュート)", kana: "しょけい", definition: "体力が一定割合以下の対象に追加ダメージを与える性質。低体力の相手を確実に仕留める手段になる。" },
  { slug: "harass", term: "ハラス", kana: "はらす", definition: "決定打を狙わず小さな攻撃を重ねて相手の体力を削り、有利な状況を作る行為。" },
  { slug: "peel", term: "ピール", kana: "ぴーる", definition: "味方のキャリーを敵の攻撃から守るために立ち回ること。集団戦での生存率を大きく左右する。" },
  { slug: "farm", term: "ファーム", kana: "ふぁーむ", definition: "ミニオンやモンスターを効率よく処理してゴールドと経験値を稼ぐこと。" },
  { slug: "freeze", term: "フリーズ", kana: "ふりーず", definition: "ミニオンの集団をあえて自陣寄りに留めておくレーン管理のテクニック。相手を危険な位置に誘い込める。" },
  { slug: "poke", term: "ポーク", kana: "ぽーく", definition: "接近戦を避けつつ射程の長いスキルで継続的にダメージを与える戦い方。" },
  { slug: "meta", term: "メタ", kana: "めた", definition: "その時点の環境で強いとされる戦略やチャンピオンの傾向。パッチのたびに移り変わる。" },
  { slug: "roam", term: "ローム(ロームする)", kana: "ろーむ", definition: "自分のレーンを離れて他のレーンやマップの目標に関与しに行くこと。ガンクより広い意味で使われる。" },
  { slug: "ward", term: "ワード", kana: "わーど", definition: "マップに設置して視界を確保するアイテム/スキルの総称。索敵と待ち伏せ回避の生命線。" },
  { slug: "vision-score", term: "ビジョンスコア", kana: "びじょんすこあ", definition: "ワード設置・解除や視界貢献を数値化した指標。サポート等の貢献度を測る目安になる。" },
  { slug: "lane-control", term: "レーンコントロール", kana: "れーんこんとろーる", definition: "ミニオンの集団の位置を意図的に操作し、有利な立ち回りができる状況を作り出す技術。" },
];

/**
 * 用語一覧を五十音順で返す。query を指定すると用語名・定義文にマッチするものだけに絞り込む。
 * query が空/未指定の場合は全件をそのまま返す。
 */
export function listGlossaryTerms(query?: string): GlossaryTerm[] {
  const sorted = [...GLOSSARY_TERMS].sort((a, b) => a.kana.localeCompare(b.kana, "ja"));
  const trimmed = query?.trim();
  if (!trimmed) return sorted;
  return sorted.filter((t) => t.term.includes(trimmed) || t.definition.includes(trimmed));
}

/** スラッグから用語を引く。見つからない場合は undefined。 */
export function getGlossaryTermBySlug(slug: string): GlossaryTerm | undefined {
  return GLOSSARY_TERMS.find((t) => t.slug === slug);
}
