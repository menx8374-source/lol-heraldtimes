/**
 * ソース非依存の統一レス選定（resel-S2 F-RS2-1）。「scoreの高いレスを選ぶ＋アンカーで連結した
 * 元レス（親）も文脈として採用」を、Reddit（コメントupvote score）・X（likeCount）で共通に使う
 * 決定論の純関数。AI・非同期処理は一切使わない（LLM呼び出し増なし）。
 *
 * アルゴリズム:
 * 1. primary = index を score 降順（同点は index 昇順で決定論タイブレーク）でソートし先頭 `target` 件。
 * 2. context = 各 primary の `parentIndex` を `anchorDepth` 段まで遡り、primary に無い祖先を追加
 *    （低scoreでも文脈として採用）。
 * 3. selected = primary ∪ context。`selected.size > hardCap` なら context のうち score が低いもの
 *    から間引く（primaryは絶対に間引かない）。
 * 4. 出力順＝チェーン整合順: primary を score 降順で走査し、各 primary について
 *    「selected に含まれる祖先を親→子の順で先に、その後自分」を emit する（各 index は1回だけ）。
 *    ＝親レスが必ず子より前に出て会話が繋がる。
 */

/** 選定入力の1件。`index` は呼び出し側の配列内位置、`parentIndex` は同じ配列内の親のindex（無ければnull）。 */
export type ScoredAnchorItem = {
  index: number;
  score: number;
  parentIndex: number | null;
};

export type ScoredAnchorOptions = {
  /** primaryとして採用する上限件数（scoreの高いレス、既定12目安）。 */
  target: number;
  /** 親を遡って文脈として採用する段数（既定1）。 */
  anchorDepth: number;
  /** primary+context合計の絶対上限（超過分はcontextの低scoreから間引く、既定target+3）。 */
  hardCap: number;
};

/**
 * 統一レス選定（score優先＋アンカー文脈）。空入力は空配列。`parentIndex` が null、または
 * `items` に存在しないindexを指していても例外を投げない（呼び出し側で「プール外はnull」に
 * 正規化する想定だが、念のため存在しない参照は無視して打ち切る）。
 */
export function selectScoredAnchorReses(items: ScoredAnchorItem[], options: ScoredAnchorOptions): number[] {
  if (items.length === 0) return [];
  const { target, anchorDepth, hardCap } = options;
  const byIndex = new Map(items.map((it) => [it.index, it]));

  // 1. primary: score降順（同点はindex昇順）→ 先頭target件。
  const sortedByScore = items.slice().sort((a, b) => b.score - a.score || a.index - b.index);
  const primary = sortedByScore.slice(0, Math.max(0, target));
  const primarySet = new Set(primary.map((p) => p.index));

  // 2. context: 各primaryのparentIndexをanchorDepth段まで遡り、primaryに無い祖先を追加。
  const contextItems = new Map<number, ScoredAnchorItem>();
  for (const p of primary) {
    let current = p.parentIndex;
    let depth = 0;
    const visited = new Set<number>();
    while (current !== null && depth < anchorDepth) {
      if (visited.has(current)) break; // 循環防止（通常のスレ/会話木では起きない想定の保険）
      visited.add(current);
      const ancestorItem = byIndex.get(current);
      if (!ancestorItem) break; // プール外・不明な参照は打ち切る
      if (!primarySet.has(current)) contextItems.set(current, ancestorItem);
      current = ancestorItem.parentIndex;
      depth++;
    }
  }

  // 3. hardCap超過はcontextのうちscoreが低いものから間引く（primaryは間引かない）。
  const selectedSet = new Set<number>([...primarySet, ...contextItems.keys()]);
  if (selectedSet.size > hardCap) {
    const overflow = selectedSet.size - hardCap;
    const sortedContextAsc = [...contextItems.values()].sort((a, b) => a.score - b.score || b.index - a.index);
    for (let i = 0; i < overflow && i < sortedContextAsc.length; i++) {
      selectedSet.delete(sortedContextAsc[i].index);
      contextItems.delete(sortedContextAsc[i].index);
    }
  }

  // 4. 出力順=チェーン整合順: primaryをscore降順で走査し、selectedに含まれる祖先を親→子の順で先に、
  // その後自分をemitする（各indexは1回だけ）。
  const emitted = new Set<number>();
  const output: number[] = [];
  for (const p of primary) {
    if (!selectedSet.has(p.index)) continue; // primaryは通常trimされないが念のため

    // 祖先チェーンを子→親の順で辿り、selectedに含まれる間だけ集める(選定外の祖先で打ち切る)。
    const ancestorsChildToParent: number[] = [];
    let current = p.parentIndex;
    const visited = new Set<number>();
    while (current !== null) {
      if (visited.has(current)) break;
      visited.add(current);
      if (!selectedSet.has(current)) break;
      ancestorsChildToParent.push(current);
      const ancestorItem = byIndex.get(current);
      current = ancestorItem ? ancestorItem.parentIndex : null;
    }

    for (const ancestorIndex of ancestorsChildToParent.reverse()) {
      if (emitted.has(ancestorIndex)) continue;
      emitted.add(ancestorIndex);
      output.push(ancestorIndex);
    }
    if (!emitted.has(p.index)) {
      emitted.add(p.index);
      output.push(p.index);
    }
  }

  // 安全網: `anchorDepth >= 2` かつ hardCap 間引きで「中間の祖先だけ間引かれた」場合、上の
  // チェーン走査は間引かれた祖先で break するため、selected なのに未emitのindexが理論上残り得る
  // （既定 anchorDepth=1 では到達しない）。selected は必ず全件出力する不変条件を保つため、
  // 未emitのselectedを末尾に決定論順（selectedSetの挿入順＝primary→context）で補う。
  for (const idx of selectedSet) {
    if (!emitted.has(idx)) {
      emitted.add(idx);
      output.push(idx);
    }
  }
  return output;
}
