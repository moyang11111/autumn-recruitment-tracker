import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import test from "node:test";

import {
  deduplicateRecords,
  normalizeCity,
  normalizeJob,
  payloadContentChanged,
  renderJavaScript,
  renderJson,
  stableRecordId,
  syncJobs,
  writeSnapshotFiles,
} from "../scripts/sync-jobs.mjs";

const NOW = "2026-09-01T12:00:00.000Z";
const EARLIER = "2026-08-31T12:00:00.000Z";

const greenhouseSource = {
  id: "gh-fixture",
  name: "Fixture Greenhouse",
  type: "greenhouse",
  boardToken: "fixture",
  companyName: "示例科技",
  companyType: "外企",
  campusUrl: "https://example.com/careers",
};

const leverSource = {
  id: "lever-fixture",
  name: "Fixture Lever",
  type: "lever",
  site: "fixture",
  companyName: "示例软件",
  companyType: "私企",
  campusUrl: "https://software.example.com/careers",
};

function response(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return body;
    },
  };
}

function mockFetch(routes) {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    const route = routes[url];
    if (route instanceof Error) throw route;
    if (typeof route === "function") return route(url, options);
    if (route === undefined) throw new Error(`unexpected URL: ${url}`);
    return response(route);
  };
  return { calls, fetchImpl };
}

function previousRecord(overrides = {}) {
  return {
    id: stableRecordId("gh-fixture", "old-1"),
    companyName: "示例科技",
    companyType: "外企",
    openDate: "",
    deadline: "",
    province: "广东",
    city: "深圳",
    jobCategories: ["研发"],
    campusUrl: "https://boards.greenhouse.io/fixture/jobs/old-1",
    sourceId: "gh-fixture",
    sourceName: "Fixture Greenhouse",
    sourceType: "greenhouse",
    sourceUpdatedAt: "2026-08-30T10:00:00.000Z",
    fetchedAt: EARLIER,
    status: "已投递",
    statusUpdatedAt: "2026-08-30T11:00:00.000Z",
    isDemo: false,
    ...overrides,
  };
}

test("正常同步 Greenhouse 与 Lever，规范化字段并忽略危险岗位链接", async () => {
  const greenhouseUrl = "https://boards-api.greenhouse.io/v1/boards/fixture/jobs?content=true";
  const leverUrl = "https://api.lever.co/v0/postings/fixture?mode=json";
  const greenhouseJob = {
    id: 101,
    title: "后端工程师",
    absolute_url: "https://boards.greenhouse.io/fixture/jobs/101",
    location: { name: "广东省深圳市" },
    departments: [{ name: "工程" }, { name: "工程" }, { name: "平台" }],
    created_at: "2026-08-01T00:00:00Z",
    updated_at: "2026-08-31T08:00:00Z",
  };
  const unsafeGreenhouseJob = {
    id: 102,
    title: "不安全岗位",
    absolute_url: "javascript:alert(1)",
    location: { name: "上海市" },
  };
  const leverJob = {
    id: "lever-7",
    text: "Product Engineer",
    hostedUrl: "https://jobs.lever.co/fixture/lever-7",
    categories: { location: "杭州, China", team: "Engineering", department: "Product" },
    createdAt: 1_725_000_000_000,
    updatedAt: 1_725_100_000_000,
  };
  const mock = mockFetch({
    [greenhouseUrl]: { jobs: [greenhouseJob, unsafeGreenhouseJob] },
    [leverUrl]: [leverJob],
  });

  const payload = await syncJobs({
    sources: [leverSource, greenhouseSource],
    fetchImpl: mock.fetchImpl,
    now: NOW,
  });

  assert.equal(payload.schemaVersion, 1);
  assert.equal(payload.generatedAt, NOW);
  assert.equal(payload.records.length, 2);
  assert.deepEqual(payload.sources.map((source) => [source.id, source.status, source.recordCount]), [
    ["gh-fixture", "ok", 1],
    ["lever-fixture", "ok", 1],
  ]);

  const greenhouseRecord = payload.records.find((record) => record.sourceId === "gh-fixture");
  const leverRecord = payload.records.find((record) => record.sourceId === "lever-fixture");
  assert.deepEqual({ province: greenhouseRecord.province, city: greenhouseRecord.city }, { province: "广东", city: "深圳" });
  assert.deepEqual(greenhouseRecord.jobCategories, ["工程", "平台"]);
  assert.equal(greenhouseRecord.openDate, "", "只有 created_at 时不能伪造开放日期");
  assert.equal(greenhouseRecord.deadline, "", "来源没有截止日期时应为空");
  assert.equal(greenhouseRecord.status, "未投递");
  assert.equal(greenhouseRecord.statusUpdatedAt, NOW);
  assert.deepEqual({ province: leverRecord.province, city: leverRecord.city }, { province: "浙江", city: "杭州" });
  assert.deepEqual(leverRecord.jobCategories, ["Engineering", "Product"]);
  assert.equal(payload.records.some((record) => record.id.includes("102")), false);
  assert.equal(mock.calls.every(({ options }) => options.method === "GET"), true);
  assert.equal(mock.calls.every(({ url }) => url.startsWith("https://")), true);
});

test("来源失败时隔离错误并保留上一快照及投递状态", async () => {
  const greenhouseUrl = "https://boards-api.greenhouse.io/v1/boards/fixture/jobs?content=true";
  const leverUrl = "https://api.lever.co/v0/postings/fixture?mode=json";
  const mock = mockFetch({
    [greenhouseUrl]: new Error("fixture unavailable"),
    [leverUrl]: [],
  });
  const old = previousRecord();
  const payload = await syncJobs({
    sources: [greenhouseSource, leverSource],
    previousPayload: {
      schemaVersion: 1,
      generatedAt: EARLIER,
      sources: [{ id: greenhouseSource.id, status: "ok", lastCheckedAt: EARLIER, recordCount: 1 }],
      records: [old],
    },
    fetchImpl: mock.fetchImpl,
    now: NOW,
  });

  const source = payload.sources.find((item) => item.id === greenhouseSource.id);
  assert.equal(source.status, "error");
  assert.equal(source.recordCount, 1);
  assert.match(source.error, /fixture unavailable/);
  assert.equal(source.lastCheckedAt, NOW);
  assert.deepEqual(payload.records.find((record) => record.id === old.id), old);
  assert.equal(payload.sources.find((item) => item.id === leverSource.id).status, "ok");
  assert.equal(payload.sources.find((item) => item.id === leverSource.id).recordCount, 0);
});

test("成功刷新同一岗位时也保留用户投递状态", async () => {
  const url = "https://boards-api.greenhouse.io/v1/boards/fixture/jobs?content=true";
  const job = {
    id: "kept-state",
    title: "状态保留岗位",
    absolute_url: "https://boards.greenhouse.io/fixture/jobs/kept-state",
    updated_at: "2026-09-01T00:00:00Z",
  };
  const old = previousRecord({
    id: stableRecordId("gh-fixture", "kept-state"),
    campusUrl: job.absolute_url,
    status: "面试中",
    statusUpdatedAt: "2026-08-30T11:00:00.000Z",
  });
  const payload = await syncJobs({
    sources: [greenhouseSource],
    previousPayload: { schemaVersion: 1, sources: [], records: [old] },
    fetchImpl: mockFetch({ [url]: { jobs: [job] } }).fetchImpl,
    now: NOW,
  });
  assert.equal(payload.records[0].status, "面试中");
  assert.equal(payload.records[0].statusUpdatedAt, old.statusUpdatedAt);
  assert.equal(payload.records[0].fetchedAt, NOW);
});

test("危险来源 URL 不会触发请求，危险岗位 URL 不会进入快照", async () => {
  let called = false;
  const unsafeSource = {
    ...greenhouseSource,
    id: "gh-unsafe-source",
    endpoint: "http://boards-api.greenhouse.io/v1/boards/fixture/jobs",
  };
  const payload = await syncJobs({
    sources: [unsafeSource],
    fetchImpl: async () => {
      called = true;
      return response({ jobs: [] });
    },
    now: NOW,
  });
  assert.equal(called, false);
  assert.equal(payload.sources[0].status, "error");
  assert.match(payload.sources[0].error, /HTTPS/);

  const record = normalizeJob({
    id: "dangerous",
    title: "危险链接",
    absolute_url: "data:text/html,blocked",
  }, greenhouseSource, NOW);
  assert.equal(record, null);
});

test("重复岗位按稳定 ID/链接去重，输入顺序不影响输出", async () => {
  const url = "https://boards-api.greenhouse.io/v1/boards/fixture/jobs?content=true";
  const first = {
    id: "same-id",
    title: "旧标题",
    absolute_url: "https://boards.greenhouse.io/fixture/jobs/same-id",
    updated_at: "2026-08-30T00:00:00Z",
  };
  const second = {
    id: "same-id",
    title: "新标题",
    absolute_url: "https://boards.greenhouse.io/fixture/jobs/same-id",
    updated_at: "2026-08-31T00:00:00Z",
  };
  const payloadA = await syncJobs({
    sources: [greenhouseSource],
    fetchImpl: mockFetch({ [url]: { jobs: [first, second] } }).fetchImpl,
    now: NOW,
  });
  const payloadB = await syncJobs({
    sources: [greenhouseSource],
    fetchImpl: mockFetch({ [url]: { jobs: [second, first] } }).fetchImpl,
    now: NOW,
  });
  assert.equal(payloadA.records.length, 1);
  assert.equal(payloadA.records[0].sourceUpdatedAt, "2026-08-31T00:00:00.000Z");
  assert.deepEqual(payloadA, payloadB);
  assert.equal(stableRecordId("gh-fixture", "same-id"), payloadA.records[0].id);
  assert.equal(deduplicateRecords([...payloadA.records, ...payloadA.records]).length, 1);
});

test("缺少岗位详情链接时使用来源回退链接但不把不同岗位误合并", async () => {
  const url = "https://boards-api.greenhouse.io/v1/boards/fixture/jobs?content=true";
  const mock = mockFetch({
    [url]: {
      jobs: [
        { id: "without-url-1", title: "岗位一" },
        { id: "without-url-2", title: "岗位二" },
      ],
    },
  });
  const payload = await syncJobs({ sources: [greenhouseSource], fetchImpl: mock.fetchImpl, now: NOW });
  assert.equal(payload.records.length, 2);
  assert.equal(payload.records.every((record) => record.campusUrl === greenhouseSource.campusUrl), true);
});

test("城市映射覆盖中文、英文和未知地点", () => {
  assert.deepEqual(normalizeCity("广东省 深圳市"), { province: "广东", city: "深圳" });
  assert.deepEqual(normalizeCity("Shenzhen, China"), { province: "广东", city: "深圳" });
  assert.deepEqual(normalizeCity("上海市"), { province: "上海", city: "上海" });
  assert.deepEqual(normalizeCity("Remote"), { province: "", city: "" });
  assert.deepEqual(normalizeCity("Austin, TX"), { province: "TX", city: "Austin" });
});

test("超时只影响当前来源，其他来源仍可完成", async () => {
  const slowUrl = "https://boards-api.greenhouse.io/v1/boards/fixture/jobs?content=true";
  const fastUrl = "https://api.lever.co/v0/postings/fixture?mode=json";
  const payload = await syncJobs({
    sources: [greenhouseSource, leverSource],
    fetchImpl: async (url) => {
      if (url === slowUrl) return new Promise(() => {});
      return response([]);
    },
    timeoutMs: 15,
    now: NOW,
  });
  assert.equal(payload.sources.find((source) => source.id === greenhouseSource.id).status, "error");
  assert.match(payload.sources.find((source) => source.id === greenhouseSource.id).error, /超时/);
  assert.equal(payload.sources.find((source) => source.id === leverSource.id).status, "ok");
});

test("固定时间下 JSON/JS 输出确定且 file:// 风格脚本可加载", async () => {
  const source = {
    id: "gh-fixture",
    name: "Fixture Greenhouse",
    type: "greenhouse",
    status: "ok",
    lastCheckedAt: NOW,
    recordCount: 0,
  };
  const payload = { schemaVersion: 1, generatedAt: NOW, sources: [source], records: [] };
  const json = renderJson(payload);
  assert.equal(json, renderJson(JSON.parse(json)));
  const context = vm.createContext({});
  vm.runInContext(renderJavaScript(payload), context);
  assert.deepEqual(JSON.parse(JSON.stringify(context.RECRUITMENT_SYNC_PAYLOAD)), payload);

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "recruitment-sync-"));
  const jsonPath = path.join(tempDir, "jobs.generated.json");
  const jsPath = path.join(tempDir, "jobs.generated.js");
  try {
    const firstWrite = await writeSnapshotFiles(payload, { jsonPath, jsPath, previousPayload: null });
    assert.equal(firstWrite.changed, true);
    const before = await fs.readFile(jsonPath, "utf8");
    const volatileOnlyChange = {
      ...payload,
      generatedAt: "2026-09-02T12:00:00.000Z",
      sources: [{ ...source, lastCheckedAt: "2026-09-02T12:00:00.000Z" }],
    };
    assert.equal(payloadContentChanged(payload, volatileOnlyChange), false);
    const secondWrite = await writeSnapshotFiles(volatileOnlyChange, {
      jsonPath,
      jsPath,
      previousPayload: payload,
    });
    assert.equal(secondWrite.changed, false);
    assert.equal(await fs.readFile(jsonPath, "utf8"), before);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});
