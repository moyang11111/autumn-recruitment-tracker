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
