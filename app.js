(() => {
  "use strict";

  const root = typeof globalThis !== "undefined" ? globalThis : window;
  const hasDocument = typeof document !== "undefined";
  const initialRecords = Array.isArray(root.INITIAL_RECRUITMENT_DATA)
    ? root.INITIAL_RECRUITMENT_DATA
    : [];
  const statusOptions = Array.isArray(root.RECRUITMENT_STATUS_OPTIONS)
    ? root.RECRUITMENT_STATUS_OPTIONS
    : [];
  const companyTypeOptions = Array.isArray(root.RECRUITMENT_COMPANY_TYPES)
    ? root.RECRUITMENT_COMPANY_TYPES
    : [];
  const dataMeta = root.RECRUITMENT_DATA_META && typeof root.RECRUITMENT_DATA_META === "object"
    ? root.RECRUITMENT_DATA_META
    : {};
  const storageKey = typeof dataMeta.storageKey === "string" && dataMeta.storageKey.trim()
    ? dataMeta.storageKey
    : "autumn-recruitment-tracker:v1";
  const DEFAULT_STATUS = statusOptions[0] || "未投递";
  const DEFAULT_STATUS_UPDATED_AT = "1970-01-01T00:00:00.000Z";
  const EXAMPLE_SOURCE_NAME = "内置示例";
  const DEFAULT_SYNC_SOURCE_NAME = "自动同步源";

  const STATUS_CLASS_NAMES = Object.freeze({
    未投递: "status-not-applied",
    已投递: "status-submitted",
    筛选中: "status-screening",
    "笔试 / 测评中": "status-test",
    面试中: "status-interview",
    "已发 offer": "status-offer",
    "终止流程 / 已淘汰": "status-rejected",
    "已接受 / 已拒绝 offer": "status-accepted",
  });

  const COMPANY_TYPE_CLASS_NAMES = Object.freeze({
    央国企: "company-type-soe",
    私企: "company-type-private",
    外企: "company-type-foreign",
    事业单位: "company-type-public",
    其他: "company-type-other",
  });

  const state = {
    records: [],
    dataInfo: {
      mode: "example",
      label: "示例数据",
      sourceName: EXAMPLE_SOURCE_NAME,
      lastSyncAt: "",
    },
    filters: {
      keyword: "",
      nature: "",
      province: "",
      city: "",
      deadline: "",
      status: "",
    },
    sort: "default",
    storageAvailable: false,
  };

  const assistantState = {
    pending: null,
  };

  let dom = {};
  let toastTimer = null;

  function cloneRecord(record) {
    const sourceCategories = Array.isArray(record?.categories)
      ? record.categories
      : (Array.isArray(record?.jobCategories) ? record.jobCategories : []);
    return {
      ...record,
      categories: [...sourceCategories],
    };
  }

  function cloneRecords(records) {
    return Array.isArray(records) ? records.map(cloneRecord) : [];
  }

  function getStorage() {
    try {
      if (root.localStorage && typeof root.localStorage.getItem === "function") {
        return root.localStorage;
      }
    } catch {
      return null;
    }
    return null;
  }

  function isDateOnly(value) {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }

  function isBlankDate(value) {
    return value === "" || value === null || typeof value === "undefined";
  }

  function isOptionalDate(value) {
    return isBlankDate(value) || isDateOnly(value);
  }

  function normalizeDateValue(value) {
    if (isBlankDate(value)) return "";
    return isDateOnly(value) ? value : null;
  }

  function isValidTimestamp(value) {
    return typeof value === "string" && value.trim().length > 0 && !Number.isNaN(Date.parse(value));
  }

  function isHttpsUrl(value) {
    if (typeof value !== "string" || !value.trim()) return false;
    try {
      const url = new URL(value);
      return url.protocol === "https:" && Boolean(url.hostname);
    } catch {
      return false;
    }
  }

  function safeCampusUrl(value) {
    if (!isHttpsUrl(value)) return "";
    try {
      return new URL(value).href;
    } catch {
      return "";
    }
  }

  function isValidStoredRecord(record) {
    if (!record || typeof record !== "object" || Array.isArray(record)) return false;
    if (typeof record.id !== "string" || !record.id.trim()) return false;
    if (typeof record.companyName !== "string" || !record.companyName.trim()) return false;
    if (!companyTypeOptions.includes(record.companyType)) return false;
    if (!statusOptions.includes(record.status)) return false;
    if (!isOptionalDate(record.openDate) || !isOptionalDate(record.deadline)) return false;
    if (isDateOnly(record.openDate) && isDateOnly(record.deadline) && record.openDate > record.deadline) return false;
    if (typeof record.province !== "string" || typeof record.city !== "string") return false;
    const categories = Array.isArray(record.categories) ? record.categories : record.jobCategories;
    if (!Array.isArray(categories) || categories.length === 0 || !categories.every((category) => typeof category === "string" && category.trim())) return false;
    if (!isHttpsUrl(record.campusUrl)) return false;
    if (!isValidTimestamp(record.statusUpdatedAt)) return false;
    return true;
  }

  function readStoredRecords() {
    const storage = getStorage();
    state.storageAvailable = Boolean(storage);
    if (!storage) return null;

    try {
      const raw = storage.getItem(storageKey);
      if (raw === null) return null;
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed) || !parsed.every(isValidStoredRecord)) return null;
      return cloneRecords(parsed);
    } catch {
      return null;
    }
  }

  function writeRecords(records) {
    const storage = getStorage();
    state.storageAvailable = Boolean(storage);
    if (!storage) {
      updateSaveHint("未持久化：本机存储不可用");
      return false;
    }

    try {
      storage.setItem(storageKey, JSON.stringify(records));
      const now = new Date();
      updateSaveHint(`已保存 ${formatClock(now)}`);
      return true;
    } catch {
      state.storageAvailable = false;
      updateSaveHint("未持久化：无法写入本机存储");
      return false;
    }
  }

  function removeStoredRecords() {
    const storage = getStorage();
    if (!storage) return;
    try {
      storage.removeItem(storageKey);
    } catch {
      // Some privacy modes expose localStorage but reject writes. Memory state still works.
    }
  }

  function pickFirstString(...values) {
    return values.find((value) => typeof value === "string" && value.trim())?.trim() || "";
  }

  function extractSyncRecords(payload) {
    if (Array.isArray(payload)) return payload;
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
    const recordKeys = ["records", "jobs", "data", "items", "recruitment"];
    for (const key of recordKeys) {
      if (Array.isArray(payload[key])) return payload[key];
    }
    return null;
  }

  function extractSyncMeta(payload) {
    const nestedMeta = payload && typeof payload === "object" && payload.meta && typeof payload.meta === "object"
      ? payload.meta
      : {};
    const sourceList = Array.isArray(payload?.sources)
      ? payload.sources
        .map((source) => pickFirstString(source?.name, source?.sourceName, source?.id))
        .filter(Boolean)
        .join("、")
      : "";
    const sourceName = pickFirstString(
      payload?.sourceName,
      payload?.source,
      payload?.provider,
      payload?.feedName,
      nestedMeta.sourceName,
      nestedMeta.source,
      nestedMeta.provider,
      nestedMeta.feedName,
      sourceList,
    ) || DEFAULT_SYNC_SOURCE_NAME;
    const lastSyncAt = pickFirstString(
      payload?.lastSyncAt,
      payload?.lastSyncedAt,
      payload?.syncedAt,
      payload?.generatedAt,
      payload?.fetchedAt,
      payload?.updatedAt,
      payload?.syncTime,
      payload?.lastSyncTime,
      nestedMeta.lastSyncAt,
      nestedMeta.lastSyncedAt,
      nestedMeta.syncedAt,
      nestedMeta.generatedAt,
      nestedMeta.fetchedAt,
      nestedMeta.updatedAt,
      nestedMeta.syncTime,
      nestedMeta.lastSyncTime,
    );
    return {
      sourceName,
      lastSyncAt: isValidTimestamp(lastSyncAt) ? lastSyncAt : "",
    };
  }

  function isSyncPayloadShapeValid(payload) {
    if (Array.isArray(payload)) return true;
    if (!payload || typeof payload !== "object") return false;
    if (typeof payload.schemaVersion !== "undefined" && Number(payload.schemaVersion) !== 1) return false;
    if (Object.prototype.hasOwnProperty.call(payload, "sources") && !Array.isArray(payload.sources)) return false;
    const nestedMeta = payload.meta && typeof payload.meta === "object" ? payload.meta : {};
    const timestampKeys = [
      "lastSyncAt",
      "lastSyncedAt",
      "syncedAt",
      "generatedAt",
      "fetchedAt",
      "updatedAt",
      "syncTime",
      "lastSyncTime",
    ];
    return [...timestampKeys.map((key) => payload[key]), ...timestampKeys.map((key) => nestedMeta[key])]
      .every((value) => isBlankDate(value) || (typeof value === "string" && isValidTimestamp(value)));
  }

  function getGlobalSyncPayload() {
    try {
      if (typeof RECRUITMENT_SYNC_PAYLOAD !== "undefined") return RECRUITMENT_SYNC_PAYLOAD;
    } catch {
      // A generated script may expose the payload only through globalThis.
    }
    return root.RECRUITMENT_SYNC_PAYLOAD;
  }

  function normalizeFeedRecord(record, sourceKind, sourceName, lastSyncAt) {
    if (!record || typeof record !== "object" || Array.isArray(record)) return null;
    const id = typeof record.id === "string" ? record.id.trim() : "";
    const companyName = typeof record.companyName === "string" ? record.companyName.trim() : "";
    const companyType = record.companyType;
    const province = typeof record.province === "string" ? record.province.trim() : "";
    const city = typeof record.city === "string" ? record.city.trim() : "";
    const rawCategories = Array.isArray(record.categories)
      ? record.categories
      : (Array.isArray(record.jobCategories) ? record.jobCategories : null);
    const categories = rawCategories && rawCategories.length > 0 && rawCategories.every(
      (category) => typeof category === "string" && category.trim(),
    )
      ? rawCategories.map((category) => category.trim())
      : null;
    const openDate = normalizeDateValue(record.openDate);
    const deadline = normalizeDateValue(record.deadline);
    const campusUrl = safeCampusUrl(record.campusUrl);
    if (!id || !companyName || !companyTypeOptions.includes(companyType)) return null;
    if (typeof record.province !== "string" || typeof record.city !== "string") return null;
    if (!isOptionalDate(record.openDate) || !isOptionalDate(record.deadline) || openDate === null || deadline === null) return null;
    if (isDateOnly(openDate) && isDateOnly(deadline) && openDate > deadline) return null;
    if (!categories || categories.length === 0 || !campusUrl) return null;
    if (typeof record.status !== "undefined" && !statusOptions.includes(record.status)) return null;
    if (typeof record.statusUpdatedAt !== "undefined" && !isValidTimestamp(record.statusUpdatedAt)) return null;

    const normalized = {
      ...record,
      id,
      companyName,
      companyType,
      openDate,
      deadline,
      province,
      city,
      categories,
      campusUrl,
      isDemo: sourceKind === "example",
      sourceKind,
      sourceName: pickFirstString(record.sourceName, record.source, sourceName) || sourceName,
      lastSyncAt: sourceKind === "sync" ? lastSyncAt : "",
    };
    if (typeof record.status === "undefined") delete normalized.status;
    if (typeof record.statusUpdatedAt === "undefined") delete normalized.statusUpdatedAt;
    return normalized;
  }

  function normalizeExampleRecords() {
    return initialRecords
      .map((record) => normalizeFeedRecord(record, "example", EXAMPLE_SOURCE_NAME, ""))
      .filter(Boolean)
      .map((record) => ({
        ...record,
        status: statusOptions.includes(record.status) ? record.status : DEFAULT_STATUS,
        statusUpdatedAt: isValidTimestamp(record.statusUpdatedAt)
          ? record.statusUpdatedAt
          : DEFAULT_STATUS_UPDATED_AT,
      }));
  }

  function mergeRecruitmentRecords(exampleRecords, syncRecords) {
    const byId = new Map();
    exampleRecords.forEach((record) => {
      if (record?.id) byId.set(record.id, cloneRecord(record));
    });
    syncRecords.forEach((record) => {
      if (!record?.id) return;
      const previous = byId.get(record.id);
      const merged = {
        ...(previous || {}),
        ...cloneRecord(record),
        isDemo: false,
        sourceKind: "sync",
        sourceName: record.sourceName || DEFAULT_SYNC_SOURCE_NAME,
        lastSyncAt: record.lastSyncAt || "",
        status: statusOptions.includes(record.status)
          ? record.status
          : (previous?.status || DEFAULT_STATUS),
        statusUpdatedAt: isValidTimestamp(record.statusUpdatedAt)
          ? record.statusUpdatedAt
          : (previous?.statusUpdatedAt || DEFAULT_STATUS_UPDATED_AT),
      };
      byId.set(record.id, merged);
    });
    return [...byId.values()];
  }

  function resolveRecruitmentData(...args) {
    const payload = args.length > 0 ? args[0] : getGlobalSyncPayload();
    const exampleRecords = normalizeExampleRecords();
    const syncCandidates = extractSyncRecords(payload);
    if (!isSyncPayloadShapeValid(payload) || !Array.isArray(syncCandidates) || syncCandidates.length === 0) {
      return {
        records: exampleRecords,
        syncRecords: [],
        info: {
          mode: "example",
          label: "示例数据",
          sourceName: EXAMPLE_SOURCE_NAME,
          lastSyncAt: "",
        },
      };
    }

    const syncMeta = extractSyncMeta(payload);
    let syncRecords = syncCandidates.map((record) => normalizeFeedRecord(
      record,
      "sync",
      syncMeta.sourceName,
      syncMeta.lastSyncAt,
    ));
    if (syncRecords.some((record) => !record)) {
      return {
        records: exampleRecords,
        syncRecords: [],
        info: {
          mode: "example",
          label: "示例数据",
          sourceName: EXAMPLE_SOURCE_NAME,
          lastSyncAt: "",
        },
      };
    }

    const inferredLastSyncAt = syncMeta.lastSyncAt || syncRecords
      .map((record) => pickFirstString(record.fetchedAt, record.sourceUpdatedAt))
      .find((value) => isValidTimestamp(value)) || "";
    syncRecords = syncRecords.map((record) => ({ ...record, lastSyncAt: inferredLastSyncAt }));

    const dedupedSyncRecords = [...new Map(syncRecords.map((record) => [record.id, record])).values()];
    return {
      records: mergeRecruitmentRecords(exampleRecords, dedupedSyncRecords),
      syncRecords: dedupedSyncRecords,
      info: {
        mode: "sync",
        label: "自动同步 + 示例数据",
        sourceName: syncMeta.sourceName,
        lastSyncAt: syncMeta.lastSyncAt,
      },
    };
  }

  function applyStoredProgress(records, storedRecords) {
    if (!Array.isArray(storedRecords)) return records;
    const progressById = new Map(storedRecords.map((record) => [record.id, record]));
    return records.map((record) => {
      const stored = progressById.get(record.id);
      if (!stored || !statusOptions.includes(stored.status) || !isValidTimestamp(stored.statusUpdatedAt)) {
        return record;
      }
      return {
        ...record,
        status: stored.status,
        statusUpdatedAt: stored.statusUpdatedAt,
      };
    });
  }

  function loadRecords() {
    const stored = readStoredRecords();
    const resolved = resolveRecruitmentData();
    state.dataInfo = resolved.info;
    const fresh = cloneRecords(resolved.records);
    const merged = applyStoredProgress(fresh, stored);
    writeRecords(merged);
    return merged;
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (character) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    })[character]);
  }

  function escapeCsvCell(value) {
    const text = String(value ?? "");
    return `"${text.replace(/"/g, '""')}"`;
  }

  function makeCsv(records = state.records) {
    const header = [
      "企业名称",
      "企业性质",
      "开放日期",
      "截止日期",
      "省份",
      "城市",
      "岗位方向",
      "校招官网",
      "投递状态",
      "状态更新时间",
    ];
    const rows = records.map((record) => [
      record.companyName,
      record.companyType,
      record.openDate,
      record.deadline,
      record.province,
      record.city,
      Array.isArray(record.categories) ? record.categories.join("、") : "",
      record.campusUrl,
      record.status,
      record.statusUpdatedAt,
    ]);
    return `\uFEFF${[header, ...rows].map((row) => row.map(escapeCsvCell).join(",")).join("\r\n")}\r\n`;
  }

  function downloadCsv(records = state.records) {
    const csv = makeCsv(records);
    if (!hasDocument || typeof Blob === "undefined") return csv;

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    if (root.navigator && typeof root.navigator.msSaveOrOpenBlob === "function") {
      root.navigator.msSaveOrOpenBlob(blob, "秋招追踪台-当前清单.csv");
      return csv;
    }

    if (!root.URL || typeof root.URL.createObjectURL !== "function") return csv;
    const url = root.URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "秋招追踪台-当前清单.csv";
    link.rel = "noopener";
    link.style.display = "none";
    document.body.appendChild(link);
    link.click();
    link.remove();
    if (typeof root.URL.revokeObjectURL === "function") {
      root.setTimeout(() => root.URL.revokeObjectURL(url), 0);
    }
    return csv;
  }

  function normalizeSearchText(value) {
    return String(value ?? "").trim().toLocaleLowerCase();
  }

  const STATUS_INFERENCE_RULES = [
    {
      status: "已接受 / 已拒绝 offer",
      priority: 100,
      confidence: "高",
      confidenceScore: 0.98,
      patterns: [
        /(?:接受|拒绝|谢绝|放弃|不接受|不考虑|已签约).{0,14}(?:offer|录用|入职)/i,
        /(?:offer|录用|入职).{0,14}(?:已接受|接受|拒绝|谢绝|放弃|不接受)/i,
        /已接受\s*\/\s*已拒绝\s*offer/i,
      ],
    },
    {
      status: "终止流程 / 已淘汰",
      priority: 95,
      confidence: "高",
      confidenceScore: 0.96,
      patterns: [
        /(?:终止流程|流程.{0,4}终止|流程已结束|已淘汰|被淘汰|未通过|不通过|不再进入后续|遗憾地通知|很遗憾)/i,
        /(?:不发|未能获得|无法获得).{0,10}(?:offer|录用)/i,
      ],
    },
    {
      status: "已发 offer",
      priority: 80,
      confidence: "高",
      confidenceScore: 0.93,
      patterns: [
        /(?:发放|发出|获得|拿到|收到|恭喜).{0,12}(?:offer|录用|录取)/i,
        /(?:offer|录用|录取|拟录用)(?:通知|邮件|函)/i,
      ],
    },
    {
      status: "面试中",
      priority: 70,
      confidence: "高",
      confidenceScore: 0.91,
      patterns: [
        /(?:面试|技术面|专业面|hr面|HR面|群面|终面|复试|面谈)/i,
      ],
    },
    {
      status: "笔试 / 测评中",
      priority: 60,
      confidence: "高",
      confidenceScore: 0.9,
      patterns: [
        /(?:笔试|测评|机考|在线测验|性格测评|测验)/i,
      ],
    },
    {
      status: "筛选中",
      priority: 50,
      confidence: "中",
      confidenceScore: 0.82,
      patterns: [
        /(?:简历筛选|初筛|筛选中|简历评估|正在审核|审核中)/i,
      ],
    },
    {
      status: "已投递",
      priority: 40,
      confidence: "中",
      confidenceScore: 0.8,
      patterns: [
        /(?:投递成功|申请成功|简历已收|已收到.{0,8}(?:申请|简历)|网申成功|报名成功)/i,
      ],
    },
    {
      status: "未投递",
      priority: 10,
      confidence: "中",
      confidenceScore: 0.76,
      patterns: [
        /(?:未投递|尚未投递|尚未申请|请先投递)/i,
      ],
    },
  ];

  function noStatusInferenceResult(notice = "") {
    return {
      status: null,
      confidence: "无匹配",
      confidenceLabel: "无匹配",
      confidenceScore: 0,
      evidence: notice ? ["未识别到可对应 8 种状态的明确关键词"] : ["请先粘贴一段通知文本"],
      matchedKeywords: [],
      isTerminal: false,
    };
  }

  function inferStatusFromNotice(notice) {
    const text = typeof notice === "string" ? notice.trim() : "";
    if (!text) return noStatusInferenceResult();
    const normalized = normalizeSearchText(text).replace(/\s+/g, " ");
    const matches = [];

    STATUS_INFERENCE_RULES.forEach((rule) => {
      const evidence = [];
      if (normalized.includes(normalizeSearchText(rule.status))) {
        evidence.push(`通知包含状态词“${rule.status}”`);
      }
      for (const pattern of rule.patterns) {
        const match = text.match(pattern);
        if (match) {
          evidence.push(`命中关键词“${match[0].trim()}”`);
          break;
        }
      }
      if (evidence.length > 0) matches.push({ rule, evidence });
    });

    if (matches.length === 0) return noStatusInferenceResult(text);
    matches.sort((left, right) => right.rule.priority - left.rule.priority);
    const best = matches[0];
    const isTerminal = best.rule.status === "终止流程 / 已淘汰" || best.rule.status === "已接受 / 已拒绝 offer";
    return {
      status: best.rule.status,
      confidence: best.rule.confidence,
      confidenceLabel: best.rule.confidence,
      confidenceScore: best.rule.confidenceScore,
      evidence: best.evidence,
      matchedKeywords: best.evidence.map((item) => item.replace(/^.*“|”$/g, "")),
      isTerminal,
      competingStatuses: matches.slice(1).map(({ rule }) => rule.status),
    };
  }

  function todayKey(date = new Date()) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function dateDistance(dateValue, baseDate = todayKey()) {
    if (!isDateOnly(dateValue) || !isDateOnly(baseDate)) return null;
    const target = Date.parse(`${dateValue}T00:00:00Z`);
    const base = Date.parse(`${baseDate}T00:00:00Z`);
    if (Number.isNaN(target) || Number.isNaN(base)) return null;
    return Math.round((target - base) / 86400000);
  }

  function deadlineState(deadline, baseDate = todayKey()) {
    const distance = dateDistance(deadline, baseDate);
    if (distance === null) return "unknown";
    if (distance < 0) return "expired";
    if (distance <= 3) return "soon";
    return "open";
  }

  function formatDate(value) {
    if (!isDateOnly(value)) return "待公布";
    return value.replace(/-/g, ".");
  }

  function formatClock(date) {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "--:--";
    return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  }

  function formatUpdatedAt(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "暂无记录";
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    const hours = String(date.getHours()).padStart(2, "0");
    const minutes = String(date.getMinutes()).padStart(2, "0");
    return `${year}.${month}.${day} ${hours}:${minutes}`;
  }

  function deadlineLabel(deadline) {
    const distance = dateDistance(deadline);
    if (distance === null) return "待公布";
    if (distance < 0) return "已截止";
    if (distance === 0) return "今天截止";
    if (distance === 1) return "明天截止";
    if (distance <= 3) return `${distance} 天后截止`;
    return "开放中";
  }

  function statusClassName(status) {
    return STATUS_CLASS_NAMES[status] || "status-not-applied";
  }

  function companyTypeClassName(type) {
    return COMPANY_TYPE_CLASS_NAMES[type] || "company-type-other";
  }

  function companyMark(companyName) {
    const text = String(companyName ?? "").trim();
    return text.slice(0, 2) || "—";
  }

  function isExampleRecord(record) {
    return record?.sourceKind === "example" || record?.isDemo === true;
  }

  function sourceNameForRecord(record) {
    return pickFirstString(
      record?.sourceName,
      record?.source,
      isExampleRecord(record) ? EXAMPLE_SOURCE_NAME : state.dataInfo.sourceName,
    ) || (isExampleRecord(record) ? EXAMPLE_SOURCE_NAME : DEFAULT_SYNC_SOURCE_NAME);
  }

  function renderSourceBadge(record) {
    const kind = isExampleRecord(record) ? "示例数据" : "自动同步";
    const className = isExampleRecord(record) ? "record-source-example" : "record-source-sync";
    return `<span class="record-source ${className}" title="来源：${escapeHtml(sourceNameForRecord(record))}">${kind}</span>`;
  }

  function statusIndex(status) {
    const index = statusOptions.indexOf(status);
    return index < 0 ? Number.MAX_SAFE_INTEGER : index;
  }

  function compareText(left, right) {
    return String(left ?? "").localeCompare(String(right ?? ""), "zh-CN");
  }

  function compareDeadlines(left, right) {
    const leftKnown = isDateOnly(left);
    const rightKnown = isDateOnly(right);
    if (!leftKnown && !rightKnown) return 0;
    if (!leftKnown) return 1;
    if (!rightKnown) return -1;
    return compareText(left, right);
  }

  function sortRecords(records, sortValue = state.sort) {
    const indexed = records.map((record, index) => ({ record, index }));
    if (sortValue === "default") return indexed.map(({ record }) => record);

    const direction = sortValue.endsWith("-desc") ? -1 : 1;
    indexed.sort((left, right) => {
      let result = 0;
      if (sortValue.startsWith("deadline")) {
        result = compareDeadlines(left.record.deadline, right.record.deadline);
      } else if (sortValue.startsWith("status")) {
        result = statusIndex(left.record.status) - statusIndex(right.record.status);
      } else if (sortValue.startsWith("updated")) {
        const leftUpdatedAt = Date.parse(left.record.statusUpdatedAt);
        const rightUpdatedAt = Date.parse(right.record.statusUpdatedAt);
        const leftTimestamp = Number.isNaN(leftUpdatedAt) ? 0 : leftUpdatedAt;
        const rightTimestamp = Number.isNaN(rightUpdatedAt) ? 0 : rightUpdatedAt;
        result = leftTimestamp - rightTimestamp;
      }
      if (result === 0) result = left.index - right.index;
      return result * direction;
    });
    return indexed.map(({ record }) => record);
  }

  function recordMatchesFilters(record, filters = state.filters) {
    const keyword = normalizeSearchText(filters.keyword);
    if (keyword) {
      const searchable = [
        record.companyName,
        record.companyType,
        record.province,
        record.city,
        ...(Array.isArray(record.categories) ? record.categories : []),
      ].map(normalizeSearchText).join(" ");
      if (!searchable.includes(keyword)) return false;
    }
    if (filters.nature && record.companyType !== filters.nature) return false;
    if (filters.province && record.province !== filters.province) return false;
    if (filters.city && record.city !== filters.city) return false;
    if (filters.status && record.status !== filters.status) return false;
    if (filters.deadline && deadlineState(record.deadline) !== filters.deadline) return false;
    return true;
  }

  function filterRecords(records, filters = state.filters) {
    return records.filter((record) => recordMatchesFilters(record, filters));
  }

  function calculateStats(records = state.records) {
    const countStatus = (status) => records.filter((record) => record.status === status).length;
    return {
      total: records.length,
      soe: records.filter((record) => record.companyType === "央国企").length,
      private: records.filter((record) => record.companyType === "私企").length,
      submitted: countStatus("已投递"),
      interviewing: countStatus("面试中"),
      offer: countStatus("已发 offer"),
      dueSoon: records.filter((record) => deadlineState(record.deadline) === "soon").length,
    };
  }

  function setSelectOptions(select, values, emptyLabel) {
    if (!select || !hasDocument) return;
    const fragment = document.createDocumentFragment();
    const emptyOption = document.createElement("option");
    emptyOption.value = "";
    emptyOption.textContent = emptyLabel;
    fragment.appendChild(emptyOption);
    values.forEach((value) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = value;
      fragment.appendChild(option);
    });
    select.replaceChildren(fragment);
  }

  function refreshLocationOptions() {
    if (!dom.provinceFilter || !dom.cityFilter) return;
    const provinces = [...new Set(state.records.map((record) => record.province).filter(Boolean))]
      .sort((left, right) => compareText(left, right));
    const selectedProvince = provinces.includes(state.filters.province) ? state.filters.province : "";
    const cities = [...new Set(state.records
      .filter((record) => !selectedProvince || record.province === selectedProvince)
      .map((record) => record.city)
      .filter(Boolean))]
      .sort((left, right) => compareText(left, right));
    const selectedCity = cities.includes(state.filters.city) ? state.filters.city : "";

    state.filters.province = selectedProvince;
    state.filters.city = selectedCity;
    setSelectOptions(dom.provinceFilter, provinces, "全部省份");
    setSelectOptions(dom.cityFilter, cities, "全部城市");
    dom.provinceFilter.value = selectedProvince;
    dom.cityFilter.value = selectedCity;
    dom.cityFilter.disabled = cities.length === 0;
    dom.cityFilter.setAttribute("aria-disabled", String(cities.length === 0));
  }

  function populateEnumOptions() {
    if (!dom.natureFilter || !dom.statusFilter) return;
    setSelectOptions(dom.natureFilter, companyTypeOptions, "全部性质");
    setSelectOptions(dom.statusFilter, statusOptions, "全部状态");
    dom.natureFilter.value = state.filters.nature;
    dom.statusFilter.value = state.filters.status;
  }

  function statusOptionsMarkup(currentStatus) {
    return statusOptions.map((status) => `<option value="${escapeHtml(status)}"${status === currentStatus ? " selected" : ""}>${escapeHtml(status)}</option>`).join("");
  }

  function renderStatusPicker(record, context = "") {
    const label = `${record.companyName}${context ? `（${context}）` : ""}的投递状态`;
    return `<label class="status-picker ${statusClassName(record.status)}" data-status-picker>
      <span class="status-dot" aria-hidden="true"></span>
      <select class="status-select" data-status-id="${escapeHtml(record.id)}" aria-label="${escapeHtml(label)}">
        ${statusOptionsMarkup(record.status)}
      </select>
    </label>`;
  }

  function renderCampusLink(record, compact = false) {
    const campusUrl = safeCampusUrl(record.campusUrl);
    if (!campusUrl) {
      return `<span class="campus-link campus-link-disabled" role="status">链接待核实</span>`;
    }
    const label = compact ? "打开官网" : "官网";
    return `<a class="campus-link" href="${escapeHtml(campusUrl)}" target="_blank" rel="noopener noreferrer" aria-label="打开 ${escapeHtml(record.companyName)} 校招官网">${label}<svg aria-hidden="true" viewBox="0 0 16 16" fill="none"><path d="M5.2 3.4h7.4v7.4M12.3 3.7 4.1 11.9" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"/><path d="M10.1 8.5v2.8c0 .5-.4.9-.9.9H3.8c-.5 0-.9-.4-.9-.9V6.8c0-.5.4-.9.9-.9h2.8" stroke="currentColor" stroke-width="1.35" stroke-linecap="round"/></svg></a>`;
  }

  function renderDeadline(record, extraClass = "") {
    const status = deadlineState(record.deadline);
    return `<div class="deadline-cell deadline-${status} ${extraClass}">
      <div class="deadline-range">${renderDateValue(record.openDate)}<span aria-hidden="true"> → </span>${renderDateValue(record.deadline)}</div>
      <span class="deadline-state">${escapeHtml(deadlineLabel(record.deadline))}</span>
    </div>`;
  }

  function renderDateValue(value) {
    if (!isDateOnly(value)) return `<span class="date-pending">待公布</span>`;
    return `<time datetime="${escapeHtml(value)}">${escapeHtml(formatDate(value))}</time>`;
  }

  function renderCategories(record) {
    const categories = Array.isArray(record.categories) ? record.categories : [];
    return `<div class="category-list" aria-label="岗位方向">${categories.map((category) => `<span class="category-tag">${escapeHtml(category)}</span>`).join("")}</div>`;
  }

  function renderLocation(record) {
    const city = typeof record.city === "string" && record.city.trim() ? record.city : "城市待定";
    const province = typeof record.province === "string" && record.province.trim() ? record.province : "地区待定";
    return `<div class="location-cell"><strong>${escapeHtml(city)}</strong><span>${escapeHtml(province)}</span></div>`;
  }

  function renderTable(records) {
    if (!dom.tableBody) return;
    dom.tableBody.innerHTML = records.map((record) => `<tr data-record-id="${escapeHtml(record.id)}" data-status="${escapeHtml(record.status)}">
      <td>
        <div class="company-cell">
          <span class="company-avatar" aria-hidden="true">${escapeHtml(companyMark(record.companyName))}</span>
          <span class="company-copy"><strong class="company-name">${escapeHtml(record.companyName)}</strong><span class="company-id">${escapeHtml(record.id)}</span>${renderSourceBadge(record)}</span>
        </div>
      </td>
      <td><span class="company-type ${companyTypeClassName(record.companyType)}">${escapeHtml(record.companyType)}</span></td>
      <td>${renderCategories(record)}</td>
      <td>${renderLocation(record)}</td>
      <td>${renderDeadline(record)}</td>
      <td>${renderStatusPicker(record)}</td>
      <td><div class="updated-cell"><time datetime="${escapeHtml(record.statusUpdatedAt)}">${escapeHtml(formatUpdatedAt(record.statusUpdatedAt))}</time><span class="updated-caption">状态更新时间</span></div></td>
      <td>${renderCampusLink(record)}</td>
    </tr>`).join("");
  }

  function renderMobileCards(records) {
    if (!dom.mobileCardView) return;
    dom.mobileCardView.innerHTML = records.map((record) => `<article class="job-card" data-record-id="${escapeHtml(record.id)}" data-status="${escapeHtml(record.status)}">
      <div class="job-card-header">
        <div class="job-card-company">
          <span class="company-avatar" aria-hidden="true">${escapeHtml(companyMark(record.companyName))}</span>
          <span class="company-copy"><strong class="company-name">${escapeHtml(record.companyName)}</strong><span class="company-id">${escapeHtml(record.id)}</span>${renderSourceBadge(record)}</span>
        </div>
        <span class="company-type ${companyTypeClassName(record.companyType)}">${escapeHtml(record.companyType)}</span>
      </div>
      <div class="job-card-grid">
        <div class="job-card-field"><span class="job-card-label">岗位方向</span><div class="job-card-value">${renderCategories(record)}</div></div>
        <div class="job-card-field"><span class="job-card-label">工作地点</span><div class="job-card-value">${renderLocation(record)}</div></div>
        <div class="job-card-field"><span class="job-card-label">开放 / 截止</span><div class="job-card-value">${renderDeadline(record, "job-card-deadline")}</div></div>
        <div class="job-card-field"><span class="job-card-label">校招官网</span><div class="job-card-value">${renderCampusLink(record, true)}</div></div>
      </div>
      <div class="job-card-footer">
        ${renderStatusPicker(record, "移动端")}
        <div class="job-card-updated"><span>最近更新</span><time datetime="${escapeHtml(record.statusUpdatedAt)}">${escapeHtml(formatUpdatedAt(record.statusUpdatedAt))}</time></div>
      </div>
    </article>`).join("");
  }

  function updateStats() {
    const stats = calculateStats(state.records);
    if (!hasDocument) return;
    Object.entries(stats).forEach(([key, value]) => {
      const element = document.querySelector(`[data-stat="${key}"]`);
      if (element) element.textContent = String(value);
    });
  }

  function formatSyncTime(value) {
    return isValidTimestamp(value) ? formatUpdatedAt(value) : "暂无";
  }

  function calculateDiscoverySummary(records = state.records) {
    const sources = new Set(records.map((record) => sourceNameForRecord(record)).filter(Boolean));
    const recordSyncTime = records
      .map((record) => record?.lastSyncAt)
      .find((value) => isValidTimestamp(value));
    return {
      matchCount: records.length,
      sourceCount: sources.size,
      lastSyncAt: state.dataInfo.lastSyncAt || recordSyncTime || "",
      city: state.filters.city || "",
      province: state.filters.province || "",
    };
  }

  function updateDataProvenance() {
    if (!hasDocument) return;
    if (dom.dataSourceKind) dom.dataSourceKind.textContent = state.dataInfo.label || "示例数据";
    if (dom.dataSourceName) {
      const suffix = state.dataInfo.mode === "sync" ? "（含内置示例）" : "";
      dom.dataSourceName.textContent = `来源：${state.dataInfo.sourceName || EXAMPLE_SOURCE_NAME}${suffix}`;
    }
    if (dom.dataLastSync) {
      dom.dataLastSync.textContent = state.dataInfo.lastSyncAt
        ? `最后同步：${formatSyncTime(state.dataInfo.lastSyncAt)}`
        : "最后同步：暂无（示例数据）";
    }
  }

  function updateDiscoverySummary(records) {
    if (!hasDocument) return;
    const summary = calculateDiscoverySummary(records);
    const location = [summary.province, summary.city].filter(Boolean).join(" · ") || "全部城市";
    if (dom.cityDiscoveryContext) dom.cityDiscoveryContext.textContent = `${location} · 可叠加其他筛选条件`;
    if (dom.cityMatchCount) dom.cityMatchCount.textContent = String(summary.matchCount);
    if (dom.citySourceCount) dom.citySourceCount.textContent = String(summary.sourceCount);
    if (dom.cityLastSync) dom.cityLastSync.textContent = formatSyncTime(summary.lastSyncAt);
  }

  function updateResultsSummary(matchCount) {
    if (!dom.resultsCount) return;
    dom.resultsCount.textContent = `共 ${matchCount} / ${state.records.length} 个岗位`;
  }

  function updateEmptyState(isEmpty) {
    if (!hasDocument || !dom.emptyState) return;
    const hasLocationFilter = Boolean(state.filters.province || state.filters.city);
    if (dom.emptyStateTitle) {
      dom.emptyStateTitle.textContent = hasLocationFilter ? "该城市暂无匹配岗位" : "没有找到匹配的岗位";
    }
    if (dom.emptyStateDescription) {
      dom.emptyStateDescription.textContent = hasLocationFilter
        ? "可以恢复全部城市，或保留其他筛选条件继续查找。"
        : "试试减少筛选条件，或者换一个关键词继续看看。";
    }
    if (dom.emptyRestoreCitiesButton) dom.emptyRestoreCitiesButton.hidden = !hasLocationFilter;
    dom.emptyState.hidden = !isEmpty;
  }

  function renderResults() {
    const filteredRecords = filterRecords(state.records);
    const visibleRecords = sortRecords(filteredRecords, state.sort);
    updateResultsSummary(visibleRecords.length);
    updateDiscoverySummary(filteredRecords);
    renderTable(visibleRecords);
    renderMobileCards(visibleRecords);
    const isEmpty = visibleRecords.length === 0;
    if (dom.desktopTableView) dom.desktopTableView.hidden = isEmpty;
    if (dom.mobileCardView) dom.mobileCardView.hidden = isEmpty;
    updateEmptyState(isEmpty);
  }

  function renderAll() {
    if (!hasDocument) return;
    updateDataProvenance();
    updateDataNote();
    populateStatusAssistantJobs();
    updateStats();
    renderResults();
  }

  function updateSaveHint(message) {
    if (dom.saveHint) dom.saveHint.textContent = message;
  }

  function showToast(message) {
    if (!dom.toast) return;
    dom.toast.textContent = message;
    dom.toast.classList.add("is-visible");
    if (toastTimer !== null && typeof root.clearTimeout === "function") root.clearTimeout(toastTimer);
    if (typeof root.setTimeout === "function") {
      toastTimer = root.setTimeout(() => {
        dom.toast.classList.remove("is-visible");
        toastTimer = null;
      }, 2600);
    }
  }

  function syncControls() {
    if (!hasDocument) return;
    if (dom.keywordInput) dom.keywordInput.value = state.filters.keyword;
    if (dom.natureFilter) dom.natureFilter.value = state.filters.nature;
    if (dom.deadlineFilter) dom.deadlineFilter.value = state.filters.deadline;
    if (dom.statusFilter) dom.statusFilter.value = state.filters.status;
    if (dom.sortSelect) dom.sortSelect.value = state.sort;
    refreshLocationOptions();
  }

  function clearFilters(showMessage = false) {
    state.filters = {
      keyword: "",
      nature: "",
      province: "",
      city: "",
      deadline: "",
      status: "",
    };
    syncControls();
    renderResults();
    if (showMessage) showToast("已清除全部筛选条件");
  }

  function restoreAllCities(showMessage = true) {
    state.filters.province = "";
    state.filters.city = "";
    syncControls();
    renderResults();
    if (showMessage) showToast("已恢复全部城市");
  }

  function statusViewForControl(control) {
    if (!hasDocument || !control || typeof control.closest !== "function") return null;
    if (control.closest("#mobileCardView")) return "mobile";
    if (control.closest("#desktopTableView")) return "desktop";
    return null;
  }

  function isStatusViewVisible(view) {
    const container = view === "mobile" ? dom.mobileCardView : dom.desktopTableView;
    if (!container || container.hidden) return false;
    if (typeof root.getComputedStyle === "function") {
      const computed = root.getComputedStyle(container);
      if (computed && (computed.display === "none" || computed.visibility === "hidden")) return false;
    }
    return true;
  }

  function findStatusControl(recordId, view) {
    const container = view === "mobile" ? dom.mobileCardView : dom.tableBody;
    if (!container || typeof container.querySelectorAll !== "function") return null;
    return [...container.querySelectorAll("select[data-status-id]")]
      .find((select) => select.dataset.statusId === recordId) || null;
  }

  function handleFilterChange(event) {
    const field = event.target.closest?.("[data-filter]");
    if (!field) return;
    const name = field.dataset.filter;
    if (!Object.prototype.hasOwnProperty.call(state.filters, name)) return;
    state.filters[name] = field.value;
    if (name === "province") state.filters.city = "";
    if (name === "province" || name === "city") refreshLocationOptions();
    renderResults();
  }

  function updateStatus(recordId, nextStatus, sourceControl) {
    if (!statusOptions.includes(nextStatus)) {
      renderAll();
      return false;
    }
    const record = state.records.find((item) => item.id === recordId);
    if (!record || record.status === nextStatus) return false;

    const shouldRefocus = hasDocument && document.activeElement === sourceControl;
    const sourceView = shouldRefocus ? statusViewForControl(sourceControl) : null;
    record.status = nextStatus;
    record.statusUpdatedAt = new Date().toISOString();
    const persisted = writeRecords(state.records);
    renderAll();
    if (shouldRefocus && sourceView && isStatusViewVisible(sourceView)) {
      const replacement = findStatusControl(recordId, sourceView);
      if (replacement) replacement.focus();
    }
    showToast(persisted
      ? `${record.companyName}：已更新为“${nextStatus}”`
      : `${record.companyName}：状态已更新，但未持久化，请不要刷新页面`);
    return persisted;
  }

  function handleStatusChange(event) {
    const select = event.target.closest?.("select[data-status-id]");
    if (!select) return;
    updateStatus(select.dataset.statusId, select.value, select);
  }

  function clearStatusAssistantResult() {
    assistantState.pending = null;
    if (!hasDocument) return;
    if (dom.statusAssistantResult) dom.statusAssistantResult.hidden = true;
    if (dom.statusAssistantConfirmButton) dom.statusAssistantConfirmButton.disabled = true;
    if (dom.statusAssistantMessage) dom.statusAssistantMessage.textContent = "";
  }

  function populateStatusAssistantJobs() {
    if (!hasDocument || !dom.statusAssistantJobSelect) return;
    const selectedId = dom.statusAssistantJobSelect.value;
    const fragment = document.createDocumentFragment();
    const emptyOption = document.createElement("option");
    emptyOption.value = "";
    emptyOption.textContent = "请选择要更新的职位";
    fragment.appendChild(emptyOption);
    state.records.forEach((record) => {
      const option = document.createElement("option");
      option.value = record.id;
      const firstCategory = Array.isArray(record.categories) && record.categories.length > 0
        ? ` · ${record.categories[0]}`
        : "";
      option.textContent = `${record.companyName} · ${record.city}${firstCategory}`;
      fragment.appendChild(option);
    });
    dom.statusAssistantJobSelect.replaceChildren(fragment);
    dom.statusAssistantJobSelect.value = state.records.some((record) => record.id === selectedId) ? selectedId : "";
  }

  function setAssistantMessage(message) {
    if (dom.statusAssistantMessage) dom.statusAssistantMessage.textContent = message;
  }

  function renderStatusInference(record, inference) {
    if (!hasDocument || !dom.statusAssistantResult) return;
    dom.statusAssistantResult.hidden = false;
    if (dom.statusAssistantRecommendation) {
      dom.statusAssistantRecommendation.textContent = inference.status || "暂未识别";
    }
    if (dom.statusAssistantConfidence) {
      const score = inference.confidenceScore > 0 ? ` · ${Math.round(inference.confidenceScore * 100)}%` : "";
      dom.statusAssistantConfidence.textContent = `置信度：${inference.confidence}${score}`;
    }
    if (dom.statusAssistantCurrentStatus) {
      dom.statusAssistantCurrentStatus.textContent = record
        ? `当前状态：${record.status}`
        : "请先选择一个职位";
    }
    if (dom.statusAssistantEvidence) {
      const fragment = document.createDocumentFragment();
      inference.evidence.forEach((item) => {
        const evidenceItem = document.createElement("li");
        evidenceItem.textContent = item;
        fragment.appendChild(evidenceItem);
      });
      dom.statusAssistantEvidence.replaceChildren(fragment);
    }
    const canConfirm = Boolean(record && inference.status && statusOptions.includes(inference.status));
    if (dom.statusAssistantConfirmButton) dom.statusAssistantConfirmButton.disabled = !canConfirm;
    setAssistantMessage(canConfirm
      ? "请核对判断依据；只有点击确认后才会更新投递状态。"
      : "未更新任何状态，请补充更明确的通知内容。"
    );
  }

  function analyzeStatusNotice() {
    const recordId = dom.statusAssistantJobSelect?.value || "";
    const notice = dom.statusAssistantNotice?.value || "";
    const record = state.records.find((item) => item.id === recordId) || null;
    if (!record) {
      assistantState.pending = null;
      renderStatusInference(null, noStatusInferenceResult(notice));
      setAssistantMessage("请先选择一个职位；分析结果不会自动修改状态。 ");
      return;
    }
    const inference = inferStatusFromNotice(notice);
    assistantState.pending = inference.status
      ? { recordId: record.id, status: inference.status, inference }
      : null;
    renderStatusInference(record, inference);
  }

  function clearStatusAssistant() {
    if (dom.statusAssistantNotice) dom.statusAssistantNotice.value = "";
    clearStatusAssistantResult();
    dom.statusAssistantNotice?.focus();
  }

  function cancelStatusAssistant() {
    clearStatusAssistantResult();
    dom.statusAssistantNotice?.focus();
  }

  function confirmStatusAssistant() {
    const pending = assistantState.pending;
    if (!pending || !statusOptions.includes(pending.status)) return false;
    const record = state.records.find((item) => item.id === pending.recordId);
    if (!record) {
      clearStatusAssistantResult();
      return false;
    }
    const changed = updateStatus(record.id, pending.status);
    clearStatusAssistantResult();
    if (!changed && record.status === pending.status) {
      showToast(`${record.companyName}：当前已经是“${pending.status}”`);
    }
    return true;
  }

  function resetToInitialData() {
    const confirmFn = typeof root.confirm === "function" ? root.confirm.bind(root) : () => true;
    if (!confirmFn("确定恢复示例数据吗？这会覆盖本机保存的投递状态。")) return;
    removeStoredRecords();
    state.dataInfo = {
      mode: "example",
      label: "示例数据",
      sourceName: EXAMPLE_SOURCE_NAME,
      lastSyncAt: "",
    };
    state.records = normalizeExampleRecords();
    state.sort = "default";
    clearStatusAssistantResult();
    clearFilters();
    const persisted = writeRecords(state.records);
    renderAll();
    showToast(persisted ? "已恢复示例数据" : "示例数据已恢复，但未持久化，请不要刷新页面");
    return persisted;
  }

  function bindEvents() {
    if (!hasDocument) return;
    dom.filtersForm?.addEventListener("submit", (event) => event.preventDefault());
    dom.filtersForm?.addEventListener("input", handleFilterChange);
    dom.filtersForm?.addEventListener("change", handleFilterChange);
    dom.clearFiltersButton?.addEventListener("click", () => clearFilters(true));
    dom.emptyClearButton?.addEventListener("click", () => clearFilters(true));
    dom.restoreCitiesButton?.addEventListener("click", () => restoreAllCities(true));
    dom.emptyRestoreCitiesButton?.addEventListener("click", () => restoreAllCities(true));
    dom.sortSelect?.addEventListener("change", (event) => {
      state.sort = event.target.value;
      renderResults();
    });
    dom.tableBody?.addEventListener("change", handleStatusChange);
    dom.mobileCardView?.addEventListener("change", handleStatusChange);
    dom.exportButton?.addEventListener("click", () => {
      const records = sortRecords(filterRecords(state.records), state.sort);
      downloadCsv(records);
      showToast(`已导出 ${records.length} 条岗位记录`);
    });
    dom.heroExportButton?.addEventListener("click", () => {
      const records = sortRecords(filterRecords(state.records), state.sort);
      downloadCsv(records);
      showToast(`已导出 ${records.length} 条岗位记录`);
    });
    dom.heroResetButton?.addEventListener("click", resetToInitialData);
    dom.statusAssistantAnalyzeButton?.addEventListener("click", analyzeStatusNotice);
    dom.statusAssistantClearButton?.addEventListener("click", clearStatusAssistant);
    dom.statusAssistantCancelButton?.addEventListener("click", cancelStatusAssistant);
    dom.statusAssistantConfirmButton?.addEventListener("click", confirmStatusAssistant);
    dom.statusAssistantJobSelect?.addEventListener("change", clearStatusAssistantResult);
    dom.statusAssistantNotice?.addEventListener("input", clearStatusAssistantResult);
  }

  function collectDom() {
    if (!hasDocument) return;
    const byId = (id) => document.getElementById(id);
    dom = {
      saveHint: byId("saveHint"),
      dataNote: byId("dataNote"),
      dataProvenance: byId("dataProvenance"),
      dataSourceKind: byId("dataSourceKind"),
      dataSourceName: byId("dataSourceName"),
      dataLastSync: byId("dataLastSync"),
      filtersForm: byId("filtersForm"),
      keywordInput: byId("keywordInput"),
      natureFilter: byId("natureFilter"),
      provinceFilter: byId("provinceFilter"),
      cityFilter: byId("cityFilter"),
      deadlineFilter: byId("deadlineFilter"),
      statusFilter: byId("statusFilter"),
      sortSelect: byId("sortSelect"),
      clearFiltersButton: byId("clearFiltersButton"),
      emptyClearButton: byId("emptyClearButton"),
      restoreCitiesButton: byId("restoreCitiesButton"),
      emptyRestoreCitiesButton: byId("emptyRestoreCitiesButton"),
      exportButton: byId("exportButton"),
      heroExportButton: byId("heroExportButton"),
      heroResetButton: byId("heroResetButton"),
      desktopTableView: byId("desktopTableView"),
      tableBody: byId("tableBody"),
      mobileCardView: byId("mobileCardView"),
      emptyState: byId("emptyState"),
      emptyStateTitle: byId("emptyStateTitle"),
      emptyStateDescription: byId("emptyStateDescription"),
      resultsCount: byId("resultsCount"),
      cityDiscoveryContext: byId("cityDiscoveryContext"),
      cityMatchCount: byId("cityMatchCount"),
      citySourceCount: byId("citySourceCount"),
      cityLastSync: byId("cityLastSync"),
      statusAssistantJobSelect: byId("statusAssistantJobSelect"),
      statusAssistantNotice: byId("statusAssistantNotice"),
      statusAssistantAnalyzeButton: byId("statusAssistantAnalyzeButton"),
      statusAssistantClearButton: byId("statusAssistantClearButton"),
      statusAssistantResult: byId("statusAssistantResult"),
      statusAssistantRecommendation: byId("statusAssistantRecommendation"),
      statusAssistantConfidence: byId("statusAssistantConfidence"),
      statusAssistantCurrentStatus: byId("statusAssistantCurrentStatus"),
      statusAssistantEvidence: byId("statusAssistantEvidence"),
      statusAssistantMessage: byId("statusAssistantMessage"),
      statusAssistantConfirmButton: byId("statusAssistantConfirmButton"),
      statusAssistantCancelButton: byId("statusAssistantCancelButton"),
      toast: byId("toast"),
    };
  }

  function updateDataNote() {
    if (!dom.dataNote) return;
    if (state.dataInfo.mode === "sync") {
      dom.dataNote.textContent = "已加载自动同步招聘信息；空日期显示为待公布，请以企业官方页面为准。";
      return;
    }
    dom.dataNote.textContent = typeof dataMeta.dateNote === "string" && dataMeta.dateNote.trim()
      ? dataMeta.dateNote
      : "开放时间与截止时间为演示日期，请以企业官方页面为准。";
  }

  function init() {
    if (!hasDocument || init.started) return;
    init.started = true;
    collectDom();
    updateSaveHint(state.storageAvailable ? "数据仅保存在本机" : "未持久化：本机存储不可用");
    updateDataNote();
    populateEnumOptions();
    refreshLocationOptions();
    syncControls();
    bindEvents();
    renderAll();
  }

  const api = {
    get data() {
      return state.records;
    },
    get dataInfo() {
      return state.dataInfo;
    },
    state,
    initialRecords,
    statusOptions,
    companyTypeOptions,
    storageKey,
    calculateStats,
    calculateDiscoverySummary,
    deadlineState,
    formatDate,
    formatSyncTime,
    recordMatchesFilters,
    filterRecords,
    sortRecords,
    makeCsv,
    downloadCsv,
    isDateOnly,
    isHttpsUrl,
    safeCampusUrl,
    isValidStoredRecord,
    isOptionalDate,
    escapeHtml,
    inferStatusFromNotice,
    mergeRecruitmentRecords,
    resolveRecruitmentData,
    applyStoredProgress,
    writeRecords,
    statusClassName,
    updateStatus,
    resetToInitialData,
    init,
  };

  root.AutumnRecruitmentApp = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;

  state.records = loadRecords();

  if (hasDocument) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", init, { once: true });
    } else {
      init();
    }
  }
})();
