/*
 * 秋招资源汇总平台的初始化数据。
 *
 * 日期和招聘信息均为演示数据，不代表企业真实招聘安排。应用加载后应
 * 复制此数组再写入 localStorage，避免直接修改初始化常量影响重置逻辑。
 */

const RECRUITMENT_STATUS_OPTIONS = [
  "未投递",
  "已投递",
  "筛选中",
  "笔试 / 测评中",
  "面试中",
  "已发 offer",
  "终止流程 / 已淘汰",
  "已接受 / 已拒绝 offer",
];

const RECRUITMENT_COMPANY_TYPES = ["央国企", "私企", "外企", "事业单位", "其他"];

const RECRUITMENT_FOCUS_REGION = {
  province: "广东",
  cities: [
    "广州", "深圳", "珠海", "汕头", "佛山", "韶关", "河源", "梅州", "惠州", "汕尾", "东莞",
    "中山", "江门", "阳江", "湛江", "茂名", "肇庆", "清远", "潮州", "揭阳", "云浮",
  ],
};

const RECRUITMENT_DOMESTIC_LOCATIONS = {
  [RECRUITMENT_FOCUS_REGION.province]: [...RECRUITMENT_FOCUS_REGION.cities],
};

const RECRUITMENT_DATA_META = {
  isDemo: true,
  dateNote: "当前仅展示广东 21 城；示例日期为模拟的 2026 秋招日期，请以企业官方页面为准。",
  storageKey: "autumn-recruitment-tracker:v2",
  schemaVersion: 2,
};

const INITIAL_RECRUITMENT_DATA = [
  {
    id: "recruitment-005",
    companyName: "华润集团",
    companyType: "央国企",
    openDate: "2026-08-15",
    deadline: "2026-09-10",
    province: "广东",
    city: "深圳",
    categories: ["战略投资", "商业管理", "医药健康", "信息技术"],
    campusUrl: "https://campus.crc.com.cn/",
    status: "未投递",
    statusUpdatedAt: "1970-01-01T00:00:00.000Z",
    isDemo: true,
  },
  {
    id: "recruitment-008",
    companyName: "南方电网",
    companyType: "央国企",
    openDate: "2026-08-28",
    deadline: "2026-09-20",
    province: "广东",
    city: "广州",
    categories: ["电气工程", "数字化技术", "调度运行", "人力资源"],
    campusUrl: "https://zhaopin.csg.cn/",
    status: "未投递",
    statusUpdatedAt: "1970-01-01T00:00:00.000Z",
    isDemo: true,
  },
  {
    id: "recruitment-011",
    companyName: "腾讯",
    companyType: "私企",
    openDate: "2026-08-24",
    deadline: "2026-10-31",
    province: "广东",
    city: "深圳",
    categories: ["软件开发", "产品经理", "游戏研发", "设计"],
    campusUrl: "https://join.qq.com/",
    status: "未投递",
    statusUpdatedAt: "1970-01-01T00:00:00.000Z",
    isDemo: true,
  },
  {
    id: "recruitment-013",
    companyName: "华为",
    companyType: "私企",
    openDate: "2026-08-12",
    deadline: "2026-10-20",
    province: "广东",
    city: "深圳",
    categories: ["软件开发", "芯片与器件", "通信技术", "销售管理"],
    campusUrl: "https://career.huawei.com/reccampportal/portal5/index.html",
    status: "未投递",
    statusUpdatedAt: "1970-01-01T00:00:00.000Z",
    isDemo: true,
  },
  {
    id: "recruitment-016",
    companyName: "比亚迪",
    companyType: "私企",
    openDate: "2026-08-17",
    deadline: "2026-10-10",
    province: "广东",
    city: "深圳",
    categories: ["车辆工程", "电池研发", "智能驾驶", "制造工程"],
    campusUrl: "https://job.byd.com/",
    status: "未投递",
    statusUpdatedAt: "1970-01-01T00:00:00.000Z",
    isDemo: true,
  },
];

// 兼容浏览器直接引入和 Node 校验/构建脚本，不依赖 window、document 等对象。
globalThis.INITIAL_RECRUITMENT_DATA = INITIAL_RECRUITMENT_DATA;
globalThis.RECRUITMENT_STATUS_OPTIONS = RECRUITMENT_STATUS_OPTIONS;
globalThis.RECRUITMENT_COMPANY_TYPES = RECRUITMENT_COMPANY_TYPES;
globalThis.RECRUITMENT_DATA_META = RECRUITMENT_DATA_META;
globalThis.RECRUITMENT_FOCUS_REGION = RECRUITMENT_FOCUS_REGION;
globalThis.RECRUITMENT_DOMESTIC_LOCATIONS = RECRUITMENT_DOMESTIC_LOCATIONS;

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    INITIAL_RECRUITMENT_DATA,
    RECRUITMENT_STATUS_OPTIONS,
    RECRUITMENT_COMPANY_TYPES,
    RECRUITMENT_DATA_META,
    RECRUITMENT_FOCUS_REGION,
    RECRUITMENT_DOMESTIC_LOCATIONS,
  };
}
