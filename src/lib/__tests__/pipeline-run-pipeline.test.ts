/**
 * 統合パイプライン（F10・F11）の結合テスト。専用テストDB（vitest.global-setup.ts で
 * DATABASE_URL を差し替え済み）に対して実際にPrisma経由で書き込み、
 * 「完走・上限・重複防止・失敗継続・運営ログ」を検証する。
 */
import { describe, expect, it, beforeEach } from "vitest";
import { prisma } from "@/lib/prisma";
import { runFullPipeline, type PipelineRunOptions } from "@/lib/pipeline/run-pipeline";
import { rebuildCandidateQueue } from "@/lib/collection/queue";
import { MockLLMClient } from "@/lib/generation/llm-client";
import type { RawCollectionItem, SourceAdapter, SourceType } from "@/lib/collection/types";

/**
 * このテストファイルは実APIを叩かない方針のため、championMap は明示的にnull
 * （チャンピオン検出のフェッチ自体をスキップ）を既定にする（拡張E31）。
 * チャンピオン検出の配線自体は generation-generate-article.test.ts / champion-thumbnail.test.ts で
 * スタブMapを使って別途検証する。
 *
 * リファクタリングS5a F-S5a-2: 既定の生成経路は"post"（hot判定されたPostだけをAIで記事化する
 * 新フロー）に変わったが、このファイルは従来どおりCollectedItemベースの記事化
 * （generateArticlesForQueue、CollectedItemの状態遷移・重複防止等）を検証する比較用の回帰テストのため、
 * generationSource: "collected"（旧経路）を明示して従来の期待値のまま動かす
 * （新フロー自体のテストは generation-post-pipeline.test.ts、経路切替自体のテストは本ファイル末尾）。
 */
function runPipeline(options: PipelineRunOptions = {}) {
  return runFullPipeline({ championMap: null, generationSource: "collected", ...options });
}

class FakeAdapter implements SourceAdapter {
  constructor(
    public readonly sourceType: SourceType,
    private readonly itemsOrThrow: RawCollectionItem[] | (() => RawCollectionItem[]),
  ) {}
  async fetchItems(): Promise<RawCollectionItem[]> {
    if (typeof this.itemsOrThrow === "function") return this.itemsOrThrow();
    return this.itemsOrThrow;
  }
}

function item(overrides: {
  sourceUrl: string;
  title: string;
  content: string;
  imageUrl?: string | null;
}): RawCollectionItem {
  return { fetchedAt: new Date("2026-07-20T00:00:00+09:00"), ...overrides };
}

async function resetDb() {
  await prisma.pipelineRunLog.deleteMany();
  await prisma.sourceFetchLog.deleteMany();
  await prisma.articleSource.deleteMany();
  await prisma.articleTag.deleteMany();
  await prisma.collectedItem.deleteMany();
  await prisma.article.deleteMany();
  await prisma.tag.deleteMany();
}

beforeEach(async () => {
  await resetDb();
});

const llm = new MockLLMClient();
const T0 = new Date("2026-07-25T00:00:00+09:00");
const hours = (n: number) => n * 60 * 60 * 1000;

describe("runFullPipeline（統合パイプライン）", () => {
  it("1回の起動で収集→重複排除→生成→タイトル→安全フィルタ→公開まで人手介入なしで完走し、公開記事が増える", async () => {
    const adapters = [
      new FakeAdapter("riot", [
        item({
          sourceUrl: "https://www.leagueoflegends.com/ja-jp/news/patch-15-1/",
          title: "パッチ15.1ノート公開",
          content: "本パッチではジャングルモンスターの経験値量が引き下げられ、序盤のペースに変化が生まれた。",
        }),
      ]),
      new FakeAdapter("5ch", [
        item({
          sourceUrl: "https://leagueoflegends.5ch.net/test/read.cgi/game/2000000001/",
          title: "【LoL】ヤスオの壁飛びコンボがすごいと話題のスレ",
          content: "壁飛びから連続でキャリーする神プレイに賞賛の声が相次いだ実況スレ。",
        }),
      ]),
    ];

    const report = await runPipeline({ adapters, llmClient: llm, now: T0 });

    expect(report.status).toBe("success");
    expect(report.collectedCount).toBeGreaterThan(0);
    expect(report.candidateCount).toBeGreaterThan(0);
    expect(report.publishedCount).toBeGreaterThan(0);

    const publishedTotal = await prisma.article.count({ where: { status: "published" } });
    expect(publishedTotal).toBe(report.publishedCount);

    // 実行ログ（F11）が5指標を含めて記録されている
    const log = await prisma.pipelineRunLog.findFirst({ orderBy: { startedAt: "desc" } });
    expect(log).not.toBeNull();
    expect(log?.status).toBe("success");
    expect(log?.collectedCount).toBe(report.collectedCount);
    expect(log?.candidateCount).toBe(report.candidateCount);
    expect(log?.publishedCount).toBe(report.publishedCount);
  });

  it("収集アイテムのimageUrlが公開記事のthumbnailUrlに反映される(拡張E19 F-E19-3)", async () => {
    const splashUrl = "https://ddragon.leagueoflegends.com/cdn/img/champion/splash/Lillia_0.jpg";
    const adapters = [
      new FakeAdapter("riot", [
        item({
          sourceUrl: "https://www.leagueoflegends.com/ja-jp/champions/lillia/",
          title: "【チャンピオン紹介】リリア（夢の子鹿）",
          content: "リリアは夢を司る子鹿の精霊であり、眠りの森を守るチャンピオンだ。",
          imageUrl: splashUrl,
        }),
      ]),
    ];

    const report = await runPipeline({ adapters, llmClient: llm, now: T0 });
    expect(report.publishedCount).toBeGreaterThan(0);

    const published = await prisma.article.findFirst({ where: { status: "published" } });
    expect(published?.thumbnailUrl).toBe(splashUrl);
  });

  it("収集アイテムにimageUrlが無い場合、公開記事のthumbnailUrlはnullのままになる(表示側が既定画像にフォールバックする)", async () => {
    const adapters = [
      new FakeAdapter("riot", [
        item({
          sourceUrl: "https://www.leagueoflegends.com/ja-jp/news/patch-15-9/",
          title: "パッチ15.9ノート公開",
          content: "本パッチではサポートアイテムの一部性能が調整された。",
        }),
      ]),
    ];

    const report = await runPipeline({ adapters, llmClient: llm, now: T0 });
    expect(report.publishedCount).toBeGreaterThan(0);

    const published = await prisma.article.findFirst({ where: { status: "published" } });
    expect(published?.thumbnailUrl).toBeNull();
  });

  it("championMapを渡すとimageUrl無しでもチャンピオン検出でスプラッシュURLがthumbnailUrlになる(拡張E31 F-E31-1/2)", async () => {
    const adapters = [
      new FakeAdapter("5ch", [
        item({
          sourceUrl: "https://leagueoflegends.5ch.net/test/read.cgi/game/2000000099/",
          title: "【LoL】リサンドラが強すぎると話題のスレ",
          content: "1: リサンドラの氷結スキルが強すぎて対処法が無い。\n2: 確かにリサンドラは今パッチ最強クラス。",
        }),
      ]),
    ];
    const report = await runPipeline({
      adapters,
      llmClient: llm,
      now: T0,
      championMap: new Map([["リサンドラ", "Lissandra"]]),
    });
    expect(report.publishedCount).toBeGreaterThan(0);

    const published = await prisma.article.findFirst({ where: { status: "published" } });
    expect(published?.thumbnailUrl).toBe(
      "https://ddragon.leagueoflegends.com/cdn/img/champion/splash/Lissandra_0.jpg",
    );
  });

  it("1回の実行で公開する記事本数の上限を超えて一度に公開しない", async () => {
    const adapters = [
      new FakeAdapter("riot", [
        item({
          sourceUrl: "https://www.leagueoflegends.com/ja-jp/news/jungle-adjust/",
          title: "ジャングルモンスターの経験値調整について",
          content: "序盤のレベル差を抑えるための経験値調整が発表された。",
        }),
        item({
          sourceUrl: "https://www.leagueoflegends.com/ja-jp/news/new-champion/",
          title: "新チャンピオンが実装決定",
          content: "新たなチャンピオンの実装が正式に決定し、詳細情報が公開された。",
        }),
        item({
          sourceUrl: "https://www.leagueoflegends.com/ja-jp/news/yasuo-ban/",
          title: "ヤスオの大会使用禁止に関する声明",
          content: "大会運営から特定チャンピオンの使用制限に関する声明が出された。",
        }),
      ]),
    ];

    const report = await runPipeline({ adapters, llmClient: llm, now: T0, maxPublishPerRun: 1 });

    expect(report.candidateCount).toBeGreaterThanOrEqual(2);
    expect(report.publishedCount).toBeLessThanOrEqual(1);

    const publishedTotal = await prisma.article.count({ where: { status: "published" } });
    expect(publishedTotal).toBeLessThanOrEqual(1);
  });

  it("繰り返し実行すると新規記事が積み上がり、同じアイテムの再実行では重複公開されず、候補枯渇時は0件公開で正常終了する", async () => {
    const first = item({
      sourceUrl: "https://www.leagueoflegends.com/ja-jp/news/patch-15-2/",
      title: "パッチ15.2ノート公開",
      content: "本パッチではミッドレーンの複数チャンピオンにバランス調整が入った。",
    });

    const report1 = await runPipeline({
      adapters: [new FakeAdapter("riot", [first])],
      llmClient: llm,
      now: T0,
    });
    expect(report1.publishedCount).toBeGreaterThan(0);
    const afterRun1 = await prisma.article.count({ where: { status: "published" } });

    // スケジュール間隔を空けて2回目を実行(レート制限回避)。前回と同じアイテム+新規1件。
    const second = item({
      sourceUrl: "https://www.leagueoflegends.com/ja-jp/news/worlds-2026-draw/",
      title: "World Championship 2026 グループステージ組み合わせ発表",
      content: "各地域を代表するチームのグループステージ組み合わせが決定した。",
    });
    const report2 = await runPipeline({
      adapters: [new FakeAdapter("riot", [first, second])],
      llmClient: llm,
      now: new Date(T0.getTime() + hours(5)),
    });
    expect(report2.publishedCount).toBe(1); // 新規分のみ公開される
    const afterRun2 = await prisma.article.count({ where: { status: "published" } });
    expect(afterRun2).toBe(afterRun1 + 1); // 既公開記事は重複公開されない

    // 3回目: 新規ソースアイテムなし(候補枯渇) → エラーにならず0件公開で正常終了する
    const report3 = await runPipeline({
      adapters: [new FakeAdapter("riot", [first, second])],
      llmClient: llm,
      now: new Date(T0.getTime() + hours(10)),
    });
    expect(report3.status).toBe("success");
    expect(report3.candidateCount).toBe(0);
    expect(report3.publishedCount).toBe(0);
    const afterRun3 = await prisma.article.count({ where: { status: "published" } });
    expect(afterRun3).toBe(afterRun2);
  });

  it("収集ソースの1件が失敗しても、パイプライン全体は停止せず他ソースの処理を完走する", async () => {
    const adapters: SourceAdapter[] = [
      new FakeAdapter("riot", [
        item({
          sourceUrl: "https://www.leagueoflegends.com/ja-jp/news/patch-15-3/",
          title: "パッチ15.3ノート公開",
          content: "サポートアイテムの価格に関する調整が発表された。",
        }),
      ]),
      new FakeAdapter("5ch", () => {
        throw new Error("5chへの接続に失敗しました(意図的な失敗・テスト用)");
      }),
    ];

    const report = await runPipeline({ adapters, llmClient: llm, now: T0 });

    expect(report.status).toBe("success"); // 全体は正常終了する
    const riotSummary = report.sourceSummaries.find((s) => s.sourceType === "riot");
    const chSummary = report.sourceSummaries.find((s) => s.sourceType === "5ch");
    expect(riotSummary?.status).toBe("success");
    expect(chSummary?.status).toBe("failure");
    expect(report.publishedCount).toBeGreaterThan(0); // riot分は処理が完走している

    const failureLog = await prisma.sourceFetchLog.findFirst({ where: { sourceType: "5ch", status: "failure" } });
    expect(failureLog).not.toBeNull();
  });

  it("生成に失敗した候補は破棄されず、次回のキュー再構築で再処理対象(queued)に戻る", async () => {
    // 拡張E41 F-E41-2: riot(既定fact)は本文の長短に関わらず事実速報が生成され失敗しなくなったため、
    // 生成失敗の再現はreactionブロックが1件も組み立てられない(空content)5ch候補で行う。
    const adapters = [
      new FakeAdapter("riot", [
        item({
          sourceUrl: "https://www.leagueoflegends.com/ja-jp/news/patch-15-4/",
          title: "パッチ15.4ノート公開",
          content: "アイテム全般のコストバランスが見直された。",
        }),
      ]),
      new FakeAdapter("5ch", [
        item({
          sourceUrl: "https://leagueoflegends.5ch.net/test/read.cgi/game/empty-reaction/",
          title: "【LoL】空スレ", // 空内容でreactionブロックが1件も組み立てられず生成失敗を意図的に起こす
          content: "", // 空内容 → 生成失敗(reactionブロック0件)を意図的に起こす
        }),
      ]),
    ];

    const report = await runPipeline({ adapters, llmClient: llm, now: T0 });

    expect(report.generationSucceeded).toBe(1);
    expect(report.generationFailed).toBe(1);
    expect(report.publishedCount).toBe(1); // 失敗した1件を除き、他候補の処理は完走している

    const failedItem = await prisma.collectedItem.findFirst({
      where: { sourceUrl: "https://leagueoflegends.5ch.net/test/read.cgi/game/empty-reaction/" },
    });
    expect(failedItem?.status).toBe("generation_failed");
    expect(failedItem?.articleId).toBeNull(); // 恒久的に消えない(破棄されない)

    // 次回のキュー再構築で再度 queued に戻る(再処理対象になる)
    const queueSummary = await rebuildCandidateQueue();
    expect(queueSummary.queuedCount).toBeGreaterThanOrEqual(1);
    const refetched = await prisma.collectedItem.findUnique({ where: { id: failedItem!.id } });
    expect(refetched?.status).toBe("queued");
  });

  it("全ソースが応答しない最悪ケースでもクラッシュせず、ログにエラーを残して正常終了する", async () => {
    const adapters: SourceAdapter[] = [
      new FakeAdapter("riot", () => {
        throw new Error("riot応答なし(テスト用)");
      }),
      new FakeAdapter("5ch", () => {
        throw new Error("5ch応答なし(テスト用)");
      }),
      new FakeAdapter("reddit", () => {
        throw new Error("reddit応答なし(テスト用)");
      }),
    ];

    const report = await runPipeline({ adapters, llmClient: llm, now: T0 });

    expect(report.status).toBe("success"); // クラッシュせず正常終了
    expect(report.collectedCount).toBe(0);
    expect(report.publishedCount).toBe(0);
    expect(report.sourceSummaries.every((s) => s.status === "failure")).toBe(true);

    const failureLogs = await prisma.sourceFetchLog.findMany({ where: { status: "failure" } });
    expect(failureLogs.length).toBe(3);

    const runLog = await prisma.pipelineRunLog.findFirst({ orderBy: { startedAt: "desc" } });
    expect(runLog?.status).toBe("success");
    expect(runLog?.collectedCount).toBe(0);
    expect(runLog?.publishedCount).toBe(0);
  });

  it("maxPublishPerRun未指定時、generateArticlesForQueueへカテゴリ別上限(maxPerCategory)を渡す(拡張E48)", async () => {
    let receivedOptions: Parameters<NonNullable<PipelineRunOptions["generateArticles"]>>[1] | undefined;
    const generateArticlesSpy: NonNullable<PipelineRunOptions["generateArticles"]> = async (_client, options) => {
      receivedOptions = options;
      return { succeededCount: 0, failedCount: 0, results: [] };
    };

    await runPipeline({ now: T0, generateArticles: generateArticlesSpy });

    expect(receivedOptions?.maxPerCategory).toBeGreaterThan(0);
    expect(receivedOptions?.maxCandidates).toBeUndefined();
  });

  it("maxPublishPerRunを明示指定した場合は、従来どおり総数上限(maxCandidates)を渡す(後方互換)", async () => {
    let receivedOptions: Parameters<NonNullable<PipelineRunOptions["generateArticles"]>>[1] | undefined;
    const generateArticlesSpy: NonNullable<PipelineRunOptions["generateArticles"]> = async (_client, options) => {
      receivedOptions = options;
      return { succeededCount: 0, failedCount: 0, results: [] };
    };

    await runPipeline({ now: T0, maxPublishPerRun: 1, generateArticles: generateArticlesSpy });

    expect(receivedOptions?.maxCandidates).toBe(1);
    expect(receivedOptions?.maxPerCategory).toBeUndefined();
  });

  it("工程をまたぐ想定外の例外が起きてもクラッシュせず、実行ログに失敗として記録して正常終了する", async () => {
    const report = await runPipeline({
      now: T0,
      runCollection: async () => {
        throw new Error("想定外のDB異常(テスト用)");
      },
    });

    expect(report.status).toBe("failure");
    expect(report.errorMessage).toContain("想定外のDB異常");

    const runLog = await prisma.pipelineRunLog.findFirst({ orderBy: { startedAt: "desc" } });
    expect(runLog?.status).toBe("failure");
    expect(runLog?.errorMessage).toContain("想定外のDB異常");
  });
});

/**
 * 生成経路の切替（リファクタリングS5a F-S5a-2）の結合テスト。実際の生成ロジック（新旧いずれも）は
 * generation-post-pipeline.test.ts / generation-pipeline.test.ts で別途検証済みのため、ここでは
 * runFullPipeline が options.generationSource（未指定時はenv GENERATION_SOURCE）に従って
 * どちらの生成関数を呼ぶかだけをスパイで検証する（DB書き込みは発生させない）。
 */
describe("runFullPipeline の生成経路切替（GENERATION_SOURCE、リファクタリングS5a F-S5a-2）", () => {
  it("generationSource未指定・env未設定時は既定でgeneratePostArticles（新フロー）が呼ばれる", async () => {
    const original = process.env.GENERATION_SOURCE;
    delete process.env.GENERATION_SOURCE;
    try {
      let called = false;
      await runFullPipeline({
        now: T0,
        championMap: null,
        generatePostArticles: async () => {
          called = true;
          return { succeededCount: 0, failedCount: 0, results: [] };
        },
        generateArticles: async () => {
          throw new Error("旧経路が誤って呼ばれた(テスト用)");
        },
      });
      expect(called).toBe(true);
    } finally {
      if (original === undefined) delete process.env.GENERATION_SOURCE;
      else process.env.GENERATION_SOURCE = original;
    }
  });

  it('generationSource:"collected" 指定時は旧経路(generateArticlesForQueue相当)が呼ばれる', async () => {
    let called = false;
    await runFullPipeline({
      now: T0,
      championMap: null,
      generationSource: "collected",
      generateArticles: async () => {
        called = true;
        return { succeededCount: 0, failedCount: 0, results: [] };
      },
      generatePostArticles: async () => {
        throw new Error("新フローが誤って呼ばれた(テスト用)");
      },
    });
    expect(called).toBe(true);
  });

  it('env GENERATION_SOURCE="collected" のときはoptions未指定でも旧経路が呼ばれる', async () => {
    const original = process.env.GENERATION_SOURCE;
    process.env.GENERATION_SOURCE = "collected";
    try {
      let called = false;
      await runFullPipeline({
        now: T0,
        championMap: null,
        generateArticles: async () => {
          called = true;
          return { succeededCount: 0, failedCount: 0, results: [] };
        },
        generatePostArticles: async () => {
          throw new Error("新フローが誤って呼ばれた(テスト用)");
        },
      });
      expect(called).toBe(true);
    } finally {
      if (original === undefined) delete process.env.GENERATION_SOURCE;
      else process.env.GENERATION_SOURCE = original;
    }
  });
});
