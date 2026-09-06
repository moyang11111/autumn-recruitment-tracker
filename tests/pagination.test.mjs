import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function createStorage() {
  const values = new Map();
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, value);
    },
    removeItem(key) {
      values.delete(key);
    },
  };
}

function loadApp(payload) {
  const sandbox = {
    URL,
    console,
    localStorage: createStorage(),
    module: { exports: {} },
    RECRUITMENT_SYNC_PAYLOAD: payload,
  };
  const context = vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(ROOT, "data.js"), "utf8"), context);
  context.RECRUITMENT_SYNC_PAYLOAD = payload;
  vm.runInContext(fs.readFileSync(path.join(ROOT, "app.js"), "utf8"), context);
  return context.AutumnRecruitmentApp;
}

const frozenSnapshot = JSON.parse(
  fs.readFileSync(path.join(ROOT, "data", "jobs.generated.json"), "utf8"),
);
const appSource = fs.readFileSync(path.join(ROOT, "app.js"), "utf8");
const htmlSource = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
const stylesSource = fs.readFileSync(path.join(ROOT, "styles.css"), "utf8");
const app = loadApp(frozenSnapshot);
const snapshotSummary = app.calculateSnapshotSummary();
const matchingRecords = app.getMatchingRecords();

assert.equal(snapshotSummary.syncJobCount, 619, "应加载 619 条同步岗位");
assert.equal(snapshotSummary.exampleJobCount, 5, "应保留 5 条示例岗位");
assert.equal(matchingRecords.length, 624, "默认结果应包含全部 624 条岗位");
assert.equal(app.defaultPageSize, 80);
assert.deepEqual(Array.from(app.pageSizeOptions), [80, 160, "all"]);
assert.equal(app.calculatePageCount(624, 80), 8);
assert.doesNotMatch(appSource, /MAX_RENDERED_RECORDS|slice\(\s*0\s*,\s*80\s*\)/);

for (const controlId of [
  "firstPageButton",
  "previousPageButton",
  "paginationPageStatus",
  "nextPageButton",
  "lastPageButton",
  "paginationRange",
  "pageSizeSelect",
]) {
  assert.match(htmlSource, new RegExp('id="' + controlId + '"'));
}
assert.match(htmlSource, /<option value="80">80 条<\/option>/);
assert.match(htmlSource, /<option value="160">160 条<\/option>/);
assert.match(htmlSource, /<option value="all">全部<\/option>/);
assert.match(htmlSource, /paginationPageStatus"[^>]*aria-live="polite"/);
assert.match(
  stylesSource,
  /@media \(max-width: 580px\)[\s\S]*?\.pagination-controls[\s\S]*?flex-direction: column;/,
  "分页控件应在 320px 所属断点改为纵向布局",
);

const firstPage = app.paginateRecords(matchingRecords);
assert.equal(firstPage.currentPage, 1);
assert.equal(firstPage.totalPages, 8);
assert.equal(firstPage.records.length, 80);
assert.equal(firstPage.start, 1);
assert.equal(firstPage.end, 80);

const secondPage = app.paginateRecords(matchingRecords, 2, 80);
assert.equal(secondPage.currentPage, 2);
assert.equal(secondPage.records.length, 80);
assert.equal(secondPage.start, 81);
assert.equal(secondPage.end, 160);
assert.equal(secondPage.records[0].id, matchingRecords[80].id);

const lastPage = app.paginateRecords(matchingRecords, 8, 80);
assert.equal(lastPage.currentPage, 8);
assert.equal(lastPage.records.length, 64);
assert.equal(lastPage.start, 561);
assert.equal(lastPage.end, 624);
assert.equal(lastPage.records.at(-1).id, matchingRecords.at(-1).id);

const clampedPage = app.paginateRecords(matchingRecords.slice(0, 81), 8, 80);
assert.equal(clampedPage.currentPage, 2, "结果减少后页码应 clamp 到最后一页");
assert.equal(clampedPage.records.length, 1);

const emptyPage = app.paginateRecords([], 8, 80);
assert.equal(emptyPage.currentPage, 1);
assert.equal(emptyPage.totalPages, 0);
assert.equal(emptyPage.records.length, 0);
assert.equal(emptyPage.start, 0);
assert.equal(emptyPage.end, 0);

const allRecordsPage = app.paginateRecords(matchingRecords, 8, "all");
assert.equal(allRecordsPage.currentPage, 1);
assert.equal(allRecordsPage.totalPages, 1);
assert.equal(allRecordsPage.records.length, 624);
assert.equal(allRecordsPage.start, 1);
assert.equal(allRecordsPage.end, 624);

app.state.currentPage = 8;
assert.equal(app.setPageSize("all"), "all");
assert.equal(app.state.currentPage, 1);
assert.equal(app.setPageSize(160), 160);
assert.equal(app.state.currentPage, 1, "从全部模式恢复分页后应从合法的第 1 页开始");
assert.equal(app.paginateRecords(matchingRecords, app.state.currentPage, app.state.pageSize).totalPages, 4);

app.state.currentPage = 8;
assert.equal(app.setFilterValue("keyword", matchingRecords[0].companyName), true);
assert.equal(app.state.currentPage, 1, "搜索变化后应回到第 1 页");
assert.ok(app.getMatchingRecords().length < 624);

app.state.currentPage = 4;
app.setSortValue("deadline-desc");
assert.equal(app.state.currentPage, 1, "排序变化后应回到第 1 页");

app.setFilterValue("keyword", "");
app.setSortValue("default");
app.state.currentPage = 2;
app.state.pageSize = 80;
const statusTarget = app.paginateRecords(app.getMatchingRecords(), 2, 80).records[0];
const nextStatus = statusTarget.status === "面试中" ? "已投递" : "面试中";
assert.equal(app.updateStatus(statusTarget.id, nextStatus), true);
assert.equal(app.state.currentPage, 2, "更新状态不应改变当前页");
assert.equal(
  app.paginateRecords(app.getMatchingRecords(), 2, 80).records[0].status,
  nextStatus,
  "切页数据应读取更新后的状态",
);

const exportRecords = app.getExportRecords();
const csvRows = app.makeCsv(exportRecords)
  .replace(/^\uFEFF/, "")
  .trimEnd()
  .split("\r\n");
assert.equal(exportRecords.length, 624, "导出应忽略当前分页并保留全部筛选结果");
assert.equal(csvRows.length, 625, "CSV 应包含表头及全部 624 条记录");

console.log("pagination tests passed");
