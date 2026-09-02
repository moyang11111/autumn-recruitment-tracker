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

const records = [
  {
    ...app.initialRecords[0],
    id: "city-beijing-sync",
    companyName: "北京同步机会",
    province: "北京",
    city: "北京",
    deadline: "2099-01-01",
    sourceKind: "sync",
    sourceName: "自动源 A",
  },
  {
    ...app.initialRecords[1],
    id: "city-shanghai-sync",
    companyName: "上海同步机会",
    province: "上海",
    city: "上海",
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
assert.equal(Beijing.length, 1);
assert.equal(Beijing[0].companyName, "北京同步机会");

const compatibleFilters = app.filterRecords(records, {
  keyword: "同步",
  nature: "央国企",
  province: "北京",
  city: "北京",
  deadline: "open",
  status: "未投递",
});
assert.equal(compatibleFilters.length, 1);

app.state.filters.province = "广东";
app.state.filters.city = "深圳";
const discovery = app.calculateDiscoverySummary(app.filterRecords(records, app.state.filters));
assert.equal(discovery.matchCount, 1);
assert.equal(discovery.sourceCount, 1);
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

const domesticOptions = app.availableDomesticLocations(records);
assert.equal(domesticOptions.some((item) => item.province === "广东" && item.cities.includes("深圳")), true);
assert.equal(domesticOptions.some((item) => item.province === "加利福尼亚"), false);

let releasePayload;
const latestPayload = new Promise((resolve) => {
  releasePayload = resolve;
});
const request = app.requestCityRecruitment("北京", "北京", async () => ({
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
    ...records[0],
    id: "city-live-beijing",
    sourceKind: "sync",
    sourceId: "city-live",
    sourceName: "城市实时测试源",
    status: "未投递",
    statusUpdatedAt: "1970-01-01T00:00:00.000Z",
  }],
});
const requested = await request;
assert.equal(app.state.cityRequest.loading, false);
assert.equal(app.state.filters.province, "北京");
assert.equal(app.state.filters.city, "北京");
assert.equal(requested.records.length > 0, true);
assert.equal(requested.records.every((record) => record.province === "北京" && record.city === "北京"), true);
assert.equal(requested.refreshed, true);

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
