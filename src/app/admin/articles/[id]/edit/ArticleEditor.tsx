"use client";

/**
 * 構造化エディタ（admincms-S3 F7/F8、admincms-S4 F9でパッチ系ブロックの編集フォームを追加）。
 * 生JSON textareaを廃止し、本文ブロックをカードとして縦に並べ、追加/削除/並べ替え＋メタ情報
 * （タイトル/要約/カテゴリ/タグ/サムネイル/公開状態）を同画面で編集する。保存は`updateArticleAction`
 * （server action）へ、タグ配列・ブロックドラフト配列をJSON文字列化したhidden inputで渡す
 * （フォーム⇔ブロックの変換自体は`lib/admin/article-editor-form.ts`の純関数が担い、ここではUI状態の
 * 保持と入力欄の描画のみを行う）。
 *
 * サブコンポーネント（BlockCard等）はモジュールトップレベルで定義する。ArticleEditor本体の中で
 * 関数コンポーネントを再定義すると、親の再レンダーごとに別コンポーネントとして扱われ入力中の
 * フォーカスが失われるため（Reactの既知の落とし穴）、必ずトップレベルに置く。
 *
 * 保存結果は`useActionState`で受け取る（admincms-S3補完）。検証NG時にサーバー側でredirectすると
 * DB再取得でフォームが最後の保存内容にリセットされ、入力中の他の編集内容が失われてしまう。
 * `updateArticleAction`は成功時のみredirectし、失敗時は`{success:false, error}`を返すため、
 * このコンポーネントは自身のReact state（title/items等）を保持したままエラーメッセージだけを表示する。
 */
import { useActionState, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { updateArticleAction } from "@/app/admin/actions";
import {
  BLOCK_TYPE_LABELS,
  EDITABLE_BLOCK_TYPES,
  PATCH_ABILITY_KEY_LABELS,
  PATCH_DIRECTION_LABELS,
  PATCH_TARGET_KIND_LABELS,
  blockToDraft,
  createDraftBlock,
  insertItemAfter,
  moveItem,
  removeItemAt,
  type BlockDraft,
  type EditableBlockType,
  type PatchChangeDraft,
  type PatchChangeGroupDraft,
  type ReactionLineDraft,
} from "@/lib/admin/article-editor-form";
import { CATEGORY_LABELS } from "@/lib/categories";
import { EMBED_PROVIDER_LABELS, type EmbedProvider } from "@/lib/embed";
import type { ArticleBodyBlock, ArticleBodyEmphasisColor } from "@/lib/article-body";
import {
  PATCH_TARGET_KIND_VALUES,
  PATCH_DIRECTION_VALUES,
  PATCH_ABILITY_KEY_VALUES,
} from "@/lib/article-body";
import { ARTICLE_STATUS_LABELS as STATUS_LABELS } from "@/lib/admin/article-status-labels";

const RES_EMPHASIS_COLOR_OPTIONS: { value: "" | ArticleBodyEmphasisColor; label: string }[] = [
  { value: "", label: "なし" },
  { value: "red", label: "赤" },
  { value: "blue", label: "青" },
  { value: "purple", label: "紫" },
  { value: "orange", label: "オレンジ" },
];

const LINE_EMPHASIS_OPTIONS: { value: "" | "red" | "orange"; label: string }[] = [
  { value: "", label: "なし" },
  { value: "red", label: "赤" },
  { value: "orange", label: "オレンジ" },
];

const inputClass =
  "rounded border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-100";
const smallButtonClass =
  "rounded border border-neutral-700 px-2 py-1 text-xs text-neutral-200 hover:bg-neutral-800 disabled:opacity-40";

/** 種別選択＋「追加」ボタン。指定位置(末尾 or 指定ブロック直後)にブロックを1つ追加する。 */
function AddBlockControl({ onAdd, label }: { onAdd: (type: EditableBlockType) => void; label: string }) {
  const [type, setType] = useState<EditableBlockType>("paragraph");
  return (
    <div className="flex flex-wrap items-center gap-2 rounded border border-dashed border-neutral-700 px-3 py-2 text-xs">
      <span className="text-neutral-400">{label}:</span>
      <select
        value={type}
        onChange={(e) => setType(e.target.value as EditableBlockType)}
        className="rounded border border-neutral-700 bg-neutral-950 px-2 py-1 text-xs text-neutral-100"
      >
        {EDITABLE_BLOCK_TYPES.map((t) => (
          <option key={t} value={t}>
            {BLOCK_TYPE_LABELS[t]}
          </option>
        ))}
      </select>
      <button type="button" onClick={() => onAdd(type)} className={smallButtonClass}>
        ブロックを追加
      </button>
    </div>
  );
}

type BlockCardProps = {
  draft: BlockDraft;
  index: number;
  total: number;
  onChange: (draft: BlockDraft) => void;
  onMove: (direction: -1 | 1) => void;
  onRemove: () => void;
};

/** 1ブロック分のカード。種別ラベル・↑↓・削除の共通ヘッダー＋種別ごとの入力欄。 */
function BlockCard({ draft, index, total, onChange, onMove, onRemove }: BlockCardProps) {
  return (
    <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-3" data-block-card data-block-type={draft.type}>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="rounded bg-neutral-800 px-2 py-0.5 text-xs font-bold text-neutral-200">
          {BLOCK_TYPE_LABELS[draft.type]}
        </span>
        <span className="text-xs text-neutral-500">#{index + 1}</span>
        <div className="ml-auto flex gap-1">
          <button type="button" onClick={() => onMove(-1)} disabled={index === 0} className={smallButtonClass} aria-label="上へ移動">
            ↑
          </button>
          <button type="button" onClick={() => onMove(1)} disabled={index === total - 1} className={smallButtonClass} aria-label="下へ移動">
            ↓
          </button>
          <button
            type="button"
            onClick={onRemove}
            className="rounded border border-red-900 px-2 py-1 text-xs text-red-300 hover:bg-red-950/40"
          >
            削除
          </button>
        </div>
      </div>

      <BlockFields draft={draft} onChange={onChange} />
    </div>
  );
}

function BlockFields({ draft, onChange }: { draft: BlockDraft; onChange: (draft: BlockDraft) => void }) {
  if (draft.type === "reaction") {
    return <ReactionFields draft={draft} onChange={onChange} />;
  }
  if (draft.type === "redditSource") {
    return (
      <div className="flex flex-col gap-2 text-sm">
        <label className="flex flex-col gap-1">
          <span>元スレタイトル</span>
          <input
            type="text"
            value={draft.title}
            onChange={(e) => onChange({ ...draft, title: e.target.value })}
            className={inputClass}
          />
        </label>
        <div className="flex flex-wrap gap-2">
          <label className="flex flex-col gap-1">
            <span>作者（任意）</span>
            <input
              type="text"
              value={draft.author}
              onChange={(e) => onChange({ ...draft, author: e.target.value })}
              className={inputClass}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span>サブレディット（任意）</span>
            <input
              type="text"
              value={draft.subreddit}
              onChange={(e) => onChange({ ...draft, subreddit: e.target.value })}
              className={inputClass}
            />
          </label>
        </div>
        <label className="flex flex-col gap-1">
          <span>元スレURL（reddit.com のみ）</span>
          <input
            type="text"
            value={draft.url}
            onChange={(e) => onChange({ ...draft, url: e.target.value })}
            className={inputClass}
          />
        </label>
      </div>
    );
  }
  if (draft.type === "heading") {
    return (
      <div className="flex flex-col gap-2 text-sm">
        <label className="flex flex-col gap-1">
          <span>見出しテキスト</span>
          <input
            type="text"
            value={draft.text}
            onChange={(e) => onChange({ ...draft, text: e.target.value })}
            className={inputClass}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span>アンカー（任意、目次連携用）</span>
          <input
            type="text"
            value={draft.anchor}
            onChange={(e) => onChange({ ...draft, anchor: e.target.value })}
            className={inputClass}
          />
        </label>
      </div>
    );
  }
  if (draft.type === "paragraph") {
    return (
      <label className="flex flex-col gap-1 text-sm">
        <span>段落テキスト</span>
        <textarea
          value={draft.text}
          onChange={(e) => onChange({ ...draft, text: e.target.value })}
          rows={3}
          className={inputClass}
        />
      </label>
    );
  }
  if (draft.type === "quote") {
    return (
      <div className="flex flex-col gap-2 text-sm">
        <label className="flex flex-col gap-1">
          <span>引用テキスト</span>
          <textarea
            value={draft.text}
            onChange={(e) => onChange({ ...draft, text: e.target.value })}
            rows={2}
            className={inputClass}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span>出典（任意）</span>
          <input
            type="text"
            value={draft.source}
            onChange={(e) => onChange({ ...draft, source: e.target.value })}
            className={inputClass}
          />
        </label>
      </div>
    );
  }
  if (draft.type === "embed") {
    return (
      <div className="flex flex-col gap-2 text-sm">
        <label className="flex flex-col gap-1">
          <span>提供元</span>
          <select
            value={draft.provider}
            onChange={(e) => onChange({ ...draft, provider: e.target.value })}
            className={inputClass}
          >
            {(Object.keys(EMBED_PROVIDER_LABELS) as EmbedProvider[]).map((p) => (
              <option key={p} value={p}>
                {EMBED_PROVIDER_LABELS[p]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span>URL（ホワイトリスト外は保存時にエラー）</span>
          <input
            type="text"
            value={draft.url}
            onChange={(e) => onChange({ ...draft, url: e.target.value })}
            className={inputClass}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span>キャプション（任意）</span>
          <input
            type="text"
            value={draft.caption}
            onChange={(e) => onChange({ ...draft, caption: e.target.value })}
            className={inputClass}
          />
        </label>
      </div>
    );
  }
  if (draft.type === "image") {
    return (
      <div className="flex flex-col gap-2 text-sm">
        <label className="flex flex-col gap-1">
          <span>画像URL</span>
          <input
            type="text"
            value={draft.url}
            onChange={(e) => onChange({ ...draft, url: e.target.value })}
            className={inputClass}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span>alt（代替テキスト）</span>
          <input
            type="text"
            value={draft.alt}
            onChange={(e) => onChange({ ...draft, alt: e.target.value })}
            className={inputClass}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span>クレジット（任意）</span>
          <input
            type="text"
            value={draft.credit}
            onChange={(e) => onChange({ ...draft, credit: e.target.value })}
            className={inputClass}
          />
        </label>
      </div>
    );
  }
  if (draft.type === "linkButton") {
    return (
      <div className="flex flex-col gap-2 text-sm">
        <label className="flex flex-col gap-1">
          <span>ラベル</span>
          <input
            type="text"
            value={draft.label}
            onChange={(e) => onChange({ ...draft, label: e.target.value })}
            className={inputClass}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span>URL（https のみ）</span>
          <input
            type="text"
            value={draft.url}
            onChange={(e) => onChange({ ...draft, url: e.target.value })}
            className={inputClass}
          />
        </label>
      </div>
    );
  }
  if (draft.type === "toc") {
    return <TocFields draft={draft} onChange={onChange} />;
  }
  // draft.type === "patchChange"（残る唯一のケース）
  return <PatchChangeFields draft={draft} onChange={onChange} />;
}

/** 目次(toc)ブロックの編集欄。items(表示名/リンク先アンカー)の追加/編集/並替/削除。 */
function TocFields({
  draft,
  onChange,
}: {
  draft: Extract<BlockDraft, { type: "toc" }>;
  onChange: (draft: BlockDraft) => void;
}) {
  function updateItem(itemIndex: number, item: { label: string; anchor: string }) {
    onChange({ ...draft, items: draft.items.map((it, i) => (i === itemIndex ? item : it)) });
  }
  function addItem() {
    onChange({ ...draft, items: insertItemAfter(draft.items, null, { label: "", anchor: "" }) });
  }
  function removeItem(itemIndex: number) {
    onChange({ ...draft, items: removeItemAt(draft.items, itemIndex) });
  }
  function moveItemAt(itemIndex: number, direction: -1 | 1) {
    onChange({ ...draft, items: moveItem(draft.items, itemIndex, direction) });
  }

  return (
    <div className="flex flex-col gap-2 text-sm">
      {draft.items.map((item, itemIndex) => (
        <div key={itemIndex} className="flex flex-wrap items-end gap-2 rounded border border-neutral-800 p-2">
          <label className="flex flex-col gap-1">
            <span>表示名</span>
            <input
              type="text"
              value={item.label}
              onChange={(e) => updateItem(itemIndex, { ...item, label: e.target.value })}
              className={inputClass}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span>リンク先アンカー（見出しブロックのアンカーと一致させる）</span>
            <input
              type="text"
              value={item.anchor}
              onChange={(e) => updateItem(itemIndex, { ...item, anchor: e.target.value })}
              className={inputClass}
            />
          </label>
          <div className="flex gap-1">
            <button type="button" onClick={() => moveItemAt(itemIndex, -1)} disabled={itemIndex === 0} className={smallButtonClass} aria-label="項目を上へ移動">
              ↑
            </button>
            <button
              type="button"
              onClick={() => moveItemAt(itemIndex, 1)}
              disabled={itemIndex === draft.items.length - 1}
              className={smallButtonClass}
              aria-label="項目を下へ移動"
            >
              ↓
            </button>
            <button
              type="button"
              onClick={() => removeItem(itemIndex)}
              disabled={draft.items.length <= 1}
              className={smallButtonClass}
            >
              項目を削除
            </button>
          </div>
        </div>
      ))}
      <button type="button" onClick={addItem} className={`${smallButtonClass} self-start`}>
        項目を追加
      </button>
    </div>
  );
}

/** パッチ変更(patchChange)ブロックの編集欄。対象名/対象種別/方向/変更意図＋グループ群。 */
function PatchChangeFields({
  draft,
  onChange,
}: {
  draft: Extract<BlockDraft, { type: "patchChange" }>;
  onChange: (draft: BlockDraft) => void;
}) {
  function updateGroup(groupIndex: number, group: PatchChangeGroupDraft) {
    onChange({ ...draft, groups: draft.groups.map((g, i) => (i === groupIndex ? group : g)) });
  }
  function addGroup() {
    const newGroup: PatchChangeGroupDraft = { abilityKey: "", abilityName: "", abilityIconUrl: "", changes: [] };
    onChange({ ...draft, groups: insertItemAfter(draft.groups, null, newGroup) });
  }
  function removeGroup(groupIndex: number) {
    onChange({ ...draft, groups: removeItemAt(draft.groups, groupIndex) });
  }
  function moveGroup(groupIndex: number, direction: -1 | 1) {
    onChange({ ...draft, groups: moveItem(draft.groups, groupIndex, direction) });
  }

  return (
    <div className="flex flex-col gap-3 text-sm">
      <div className="flex flex-wrap gap-2">
        <label className="flex flex-col gap-1">
          <span>対象名</span>
          <input
            type="text"
            value={draft.targetName}
            onChange={(e) => onChange({ ...draft, targetName: e.target.value })}
            className={inputClass}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span>対象種別</span>
          <select
            value={draft.targetKind}
            onChange={(e) => onChange({ ...draft, targetKind: e.target.value as typeof draft.targetKind })}
            className={inputClass}
          >
            {PATCH_TARGET_KIND_VALUES.map((k) => (
              <option key={k} value={k}>
                {PATCH_TARGET_KIND_LABELS[k]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span>方向</span>
          <select
            value={draft.direction}
            onChange={(e) => onChange({ ...draft, direction: e.target.value as typeof draft.direction })}
            className={inputClass}
          >
            {PATCH_DIRECTION_VALUES.map((k) => (
              <option key={k} value={k}>
                {PATCH_DIRECTION_LABELS[k]}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="flex flex-col gap-1">
        <span>対象アイコンURL（任意）</span>
        <input
          type="text"
          value={draft.targetIconUrl}
          onChange={(e) => onChange({ ...draft, targetIconUrl: e.target.value })}
          className={inputClass}
        />
      </label>
      <label className="flex flex-col gap-1">
        <span>変更意図（任意）</span>
        <textarea
          value={draft.intent}
          onChange={(e) => onChange({ ...draft, intent: e.target.value })}
          rows={2}
          className={inputClass}
        />
      </label>

      <div className="flex flex-col gap-2">
        <span className="font-bold">グループ（スキル・項目単位の変更）</span>
        {draft.groups.map((group, groupIndex) => (
          <PatchChangeGroupCard
            key={groupIndex}
            group={group}
            index={groupIndex}
            total={draft.groups.length}
            onChange={(g) => updateGroup(groupIndex, g)}
            onMove={(direction) => moveGroup(groupIndex, direction)}
            onRemove={() => removeGroup(groupIndex)}
          />
        ))}
        <button type="button" onClick={addGroup} className={`${smallButtonClass} self-start`}>
          グループを追加
        </button>
      </div>
    </div>
  );
}

const smallSelectClass = "rounded border border-neutral-700 bg-neutral-950 px-2 py-1 text-xs text-neutral-100";

/** patchChangeの1グループ分のカード。abilityKey/abilityName＋変更行一覧。 */
function PatchChangeGroupCard({
  group,
  index,
  total,
  onChange,
  onMove,
  onRemove,
}: {
  group: PatchChangeGroupDraft;
  index: number;
  total: number;
  onChange: (group: PatchChangeGroupDraft) => void;
  onMove: (direction: -1 | 1) => void;
  onRemove: () => void;
}) {
  function updateChange(changeIndex: number, change: PatchChangeDraft) {
    onChange({ ...group, changes: group.changes.map((c, i) => (i === changeIndex ? change : c)) });
  }
  function addChange(kind: "numeric" | "descriptive") {
    onChange({ ...group, changes: insertItemAfter(group.changes, null, { kind, stat: "", before: "", after: "", text: "" }) });
  }
  function removeChange(changeIndex: number) {
    onChange({ ...group, changes: removeItemAt(group.changes, changeIndex) });
  }
  function moveChange(changeIndex: number, direction: -1 | 1) {
    onChange({ ...group, changes: moveItem(group.changes, changeIndex, direction) });
  }

  return (
    <div className="flex flex-col gap-2 rounded border border-neutral-800 p-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-neutral-500">グループ #{index + 1}</span>
        <div className="ml-auto flex gap-1">
          <button type="button" onClick={() => onMove(-1)} disabled={index === 0} className={smallButtonClass} aria-label="グループを上へ移動">
            ↑
          </button>
          <button type="button" onClick={() => onMove(1)} disabled={index === total - 1} className={smallButtonClass} aria-label="グループを下へ移動">
            ↓
          </button>
          <button
            type="button"
            onClick={onRemove}
            className="rounded border border-red-900 px-2 py-1 text-xs text-red-300 hover:bg-red-950/40"
          >
            グループを削除
          </button>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <label className="flex flex-col gap-1 text-xs">
          <span>スキル区分（任意）</span>
          <select
            value={group.abilityKey}
            onChange={(e) => onChange({ ...group, abilityKey: e.target.value as PatchChangeGroupDraft["abilityKey"] })}
            className={smallSelectClass}
          >
            <option value="">未指定</option>
            {PATCH_ABILITY_KEY_VALUES.map((k) => (
              <option key={k} value={k}>
                {PATCH_ABILITY_KEY_LABELS[k]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span>スキル名（任意）</span>
          <input
            type="text"
            value={group.abilityName}
            onChange={(e) => onChange({ ...group, abilityName: e.target.value })}
            className={smallSelectClass}
          />
        </label>
      </div>

      <div className="flex flex-col gap-2">
        {group.changes.map((change, changeIndex) => (
          <PatchChangeRow
            key={changeIndex}
            change={change}
            index={changeIndex}
            total={group.changes.length}
            onChange={(c) => updateChange(changeIndex, c)}
            onMove={(direction) => moveChange(changeIndex, direction)}
            onRemove={() => removeChange(changeIndex)}
          />
        ))}
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => addChange("numeric")} className={smallButtonClass}>
            数値変更の行を追加
          </button>
          <button type="button" onClick={() => addChange("descriptive")} className={smallButtonClass}>
            記述式変更の行を追加
          </button>
        </div>
      </div>
    </div>
  );
}

/** patchChangeグループ内の1変更行。`kind`で数値変更(項目名/変更前/変更後)・記述式変更(ラベル任意/本文)を切り替える。 */
function PatchChangeRow({
  change,
  index,
  total,
  onChange,
  onMove,
  onRemove,
}: {
  change: PatchChangeDraft;
  index: number;
  total: number;
  onChange: (change: PatchChangeDraft) => void;
  onMove: (direction: -1 | 1) => void;
  onRemove: () => void;
}) {
  return (
    <div className="flex flex-wrap items-start gap-2 rounded border border-neutral-800 p-2 text-xs" data-patch-change-row data-change-kind={change.kind}>
      <span className="rounded bg-neutral-800 px-1.5 py-0.5">{change.kind === "numeric" ? "数値変更" : "記述式変更"}</span>
      {change.kind === "numeric" ? (
        <>
          <label className="flex flex-col gap-1">
            <span>項目名</span>
            <input type="text" value={change.stat} onChange={(e) => onChange({ ...change, stat: e.target.value })} className={smallSelectClass} />
          </label>
          <label className="flex flex-col gap-1">
            <span>変更前</span>
            <input type="text" value={change.before} onChange={(e) => onChange({ ...change, before: e.target.value })} className={smallSelectClass} />
          </label>
          <label className="flex flex-col gap-1">
            <span>変更後</span>
            <input type="text" value={change.after} onChange={(e) => onChange({ ...change, after: e.target.value })} className={smallSelectClass} />
          </label>
        </>
      ) : (
        <>
          <label className="flex flex-col gap-1">
            <span>ラベル（任意）</span>
            <input type="text" value={change.stat} onChange={(e) => onChange({ ...change, stat: e.target.value })} className={smallSelectClass} />
          </label>
          <label className="flex min-w-[12rem] flex-1 flex-col gap-1">
            <span>本文</span>
            <textarea value={change.text} onChange={(e) => onChange({ ...change, text: e.target.value })} rows={2} className={smallSelectClass} />
          </label>
        </>
      )}
      <div className="ml-auto flex gap-1 self-center">
        <button type="button" onClick={() => onMove(-1)} disabled={index === 0} className={smallButtonClass} aria-label="変更行を上へ移動">
          ↑
        </button>
        <button type="button" onClick={() => onMove(1)} disabled={index === total - 1} className={smallButtonClass} aria-label="変更行を下へ移動">
          ↓
        </button>
        <button type="button" onClick={onRemove} className={smallButtonClass}>
          行を削除
        </button>
      </div>
    </div>
  );
}

function ReactionFields({
  draft,
  onChange,
}: {
  draft: Extract<BlockDraft, { type: "reaction" }>;
  onChange: (draft: BlockDraft) => void;
}) {
  function updateLine(lineIndex: number, line: ReactionLineDraft) {
    onChange({ ...draft, lines: draft.lines.map((l, i) => (i === lineIndex ? line : l)) });
  }
  function addLine() {
    onChange({ ...draft, lines: [...draft.lines, { text: "", emphasis: "", original: "" }] });
  }
  function removeLine(lineIndex: number) {
    onChange({ ...draft, lines: draft.lines.filter((_, i) => i !== lineIndex) });
  }

  return (
    <div className="flex flex-col gap-2 text-sm">
      <div className="flex flex-wrap gap-2">
        <label className="flex flex-col gap-1">
          <span>レス番号</span>
          <input
            type="text"
            inputMode="numeric"
            value={draft.number}
            onChange={(e) => onChange({ ...draft, number: e.target.value })}
            className={`${inputClass} w-24`}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span>名前</span>
          <input
            type="text"
            value={draft.name}
            onChange={(e) => onChange({ ...draft, name: e.target.value })}
            className={inputClass}
          />
        </label>
      </div>

      <div className="flex flex-col gap-2">
        <span className="font-bold">本文行</span>
        {draft.lines.map((line, lineIndex) => (
          <div key={lineIndex} className="flex flex-wrap items-start gap-2 rounded border border-neutral-800 p-2">
            <textarea
              value={line.text}
              onChange={(e) => updateLine(lineIndex, { ...line, text: e.target.value })}
              rows={2}
              placeholder="本文"
              className={`${inputClass} min-w-[12rem] flex-1`}
            />
            <label className="flex flex-col gap-1 text-xs">
              <span>行の強調</span>
              <select
                value={line.emphasis}
                onChange={(e) => updateLine(lineIndex, { ...line, emphasis: e.target.value as "" | "red" | "orange" })}
                className="rounded border border-neutral-700 bg-neutral-950 px-2 py-1 text-xs text-neutral-100"
              >
                {LINE_EMPHASIS_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs">
              <span>原文（任意・海外の反応）</span>
              <input
                type="text"
                value={line.original}
                onChange={(e) => updateLine(lineIndex, { ...line, original: e.target.value })}
                className="rounded border border-neutral-700 bg-neutral-950 px-2 py-1 text-xs text-neutral-100"
              />
            </label>
            <button
              type="button"
              onClick={() => removeLine(lineIndex)}
              disabled={draft.lines.length <= 1}
              className={`${smallButtonClass} self-center`}
            >
              行を削除
            </button>
          </div>
        ))}
        <button type="button" onClick={addLine} className={`${smallButtonClass} self-start`}>
          行を追加
        </button>
      </div>

      <label className="flex flex-col gap-1">
        <span>アンカー（カンマ区切りのレス番号、任意。例: 1,3）</span>
        <input
          type="text"
          value={draft.anchors}
          onChange={(e) => onChange({ ...draft, anchors: e.target.value })}
          className={inputClass}
        />
      </label>

      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-1">
          <input
            type="checkbox"
            checked={draft.emphasis}
            onChange={(e) => onChange({ ...draft, emphasis: e.target.checked })}
          />
          <span>レス全体を強調</span>
        </label>
        {draft.emphasis && (
          <label className="flex items-center gap-1 text-xs">
            <span>強調色</span>
            <select
              value={draft.emphasisColor}
              onChange={(e) => onChange({ ...draft, emphasisColor: e.target.value as "" | ArticleBodyEmphasisColor })}
              className="rounded border border-neutral-700 bg-neutral-950 px-2 py-1 text-xs text-neutral-100"
            >
              {RES_EMPHASIS_COLOR_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
    </div>
  );
}

type BlockItem = { id: string; draft: BlockDraft };

/** `updateArticleAction`の戻り値と構造的に一致させる（"use server"ファイルからの型re-exportを避けるため
 * ここでも同じ形を定義する。Client Componentなのでこちら側での定義に制約は無い）。
 * `revalidateWarning`（admincms-S5 F10、S5設計整理）: 保存(DB)自体は成功したが、一覧/詳細ページの
 * 同一プロセス内での即時反映（直接`revalidatePath`）が例外を投げて失敗した場合にのみ`true`になる
 * （通常は失敗しないため既定構成では出ない）。保存内容は失われていないため、redirectせずこの画面に
 * 留まり警告バナーを表示する。 */
type SaveState = { success: true; revalidateWarning: boolean } | { success: false; error: string };

export type ArticleEditorProps = {
  articleId: string;
  initialTitle: string;
  initialMetaDescription: string;
  initialCategory: string;
  initialTags: string[];
  initialThumbnailUrl: string;
  initialStatus: string;
  initialBlocks: ArticleBodyBlock[];
};

export function ArticleEditor({
  articleId,
  initialTitle,
  initialMetaDescription,
  initialCategory,
  initialTags,
  initialThumbnailUrl,
  initialStatus,
  initialBlocks,
}: ArticleEditorProps) {
  // 初期ブロックのidはindexから組み立て、追加分の採番用カウンターはそれ以降から開始する
  // （refをレンダー中(useStateの遅延初期化含む)に読まない。idの生成はイベントハンドラ内でのみ行う）。
  const idCounter = useRef(initialBlocks.length);
  const nextId = () => `b${idCounter.current++}`;

  // 保存結果は`useActionState`で受け取る。検証NG時はredirectせず、この画面自身のReact state
  // （title/items等、下記）を保持したままエラーメッセージだけを表示する（入力内容を失わない）。
  const [saveState, formAction, isPending] = useActionState<SaveState | null, FormData>(updateArticleAction, null);

  const [title, setTitle] = useState(initialTitle);
  const [metaDescription, setMetaDescription] = useState(initialMetaDescription);
  const [category, setCategory] = useState(initialCategory);
  const [tags, setTags] = useState<string[]>(initialTags);
  const [tagInput, setTagInput] = useState("");
  const [thumbnailUrl, setThumbnailUrl] = useState(initialThumbnailUrl);
  const statusEditable = initialStatus === "review" || initialStatus === "published";
  const [status, setStatus] = useState<"review" | "published">(initialStatus === "published" ? "published" : "review");
  const [items, setItems] = useState<BlockItem[]>(() =>
    initialBlocks.map((b, i) => ({ id: `b${i}`, draft: blockToDraft(b) })),
  );

  function updateBlockAt(index: number, draft: BlockDraft) {
    setItems((prev) => prev.map((it, i) => (i === index ? { ...it, draft } : it)));
  }
  function addBlockAfter(afterIndex: number | null, type: EditableBlockType) {
    setItems((prev) => insertItemAfter(prev, afterIndex, { id: nextId(), draft: createDraftBlock(type) }));
  }
  function removeBlockAt(index: number) {
    setItems((prev) => removeItemAt(prev, index));
  }
  function moveBlockAt(index: number, direction: -1 | 1) {
    setItems((prev) => moveItem(prev, index, direction));
  }

  function addTag() {
    const t = tagInput.trim();
    if (t && !tags.includes(t)) setTags((prev) => [...prev, t]);
    setTagInput("");
  }
  function removeTag(t: string) {
    setTags((prev) => prev.filter((x) => x !== t));
  }

  const blocksJson = useMemo(() => JSON.stringify(items.map((it) => it.draft)), [items]);
  const tagsJson = useMemo(() => JSON.stringify(tags), [tags]);

  return (
    <form action={formAction} className="mt-6 flex flex-col gap-6">
      <input type="hidden" name="articleId" value={articleId} />
      <input type="hidden" name="tagsJson" value={tagsJson} />
      <input type="hidden" name="blocksJson" value={blocksJson} />

      {saveState && !saveState.success && (
        <div
          data-save-error
          className="rounded-lg border border-red-900 bg-red-950/40 px-3 py-2 text-sm text-red-300"
        >
          保存に失敗しました: {saveState.error}
        </div>
      )}

      {saveState && saveState.success && saveState.revalidateWarning && (
        <div
          data-revalidate-warning
          className="rounded-lg border border-amber-800 bg-amber-950/40 px-3 py-2 text-sm text-amber-300"
        >
          保存は完了しましたが、一覧への即時反映ができませんでした（編集内容は失われていません）。
        </div>
      )}

      <section className="flex flex-col gap-3 rounded-lg border border-neutral-800 bg-neutral-900 p-4">
        <h2 className="text-sm font-bold text-neutral-300">記事メタ情報</h2>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-bold">タイトル</span>
          <input
            type="text"
            name="title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
            className={inputClass}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-bold">要約（メタディスクリプション）</span>
          <textarea
            name="metaDescription"
            value={metaDescription}
            onChange={(e) => setMetaDescription(e.target.value)}
            rows={2}
            className={inputClass}
          />
        </label>
        <div className="flex flex-wrap gap-4">
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-bold">カテゴリ</span>
            <select name="category" value={category} onChange={(e) => setCategory(e.target.value)} className={inputClass}>
              {CATEGORY_LABELS.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-bold">サムネイルURL</span>
            <input
              type="text"
              name="thumbnailUrl"
              value={thumbnailUrl}
              onChange={(e) => setThumbnailUrl(e.target.value)}
              className={`${inputClass} w-64`}
            />
          </label>
        </div>

        <div className="flex flex-col gap-1 text-sm">
          <span className="font-bold">タグ</span>
          <div className="flex flex-wrap gap-2">
            {tags.map((t) => (
              <span
                key={t}
                className="flex items-center gap-1 rounded-full border border-neutral-700 px-2 py-0.5 text-xs"
              >
                #{t}
                <button
                  type="button"
                  onClick={() => removeTag(t)}
                  className="text-neutral-400 hover:text-red-400"
                  aria-label={`タグ${t}を削除`}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
          <div className="mt-1 flex gap-2">
            <input
              type="text"
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addTag();
                }
              }}
              placeholder="タグ名を入力"
              className={inputClass}
            />
            <button type="button" onClick={addTag} className={smallButtonClass}>
              追加
            </button>
          </div>
        </div>

        <div className="flex flex-col gap-1 text-sm">
          <span className="font-bold">公開状態</span>
          {statusEditable ? (
            <div className="flex gap-4">
              <label className="flex items-center gap-1">
                <input
                  type="radio"
                  name="status"
                  value="review"
                  checked={status === "review"}
                  onChange={() => setStatus("review")}
                />
                要レビュー
              </label>
              <label className="flex items-center gap-1">
                <input
                  type="radio"
                  name="status"
                  value="published"
                  checked={status === "published"}
                  onChange={() => setStatus("published")}
                />
                公開
              </label>
            </div>
          ) : (
            <p className="text-xs text-neutral-400">
              現在の状態: {STATUS_LABELS[initialStatus] ?? initialStatus}（このエディタでは変更できません）
            </p>
          )}
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-bold text-neutral-300">本文ブロック</h2>
        {items.length === 0 && (
          <p className="text-sm text-neutral-400">ブロックがありません。下のメニューから追加してください。</p>
        )}
        {items.map((item, index) => (
          <div key={item.id} className="flex flex-col gap-2">
            <BlockCard
              draft={item.draft}
              index={index}
              total={items.length}
              onChange={(draft) => updateBlockAt(index, draft)}
              onMove={(direction) => moveBlockAt(index, direction)}
              onRemove={() => removeBlockAt(index)}
            />
            <AddBlockControl label="この直後に追加" onAdd={(type) => addBlockAfter(index, type)} />
          </div>
        ))}
        {items.length === 0 && <AddBlockControl label="末尾に追加" onAdd={(type) => addBlockAfter(null, type)} />}
      </section>

      <div className="flex gap-3">
        <button
          type="submit"
          disabled={isPending}
          className="rounded bg-emerald-700 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isPending ? "保存中..." : "保存する"}
        </button>
        <Link
          href={`/admin/articles/${articleId}/preview`}
          className="rounded border border-neutral-700 px-4 py-2 text-sm text-neutral-300 hover:bg-neutral-900"
        >
          プレビュー
        </Link>
        <Link href="/admin" className="rounded border border-neutral-700 px-4 py-2 text-sm text-neutral-300 hover:bg-neutral-900">
          キャンセル
        </Link>
      </div>
    </form>
  );
}
