import fsp from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

export const SCHEMA_VERSION = 1;
export const DEFAULT_STATUS = "未投递";
export const DEFAULT_STATUS_UPDATED_AT = "1970-01-01T00:00:00.000Z";
export const DEFAULT_TIMEOUT_MS = 15_000;
export const SOURCE_STALE_AFTER_DAYS = 14;

export const VALID_STATUSES = new Set([
  "未投递",
  "已投递",
  "筛选中",
  "笔试 / 测评中",
  "面试中",
  "已发 offer",
  "终止流程 / 已淘汰",
  "已接受 / 已拒绝 offer",
]);

export const VALID_COMPANY_TYPES = new Set(["央国企", "私企", "外企", "事业单位", "其他"]);
export const VALID_SOURCE_TYPES = new Set(["greenhouse", "lever", "community-json"]);

export const GUANGDONG_PROVINCE = "广东";
export const GUANGDONG_CITIES = Object.freeze([
  "广州", "深圳", "珠海", "汕头", "佛山", "韶关", "河源", "梅州", "惠州", "汕尾", "东莞",
  "中山", "江门", "阳江", "湛江", "茂名", "肇庆", "清远", "潮州", "揭阳", "云浮",
]);
const GUANGDONG_CITY_SET = new Set(GUANGDONG_CITIES);

const CONTRACT_RECORD_KEYS = [
  "id",
  "companyName",
  "companyType",
  "openDate",
  "deadline",
  "province",
  "city",
  "jobCategories",
  "campusUrl",
  "sourceId",
  "sourceName",
  "sourceType",
  "sourceUpdatedAt",
  "fetchedAt",
  "status",
  "statusUpdatedAt",
  "isDemo",
];

const CITY_PROVINCE_PAIRS = [
  ["北京", "北京", ["北京", "北京市", "beijing"]],
  ["上海", "上海", ["上海", "上海市", "shanghai"]],
  ["天津", "天津", ["天津", "天津市", "tianjin"]],
  ["重庆", "重庆", ["重庆", "重庆市", "chongqing"]],
  ["广东", "广州", ["广州", "广州市", "guangzhou"]],
  ["广东", "深圳", ["深圳", "深圳市", "shenzhen"]],
  ["广东", "珠海", ["珠海", "珠海市", "zhuhai"]],
  ["广东", "汕头", ["汕头", "汕头市", "shantou"]],
  ["广东", "佛山", ["佛山", "佛山市", "foshan"]],
  ["广东", "韶关", ["韶关", "韶关市", "shaoguan"]],
  ["广东", "河源", ["河源", "河源市", "heyuan"]],
  ["广东", "梅州", ["梅州", "梅州市", "meizhou"]],
  ["广东", "惠州", ["惠州", "惠州市", "huizhou"]],
  ["广东", "汕尾", ["汕尾", "汕尾市", "shanwei"]],
  ["广东", "东莞", ["东莞", "东莞市", "dongguan"]],
  ["广东", "中山", ["中山", "中山市", "zhongshan"]],
  ["广东", "江门", ["江门", "江门市", "jiangmen"]],
  ["广东", "阳江", ["阳江", "阳江市", "yangjiang"]],
  ["广东", "湛江", ["湛江", "湛江市", "zhanjiang"]],
  ["广东", "茂名", ["茂名", "茂名市", "maoming"]],
  ["广东", "肇庆", ["肇庆", "肇庆市", "zhaoqing"]],
  ["广东", "清远", ["清远", "清远市", "qingyuan"]],
  ["广东", "潮州", ["潮州", "潮州市", "chaozhou"]],
  ["广东", "揭阳", ["揭阳", "揭阳市", "jieyang"]],
  ["广东", "云浮", ["云浮", "云浮市", "yunfu"]],
  ["浙江", "杭州", ["杭州", "杭州市", "hangzhou"]],
  ["浙江", "宁波", ["宁波", "宁波市", "ningbo"]],
  ["浙江", "温州", ["温州", "温州市", "wenzhou"]],
  ["浙江", "嘉兴", ["嘉兴", "嘉兴市", "jiaxing"]],
  ["浙江", "绍兴", ["绍兴", "绍兴市", "shaoxing"]],
  ["浙江", "金华", ["金华", "金华市", "jinhua"]],
  ["江苏", "南京", ["南京", "南京市", "nanjing"]],
  ["江苏", "苏州", ["苏州", "苏州市", "suzhou"]],
  ["江苏", "无锡", ["无锡", "无锡市", "wuxi"]],
  ["江苏", "常州", ["常州", "常州市", "changzhou"]],
  ["江苏", "南通", ["南通", "南通市", "nantong"]],
  ["江苏", "徐州", ["徐州", "徐州市", "xuzhou"]],
  ["福建", "福州", ["福州", "福州市", "fuzhou"]],
  ["福建", "厦门", ["厦门", "厦门市", "xiamen"]],
  ["福建", "泉州", ["泉州", "泉州市", "quanzhou"]],
  ["福建", "漳州", ["漳州", "漳州市", "zhangzhou"]],
  ["福建", "宁德", ["宁德", "宁德市", "ningde"]],
  ["湖北", "武汉", ["武汉", "武汉市", "wuhan"]],
  ["湖北", "宜昌", ["宜昌", "宜昌市", "yichang"]],
  ["湖北", "襄阳", ["襄阳", "襄阳市", "xiangyang"]],
  ["湖南", "长沙", ["长沙", "长沙市", "changsha"]],
  ["湖南", "株洲", ["株洲", "株洲市", "zhuzhou"]],
  ["湖南", "湘潭", ["湘潭", "湘潭市", "xiangtan"]],
  ["四川", "成都", ["成都", "成都市", "chengdu"]],
  ["四川", "绵阳", ["绵阳", "绵阳市", "mianyang"]],
  ["四川", "德阳", ["德阳", "德阳市", "deyang"]],
  ["陕西", "西安", ["西安", "西安市", "xian"]],
  ["陕西", "咸阳", ["咸阳", "咸阳市", "xianyang"]],
  ["陕西", "宝鸡", ["宝鸡", "宝鸡市", "baoji"]],
  ["山东", "济南", ["济南", "济南市", "jinan"]],
  ["山东", "青岛", ["青岛", "青岛市", "qingdao"]],
  ["山东", "烟台", ["烟台", "烟台市", "yantai"]],
  ["山东", "潍坊", ["潍坊", "潍坊市", "weifang"]],
  ["山东", "威海", ["威海", "威海市", "weihai"]],
  ["河南", "郑州", ["郑州", "郑州市", "zhengzhou"]],
  ["河南", "洛阳", ["洛阳", "洛阳市", "luoyang"]],
  ["河南", "开封", ["开封", "开封市", "kaifeng"]],
  ["河北", "石家庄", ["石家庄", "石家庄市", "shijiazhuang"]],
  ["河北", "保定", ["保定", "保定市", "baoding"]],
  ["河北", "唐山", ["唐山", "唐山市", "tangshan"]],
  ["河北", "廊坊", ["廊坊", "廊坊市", "langfang"]],
  ["辽宁", "沈阳", ["沈阳", "沈阳市", "shenyang"]],
  ["辽宁", "大连", ["大连", "大连市", "dalian"]],
  ["辽宁", "鞍山", ["鞍山", "鞍山市", "anshan"]],
  ["吉林", "长春", ["长春", "长春市", "changchun"]],
  ["吉林", "吉林", ["吉林市", "jilin"]],
  ["黑龙江", "哈尔滨", ["哈尔滨", "哈尔滨市", "harbin"]],
  ["黑龙江", "大庆", ["大庆", "大庆市", "daqing"]],
  ["安徽", "合肥", ["合肥", "合肥市", "hefei"]],
  ["安徽", "芜湖", ["芜湖", "芜湖市", "wuhu"]],
  ["安徽", "蚌埠", ["蚌埠", "蚌埠市", "bengbu"]],
  ["江西", "南昌", ["南昌", "南昌市", "nanchang"]],
  ["江西", "赣州", ["赣州", "赣州市", "ganzhou"]],
  ["江西", "九江", ["九江", "九江市", "jiujiang"]],
  ["广西", "南宁", ["南宁", "南宁市", "nanning"]],
  ["广西", "柳州", ["柳州", "柳州市", "liuzhou"]],
  ["广西", "桂林", ["桂林", "桂林市", "guilin"]],
  ["云南", "昆明", ["昆明", "昆明市", "kunming"]],
  ["云南", "曲靖", ["曲靖", "曲靖市", "qujing"]],
  ["云南", "大理", ["大理", "大理市", "dali"]],
  ["贵州", "贵阳", ["贵阳", "贵阳市", "guiyang"]],
  ["贵州", "遵义", ["遵义", "遵义市", "zunyi"]],
  ["海南", "海口", ["海口", "海口市", "haikou"]],
  ["海南", "三亚", ["三亚", "三亚市", "sanya"]],
  ["山西", "太原", ["太原", "太原市", "taiyuan"]],
  ["山西", "大同", ["大同", "大同市", "datong"]],
  ["内蒙古", "呼和浩特", ["呼和浩特", "呼和浩特市", "hohhot"]],
  ["内蒙古", "包头", ["包头", "包头市", "baotou"]],
  ["内蒙古", "鄂尔多斯", ["鄂尔多斯", "鄂尔多斯市", "ordos"]],
  ["甘肃", "兰州", ["兰州", "兰州市", "lanzhou"]],
  ["甘肃", "嘉峪关", ["嘉峪关", "嘉峪关市", "jiayuguan"]],
  ["新疆", "乌鲁木齐", ["乌鲁木齐", "乌鲁木齐市", "urumqi"]],
  ["新疆", "克拉玛依", ["克拉玛依", "克拉玛依市", "karamay"]],
  ["西藏", "拉萨", ["拉萨", "拉萨市", "lhasa"]],
  ["青海", "西宁", ["西宁", "西宁市", "xining"]],
  ["宁夏", "银川", ["银川", "银川市", "yinchuan"]],
  ["香港", "香港", ["香港", "香港特别行政区", "hong kong", "hongkong"]],
  ["澳门", "澳门", ["澳门", "澳门特别行政区", "macau", "macao"]],
  ["台湾", "台北", ["台北", "台北市", "taipei"]],
  ["台湾", "新北", ["新北", "新北市", "new taipei"]],
  ["台湾", "台中", ["台中", "台中市", "taichung"]],
  ["台湾", "高雄", ["高雄", "高雄市", "kaohsiung"]],
  ["纽约", "纽约", ["new york", "new york city"]],
  ["加利福尼亚", "旧金山", ["旧金山", "san francisco"]],
  ["华盛顿州", "西雅图", ["西雅图", "seattle"]],
  ["安大略", "多伦多", ["多伦多", "toronto"]],
  ["英格兰", "伦敦", ["伦敦", "london"]],
  ["新加坡", "新加坡", ["新加坡", "singapore"]],
  ["东京", "东京", ["东京", "tokyo"]],
];

const CITY_ALIASES = CITY_PROVINCE_PAIRS
  .flatMap(([province, city, aliases]) => aliases.map((alias) => ({
    alias: normalizeLocationToken(alias),
    province,
    city,
  })))
  .sort((left, right) => right.alias.length - left.alias.length);

const PROVINCE_ALIASES = new Map([
  ["北京", "北京"],
  ["北京市", "北京"],
  ["上海", "上海"],
  ["上海市", "上海"],
  ["天津", "天津"],
  ["天津市", "天津"],
  ["重庆", "重庆"],
  ["重庆市", "重庆"],
  ["广东", "广东"],
  ["广东省", "广东"],
  ["广东省内", "广东"],
  ["广东全省", "广东"],
  ["guangdong", "广东"],
  ["浙江", "浙江"],
  ["浙江省", "浙江"],
  ["zhejiang", "浙江"],
  ["江苏", "江苏"],
  ["江苏省", "江苏"],
  ["jiangsu", "江苏"],
  ["福建", "福建"],
  ["福建省", "福建"],
  ["fujian", "福建"],
  ["湖北", "湖北"],
  ["湖北省", "湖北"],
  ["湖南", "湖南"],
  ["湖南省", "湖南"],
  ["四川", "四川"],
  ["四川省", "四川"],
  ["陕西", "陕西"],
  ["陕西省", "陕西"],
  ["山东", "山东"],
  ["山东省", "山东"],
  ["河南", "河南"],
  ["河南省", "河南"],
  ["河北", "河北"],
  ["河北省", "河北"],
  ["辽宁", "辽宁"],
  ["辽宁省", "辽宁"],
  ["吉林", "吉林"],
  ["吉林省", "吉林"],
  ["黑龙江", "黑龙江"],
  ["黑龙江省", "黑龙江"],
  ["安徽", "安徽"],
  ["安徽省", "安徽"],
  ["江西", "江西"],
  ["江西省", "江西"],
  ["广西", "广西"],
  ["广西壮族自治区", "广西"],
  ["云南", "云南"],
  ["云南省", "云南"],
  ["贵州", "贵州"],
  ["贵州省", "贵州"],
  ["海南", "海南"],
  ["海南省", "海南"],
  ["山西", "山西"],
  ["山西省", "山西"],
  ["内蒙古", "内蒙古"],
  ["内蒙古自治区", "内蒙古"],
  ["甘肃", "甘肃"],
  ["甘肃省", "甘肃"],
  ["新疆", "新疆"],
  ["新疆维吾尔自治区", "新疆"],
  ["西藏", "西藏"],
  ["西藏自治区", "西藏"],
  ["青海", "青海"],
  ["青海省", "青海"],
  ["宁夏", "宁夏"],
  ["宁夏回族自治区", "宁夏"],
  ["香港", "香港"],
  ["澳门", "澳门"],
  ["台湾", "台湾"],
]);

function normalizeLocationToken(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[\s\u00a0，,、|/\\;；:：()（）[\]{}<>《》·•-]+/g, "")
    .trim();
}

function text(value) {
  if (value === null || value === undefined) return "";
  return String(value).replace(/[\u0000-\u001f\u007f]/g, " ").trim();
}

function decodeHtmlEntities(value) {
  return text(value).replace(/&amp;/gi, "&");
}

function cleanList(values) {
  const result = [];
  const seen = new Set();
  for (const value of values.flat(Infinity)) {
    const cleaned = text(value);
    if (!cleaned || seen.has(cleaned)) continue;
    seen.add(cleaned);
    result.push(cleaned);
  }
  return result.sort((left, right) => left.localeCompare(right, "zh-Hans-CN"));
}

function firstValue(...values) {
  return values.find((value) => value !== null && value !== undefined && text(value) !== "");
}

function normalizeType(value) {
  return text(value).toLocaleLowerCase();
}

function normalizeIdPart(value) {
  const result = text(value)
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
  return result || "source";
}

export function isHttpsUrl(value) {
  if (typeof value !== "string" || !value.trim()) return false;
  if (/[\u0000-\u001f\u007f]/.test(value)) return false;
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:"
      && Boolean(url.hostname)
      && !url.username
      && !url.password;
  } catch {
    return false;
  }
}

function safeUrl(value) {
  const decoded = decodeHtmlEntities(value);
  if (!isHttpsUrl(decoded)) return "";
  return new URL(decoded.trim()).toString();
}

export function normalizeTimestamp(value, fallback = "") {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? fallback : value.toISOString();
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? fallback : date.toISOString();
  }
  const raw = text(value);
  if (!raw) return fallback;
  if (/^\d{10,13}$/.test(raw)) {
    const numeric = Number(raw);
    const millis = raw.length === 10 ? numeric * 1000 : numeric;
    const numericDate = new Date(millis);
    if (!Number.isNaN(numericDate.getTime())) return numericDate.toISOString();
  }
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? fallback : date.toISOString();
}

function requireTimestamp(value) {
  const timestamp = normalizeTimestamp(value);
  if (!timestamp) throw new TypeError(`无效的时间：${value}`);
  return timestamp;
}

function isDateOnly(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const year = Number(value.slice(0, 4));
  if (year < 1900 || year > 9999) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function normalizeDateOnly(value) {
  if (value instanceof Date || typeof value === "number") {
    const timestamp = normalizeTimestamp(value);
    const date = timestamp ? timestamp.slice(0, 10) : "";
    return isDateOnly(date) ? date : "";
  }

  const raw = text(value);
  if (!raw) return "";
  const datePrefix = raw.match(/^\d{4}-\d{2}-\d{2}/)?.[0];
  if (datePrefix) return isDateOnly(datePrefix) ? datePrefix : "";
  const timestamp = normalizeTimestamp(raw);
  const date = timestamp ? timestamp.slice(0, 10) : "";
  return isDateOnly(date) ? date : "";
}

export function normalizeSource(source, index = 0) {
  const raw = source && typeof source === "object" ? source : {};
  const id = text(raw.id) || `source-${index + 1}`;
  const type = normalizeType(raw.type);
  const name = text(raw.name) || text(raw.companyName) || id;
  const companyName = text(raw.companyName) || name;
  const companyType = VALID_COMPANY_TYPES.has(text(raw.companyType)) ? text(raw.companyType) : "其他";
  const endpoint = text(firstValue(raw.endpoint, raw.apiUrl, raw.url));
  const boardToken = text(firstValue(raw.boardToken, raw.token, raw.board));
  const site = text(firstValue(raw.site, raw.company, raw.slug, raw.account));
  const timeoutCandidate = Number(raw.timeoutMs ?? raw.requestTimeoutMs);

  return {
    id,
    name,
    type,
    companyName,
    companyType,
    campusUrl: safeUrl(firstValue(raw.campusUrl, raw.careersUrl, raw.sourceUrl)),
    defaultProvince: text(firstValue(raw.defaultProvince, raw.province)),
    defaultCity: text(firstValue(raw.defaultCity, raw.city)),
    categoryDefaults: cleanList([raw.categoryDefaults ?? raw.categories ?? []]),
    endpoint,
    boardToken,
    site,
    enabled: raw.enabled !== false && raw.active !== false,
    allowEmpty: raw.allowEmpty === true,
    timeoutMs: Number.isFinite(timeoutCandidate) && timeoutCandidate > 0
      ? Math.floor(timeoutCandidate)
      : DEFAULT_TIMEOUT_MS,
    raw,
  };
}

export function normalizeSources(sources) {
  const input = Array.isArray(sources)
    ? sources
    : (sources && Array.isArray(sources.sources) ? sources.sources : []);
  const counts = new Map();
  return input
    .map((source, index) => normalizeSource(source, index))
    .map((source) => {
      const count = (counts.get(source.id) ?? 0) + 1;
      counts.set(source.id, count);
      return count === 1 ? source : { ...source, id: `${source.id}-${count}` };
    })
    .sort((left, right) => left.id.localeCompare(right.id));
}

function sourceEndpoint(source) {
  if (source.endpoint) {
    if (!isHttpsUrl(source.endpoint)) throw new Error("来源 API URL 必须使用 HTTPS");
    return new URL(source.endpoint).toString();
  }

  if (source.type === "greenhouse") {
    if (!source.boardToken) throw new Error("Greenhouse 来源缺少 boardToken");
    return `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(source.boardToken)}/jobs?content=true`;
  }

  if (source.type === "lever") {
    if (!source.site) throw new Error("Lever 来源缺少 site");
    return `https://api.lever.co/v0/postings/${encodeURIComponent(source.site)}?mode=json`;
  }

  if (source.type === "community-json") {
    throw new Error("社区聚合来源缺少 endpoint");
  }

  throw new Error(`不支持的来源类型：${source.type || "空"}`);
}

export function stableRecordId(sourceId, upstreamId, fallback = "") {
  const sourcePart = normalizeIdPart(sourceId);
  const rawKey = text(firstValue(upstreamId, fallback)) || "job";
  const label = normalizeIdPart(rawKey).slice(0, 80) || "job";
  const digest = createHash("sha256")
    .update(`${text(sourceId)}\u0000${rawKey}`, "utf8")
    .digest("hex")
    .slice(0, 12);
  return `sync-${sourcePart}-${label}-${digest}`;
}

function metadataEntries(job) {
  const entries = [];
  for (const fieldName of ["metadata", "custom_fields", "customFields", "fields"]) {
    const value = job?.[fieldName];
    if (Array.isArray(value)) {
      for (const entry of value) {
        if (entry && typeof entry === "object") {
          const label = firstValue(entry.name, entry.key, entry.label, entry.title);
          const entryValue = firstValue(entry.value, entry.text, entry.displayValue);
          if (label !== undefined) entries.push([text(label), entryValue]);
        }
      }
    } else if (value && typeof value === "object") {
      for (const [key, entryValue] of Object.entries(value)) entries.push([key, entryValue]);
    }
  }
  return entries;
}

const OPEN_DATE_KEYS = [
  "openDate",
  "open_date",
  "openingDate",
  "opening_date",
  "startDate",
  "start_date",
  "postedDate",
  "posted_date",
  "datePosted",
];

const DEADLINE_KEYS = [
  "deadline",
  "deadlineDate",
  "deadline_date",
  "closeDate",
  "close_date",
  "closingDate",
  "closing_date",
  "endDate",
  "end_date",
  "applicationDeadline",
  "application_deadline",
];

function explicitDate(job, keys, labels) {
  for (const key of keys) {
    if (job && Object.prototype.hasOwnProperty.call(job, key)) {
      const value = normalizeDateOnly(job[key]);
      if (value) return value;
    }
  }

  const labelSet = new Set(labels.map(normalizeLocationToken));
  for (const [label, value] of metadataEntries(job)) {
    if (!labelSet.has(normalizeLocationToken(label))) continue;
    const date = normalizeDateOnly(value);
    if (date) return date;
  }
  return "";
}

function sourceUpdatedAt(job) {
  for (const key of ["updated_at", "updatedAt", "last_updated_at", "lastUpdatedAt", "modified_at", "modifiedAt", "_feedUpdatedAt"]) {
    if (job && Object.prototype.hasOwnProperty.call(job, key)) {
      const timestamp = normalizeTimestamp(job[key]);
      if (timestamp) return timestamp;
    }
  }
  return "";
}

function greenhouseLocation(job) {
  const values = [
    job?.location?.name,
    job?.location?.city,
    job?.location,
    ...(Array.isArray(job?.offices) ? job.offices.flatMap((office) => [office?.location?.name, office?.location, office?.name]) : []),
  ].filter((value) => value !== null && value !== undefined && text(value));
  return values.length > 0 ? values : undefined;
}

function leverLocation(job) {
  const values = [
    job?.categories?.location,
    job?.location?.name,
    job?.location,
    ...(Array.isArray(job?.locations) ? job.locations.map((location) => location?.name ?? location) : []),
  ].filter((value) => value !== null && value !== undefined && text(value));
  return values.length > 0 ? values : undefined;
}

function communityLocation(job) {
  return firstValue(job?.l, job?.location, job?.city, job?.workLocation, job?.work_location);
}

function rawJobCategories(job, source) {
  if (source.type === "greenhouse") {
    return [
      ...(Array.isArray(job?.departments) ? job.departments.map((department) => department?.name ?? department) : []),
      ...(Array.isArray(job?.teams) ? job.teams.map((team) => team?.name ?? team) : []),
      ...metadataEntries(job)
        .filter(([label]) => /category|department|team|岗位|职能/i.test(label))
        .map(([, value]) => value),
      ...source.categoryDefaults,
    ];
  }

  if (source.type === "lever") {
    return [
      job?.categories?.team,
      job?.categories?.department,
      ...(Array.isArray(job?.categories) ? job.categories : []),
      ...(Array.isArray(job?.teams) ? job.teams.map((team) => team?.name ?? team) : []),
      ...source.categoryDefaults,
    ];
  }

  if (source.type === "community-json") {
    return [job?.p, job?.ind, job?.w, ...source.categoryDefaults];
  }

  return source.categoryDefaults;
}

function rawJobUrl(job, source) {
  if (source.type === "greenhouse") {
    return firstValue(job?.absolute_url, job?.absoluteUrl, job?.jobUrl, job?.job_url, job?.url);
  }
  if (source.type === "lever") {
    return firstValue(job?.hostedUrl, job?.hosted_url, job?.applyUrl, job?.apply_url, job?.url);
  }
  if (source.type === "community-json") {
    return firstValue(job?.u, job?.url, job?.jobUrl, job?.job_url);
  }
  return firstValue(job?.url, job?.jobUrl, job?.job_url);
}

function rawJobId(job) {
  return firstValue(
    job?.id,
    job?.job_id,
    job?.jobId,
    job?.requisition_id,
    job?.requisitionId,
  );
}

function rawLocationText(value) {
  if (Array.isArray(value)) return value.map(rawLocationText).filter(Boolean).join(" / ");
  if (value && typeof value === "object") {
    return text(firstValue(
      value.name,
      value.city,
      value.location,
      value.address,
      value.displayName,
      value.province,
      value.state,
      value.region,
    ));
  }
  return text(value);
}

function canonicalLocationParts(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const explicitCity = text(firstValue(value.city, value.cityName));
    const explicitProvince = text(firstValue(value.province, value.state, value.region));
    if (explicitCity || explicitProvince) return { city: explicitCity, province: explicitProvince };
  }
  const raw = rawLocationText(value);
  return { city: raw, province: "" };
}

const REMOTE_LOCATION_PATTERN = /^(remote|remoteonly|hybrid|multiplelocations|variouslocations|worldwide|全球|不限|远程|远程办公|全国|全省)$/i;
const NATIONAL_SCOPE_PATTERN = /^(nationwide|worldwide|global|全球|不限|全国|全省)$/i;
const NATIONAL_SCOPE_WITH_GUANGDONG_PATTERN = /(?:nationwide|worldwide|global|全国|全球|不限).*guangdong|guangdong.*(?:nationwide|worldwide|global|全国|全球|不限)|(?:全国|全球|不限).*广东|广东.*(?:全国|全球|不限)/i;
const GUANGDONG_SCOPE_LOCATION_SET = new Set([
  "广东全省招聘",
  "广东省内多个城市",
  "粤港澳大湾区",
].map(normalizeLocationToken));

export function normalizeLocation(value, fallbackProvince = "", fallbackCity = "") {
  const parts = canonicalLocationParts(value);
  const raw = text(parts.city || value);
  const fallbackRaw = text(fallbackCity);
  const searchText = raw || fallbackRaw;
  const normalizedSearch = normalizeLocationToken(searchText);

  if (GUANGDONG_SCOPE_LOCATION_SET.has(normalizedSearch)) {
    return { province: GUANGDONG_PROVINCE, city: "" };
  }

  if (normalizedSearch && !REMOTE_LOCATION_PATTERN.test(normalizedSearch)) {
    const known = CITY_ALIASES.find(({ alias }) => normalizedSearch.includes(alias));
    if (known) return { province: known.province, city: known.city };
  }

  if (NATIONAL_SCOPE_WITH_GUANGDONG_PATTERN.test(normalizedSearch)) {
    return { province: GUANGDONG_PROVINCE, city: "" };
  }

  if (NATIONAL_SCOPE_PATTERN.test(normalizedSearch)) {
    return { province: "", city: "" };
  }

  const provinceCandidates = [parts.province, raw, fallbackProvince].map(text).filter(Boolean);
  for (const candidate of provinceCandidates) {
    const normalizedCandidate = normalizeLocationToken(candidate);
    const province = PROVINCE_ALIASES.get(normalizedCandidate);
    if (province) return { province, city: "" };
  }

  if (!normalizedSearch || REMOTE_LOCATION_PATTERN.test(normalizedSearch)) {
    const fallbackNormalized = normalizeLocationToken(fallbackRaw);
    const knownFallback = CITY_ALIASES.find(({ alias }) => fallbackNormalized.includes(alias));
    if (knownFallback) return { province: knownFallback.province, city: knownFallback.city };
    return { province: text(fallbackProvince), city: "" };
  }

  const tokens = searchText
    .normalize("NFKC")
    .replace(/[，,、|/\\;；]+/g, "|")
    .split("|")
    .map((item) => item.replace(/^中国|China$/gi, "").trim())
    .filter(Boolean);
  const city = text(tokens[0] || searchText)
    .replace(/(特别行政区|自治区|省|市)$/u, "")
    .trim();
  const province = text(parts.province || tokens[1] || fallbackProvince)
    .replace(/(特别行政区|自治区|省|市)$/u, "")
    .trim();
  return { province, city };
}

export function normalizeCity(value, fallbackProvince = "", fallbackCity = "") {
  return normalizeLocation(value, fallbackProvince, fallbackCity);
}

export function isGuangdongLocation(location) {
  if (!location || typeof location !== "object") return false;
  if (text(location.province) !== GUANGDONG_PROVINCE) return false;
  const city = text(location.city);
  return city === "" || GUANGDONG_CITY_SET.has(city);
}

export function isGuangdongRecord(record) {
  return isGuangdongLocation(record);
}

function hasConflictingLocations(locations) {
  const hasGuangdong = locations.some(isGuangdongLocation);
  const hasExplicitOutsideProvince = locations.some((location) => {
    const province = text(location?.province);
    return province && province !== GUANGDONG_PROVINCE;
  });
  return hasGuangdong && hasExplicitOutsideProvince;
}

export function filterGuangdongRecords(records) {
  return (Array.isArray(records) ? records : []).filter(isGuangdongRecord);
}

export function normalizeLocations(value, fallbackProvince = "", fallbackCity = "") {
  const raw = rawLocationText(value);
  const tokens = raw
    .normalize("NFKC")
    .replace(/[，,、|/\\;；]+/g, "|")
    .split("|")
    .map((item) => item.trim())
    .filter(Boolean);
  const candidates = tokens.length > 0 ? tokens : [raw];
  const locations = [];
  const provinceOnlyLocations = [];
  const seen = new Set();

  for (const candidate of candidates) {
    const location = normalizeLocation(candidate, fallbackProvince, fallbackCity);
    if (!location.city) {
      if (location.province) {
        const key = `${location.province}\u0000`;
        if (!seen.has(key)) {
          seen.add(key);
          provinceOnlyLocations.push(location);
        }
      }
      continue;
    }
    const key = `${location.province}\u0000${location.city}`;
    if (seen.has(key)) continue;
    seen.add(key);
    locations.push(location);
  }

  if (locations.length > 0) {
    const coveredProvinces = new Set(locations.map((location) => location.province));
    return [
      ...locations,
      ...provinceOnlyLocations.filter((location) => !coveredProvinces.has(location.province)),
    ];
  }
  if (provinceOnlyLocations.length > 0) return provinceOnlyLocations;
  const fallback = normalizeLocation(value, fallbackProvince, fallbackCity);
  return fallback.province || fallback.city ? [fallback] : [{ province: "", city: "" }];
}

function normalizeRecordState(previousRecord, now) {
  const previousStatus = text(previousRecord?.status);
  const status = VALID_STATUSES.has(previousStatus) ? previousStatus : DEFAULT_STATUS;
  if (status === DEFAULT_STATUS) {
    return { status, statusUpdatedAt: DEFAULT_STATUS_UPDATED_AT };
  }
  const previousUpdatedAt = text(previousRecord?.statusUpdatedAt);
  const statusUpdatedAt = previousUpdatedAt && !Number.isNaN(Date.parse(previousUpdatedAt))
    ? previousUpdatedAt
    : now;
  return { status, statusUpdatedAt };
}

function buildRecord({
  id,
  companyName,
  companyType,
  openDate,
  deadline,
  province,
  city,
  jobCategories,
  campusUrl,
  sourceId,
  sourceName,
  sourceType,
  sourceUpdatedAt: updatedAt,
  fetchedAt,
  status,
  statusUpdatedAt,
  isDemo,
}) {
  return {
    id: text(id),
    companyName: text(companyName),
    companyType: VALID_COMPANY_TYPES.has(companyType) ? companyType : "其他",
    openDate: normalizeDateOnly(openDate),
    deadline: normalizeDateOnly(deadline),
    province: text(province),
    city: text(city),
    jobCategories: cleanList([jobCategories ?? []]),
    campusUrl: safeUrl(campusUrl),
    sourceId: text(sourceId),
    sourceName: text(sourceName),
    sourceType: normalizeType(sourceType),
    sourceUpdatedAt: normalizeTimestamp(updatedAt),
    fetchedAt: normalizeTimestamp(fetchedAt),
    status: VALID_STATUSES.has(status) ? status : DEFAULT_STATUS,
    statusUpdatedAt: normalizeTimestamp(statusUpdatedAt),
    isDemo: isDemo === true,
  };
}

function setDedupeUrl(record, value) {
  Object.defineProperty(record, "__dedupeUrl", {
    value: text(value),
    enumerable: false,
    configurable: true,
  });
  return record;
}

function setStateKey(record, value) {
  Object.defineProperty(record, "__stateKey", {
    value: text(value),
    enumerable: false,
    configurable: true,
  });
  return record;
}

function communityStateKey(source, record, candidateUrl) {
  const url = canonicalUrl(candidateUrl);
  const sourceUrl = canonicalUrl(source.campusUrl);
  if (source.type === "community-json" && url && url !== sourceUrl) {
    return [
      "community-url",
      source.id,
      record.companyName,
      record.province,
      record.city,
      url,
    ].join("\u0000");
  }
  return `record-id:${source.id}\u0000${record.id}`;
}

function communityCompanyType(job, fallback) {
  const marker = text(firstValue(job?.companyType, job?.ownership, job?.t));
  if (/央企|国企|国有企业/.test(marker)) return "央国企";
  if (/外企|外资/.test(marker)) return "外企";
  if (/事业单位|高校|研究所/.test(marker)) return "事业单位";
  if (/私企|民企|民营/.test(marker)) return "私企";
  return fallback;
}

function normalizeJobAtLocation(job, source, now, location) {
  const raw = job && typeof job === "object" ? job : {};
  const candidateUrl = rawJobUrl(raw, source);
  const title = firstValue(raw.title, raw.text, raw.name, raw.p);
  const rawCompanyName = firstValue(raw.c, raw.companyName, raw.company);
  if (source.type === "community-json" && (!text(rawCompanyName) || !text(title))) return null;
  const companyName = source.type === "community-json"
    ? text(firstValue(rawCompanyName, source.companyName))
    : source.companyName;
  const companyType = source.type === "community-json"
    ? communityCompanyType(raw, source.companyType)
    : source.companyType;
  const meaningfulJob = rawJobId(raw) !== undefined || text(candidateUrl) || text(title)
    || (source.type !== "community-json" && companyName);
  if (!meaningfulJob) return null;
  const campusUrl = candidateUrl === undefined || candidateUrl === null || text(candidateUrl) === ""
    ? source.campusUrl
    : safeUrl(candidateUrl);
  if (!campusUrl || !companyName) return null;

  const fallbackKey = [
    companyName,
    text(title),
    campusUrl,
    location.province,
    location.city,
    cleanList([rawJobCategories(raw, source)]).join("|"),
  ].join("|");
  const upstreamId = rawJobId(raw);
  const idKey = upstreamId !== undefined
    ? `${text(upstreamId)}|${location.province}|${location.city}`
    : upstreamId;
  const id = stableRecordId(source.id, idKey, fallbackKey);
  const state = normalizeRecordState(null, now);
  const deadline = source.type === "community-json"
    ? normalizeDateOnly(firstValue(raw.d, raw.deadline, raw.closeDate))
    : explicitDate(raw, DEADLINE_KEYS, ["deadline", "close date", "closing date", "end date", "application deadline", "截止日期"]);

  const record = buildRecord({
    id,
    companyName,
    companyType,
    openDate: explicitDate(raw, OPEN_DATE_KEYS, ["open date", "opening date", "start date", "posted date", "date posted", "开放日期", "开始日期"]),
    deadline,
    province: location.province,
    city: location.city,
    jobCategories: rawJobCategories(raw, source),
    campusUrl,
    sourceId: source.id,
    sourceName: source.name,
    sourceType: source.type,
    sourceUpdatedAt: sourceUpdatedAt(raw),
    fetchedAt: now,
    status: state.status,
    statusUpdatedAt: state.statusUpdatedAt,
    isDemo: false,
  });
  setStateKey(record, communityStateKey(source, record, candidateUrl));
  return setDedupeUrl(record, source.type === "community-json" ? "" : (candidateUrl ? campusUrl : ""));
}

export function normalizeJobs(job, sourceInput, nowInput) {
  const source = sourceInput?.raw ? sourceInput : normalizeSource(sourceInput);
  const now = requireTimestamp(nowInput ?? new Date());
  const raw = job && typeof job === "object" ? job : {};
  const locationValue = source.type === "greenhouse"
    ? greenhouseLocation(raw)
    : (source.type === "lever" ? leverLocation(raw) : communityLocation(raw));
  const locations = normalizeLocations(locationValue, source.defaultProvince, source.defaultCity);
  if (hasConflictingLocations(locations)) return [];
  return locations
    .filter(isGuangdongLocation)
    .map((location) => normalizeJobAtLocation(raw, source, now, location))
    .filter(Boolean);
}

export function normalizeJob(job, sourceInput, nowInput) {
  return normalizeJobs(job, sourceInput, nowInput)[0] ?? null;
}

function normalizeResponseError(error) {
  const message = error instanceof Error ? error.message : text(error);
  return (message || "未知错误").replace(/[\r\n]+/g, " ").slice(0, 300);
}

export async function fetchJson(url, {
  fetchImpl = globalThis.fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  if (!isHttpsUrl(url)) throw new Error("请求 URL 必须使用 HTTPS");
  if (typeof fetchImpl !== "function") throw new Error("当前 Node 环境没有可用的 fetch");

  const safeTimeout = Number.isFinite(Number(timeoutMs)) && Number(timeoutMs) > 0
    ? Math.floor(Number(timeoutMs))
    : DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  let timeoutTimer;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutTimer = setTimeout(() => {
      controller.abort();
      reject(new Error(`请求超时（${safeTimeout}ms）`));
    }, safeTimeout);
  });

  try {
    const operation = Promise.resolve()
      .then(() => fetchImpl(url, {
        method: "GET",
        headers: {
          accept: "application/json",
          "user-agent": "autumn-recruitment-tracker-sync/1",
        },
        redirect: "error",
        signal: controller.signal,
      }))
      .then(async (response) => {
        if (!response || response.ok === false) {
          const status = response?.status ? `HTTP ${response.status}` : "HTTP 请求失败";
          throw new Error(status);
        }
        if (typeof response.json !== "function") throw new Error("响应不是 JSON 接口");
        return response.json();
      });
    return await Promise.race([
      operation,
      timeoutPromise,
    ]);
  } catch (error) {
    if (error?.name === "AbortError") throw new Error(`请求超时（${safeTimeout}ms）`);
    throw error;
  } finally {
    clearTimeout(timeoutTimer);
  }
}

export async function fetchGreenhouseJobs(sourceInput, options = {}) {
  const source = sourceInput?.raw ? sourceInput : normalizeSource(sourceInput);
  const data = await fetchJson(sourceEndpoint(source), {
    ...options,
    timeoutMs: options.timeoutMs ?? source.timeoutMs,
  });
  if (!data || !Array.isArray(data.jobs)) throw new Error("Greenhouse 响应缺少 jobs 数组");
  return data.jobs;
}

export async function fetchLeverJobs(sourceInput, options = {}) {
  const source = sourceInput?.raw ? sourceInput : normalizeSource(sourceInput);
  const data = await fetchJson(sourceEndpoint(source), {
    ...options,
    timeoutMs: options.timeoutMs ?? source.timeoutMs,
  });
  const jobs = Array.isArray(data) ? data : data?.postings;
  if (!Array.isArray(jobs)) throw new Error("Lever 响应不是岗位数组");
  return jobs;
}

export async function fetchCommunityJobs(sourceInput, options = {}) {
  const source = sourceInput?.raw ? sourceInput : normalizeSource(sourceInput);
  const data = await fetchJson(sourceEndpoint(source), {
    ...options,
    timeoutMs: options.timeoutMs ?? source.timeoutMs,
  });
  if (!data || !Array.isArray(data.jobs)) throw new Error("社区聚合响应缺少 jobs 数组");
  const feedUpdatedAt = normalizeTimestamp(data.updated);
  return data.jobs.map((job) => ({
    ...(job && typeof job === "object" ? job : {}),
    _feedUpdatedAt: feedUpdatedAt,
  }));
}

export async function fetchSourceJobs(sourceInput, options = {}) {
  const source = sourceInput?.raw ? sourceInput : normalizeSource(sourceInput);
  if (source.type === "greenhouse") return fetchGreenhouseJobs(source, options);
  if (source.type === "lever") return fetchLeverJobs(source, options);
  if (source.type === "community-json") return fetchCommunityJobs(source, options);
  throw new Error(`不支持的来源类型：${source.type || "空"}`);
}

function canonicalUrl(url) {
  if (!isHttpsUrl(url)) return "";
  const parsed = new URL(url);
  parsed.hash = "";
  for (const key of [...parsed.searchParams.keys()]) {
    if (/^(utm_|gh_src$|source$)/i.test(key)) parsed.searchParams.delete(key);
  }
  return parsed.toString().replace(/\/$/, "");
}

function recordCanonicalJson(record) {
  return JSON.stringify(Object.fromEntries(CONTRACT_RECORD_KEYS.map((key) => [key, record?.[key]])));
}

function recordCandidateKeys(record) {
  const keys = [];
  if (text(record?.id)) keys.push(`id:${text(record.id)}`);
  const dedupeUrl = Object.prototype.hasOwnProperty.call(record ?? {}, "__dedupeUrl")
    ? record.__dedupeUrl
    : record?.campusUrl;
  const url = canonicalUrl(dedupeUrl);
  if (url) {
    keys.push(`url:${text(record?.province)}\u0000${text(record?.city)}\u0000${url}`);
  }
  return keys;
}

function recordStateKeys(record) {
  const keys = recordCandidateKeys(record);
  if (text(record?.__stateKey)) keys.push(`state:${text(record.__stateKey)}`);
  return keys;
}

function carryPreviousState(record, previousRecords, now) {
  const currentKeys = new Set(recordStateKeys(record));
  const previous = previousRecords.find((candidate) => {
    return recordStateKeys(candidate).some((key) => currentKeys.has(key));
  });
  if (!previous) return record;
  const state = normalizeRecordState(previous, now);
  record.status = state.status;
  record.statusUpdatedAt = state.statusUpdatedAt;
  return record;
}

function compareCandidates(left, right) {
  if ((left.priority ?? 0) !== (right.priority ?? 0)) return (right.priority ?? 0) - (left.priority ?? 0);
  const leftUpdated = normalizeTimestamp(left.record?.sourceUpdatedAt);
  const rightUpdated = normalizeTimestamp(right.record?.sourceUpdatedAt);
  if (leftUpdated !== rightUpdated) return rightUpdated.localeCompare(leftUpdated);
  const leftId = text(left.record?.id);
  const rightId = text(right.record?.id);
  if (leftId !== rightId) return leftId.localeCompare(rightId);
  return recordCanonicalJson(left.record).localeCompare(recordCanonicalJson(right.record));
}

function deduplicateCandidates(candidates) {
  const parent = candidates.map((_, index) => index);
  const find = (index) => {
    let root = index;
    while (parent[root] !== root) root = parent[root];
    while (parent[index] !== index) {
      const next = parent[index];
      parent[index] = root;
      index = next;
    }
    return root;
  };
  const union = (left, right) => {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot !== rightRoot) parent[rightRoot] = leftRoot;
  };
  const keyOwners = new Map();

  candidates.forEach((candidate, index) => {
    for (const key of recordCandidateKeys(candidate.record)) {
      if (keyOwners.has(key)) union(index, keyOwners.get(key));
      else keyOwners.set(key, index);
    }
  });

  const groups = new Map();
  candidates.forEach((candidate, index) => {
    const root = find(index);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(candidate);
  });

  return [...groups.values()]
    .map((group) => group.sort(compareCandidates)[0].record)
    .sort((left, right) => {
      const idOrder = text(left.id).localeCompare(text(right.id));
      return idOrder || recordCanonicalJson(left).localeCompare(recordCanonicalJson(right));
    });
}

export function deduplicateRecords(records) {
  const candidates = (Array.isArray(records) ? records : [])
    .filter((record) => record && typeof record === "object")
    .map((record) => ({ record, priority: 0 }));
  return deduplicateCandidates(candidates);
}

function previousRecordForSource(record, source, now) {
  if (!record || typeof record !== "object" || !isHttpsUrl(record.campusUrl)) return null;
  const state = normalizeRecordState(record, now);
  const sourceId = text(record.sourceId) || source.id;
  if (sourceId !== source.id) return null;
  const retained = buildRecord({
    id: text(record.id) || stableRecordId(source.id, undefined, `${record.companyName}|${record.campusUrl}`),
    companyName: text(record.companyName) || source.companyName,
    companyType: text(record.companyType) || source.companyType,
    openDate: record.openDate,
    deadline: record.deadline,
    province: record.province,
    city: record.city,
    jobCategories: Array.isArray(record.jobCategories) ? record.jobCategories : record.categories,
    campusUrl: record.campusUrl,
    sourceId: source.id,
    sourceName: text(record.sourceName) || source.name,
    sourceType: text(record.sourceType) || source.type,
    sourceUpdatedAt: record.sourceUpdatedAt,
    fetchedAt: record.fetchedAt || now,
    status: state.status,
    statusUpdatedAt: state.statusUpdatedAt,
    isDemo: record.isDemo === true,
  });
  if (typeof record.campusUrl === "string" && isHttpsUrl(record.campusUrl)) retained.campusUrl = safeUrl(record.campusUrl);
  for (const key of ["sourceUpdatedAt", "fetchedAt", "statusUpdatedAt"]) {
    if (typeof record[key] === "string" && !Number.isNaN(Date.parse(record[key]))) retained[key] = record[key];
  }
  if (Array.isArray(record.jobCategories)) retained.jobCategories = [...record.jobCategories];
  const fallbackIsSourceUrl = canonicalUrl(record.campusUrl) === canonicalUrl(source.campusUrl);
  setStateKey(retained, communityStateKey(source, retained, fallbackIsSourceUrl ? "" : record.campusUrl));
  return setDedupeUrl(retained, source.type === "community-json" || fallbackIsSourceUrl ? "" : record.campusUrl);
}

function previousRecordsBySource(previousPayload, source, now) {
  const records = Array.isArray(previousPayload?.records) ? previousPayload.records : [];
  return records
    .map((record) => previousRecordForSource(record, source, now))
    .filter(Boolean)
    .filter(isGuangdongRecord);
}

function previousSourceById(previousPayload, sourceId) {
  if (!Array.isArray(previousPayload?.sources)) return null;
  return previousPayload.sources.find((source) => text(source?.id) === sourceId) ?? null;
}

function sourceIsStale(status, lastCheckedAt, sourceUpdatedAt) {
  if (status !== "ok") return true;
  if (!sourceUpdatedAt) return false;
  const checkedAt = Date.parse(lastCheckedAt);
  const updatedAt = Date.parse(sourceUpdatedAt);
  if (Number.isNaN(checkedAt) || Number.isNaN(updatedAt)) return false;
  return checkedAt - updatedAt > SOURCE_STALE_AFTER_DAYS * 86_400_000;
}

function sourceOutput(source, status, lastCheckedAt, recordCount, error, sourceUpdatedAt = "", stale = false) {
  const result = {
    id: source.id,
    name: source.name,
    type: source.type,
    status,
    lastCheckedAt: text(lastCheckedAt),
    recordCount: Number.isInteger(recordCount) && recordCount >= 0 ? recordCount : 0,
  };
  const normalizedSourceUpdatedAt = normalizeTimestamp(sourceUpdatedAt);
  if (normalizedSourceUpdatedAt) result.sourceUpdatedAt = normalizedSourceUpdatedAt;
  if (stale || sourceIsStale(status, lastCheckedAt, normalizedSourceUpdatedAt)) result.stale = true;
  if (error) result.error = normalizeResponseError(error);
  return result;
}

export async function syncJobs(optionsOrSources = {}, maybeOptions = {}) {
  const options = Array.isArray(optionsOrSources)
    ? { ...maybeOptions, sources: optionsOrSources }
    : (optionsOrSources && typeof optionsOrSources === "object" ? optionsOrSources : {});
  const now = requireTimestamp(options.now ?? options.generatedAt ?? new Date());
  const sources = normalizeSources(options.sources ?? []);
  const previousCandidate = options.previousPayload ?? options.previousSnapshot ?? options.previous;
  const previousPayload = previousCandidate && typeof previousCandidate === "object"
    ? previousCandidate
    : null;
  const fetchImpl = options.fetchImpl ?? options.fetch ?? globalThis.fetch;
  const defaultTimeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const candidates = [];
  const sourceStates = [];

  for (const source of sources) {
    const previousRecords = previousRecordsBySource(previousPayload, source, now);
    const previousSource = previousSourceById(previousPayload, source.id);

    if (!source.enabled) {
      for (const record of previousRecords) candidates.push({ record, priority: 1 });
      sourceStates.push({
        source,
        status: "disabled",
        lastCheckedAt: previousSource?.lastCheckedAt || "",
      });
      continue;
    }

    try {
      const jobs = await fetchSourceJobs(source, {
        fetchImpl,
        timeoutMs: options.timeoutMs ?? source.timeoutMs ?? defaultTimeoutMs,
      });
      if (jobs.length === 0 && !source.allowEmpty) {
        throw new Error("来源返回空岗位列表");
      }
      const latestSourceUpdatedAt = jobs
        .map((job) => sourceUpdatedAt(job))
        .filter(Boolean)
        .sort()
        .at(-1) || "";
      for (const job of jobs) {
        for (const record of normalizeJobs(job, source, now)) {
          candidates.push({ record: carryPreviousState(record, previousRecords, now), priority: 2 });
        }
      }
      sourceStates.push({ source, status: "ok", lastCheckedAt: now, sourceUpdatedAt: latestSourceUpdatedAt });
    } catch (error) {
      for (const record of previousRecords) candidates.push({ record, priority: 1 });
      sourceStates.push({ source, status: "error", lastCheckedAt: now, error: normalizeResponseError(error) });
    }
  }

  const records = filterGuangdongRecords(deduplicateCandidates(candidates));
  const sourcesOutput = sourceStates.map(({ source, status, lastCheckedAt, error, sourceUpdatedAt }) => sourceOutput(
    source,
    status,
    lastCheckedAt,
    records.filter((record) => record.sourceId === source.id).length,
    error,
    sourceUpdatedAt,
    status !== "ok",
  ));

  return {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: now,
    sources: sourcesOutput,
    records,
  };
}

function comparablePayload(payload) {
  return {
    schemaVersion: payload?.schemaVersion,
    sources: (Array.isArray(payload?.sources) ? payload.sources : []).map((source) => ({
      id: source?.id,
      name: source?.name,
      type: source?.type,
      status: source?.status,
      lastCheckedAt: "",
      recordCount: source?.recordCount,
      sourceUpdatedAt: source?.sourceUpdatedAt,
      stale: source?.stale,
      error: source?.error,
    })),
    records: (Array.isArray(payload?.records) ? payload.records : []).map((record) => ({
      ...Object.fromEntries(CONTRACT_RECORD_KEYS.map((key) => [key, record?.[key]])),
      fetchedAt: "",
    })),
  };
}

export function payloadContentChanged(previousPayload, nextPayload) {
  if (!previousPayload || typeof previousPayload !== "object") return true;
  return JSON.stringify(comparablePayload(previousPayload)) !== JSON.stringify(comparablePayload(nextPayload));
}

export function renderJson(payload) {
  return `${JSON.stringify(payload, null, 2)}\n`;
}

export function renderJavaScript(payload) {
  const serialized = JSON.stringify(payload, null, 2)
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
  return `/* Generated by scripts/sync-jobs.mjs. Do not edit manually. */\n` +
    `globalThis.RECRUITMENT_SYNC_PAYLOAD = ${serialized};\n` +
    `if (typeof module !== "undefined" && module.exports) module.exports = globalThis.RECRUITMENT_SYNC_PAYLOAD;\n`;
}

async function removeIfExists(filePath) {
  try {
    await fsp.rm(filePath, { force: true });
  } catch {
    // Best-effort cleanup must not hide the original write error.
  }
}

async function atomicWritePair(files) {
  const nonce = `${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const staged = files.map(({ filePath, content }) => ({
    filePath,
    tempPath: `${filePath}.tmp-${nonce}`,
    backupPath: `${filePath}.bak-${nonce}`,
    content,
  }));
  const movedBackups = [];
  const installed = [];
  let committed = false;

  try {
    for (const item of staged) {
      await fsp.mkdir(path.dirname(item.filePath), { recursive: true });
      await fsp.writeFile(item.tempPath, item.content, "utf8");
    }

    for (const item of staged) {
      try {
        await fsp.rename(item.filePath, item.backupPath);
        movedBackups.push(item);
      } catch (error) {
        if (!(["ENOENT", "ENOTDIR"].includes(error?.code))) throw error;
      }
    }

    for (const item of staged) {
      await fsp.rename(item.tempPath, item.filePath);
      installed.push(item);
    }

    for (const item of movedBackups) await removeIfExists(item.backupPath);
    committed = true;
  } catch (error) {
    for (const item of installed) await removeIfExists(item.filePath);
    for (const item of movedBackups.reverse()) {
      try {
        await fsp.rename(item.backupPath, item.filePath);
      } catch {
        // Preserve the original error; the backup remains recoverable on disk.
      }
    }
    throw error;
  } finally {
    for (const item of staged) await removeIfExists(item.tempPath);
    if (committed) {
      for (const item of staged) await removeIfExists(item.backupPath);
    }
  }
}

export async function writeSnapshotFiles(payload, {
  jsonPath,
  jsPath,
  previousPayload = null,
  writeIfChanged = true,
} = {}) {
  if (!jsonPath || !jsPath) throw new TypeError("必须提供 JSON 和 JS 输出路径");
  if (path.resolve(jsonPath) === path.resolve(jsPath)) throw new TypeError("JSON 和 JS 输出路径不能相同");
  if (writeIfChanged && previousPayload && !payloadContentChanged(previousPayload, payload)) {
    return { changed: false };
  }

  await atomicWritePair([
    { filePath: jsonPath, content: renderJson(payload) },
    { filePath: jsPath, content: renderJavaScript(payload) },
  ]);
  return { changed: true };
}

async function readJsonIfExists(filePath) {
  try {
    const source = await fsp.readFile(filePath, "utf8");
    return JSON.parse(source);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function parseCliArgs(argv) {
  const args = {
    sourcesPath: "data/sources.json",
    jsonPath: "data/jobs.generated.json",
    jsPath: "data/jobs.generated.js",
    writeIfChanged: true,
    dryRun: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const next = argv[index + 1];
    if (argument === "--sources" && next) {
      args.sourcesPath = next;
      index += 1;
    } else if ((argument === "--now" || argument === "--generated-at") && next) {
      args.now = next;
      index += 1;
    } else if (argument === "--timeout-ms" && next) {
      args.timeoutMs = Number(next);
      index += 1;
    } else if (argument === "--output-json" && next) {
      args.jsonPath = next;
      index += 1;
    } else if (argument === "--output-js" && next) {
      args.jsPath = next;
      index += 1;
    } else if (argument === "--force") {
      args.writeIfChanged = false;
    } else if (argument === "--dry-run") {
      args.dryRun = true;
    } else if (argument === "--no-write-if-unchanged") {
      args.writeIfChanged = false;
    }
  }
  return args;
}

export async function runSync(options = {}) {
  const scriptRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const sourcesPath = path.resolve(options.sourcesPath ?? path.join(scriptRoot, "data/sources.json"));
  const jsonPath = path.resolve(options.jsonPath ?? path.join(scriptRoot, "data/jobs.generated.json"));
  const jsPath = path.resolve(options.jsPath ?? path.join(scriptRoot, "data/jobs.generated.js"));
  const sourceConfig = await readJsonIfExists(sourcesPath);
  if (!sourceConfig) throw new Error(`找不到来源配置：${sourcesPath}`);
  const previousPayload = options.previousPayload ?? await readJsonIfExists(jsonPath);
  const payload = await syncJobs({
    sources: sourceConfig,
    previousPayload,
    fetchImpl: options.fetchImpl,
    now: options.now ?? process.env.SYNC_NOW,
    timeoutMs: options.timeoutMs ?? process.env.SYNC_TIMEOUT_MS,
  });
  const writeResult = options.dryRun
    ? { changed: payloadContentChanged(previousPayload, payload), dryRun: true }
    : await writeSnapshotFiles(payload, {
      jsonPath,
      jsPath,
      previousPayload,
      writeIfChanged: options.writeIfChanged !== false,
    });
  return { payload, ...writeResult, jsonPath, jsPath };
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseCliArgs(argv);
  const result = await runSync(args);
  const successful = result.payload.sources.filter((source) => source.status === "ok").length;
  const failed = result.payload.sources.filter((source) => source.status === "error").length;
  const disabled = result.payload.sources.filter((source) => source.status === "disabled").length;
  const action = result.dryRun ? "预览" : (result.changed ? "已写入" : "内容未变化，未写入");
  console.log(`招聘同步${action}：${result.payload.records.length} 条记录；成功 ${successful}，失败 ${failed}，禁用 ${disabled}。`);
  if (failed > 0) {
    for (const source of result.payload.sources.filter((item) => item.status === "error")) {
      console.warn(`来源失败（已保留旧记录）${source.name}: ${source.error}`);
    }
  }
  return result;
}

export const syncSources = syncJobs;
export const buildSourceUrl = (sourceInput) => sourceEndpoint(
  sourceInput?.raw ? sourceInput : normalizeSource(sourceInput),
);
export const normalizeRecord = normalizeJob;
export const writeSnapshot = writeSnapshotFiles;

const isMainModule = process.argv[1]
  && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isMainModule) {
  main().catch((error) => {
    console.error(`招聘同步失败：${normalizeResponseError(error)}`);
    process.exitCode = 1;
  });
}
