import Link from "next/link";

export function SiteHeader() {
  return (
    <header className="w-full bg-neutral-900 text-white">
      <div className="mx-auto max-w-5xl px-4 py-4">
        <Link href="/" className="inline-flex flex-col">
          <span className="text-xl font-bold tracking-tight">LoLまとめ速報</span>
          <span className="text-xs text-neutral-400">
            海外・5chの反応 / パッチ情報 / eスポーツをまとめて速報
          </span>
        </Link>
      </div>
    </header>
  );
}
