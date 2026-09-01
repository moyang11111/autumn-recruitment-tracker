import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA_FILE = path.join(ROOT, "data.js");
const INTEGRATION_MODE = process.argv.includes("--integration");

const COMPANY_TYPES = new Set(["央国企", "私企", "外企", "事业单位", "其他"]);
const STATUSES = new Set([
  "未投递",
  "已投递",
  "筛选中",
  "笔试 / 测评中",
  "面试中",
  "已发 offer",
  "终止流程 / 已淘汰",
  "已接受 / 已拒绝 offer",
]);
const REQUIRED_COMPANIES = [
  "国家电网",
  "中石油",
  "中国移动",
  "中国建筑",
  "华润集团",
  "腾讯",
  "字节跳动",
  "华为",
  "美团",
  "京东",
  "比亚迪",
];

const errors = [];
const notes = [];

function fail(message) {
  errors.push(message);
}

function note(message) {
  notes.push(message);
}

function assert(condition, message) {
  if (!condition) fail(message);
}

function isDateOnly(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function isDateInDemoWindow(value) {
  const month = Number(value.slice(5, 7));
  return value.startsWith("2026-") && month >= 8 && month <= 10;
}

function isValidUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && Boolean(url.hostname);
  } catch {
    return false;
  }
}

function loadDataFile() {
  assert(fs.existsSync(DATA_FILE), "缺少 data.js");
  if (!fs.existsSync(DATA_FILE)) return {};

  const source = fs.readFileSync(DATA_FILE, "utf8");
  const context = vm.createContext({});
  try {
    vm.runInContext(source, context, { filename: DATA_FILE });
  } catch (error) {
    fail(`data.js 无法在 Node VM 中执行：${error.message}`);
    return {};
  }
  return context;
}

function validateData(context) {
  const data = context.INITIAL_RECRUITMENT_DATA;
  assert(Array.isArray(data), "INITIAL_RECRUITMENT_DATA 必须是数组");
  if (!Array.isArray(data)) return;

  assert(data.length >= 15, `初始化数据至少需要 15 条，当前为 ${data.length} 条`);
  const ids = new Set();
  const seenStatuses = new Set();

  for (const [index, item] of data.entries()) {
    const prefix = `第 ${index + 1} 条`;
    assert(item && typeof item === "object" && !Array.isArray(item), `${prefix}必须是对象`);
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;

    assert(typeof item.id === "string" && item.id.trim().length > 0, `${prefix}缺少非空 id`);
    if (typeof item.id === "string") {
      assert(!ids.has(item.id), `id 重复：${item.id}`);
      ids.add(item.id);
    }
    assert(typeof item.companyName === "string" && item.companyName.trim().length > 0, `${prefix}缺少 companyName`);
    assert(COMPANY_TYPES.has(item.companyType), `${prefix} companyType 无效：${item.companyType}`);

    assert(isDateOnly(item.openDate), `${prefix} openDate 不是有效 YYYY-MM-DD 日期：${item.openDate}`);
    assert(isDateOnly(item.deadline), `${prefix} deadline 不是有效 YYYY-MM-DD 日期：${item.deadline}`);
    if (isDateOnly(item.openDate) && isDateOnly(item.deadline)) {
      assert(item.openDate <= item.deadline, `${prefix} openDate 不得晚于 deadline`);
      assert(isDateInDemoWindow(item.openDate), `${prefix} openDate 应为 2026 年 8—10 月演示日期`);
      assert(isDateInDemoWindow(item.deadline), `${prefix} deadline 应为 2026 年 8—10 月演示日期`);
    }

    assert(typeof item.province === "string" && item.province.trim().length > 0, `${prefix} 缺少 province`);
    assert(typeof item.city === "string" && item.city.trim().length > 0, `${prefix} 缺少 city`);
    assert(Array.isArray(item.categories), `${prefix} categories 必须是数组`);
    if (Array.isArray(item.categories)) {
      assert(item.categories.length > 0, `${prefix} categories 至少需要一个岗位类别`);
      assert(item.categories.every((category) => typeof category === "string" && category.trim()), `${prefix} categories 含有无效值`);
    }
    assert(isValidUrl(item.campusUrl), `${prefix} campusUrl 必须是 HTTPS URL：${item.campusUrl}`);
    assert(STATUSES.has(item.status), `${prefix} status 无效：${item.status}`);
    if (STATUSES.has(item.status)) seenStatuses.add(item.status);
    assert(typeof item.statusUpdatedAt === "string" && !Number.isNaN(Date.parse(item.statusUpdatedAt)), `${prefix} statusUpdatedAt 不是有效时间`);
    assert(item.isDemo === true, `${prefix} isDemo 必须为 true，以标记模拟数据`);
  }

  for (const company of REQUIRED_COMPANIES) {
    assert(data.some((item) => typeof item?.companyName === "string" && item.companyName.includes(company)), `缺少必需企业：${company}`);
  }
  for (const status of STATUSES) {
    assert(seenStatuses.has(status), `示例数据未覆盖状态：${status}`);
  }

  const meta = context.RECRUITMENT_DATA_META;
  assert(meta && meta.isDemo === true, "RECRUITMENT_DATA_META.isDemo 必须为 true");
  assert(typeof meta?.dateNote === "string" && meta.dateNote.includes("模拟"), "需要提供模拟日期提示元数据");
  assert(typeof meta?.storageKey === "string" && meta.storageKey.length > 0, "需要提供 localStorage storageKey 元数据");
}

function readIfExists(fileName) {
  const filePath = path.join(ROOT, fileName);
  return fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : "";
}

function checkAssetFile(candidates, label) {
  const found = candidates.find((fileName) => fs.existsSync(path.join(ROOT, fileName)));
  assert(Boolean(found), `集成后缺少${label}文件（候选：${candidates.join("、")}）`);
  return found;
}

function checkHook(html, label, patterns) {
  assert(patterns.some((pattern) => pattern.test(html)), `index.html 缺少${label}关键挂钩`);
}

function validateIntegration() {
  const indexPath = path.join(ROOT, "index.html");
  const appCandidates = ["app.js", "script.js", "main.js"];
  const styleCandidates = ["styles.css", "style.css", "main.css"];
  const appExists = appCandidates.some((fileName) => fs.existsSync(path.join(ROOT, fileName)));
  const styleExists = styleCandidates.some((fileName) => fs.existsSync(path.join(ROOT, fileName)));
  const indexExists = fs.existsSync(indexPath);
  const integrationFilesAreComplete = indexExists && appExists && styleExists;

  if (!INTEGRATION_MODE && !integrationFilesAreComplete) {
    if (indexExists || appExists || styleExists) {
      note("当前 UI 文件尚未完整集成，已暂跳过应用文件检查；集成完成后 npm test 会自动启用，或运行 npm run test:integration 获取严格失败结果。");
    } else {
      note("当前分层尚未集成 UI 文件，已跳过应用文件检查；集成后 npm test 会自动启用，或运行 npm run test:integration。");
    }
    return;
  }

  assert(fs.existsSync(indexPath), "集成后缺少 index.html");
  const html = readIfExists("index.html");
  const appFile = checkAssetFile(appCandidates, "JavaScript 入口");
  const styleFile = checkAssetFile(styleCandidates, "CSS 入口");
  const appSource = appFile ? readIfExists(appFile) : "";
  const dataIsReferenced = /data\.js|INITIAL_RECRUITMENT_DATA|RECRUITMENT_DATA_META/.test(`${html}\n${appSource}`);
  assert(dataIsReferenced, "应用入口未发现 data.js 或 INITIAL_RECRUITMENT_DATA 引用");
  assert(styleFile || /<style\b/i.test(html), "index.html 未发现样式入口");

  checkHook(html, "关键词搜索", [
    /搜索/, /search/i, /keyword/i, /data-(?:action|filter)=['"][^'"]*(?:search|keyword)/i,
  ]);
  checkHook(html, "筛选控件", [
    /企业性质/, /工作地点/, /省份/, /城市/, /截止时间/, /投递状态/, /filter/i, /data-filter/i,
  ]);
  checkHook(html, "招聘列表", [
    /招聘信息/, /岗位列表/, /recruitment[-_ ]?list/i, /job[-_ ]?list/i, /<table\b/i, /<tbody\b/i,
  ]);
  checkHook(html, "统计看板", [
    /总岗位/, /央国企数量/, /已投递数量/, /即将截止数量/, /dashboard/i, /stat/i, /summary/i,
  ]);
  checkHook(html, "导出入口", [/导出/, /export/i, /csv/i]);
  checkHook(html, "状态展示或编辑入口", [/投递状态/, /status/i, /已投递/, /未投递/]);
}

function createMemoryStorage(initialValue = null, failWrites = false) {
  const values = new Map();
  if (initialValue !== null) values.set("autumn-recruitment-tracker:v1", initialValue);
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      if (failWrites) throw new Error("simulated storage failure");
      values.set(key, value);
    },
    removeItem(key) {
      values.delete(key);
    },
  };
}

function loadBehaviorApp(storage) {
  const appSource = readIfExists("app.js");
  const sandbox = {
    INITIAL_RECRUITMENT_DATA: context.INITIAL_RECRUITMENT_DATA,
    RECRUITMENT_STATUS_OPTIONS: context.RECRUITMENT_STATUS_OPTIONS,
    RECRUITMENT_COMPANY_TYPES: context.RECRUITMENT_COMPANY_TYPES,
    RECRUITMENT_DATA_META: context.RECRUITMENT_DATA_META,
    localStorage: storage,
    URL,
    console,
    module: { exports: {} },
  };
  const appContext = vm.createContext(sandbox);
  try {
    vm.runInContext(appSource, appContext, { filename: path.join(ROOT, "app.js") });
  } catch (error) {
    fail(`app.js 行为检查无法执行：${error.message}`);
    return null;
  }
  return appContext.AutumnRecruitmentApp || appContext.module.exports;
}

function validateBehavior() {
  const appPath = path.join(ROOT, "app.js");
  if (!fs.existsSync(appPath)) {
    note("尚未集成 app.js，已跳过无依赖行为检查。");
    return;
  }

  const app = loadBehaviorApp(createMemoryStorage());
  if (!app) return;

  assert(app.isHttpsUrl("https://example.com/campus"), "行为检查：应接受 HTTPS 校招链接");
  for (const unsafeUrl of ["http://example.com", "javascript:alert(1)", "data:text/html,blocked"]) {
    assert(!app.isHttpsUrl(unsafeUrl), `行为检查：应拒绝不安全校招链接 ${unsafeUrl}`);
  }

  const validRecord = { ...app.data[0], categories: [...app.data[0].categories] };
  assert(app.isValidStoredRecord(validRecord), "行为检查：应接受有效存储记录");
  assert(!app.isValidStoredRecord({ ...validRecord, openDate: "2026-02-30" }), "行为检查：应拒绝无效 YYYY-MM-DD 日期");
  assert(!app.isValidStoredRecord({ ...validRecord, openDate: "2026-09-20", deadline: "2026-09-10" }), "行为检查：应拒绝开放日期晚于截止日期");

  const rows = app.data.slice(0, 3).map((record, index) => ({
    ...record,
    statusUpdatedAt: ["2026-08-31T09:00:00+08:00", "2026-09-02T09:00:00+08:00", "2026-08-30T09:00:00+08:00"][index],
  }));
  const ascendingIds = app.sortRecords(rows, "updated-asc").map((record) => record.id);
  const descendingIds = app.sortRecords(rows, "updated-desc").map((record) => record.id);
  assert(ascendingIds.join(",") === `${rows[2].id},${rows[0].id},${rows[1].id}`, "行为检查：更新时间正序错误");
  assert(descendingIds.join(",") === `${rows[1].id},${rows[0].id},${rows[2].id}`, "行为检查：更新时间倒序错误");

  const csvRecord = { ...validRecord, companyName: '测试, "企业"', categories: ["岗位", "测试"] };
  const csv = app.makeCsv([csvRecord]);
  assert(csv.charCodeAt(0) === 0xfeff, "行为检查：CSV 缺少 UTF-8 BOM");
  assert(csv.includes('"测试, ""企业"""'), "行为检查：CSV 未正确转义逗号和双引号");
  assert(csv.includes('"岗位、测试"'), "行为检查：CSV 未正确合并岗位类别");

  const unsafeData = JSON.parse(JSON.stringify(context.INITIAL_RECRUITMENT_DATA));
  unsafeData[0].campusUrl = "javascript:alert(1)";
  const unsafeApp = loadBehaviorApp(createMemoryStorage(JSON.stringify(unsafeData)));
  assert(unsafeApp && unsafeApp.data[0].campusUrl === context.INITIAL_RECRUITMENT_DATA[0].campusUrl, "行为检查：不安全存储链接不应进入应用状态");

  const failingApp = loadBehaviorApp(createMemoryStorage(null, true));
  assert(failingApp && failingApp.writeRecords(failingApp.data) === false, "行为检查：存储失败应返回 false");
}

const context = loadDataFile();
validateData(context);
validateIntegration();
validateBehavior();

if (errors.length > 0) {
  console.error("验证失败：");
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log(`数据验证通过：${context.INITIAL_RECRUITMENT_DATA.length} 条初始化记录。`);
  for (const message of notes) console.log(`提示：${message}`);
}
