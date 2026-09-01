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

  let dom = {};
  let toastTimer = null;

  function cloneRecord(record) {
    return {
      ...record,
      categories: Array.isArray(record?.categories) ? [...record.categories] : [],
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
    if (!isDateOnly(record.openDate) || !isDateOnly(record.deadline)) return false;
    if (record.openDate > record.deadline) return false;
    if (typeof record.province !== "string" || typeof record.city !== "string") return false;
    if (!Array.isArray(record.categories)) return false;
    if (!isHttpsUrl(record.campusUrl)) return false;
    if (typeof record.statusUpdatedAt !== "string" || Number.isNaN(Date.parse(record.statusUpdatedAt))) return false;
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

  function loadRecords() {
    const stored = readStoredRecords();
    if (stored !== null) return stored;

    const fresh = cloneRecords(initialRecords);
    writeRecords(fresh);
    return fresh;
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

  function todayKey(date = new Date()) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function dateDistance(dateValue, baseDate = todayKey()) {
    const target = Date.parse(`${dateValue}T00:00:00Z`);
    const base = Date.parse(`${baseDate}T00:00:00Z`);
    if (Number.isNaN(target) || Number.isNaN(base)) return null;
    return Math.round((target - base) / 86400000);
  }

  function deadlineState(deadline, baseDate = todayKey()) {
    const distance = dateDistance(deadline, baseDate);
    if (distance === null) return "open";
    if (distance < 0) return "expired";
    if (distance <= 3) return "soon";
    return "open";
  }

  function formatDate(value) {
    if (typeof value !== "string") return "—";
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
    if (distance === null) return "日期待核实";
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

  function statusIndex(status) {
    const index = statusOptions.indexOf(status);
    return index < 0 ? Number.MAX_SAFE_INTEGER : index;
  }

  function compareText(left, right) {
    return String(left ?? "").localeCompare(String(right ?? ""), "zh-CN");
  }

  function sortRecords(records, sortValue = state.sort) {
    const indexed = records.map((record, index) => ({ record, index }));
    if (sortValue === "default") return indexed.map(({ record }) => record);

    const direction = sortValue.endsWith("-desc") ? -1 : 1;
    indexed.sort((left, right) => {
      let result = 0;
      if (sortValue.startsWith("deadline")) {
        result = compareText(left.record.deadline, right.record.deadline);
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
    setSelectOptions(dom.cityFilter, cities, selectedProvince ? "全部城市" : "选择省份后筛选");
    dom.provinceFilter.value = selectedProvince;
    dom.cityFilter.value = selectedCity;
    dom.cityFilter.disabled = !selectedProvince;
    dom.cityFilter.setAttribute("aria-disabled", String(!selectedProvince));
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
      <div class="deadline-range"><time datetime="${escapeHtml(record.openDate)}">${escapeHtml(formatDate(record.openDate))}</time><span aria-hidden="true"> → </span><time datetime="${escapeHtml(record.deadline)}">${escapeHtml(formatDate(record.deadline))}</time></div>
      <span class="deadline-state">${escapeHtml(deadlineLabel(record.deadline))}</span>
    </div>`;
  }

  function renderCategories(record) {
    const categories = Array.isArray(record.categories) ? record.categories : [];
    return `<div class="category-list" aria-label="岗位方向">${categories.map((category) => `<span class="category-tag">${escapeHtml(category)}</span>`).join("")}</div>`;
  }

  function renderTable(records) {
    if (!dom.tableBody) return;
    dom.tableBody.innerHTML = records.map((record) => `<tr data-record-id="${escapeHtml(record.id)}" data-status="${escapeHtml(record.status)}">
      <td>
        <div class="company-cell">
          <span class="company-avatar" aria-hidden="true">${escapeHtml(companyMark(record.companyName))}</span>
          <span class="company-copy"><strong class="company-name">${escapeHtml(record.companyName)}</strong><span class="company-id">${escapeHtml(record.id)}</span></span>
        </div>
      </td>
      <td><span class="company-type ${companyTypeClassName(record.companyType)}">${escapeHtml(record.companyType)}</span></td>
      <td>${renderCategories(record)}</td>
      <td><div class="location-cell"><strong>${escapeHtml(record.city)}</strong><span>${escapeHtml(record.province)}</span></div></td>
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
          <span class="company-copy"><strong class="company-name">${escapeHtml(record.companyName)}</strong><span class="company-id">${escapeHtml(record.id)}</span></span>
        </div>
        <span class="company-type ${companyTypeClassName(record.companyType)}">${escapeHtml(record.companyType)}</span>
      </div>
      <div class="job-card-grid">
        <div class="job-card-field"><span class="job-card-label">岗位方向</span><div class="job-card-value">${renderCategories(record)}</div></div>
        <div class="job-card-field"><span class="job-card-label">工作地点</span><div class="job-card-value location-cell"><strong>${escapeHtml(record.city)}</strong><span>${escapeHtml(record.province)}</span></div></div>
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

  function updateResultsSummary(matchCount) {
    if (!dom.resultsCount) return;
    dom.resultsCount.textContent = `共 ${matchCount} / ${state.records.length} 个岗位`;
  }

  function renderResults() {
    const filteredRecords = filterRecords(state.records);
    const visibleRecords = sortRecords(filteredRecords, state.sort);
    updateResultsSummary(visibleRecords.length);
    renderTable(visibleRecords);
    renderMobileCards(visibleRecords);
    const isEmpty = visibleRecords.length === 0;
    if (dom.desktopTableView) dom.desktopTableView.hidden = isEmpty;
    if (dom.mobileCardView) dom.mobileCardView.hidden = isEmpty;
    if (dom.emptyState) dom.emptyState.hidden = !isEmpty;
  }

  function renderAll() {
    if (!hasDocument) return;
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

  function resetToInitialData() {
    const confirmFn = typeof root.confirm === "function" ? root.confirm.bind(root) : () => true;
    if (!confirmFn("确定恢复示例数据吗？这会覆盖本机保存的投递状态。")) return;
    removeStoredRecords();
    state.records = cloneRecords(initialRecords);
    state.sort = "default";
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
  }

  function collectDom() {
    if (!hasDocument) return;
    const byId = (id) => document.getElementById(id);
    dom = {
      saveHint: byId("saveHint"),
      dataNote: byId("dataNote"),
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
      exportButton: byId("exportButton"),
      heroExportButton: byId("heroExportButton"),
      heroResetButton: byId("heroResetButton"),
      desktopTableView: byId("desktopTableView"),
      tableBody: byId("tableBody"),
      mobileCardView: byId("mobileCardView"),
      emptyState: byId("emptyState"),
      resultsCount: byId("resultsCount"),
      toast: byId("toast"),
    };
  }

  function updateDataNote() {
    if (!dom.dataNote) return;
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
    state,
    initialRecords,
    statusOptions,
    companyTypeOptions,
    storageKey,
    calculateStats,
    deadlineState,
    filterRecords,
    sortRecords,
    makeCsv,
    downloadCsv,
    isDateOnly,
    isHttpsUrl,
    safeCampusUrl,
    isValidStoredRecord,
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
