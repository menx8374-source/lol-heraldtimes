"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { tagCloudSizeClass, type TagCount } from "@/lib/tags";

/**
 * タグ一覧ページ（拡張E10）本体。全タグを記事数付きで表示し、タグ名の部分一致で
 * 絞り込む簡易検索欄を持つ（「タグでも検索できる」導線）。絞り込みはクライアント側の
 * 文字列一致のみ（タグ総数は語彙として有界なため全件をあらかじめ渡してよい）。
 */
export function TagListing({ tags }: { tags: TagCount[] }) {
  const [query, setQuery] = useState("");
  const maxCount = tags[0]?.count ?? 0;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return tags;
    return tags.filter((t) => t.name.toLowerCase().includes(q));
  }, [tags, query]);

  return (
    <div>
      <label className="mb-3 block text-sm">
        <span className="mb-1 block text-neutral-600 dark:text-neutral-400">タグ名で絞り込む</span>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="例: ヤスオ"
          className="w-full max-w-xs rounded border border-neutral-300 px-3 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-900"
        />
      </label>

      {tags.length === 0 ? (
        <p className="text-sm text-neutral-500 dark:text-neutral-400">タグがありません</p>
      ) : filtered.length === 0 ? (
        <p className="text-sm text-neutral-500 dark:text-neutral-400">
          「{query}」に一致するタグがありません
        </p>
      ) : (
        <ul className="flex flex-wrap items-baseline gap-x-3 gap-y-2">
          {filtered.map((tag) => (
            <li key={tag.name}>
              <Link
                href={`/tags/${tag.name}`}
                className={`${tagCloudSizeClass(tag.count, maxCount)} text-sky-700 hover:underline dark:text-sky-400`}
              >
                #{tag.name}
                <span className="ml-1 text-xs text-neutral-400 dark:text-neutral-500">
                  {tag.count}件
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
