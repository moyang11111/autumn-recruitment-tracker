import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sandbox = { URL, console, localStorage: null, module: { exports: {} } };
const context = vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(ROOT, "data.js"), "utf8"), context);
vm.runInContext(fs.readFileSync(path.join(ROOT, "app.js"), "utf8"), context);
const app = context.AutumnRecruitmentApp;
assert.equal(app.maxRenderedRecords, 80);
assert.equal(app.state.filters.province, "广东");
assert.equal(app.state.cityDraft.province, "广东");
assert.equal(app.data.every((record) => record.province === "广东"), true);
assert.deepEqual(
  JSON.parse(JSON.stringify(app.sourceBadgeInfo({ sourceType: "community-json", sourceName: "社区源" }))),
  { label: "社区聚合", className: "record-source-community" },
);
const communityLink = app.renderCampusLink({
  ...app.initialRecords[0],
  sourceType: "community-json",
  companyName: "社区企业",
  campusUrl: "https://github.com/example/community",
});
assert.match(communityLink, /查看\/核验链接/);
assert.doesNotMatch(communityLink, /官网/);

const records = [
  {
    ...app.initialRecords[0],
    id: "city-outside-sync",
    companyName: "外省同步机会",
    province: "北京",
    city: "北京",
    deadline: "2099-01-01",
    sourceKind: "sync",
    sourceName: "自动源 A",
  },
  {
    ...app.initialRecords[1],
    id: "city-guangzhou-sync",
    companyName: "广州同步机会",
    province: "广东",
    city: "广州",
    sourceKind: "sync",
    sourceName: "自动源 A",
  },
  {
    ...app.initialRecords[2],
    id: "city-shenzhen-demo",
    companyName: "深圳示例机会",
    province: "广东",
    city: "深圳",
    sourceKind: "example",
    sourceName: "内置示例",
    isDemo: true,
  },
];

const Beijing = app.filterRecords(records, {
  keyword: "",
  nature: "",
  province: "北京",
  city: "北京",
  deadline: "",
  status: "",
});
assert.equal(Beijing.length, 0, "外省记录不能进入广东筛选结果");

const compatibleFilters = app.filterRecords(records, {
  keyword: "同步",
  nature: records[1].companyType,
  province: "广东",
  city: "广州",
  deadline: "open",
  status: "未投递",
});
assert.equal(compatibleFilters.length, 1);

app.state.filters.province = "广东";
app.state.filters.city = "深圳";
const discovery = app.calculateDiscoverySummary(app.filterRecords(records, app.state.filters));
assert.equal(discovery.matchCount, 1);
assert.equal(discovery.sourceCount, 0, "城市来源数只统计同步记录，不把示例来源计入");
assert.equal(discovery.province, "广东");
assert.equal(discovery.city, "深圳");

const emptyCity = app.filterRecords(records, {
  keyword: "",
  nature: "",
  province: "浙江",
  city: "杭州",
  deadline: "",
  status: "",
});
assert.equal(emptyCity.length, 0);
assert.equal(app.calculateDiscoverySummary(emptyCity).matchCount, 0);

const originalDataInfo = app.state.dataInfo;
app.state.dataInfo = {
  mode: "sync",
  sourceEntries: [
    { id: "fresh", status: "ok", stale: false },
    { id: "old", status: "ok", stale: true },
    { id: "down", status: "error", stale: true },
  ],
};
assert.deepEqual(JSON.parse(JSON.stringify(app.calculateSnapshotSummary(records))), {
  jobCount: 2,
  companyCount: 2,
  syncJobCount: 1,
  syncCompanyCount: 1,
  exampleJobCount: 1,
  exampleCompanyCount: 1,
  sourceCount: 3,
  healthySourceCount: 1,
  staleSourceCount: 2,
});
app.state.dataInfo = originalDataInfo;

const domesticOptions = app.availableDomesticLocations(records);
assert.equal(domesticOptions.some((item) => item.province === "广东" && item.cities.includes("深圳")), true);
assert.equal(domesticOptions.length, 1);
assert.equal(domesticOptions[0].cities.length, 21);
assert.equal(domesticOptions.some((item) => item.province === "加利福尼亚"), false);

let releasePayload;
const latestPayload = new Promise((resolve) => {
  releasePayload = resolve;
});
const request = app.requestCityRecruitment("广东", "广州", async () => ({
  ok: true,
  json: () => latestPayload,
}));
assert.equal(app.state.cityRequest.loading, true);
assert.equal(app.state.filters.city, "深圳", "等待期间不应提前切换当前城市结果");
releasePayload({
  schemaVersion: 1,
  generatedAt: "2026-09-01T12:00:00.000Z",
  sources: [{ id: "city-live", name: "城市实时测试源" }],
  records: [{
    ...records[1],
    id: "city-live-guangzhou",
    province: "广东",
    city: "广州",
    sourceKind: "sync",
    sourceId: "city-live",
    sourceName: "城市实时测试源",
    status: "未投递",
    statusUpdatedAt: "1970-01-01T00:00:00.000Z",
  }],
});
const requested = await request;
assert.equal(app.state.cityRequest.loading, false);
assert.equal(app.state.filters.province, "广东");
assert.equal(app.state.filters.city, "广州");
assert.equal(requested.records.length > 0, true);
assert.equal(requested.records.every((record) => record.province === "广东" && record.city === "广州"), true);
assert.equal(requested.refreshed, true);

await assert.rejects(
  app.requestCityRecruitment("北京", "北京", async () => ({ ok: true, json: async () => ({}) })),
  /广东城市/,
);

const unknownDeadline = { ...records[0], openDate: "", deadline: "" };
assert.equal(app.deadlineState(unknownDeadline.deadline), "unknown");
assert.equal(app.filterRecords([unknownDeadline], {
  keyword: "",
  nature: "",
  province: "",
  city: "",
  deadline: "soon",
  status: "",
}).length, 0);

console.log("city discovery tests passed");
