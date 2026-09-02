import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import test from "node:test";

import {
  GUANGDONG_CITIES,
  deduplicateRecords,
  filterGuangdongRecords,
  isGuangdongRecord,
  normalizeCity,
  normalizeJob,
  normalizeJobs,
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

const communitySource = {
  id: "community-fixture",
  name: "Fixture 社区聚合",
  type: "community-json",
  endpoint: "https://raw.githubusercontent.com/example/community/main/jobs.json",
  companyType: "其他",
  campusUrl: "https://github.com/example/community",
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
    categories: { location: "深圳, China", team: "Engineering", department: "Product" },
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
  assert.equal(greenhouseRecord.statusUpdatedAt, "1970-01-01T00:00:00.000Z");
  assert.deepEqual({ province: leverRecord.province, city: leverRecord.city }, { province: "广东", city: "深圳" });
  assert.deepEqual(leverRecord.jobCategories, ["Engineering", "Product"]);
  assert.equal(payload.records.some((record) => record.id.includes("102")), false);
  assert.equal(mock.calls.every(({ options }) => options.method === "GET"), true);
  assert.equal(mock.calls.every(({ url }) => url.startsWith("https://")), true);
});

test("社区聚合源会拆分多城市岗位并保留来源更新时间", async () => {
  const jobs = {
    updated: "2026-08-11",
    count: 2,
    jobs: [
      {
        c: "城市科技",
        p: "后端开发、产品经理",
        l: "北京/深圳",
        w: "批次:27届秋招正式批",
        d: "2026-10-10",
        t: "互联网",
        ind: "互联网科技",
        u: "https://jobs.example.com/campus/1",
      },
      {
        c: "城市能源集团",
        p: "电气工程师",
        l: "深圳",
        d: "招满即止",
        t: "央企",
        ind: "能源电力",
        u: "",
      },
    ],
  };
  const mock = mockFetch({ [communitySource.endpoint]: jobs });
  const payload = await syncJobs({
    sources: [communitySource],
    fetchImpl: mock.fetchImpl,
    now: NOW,
  });

  assert.equal(payload.records.length, 2);
  assert.deepEqual(
    payload.records.filter((record) => record.companyName === "城市科技").map((record) => record.city).sort(),
    ["深圳"],
  );
  const shenzhen = payload.records.find((record) => record.companyName === "城市科技" && record.city === "深圳");
  assert.equal(shenzhen.province, "广东");
  assert.equal(shenzhen.sourceType, "community-json");
  assert.equal(shenzhen.sourceUpdatedAt, "2026-08-11T00:00:00.000Z");
  assert.equal(shenzhen.deadline, "2026-10-10");
  assert.deepEqual(shenzhen.jobCategories, ["后端开发、产品经理", "互联网科技", "批次:27届秋招正式批"]);
  assert.equal(shenzhen.status, "未投递");

  const fallback = payload.records.find((record) => record.companyName === "城市能源集团");
  assert.equal(fallback.companyType, "央国企");
  assert.equal(fallback.campusUrl, communitySource.campusUrl);
  assert.equal(fallback.deadline, "");
  assert.equal(payload.sources[0].recordCount, 2);
  assert.equal(payload.sources[0].sourceUpdatedAt, "2026-08-11T00:00:00.000Z");
  assert.equal(payload.sources[0].stale, true, "成功抓取但上游更新时间超过阈值时应标记 stale");
});

test("社区聚合多城市规范化不会因相同投递链接互相去重", () => {
  const records = normalizeJobs({
    c: "同链接企业",
    p: "研发岗位",
    l: "广州、深圳、杭州",
    u: "https://jobs.example.com/campus/same",
  }, communitySource, NOW);
  assert.deepEqual(records.map((record) => [record.province, record.city]), [
    ["广东", "广州"],
    ["广东", "深圳"],
  ]);
  assert.equal(new Set(records.map((record) => record.id)).size, 2);
});

test("社区源失败时保留全部多城市记录和每条投递状态", async () => {
  const oldRecords = normalizeJobs({
    c: "同链接企业",
    p: "研发岗位",
    l: "广州、深圳",
    u: "https://jobs.example.com/campus/same",
  }, communitySource, EARLIER).map((record, index) => ({
    ...record,
    status: index === 0 ? "已投递" : "面试中",
    statusUpdatedAt: `${EARLIER.slice(0, 10)}T${index + 11}:00:00.000Z`,
  }));
  const payload = await syncJobs({
    sources: [communitySource],
    previousPayload: {
      schemaVersion: 1,
      generatedAt: EARLIER,
      sources: [{ id: communitySource.id, status: "ok", recordCount: oldRecords.length }],
      records: oldRecords,
    },
    fetchImpl: async () => {
      throw new Error("community offline");
    },
    now: NOW,
  });

  assert.equal(payload.sources[0].status, "error");
  assert.equal(payload.sources[0].recordCount, 2);
  assert.equal(payload.records.length, 2);
  assert.deepEqual(
    payload.records.map((record) => [record.city, record.status]).sort(),
    [["广州", "已投递"], ["深圳", "面试中"]],
  );
});

test("社区无上游 ID 时标题和类别变化仍按公司、城市、链接保留状态", async () => {
  const url = "https://jobs.example.com/campus/stable-state";
  const oldRecord = normalizeJobs({
    c: "状态稳定企业",
    p: "旧岗位标题",
    l: "深圳",
    w: "旧批次",
    ind: "旧类别",
    u: url,
  }, communitySource, EARLIER)[0];
  const payload = await syncJobs({
    sources: [communitySource],
    previousPayload: {
      schemaVersion: 1,
      generatedAt: EARLIER,
      sources: [{ id: communitySource.id, status: "ok", recordCount: 1 }],
      records: [{ ...oldRecord, status: "面试中", statusUpdatedAt: "2026-08-31T13:00:00.000Z" }],
    },
    fetchImpl: mockFetch({
      [communitySource.endpoint]: {
        updated: "2026-09-01",
        jobs: [{
          c: "状态稳定企业",
          p: "新岗位标题",
          l: "深圳",
          w: "新批次",
          ind: "新类别",
          u: url,
        }],
      },
    }).fetchImpl,
    now: NOW,
  });

  assert.equal(payload.records.length, 1);
  assert.notEqual(payload.records[0].id, oldRecord.id, "回归测试应覆盖标题变化导致的旧 ID 变化");
  assert.equal(payload.records[0].status, "面试中");
  assert.equal(payload.records[0].statusUpdatedAt, "2026-08-31T13:00:00.000Z");
});

test("社区聚合会拒绝 null、空对象和缺少公司或岗位的信息", async () => {
  const payload = await syncJobs({
    sources: [communitySource],
    fetchImpl: mockFetch({
      [communitySource.endpoint]: {
        jobs: [
          null,
          {},
          { c: "", p: "缺公司", l: "深圳", u: "https://jobs.example.com/missing-company" },
          { c: "缺岗位", p: "", l: "深圳", u: "https://jobs.example.com/missing-title" },
          { c: "有效企业", p: "有效岗位", l: "深圳", u: "https://jobs.example.com/valid" },
        ],
      },
    }).fetchImpl,
    now: NOW,
  });

  assert.equal(payload.records.length, 1);
  assert.equal(payload.records[0].companyName, "有效企业");
  assert.equal(payload.records[0].jobCategories.includes("有效岗位"), true);
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
  assert.equal(source.stale, true);
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
    location: { name: "深圳" },
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
    location: { name: "深圳" },
    updated_at: "2026-08-30T00:00:00Z",
  };
  const second = {
    id: "same-id",
    title: "新标题",
    absolute_url: "https://boards.greenhouse.io/fixture/jobs/same-id",
    location: { name: "深圳" },
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
        { id: "without-url-1", title: "岗位一", location: { name: "深圳" } },
        { id: "without-url-2", title: "岗位二", location: { name: "广州" } },
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

test("广东范围覆盖 21 个城市，并保留省级未细分地点", () => {
  assert.deepEqual(GUANGDONG_CITIES, [
    "广州", "深圳", "珠海", "汕头", "佛山", "韶关", "河源", "梅州", "惠州", "汕尾", "东莞",
    "中山", "江门", "阳江", "湛江", "茂名", "肇庆", "清远", "潮州", "揭阳", "云浮",
  ]);

  for (const city of GUANGDONG_CITIES) {
    const record = normalizeJobs({
      c: `企业-${city}`,
      p: "岗位",
      l: city,
      u: `https://jobs.example.com/${encodeURIComponent(city)}`,
    }, communitySource, NOW)[0];
    assert.deepEqual({ province: record.province, city: record.city }, { province: "广东", city });
  }

  const provinceOnly = normalizeJobs({
    c: "省级岗位",
    p: "岗位",
    l: "广东",
    u: "https://jobs.example.com/guangdong",
  }, communitySource, NOW);
  assert.deepEqual(provinceOnly.map((record) => [record.province, record.city]), [["广东", ""]]);
  assert.equal(provinceOnly.every(isGuangdongRecord), true);
});

test("同步边界排除其他省份，多地点只保留广东，全国必须有广东证据", () => {
  const mixed = normalizeJobs({
    c: "多地点企业",
    p: "研发岗位",
    l: "广州/上海/东莞",
    u: "https://jobs.example.com/mixed",
  }, communitySource, NOW);
  assert.deepEqual(mixed.map((record) => record.city), ["广州", "东莞"]);
  assert.equal(normalizeJobs({ c: "外省企业", p: "岗位", l: "杭州", u: "https://jobs.example.com/hangzhou" }, communitySource, NOW).length, 0);
  assert.equal(normalizeJobs({ c: "全国企业", p: "岗位", l: "全国", u: "https://jobs.example.com/nationwide" }, communitySource, NOW).length, 0);
  assert.deepEqual(
    normalizeJobs({ c: "全国广东企业", p: "岗位", l: "全国/广东", u: "https://jobs.example.com/nationwide-guangdong" }, communitySource, NOW)
      .map((record) => [record.province, record.city]),
    [["广东", ""]],
  );
  assert.deepEqual(
    normalizeJobs({ c: "全国含广东企业", p: "岗位", l: "全国（含广东）", u: "https://jobs.example.com/nationwide-guangdong-text" }, communitySource, NOW)
      .map((record) => [record.province, record.city]),
    [["广东", ""]],
  );
  assert.deepEqual(
    normalizeJobs({ c: "默认广东企业", p: "岗位", l: "全国", u: "https://jobs.example.com/default-guangdong" }, { ...communitySource, defaultProvince: "广东" }, NOW)
      .map((record) => [record.province, record.city]),
    [["广东", ""]],
  );
  assert.equal(filterGuangdongRecords([
    ...mixed,
    { ...mixed[0], id: "outside", province: "北京", city: "北京" },
  ]).every(isGuangdongRecord), true);
});

test("来源失败只回退广东旧快照，不把其他省份旧数据带回最终快照", async () => {
  const oldGuangdong = normalizeJobs({
    c: "广东旧企业",
    p: "岗位",
    l: "深圳",
    u: "https://jobs.example.com/old-guangdong",
  }, communitySource, EARLIER)[0];
  const oldOutside = {
    ...oldGuangdong,
    id: "outside-old",
    companyName: "外省旧企业",
    province: "上海",
    city: "上海",
    status: "面试中",
  };
  const payload = await syncJobs({
    sources: [communitySource],
    previousPayload: { schemaVersion: 1, sources: [], records: [oldGuangdong, oldOutside] },
    fetchImpl: async () => { throw new Error("community offline"); },
    now: NOW,
  });
  assert.equal(payload.sources[0].status, "error");
  assert.deepEqual(payload.records.map((record) => [record.province, record.city]), [["广东", "深圳"]]);
  assert.equal(payload.records[0].status, oldGuangdong.status);
});

test("广东快照的 JSON 与 JS 表示一致且不含其他省份", () => {
  const records = normalizeJobs({
    c: "快照企业",
    p: "岗位",
    l: "广州/北京",
    u: "https://jobs.example.com/snapshot",
  }, communitySource, NOW);
  const payload = {
    schemaVersion: 1,
    generatedAt: NOW,
    sources: [{ id: communitySource.id, status: "ok", recordCount: records.length }],
    records,
  };
  const context = vm.createContext({});
  vm.runInContext(renderJavaScript(payload), context);
  assert.deepEqual(JSON.parse(JSON.stringify(context.RECRUITMENT_SYNC_PAYLOAD)), JSON.parse(renderJson(payload)));
  assert.equal(payload.records.every(isGuangdongRecord), true);
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
