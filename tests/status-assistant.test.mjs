import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function createStorage(initialValue = null, legacyValue = null) {
  const values = new Map();
  if (initialValue !== null) values.set("autumn-recruitment-tracker:v2", initialValue);
  if (legacyValue !== null) values.set("autumn-recruitment-tracker:v1", legacyValue);
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

function loadApp({ payload, stored, legacyStored, storageRef } = {}) {
  const storage = createStorage(stored, legacyStored);
  if (storageRef) storageRef.storage = storage;
  const sandbox = {
    URL,
    console,
    localStorage: storage,
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

const legacySeededProgress = {
  ...app.initialRecords[1],
  status: "已投递",
  statusUpdatedAt: "2026-08-30T14:20:00+08:00",
};
const migratedDefaults = loadApp({ legacyStored: JSON.stringify([legacySeededProgress]) });
assert.equal(migratedDefaults.data.find((record) => record.id === legacySeededProgress.id).status, "未投递");

const genuineManualProgress = {
  ...legacySeededProgress,
  status: "面试中",
  statusUpdatedAt: "2026-09-01T13:45:00.000Z",
};
const preservedManual = loadApp({ stored: JSON.stringify([genuineManualProgress]) });
assert.equal(preservedManual.data.find((record) => record.id === genuineManualProgress.id).status, "面试中");
assert.equal(preservedManual.data.find((record) => record.id === genuineManualProgress.id).statusUpdatedAt, genuineManualProgress.statusUpdatedAt);

const compactStorageRef = {};
const compactApp = loadApp({
  stored: JSON.stringify([genuineManualProgress]),
  storageRef: compactStorageRef,
});
const compactStorageValue = compactStorageRef.storage.getItem("autumn-recruitment-tracker:v2");
const compactStorage = JSON.parse(compactStorageValue);
assert.equal(Array.isArray(compactStorage), false, "v2 旧数组应在读取后迁移为紧凑对象");
assert.equal(compactStorage.schemaVersion, 2);
assert.equal(Array.isArray(compactStorage.progress), true);
assert.equal(compactStorage.progress.some((entry) => entry.id === genuineManualProgress.id && entry.status === "面试中"), true);
assert.equal(compactStorage.progress.every((entry) => Object.keys(entry).every((key) => ["id", "status", "statusUpdatedAt"].includes(key))), true);
assert.equal(compactApp.data.find((record) => record.id === genuineManualProgress.id).status, "面试中");

const communityProgressUrl = "https://jobs.example.com/community/stable";
const communityOldRecord = {
  ...app.initialRecords[0],
  id: "community-state-old",
  companyName: "社区状态企业",
  companyType: "其他",
  province: "广东",
  city: "深圳",
  categories: ["旧岗位类别"],
  campusUrl: communityProgressUrl,
  sourceId: "community-fixture",
  sourceName: "Fixture 社区聚合",
  sourceType: "community-json",
  sourceKind: "sync",
  isDemo: false,
  status: "已投递",
  statusUpdatedAt: "2026-08-31T15:00:00.000Z",
};
const communityNewRecord = {
  ...communityOldRecord,
  id: "community-state-new",
  categories: ["新岗位类别"],
  status: "未投递",
  statusUpdatedAt: "1970-01-01T00:00:00.000Z",
};
const communityStorageRef = {};
const communityProgressApp = loadApp({
  payload: { records: [communityNewRecord] },
  stored: JSON.stringify([communityOldRecord]),
  storageRef: communityStorageRef,
});
assert.equal(communityProgressApp.data.find((record) => record.id === communityNewRecord.id).status, "已投递");
assert.equal(communityProgressApp.data.find((record) => record.id === communityNewRecord.id).statusUpdatedAt, communityOldRecord.statusUpdatedAt);
const communityCompactProgress = JSON.parse(communityStorageRef.storage.getItem("autumn-recruitment-tracker:v2")).progress;
assert.equal(communityCompactProgress.some((entry) => entry.id === communityNewRecord.id && entry.recordKey), true);

const compactHistoryRecord = {
  ...app.initialRecords[2],
  id: "compact-retired-submitted",
  sourceKind: "sync",
  sourceName: "已下线同步源",
  isDemo: false,
  status: "已投递",
  statusUpdatedAt: "2026-08-31T09:00:00.000Z",
};
const compactHistoryApp = loadApp({
  payload: { records: [sourceRecord] },
  stored: JSON.stringify({
    schemaVersion: 2,
    progress: [{ id: compactHistoryRecord.id, status: compactHistoryRecord.status, statusUpdatedAt: compactHistoryRecord.statusUpdatedAt }],
    history: [compactHistoryRecord],
  }),
});
assert.equal(compactHistoryApp.data.some((record) => record.id === compactHistoryRecord.id && record.status === "已投递"), true);

const manuallyResetProgress = {
  ...genuineManualProgress,
  status: "未投递",
  statusUpdatedAt: "2026-09-01T14:00:00.000Z",
};
const preservedManualReset = loadApp({ stored: JSON.stringify([manuallyResetProgress]) });
assert.equal(preservedManualReset.data.find((record) => record.id === manuallyResetProgress.id).status, "未投递");
assert.equal(preservedManualReset.data.find((record) => record.id === manuallyResetProgress.id).statusUpdatedAt, manuallyResetProgress.statusUpdatedAt);

const mixedSyncApp = loadApp({
  payload: {
    schemaVersion: 1,
    generatedAt: "2026-09-01T07:30:00+08:00",
    records: [sourceRecord, { id: "invalid-sync-record" }],
  },
});
assert.equal(mixedSyncApp.dataInfo.mode, "sync");
assert.equal(mixedSyncApp.data.some((record) => record.id === sourceRecord.id && record.companyName === sourceRecord.companyName), true);

const retiredSubmitted = {
  ...app.initialRecords[1],
  id: "sync-retired-submitted",
  sourceKind: "sync",
  sourceName: "旧同步源",
  isDemo: false,
  status: "已投递",
  statusUpdatedAt: "2026-08-31T08:00:00+08:00",
};
const retiredNotApplied = {
  ...app.initialRecords[2],
  id: "sync-retired-not-applied",
  sourceKind: "sync",
  sourceName: "旧同步源",
  isDemo: false,
  status: "未投递",
  statusUpdatedAt: "2026-08-31T08:05:00+08:00",
};
const historyApp = loadApp({
  payload: { records: [sourceRecord] },
  stored: JSON.stringify([retiredSubmitted, retiredNotApplied]),
});
assert.equal(historyApp.data.filter((record) => record.id === retiredSubmitted.id).length, 1);
assert.equal(historyApp.data.some((record) => record.id === retiredNotApplied.id), false);

assert.equal(app.resolveRecruitmentData({ records: [] }).info.mode, "example");
assert.equal(app.resolveRecruitmentData({ records: [{ id: "bad" }] }).info.mode, "example");
assert.equal(app.resolveRecruitmentData({ schemaVersion: 999, records: [sourceRecord] }).info.mode, "example");
assert.equal(app.resolveRecruitmentData({ generatedAt: "not-a-time", records: [sourceRecord] }).info.mode, "example");

console.log("status assistant tests passed");
