/**
 * チャンピオン一覧データ（拡張E6）。
 *
 * ⚠ すべてオリジナルの創作モックデータ。チャンピオン名・ロール名はLoLの一般名詞として使用するが、
 * ロール分類・難易度・一言説明・Tierランクは当サイトが独自に書き起こしたものであり、
 * 公式Wikiや外部攻略サイトの記述・ランク付けを複製したものではない。
 * `src/lib/generation/title.ts` の CHAMPIONS 語彙（チャンピオン名のみ）を土台に、
 * ロール・Tier・難易度・説明文を新規に付与した。将来、公式API等の実データに差し替える際は
 * この配列を差し替えるだけで済む構造にしてある。
 */
import { type Role, type Tier } from "./types";

export type Difficulty = 1 | 2 | 3;

export const DIFFICULTY_LABELS: Record<Difficulty, string> = {
  1: "易しい",
  2: "普通",
  3: "難しい",
};

export type ChampionEntry = {
  /** URL用スラッグ（ASCII安全・一意）。 */
  slug: string;
  name: string;
  role: Role;
  tier: Tier;
  difficulty: Difficulty;
  /** オリジナルの一言説明（当サイト独自の書き起こし）。 */
  summary: string;
};

export const CHAMPIONS: ChampionEntry[] = [
  { slug: "alistar", name: "アリスター", role: "SUP", tier: "B", difficulty: 2, summary: "頭突きとノックバックで敵の陣形を崩す、体力の高い突進型サポート。" },
  { slug: "anivia", name: "アニビア", role: "MID", tier: "C", difficulty: 3, summary: "氷結の壁で敵の進路を断ち、範囲凍結で一気に形勢を変えるコントロールメイジ。" },
  { slug: "annie", name: "アニー", role: "MID", tier: "B", difficulty: 1, summary: "熊の召喚と束の間のスタンで手数を稼ぐ、扱いやすいバースト型メイジ。" },
  { slug: "aphelios", name: "アフェリオス", role: "ADC", tier: "A", difficulty: 3, summary: "5種の武器を持ち替えて戦う、覚える要素は多いが噛み合うと爆発力が高いマークスマン。" },
  { slug: "ashe", name: "アッシュ", role: "ADC", tier: "B", difficulty: 1, summary: "凍結矢で足を止めつつ攻撃するクラシックなマークスマン。集団戦の広域スタン矢が持ち味。" },
  { slug: "azir", name: "アジール", role: "MID", tier: "S", difficulty: 3, summary: "砂の兵隊を操り遠距離から圧をかける、育てば戦線を支配するレーンコントロール型メイジ。" },
  { slug: "bard", name: "バード", role: "SUP", tier: "B", difficulty: 2, summary: "マップ全域を駆け回り、鐘収集と味方保護の壁で独特なテンポを作るユーティリティサポート。" },
  { slug: "amumu", name: "アムム", role: "JG", tier: "B", difficulty: 1, summary: "広範囲の巻き付きで敵を拘束する、集団戦の起点作りに向いたタンクジャングラー。" },
  { slug: "blitzcrank", name: "ブリッツクランク", role: "SUP", tier: "C", difficulty: 2, summary: "鉄拳グラブで敵を引き寄せる、一撃のロックが刺されば試合を決めるピック型サポート。" },
  { slug: "brand", name: "ブランド", role: "SUP", tier: "C", difficulty: 1, summary: "着火した敵に連鎖する炎で範囲ダメージを稼ぐ、火力寄りのメイジサポート。" },
  { slug: "braum", name: "ブラウム", role: "SUP", tier: "S", difficulty: 1, summary: "盾で味方を守り眉間割りで敵を怯ませる、集団戦の耐久力が高いガーディアン型サポート。" },
  { slug: "caitlyn", name: "ケイトリン", role: "ADC", tier: "A", difficulty: 2, summary: "長い射程の罠と狙撃で先手を取る、レーン戦を得意とするマークスマン。" },
  { slug: "camille", name: "カミール", role: "TOP", tier: "S", difficulty: 2, summary: "脚のフックで敵を隔離し1対1に持ち込む、決闘志向の高いブルーザー。" },
  { slug: "kassadin", name: "カサディン", role: "MID", tier: "A", difficulty: 2, summary: "序盤は我慢し、育てば瞬間移動で戦場を選べる後半特化のアサシン型メイジ。" },
  { slug: "darius", name: "ダリウス", role: "TOP", tier: "A", difficulty: 1, summary: "出血蓄積からの一撃で仕留める、レーン圧力の高いパワーファイター。" },
  { slug: "diana", name: "ダイアナ", role: "JG", tier: "B", difficulty: 2, summary: "三日月の斬撃を連ねて範囲内の敵に一気に飛び込む近接アサシン。" },
  { slug: "draven", name: "ドレイヴン", role: "ADC", tier: "C", difficulty: 3, summary: "回転する斧を華麗にキャッチし続けることで火力が伸びる、リスクとリターンが大きいマークスマン。" },
  { slug: "ekko", name: "エコー", role: "JG", tier: "B", difficulty: 3, summary: "時を巻き戻す能力で不利な状況をやり直せる、テンポ寄りのアサシン。" },
  { slug: "evelynn", name: "イブリン", role: "JG", tier: "C", difficulty: 2, summary: "隠密状態でマップを徘徊し、油断した相手を一気に沈める潜伏型アサシン。" },
  { slug: "ezreal", name: "エズリアル", role: "ADC", tier: "A", difficulty: 2, summary: "スキルショット主体で被弾を抑えながら戦う、機動力の高いマークスマン。" },
  { slug: "fiora", name: "フィオラ", role: "TOP", tier: "B", difficulty: 3, summary: "急所を突く一撃で反撃する、1対1の読み合いに特化したデュエリスト。" },
  { slug: "fizz", name: "フィズ", role: "MID", tier: "A", difficulty: 2, summary: "水中に潜って攻撃を避けつつ懐に飛び込む、機動力重視のアサシン。" },
  { slug: "galio", name: "ガリオ", role: "MID", tier: "A", difficulty: 1, summary: "石化した巨体で魔法耐性を持ち、長距離ジャンプで味方を助けに現れるタンク。" },
  { slug: "gangplank", name: "ガングプランク", role: "TOP", tier: "C", difficulty: 2, summary: "樽を置いて範囲を制圧する、独自のテンポでレーンを支配するファイター。" },
  { slug: "garen", name: "ガレン", role: "TOP", tier: "A", difficulty: 1, summary: "回転斬りと処刑で完結する、操作が簡単で耐久力も高い初心者向けファイター。" },
  { slug: "gragas", name: "グラガス", role: "JG", tier: "C", difficulty: 2, summary: "樽の爆発で味方をまとめて吹き飛ばす、集団戦の起点作りが得意なタンク。" },
  { slug: "graves", name: "グレイブス", role: "JG", tier: "A", difficulty: 2, summary: "散弾の一撃離脱でジャングルを制圧する、火力寄りのスカーミッシャー。" },
  { slug: "gwen", name: "グウェン", role: "TOP", tier: "A", difficulty: 2, summary: "裁縫バサミで刻む連続攻撃と魔法耐性軽視の特性を持つ、しぶといブルーザー。" },
  { slug: "hecarim", name: "ヘカリム", role: "JG", tier: "A", difficulty: 1, summary: "移動速度に乗った突撃で範囲を薙ぎ払う、テンポの速いジャングルファイター。" },
  { slug: "heimerdinger", name: "ハイマーディンガー", role: "MID", tier: "C", difficulty: 2, summary: "タレットを設置して陣地を作る、レーン防衛に長けたユニークなメイジ。" },
  { slug: "illaoi", name: "イラオイ", role: "TOP", tier: "B", difficulty: 2, summary: "触手で殴りつけ分身を刻む、1対1に強い独特なブルーザー。" },
  { slug: "irelia", name: "イレリア", role: "TOP", tier: "B", difficulty: 3, summary: "刃を足場に跳び回る、手数が多いぶん扱いに慣れが要る近接デュエリスト。" },
  { slug: "janna", name: "ジャンナ", role: "SUP", tier: "A", difficulty: 1, summary: "台風で敵を吹き飛ばし味方を守る、集団戦のピール性能が高いユーティリティサポート。" },
  { slug: "jax", name: "ジャックス", role: "TOP", tier: "B", difficulty: 2, summary: "武器を持たない構えからの反撃で強さを見せる、後半に化けるファイター。" },
  { slug: "jayce", name: "ジェイス", role: "TOP", tier: "A", difficulty: 3, summary: "ハンマーと砲台形態を切り替える、遠近両対応で扱いに幅が出るファイター。" },
  { slug: "jhin", name: "ジン", role: "ADC", tier: "B", difficulty: 2, summary: "4発しか撃てない銃に美学を込め、最後の一撃に大ダメージを乗せるマークスマン。" },
  { slug: "jinx", name: "ジンクス", role: "ADC", tier: "S", difficulty: 2, summary: "キルを重ねるほど加速する二丁の得物を使い分ける、後半に伸びるマークスマン。" },
  { slug: "kaisa", name: "カイサ", role: "ADC", tier: "S", difficulty: 2, summary: "味方の攻撃でマークを付け弾ける、育成方向で立ち回りが変わる進化型マークスマン。" },
  { slug: "kalista", name: "カリスタ", role: "ADC", tier: "B", difficulty: 3, summary: "槍を投げては引き戻す独特な移動で被弾を避ける、操作難度の高いマークスマン。" },
  { slug: "karma", name: "カルマ", role: "SUP", tier: "A", difficulty: 2, summary: "スキルを解放して効果を強化する、支援と足止めを両立するユーティリティメイジ。" },
  { slug: "karthus", name: "カーサス", role: "MID", tier: "B", difficulty: 2, summary: "死亡後も詠唱が続く独自の生存性を持つ、範囲火力の高いメイジ。" },
  { slug: "kayle", name: "ケイル", role: "TOP", tier: "C", difficulty: 3, summary: "序盤は控えめだが育つと聖なる剣で戦場を薙ぐ、後半特化のファイター。" },
  { slug: "kennen", name: "ケネン", role: "TOP", tier: "B", difficulty: 2, summary: "雷の手裏剣をばら撒き範囲スタンを狙う、集団戦に強いスキルショット系ファイター。" },
  { slug: "khazix", name: "カジックス", role: "JG", tier: "A", difficulty: 2, summary: "茂みに潜んで進化した爪で孤立した敵を刈り取る、奇襲特化のアサシン。" },
  { slug: "kindred", name: "キンドレッド", role: "JG", tier: "S", difficulty: 2, summary: "狼と羊の一対で戦う、マーク処刑で確実に獲物を仕留めるマークスマン寄りジャングラー。" },
  { slug: "kled", name: "クレッド", role: "TOP", tier: "C", difficulty: 3, summary: "相棒スカーヴィックに乗って突撃する、序盤から前に出る攻撃的なファイター。" },
  { slug: "kogmaw", name: "コグマウ", role: "ADC", tier: "C", difficulty: 1, summary: "自ら動かず射程内の敵を溶かす酸の弾丸を放つ、火力特化の据え置き型マークスマン。" },
  { slug: "leblanc", name: "ルブラン", role: "MID", tier: "S", difficulty: 3, summary: "分身を囮に使い連続バーストで仕留める、隙が少ない高難度アサシンメイジ。" },
  { slug: "leesin", name: "リー・シン", role: "JG", tier: "S", difficulty: 3, summary: "気功弾から瞬時に飛び込むコンボで序盤の主導権を握る、操作量の多いジャングルファイター。" },
  { slug: "leona", name: "レオナ", role: "SUP", tier: "S", difficulty: 1, summary: "太陽の光で連続して敵を拘束する、集団戦の起点作りに特化したガーディアン型サポート。" },
];

/**
 * チャンピオン一覧を取得する。role を指定するとそのロールのみに絞り込む。
 * 表示順は名前の五十音順で安定させる（データ配列の記述順に依存しない）。
 */
export function listChampions(role?: Role): ChampionEntry[] {
  const filtered = role ? CHAMPIONS.filter((c) => c.role === role) : CHAMPIONS;
  return [...filtered].sort((a, b) => a.name.localeCompare(b.name, "ja"));
}

/** スラッグからチャンピオンを引く。見つからない場合は undefined。 */
export function getChampionBySlug(slug: string): ChampionEntry | undefined {
  return CHAMPIONS.find((c) => c.slug === slug);
}
