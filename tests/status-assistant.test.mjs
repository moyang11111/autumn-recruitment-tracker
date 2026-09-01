import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function createStorage(initialValue = null) {
  const values = new Map();
  if (initialValue !== null) values.set("autumn-recruitment-tracker:v1", initialValue);
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

function loadApp({ payload, stored } = {}) {
  const sandbox = {
    URL,
    console,
    localStorage: createStorage(stored),
    module: { exports: {} },
  };
  if (typeof payload !== "undefined") sandbox.RECRUITMENT_SYNC_PAYLOAD = payload;
  const context = vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(ROOT, "data.js"), "utf8"), context);
  if (typeof payload !== "undefined") context.RECRUITMENT_SYNC_PAYLOAD = payload;
  vm.runInContext(fs.readFileSync(path.join(ROOT, "app.js"), "utf8"), context);
  return context.AutumnRecruitmentApp;
}

const app = loadApp();

const terminalInference = app.inferStatusFromNotice("恭喜获得 offer，但我决定拒绝 offer，感谢理解。");
assert.equal(terminalInference.status, "已接受 / 已拒绝 offer");
assert.equal(terminalInference.isTerminal, true);
assert.ok(terminalInference.evidence.length > 0);

const rejectionInference = app.inferStatusFromNotice("很遗憾，本次面试未通过，招聘流程已结束。");
assert.equal(rejectionInference.status, "终止流程 / 已淘汰");

const noMatch = app.inferStatusFromNotice("欢迎关注公司公众号，祝你生活愉快。");
assert.equal(noMatch.status, null);
assert.equal(noMatch.confidenceScore, 0);

for (const [notice, expected] of [
  ["你尚未投递申请", "未投递"],
  ["申请投递成功", "已投递"],
  ["简历筛选中，请耐心等待", "筛选中"],
  ["请完成在线测评", "笔试 / 测评中"],
  ["请确认面试时间", "面试中"],
  ["你已收到 offer 通知", "已发 offer"],
  ["招聘流程终止", "终止流程 / 已淘汰"],
  ["决定拒绝 offer", "已接受 / 已拒绝 offer"],
]) {
  assert.equal(app.inferStatusFromNotice(notice).status, expected, notice);
}

const unsafeText = '<img src=x onerror="alert(1)">';
assert.equal(app.escapeHtml(unsafeText), "&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
assert.equal(app.safeCampusUrl("javascript:alert(1)"), "");

const sourceRecord = { ...app.initialRecords[0], companyName: "同步后的国家电网", deadline: "", status: "未投递" };
sourceRecord.jobCategories = sourceRecord.categories;
delete sourceRecord.categories;
sourceRecord.sourceId = "fixture-source";
sourceRecord.sourceName = "招聘同步示例源";
sourceRecord.sourceType = "greenhouse";
const localProgress = {
  ...app.initialRecords[0],
  status: "面试中",
  statusUpdatedAt: "2026-09-01T08:00:00+08:00",
};
const syncApp = loadApp({
  payload: {
    schemaVersion: 1,
    generatedAt: "2026-09-01T07:30:00+08:00",
    sources: [{ id: "fixture-source", name: "招聘同步示例源" }],
    records: [sourceRecord],
  },
  stored: JSON.stringify([localProgress]),
});
const mergedRecord = syncApp.data.find((record) => record.id === sourceRecord.id);
assert.equal(syncApp.dataInfo.mode, "sync");
assert.equal(syncApp.dataInfo.sourceName, "招聘同步示例源");
assert.equal(mergedRecord.companyName, "同步后的国家电网");
assert.equal(mergedRecord.deadline, "");
assert.equal(mergedRecord.status, "面试中");
assert.equal(mergedRecord.statusUpdatedAt, localProgress.statusUpdatedAt);
assert.equal(syncApp.deadlineState(""), "unknown");
assert.equal(syncApp.formatDate(""), "待公布");
assert.equal(syncApp.calculateStats([mergedRecord]).dueSoon, 0);

assert.equal(app.resolveRecruitmentData({ records: [] }).info.mode, "example");
assert.equal(app.resolveRecruitmentData({ records: [{ id: "bad" }] }).info.mode, "example");
assert.equal(app.resolveRecruitmentData({ schemaVersion: 999, records: [sourceRecord] }).info.mode, "example");
assert.equal(app.resolveRecruitmentData({ generatedAt: "not-a-time", records: [sourceRecord] }).info.mode, "example");

console.log("status assistant tests passed");
