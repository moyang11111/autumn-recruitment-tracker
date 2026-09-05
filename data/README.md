# 自动招聘数据同步

本目录保存公开招聘岗位的同步配置和生成快照。同步器读取 Greenhouse Job Board、Lever Postings，以及明确标注的开源社区聚合 JSON；不登录、不提交申请，也不读取个人投递状态。最终快照只保留广东省记录。

## 文件

- `sources.json`：来源配置。每个来源使用稳定的 `id`，`type` 为 `greenhouse`、`lever` 或 `community-json`；来源可以返回全国岗位，但同步层只接收有明确广东证据的记录。
- `jobs.generated.json`：供脚本、服务端或其他工具读取的 JSON 快照。
- `jobs.generated.js`：不依赖模块系统的同一份快照，加载后提供 `globalThis.RECRUITMENT_SYNC_PAYLOAD`，可直接通过 `file://` 在浏览器中加载。

首次运行同步前，生成快照为空是刻意的：本地实现和测试不会访问外部网络。启用工作流或手动运行同步后，快照才会包含实时公开岗位。

## 来源配置

示例配置如下：

```json
{
  "id": "greenhouse-example",
  "name": "Example Careers（Greenhouse）",
  "type": "greenhouse",
  "boardToken": "example",
  "companyName": "Example",
  "companyType": "外企",
  "campusUrl": "https://example.com/careers",
  "enabled": true
}
```

Greenhouse 使用 `boardToken`，请求地址为 `https://boards-api.greenhouse.io/v1/boards/{boardToken}/jobs?content=true`；Lever 使用 `site`，请求地址为 `https://api.lever.co/v0/postings/{site}?mode=json`。也可以在配置中提供 HTTPS `endpoint` 覆盖默认地址。`campusUrl` 是岗位没有独立详情链接时使用的安全回退链接。

`community-json` 当前用于 Apache-2.0 授权的 xiaozhao-radar 社区数据。响应结构为 `{updated,count,jobs:[...]}`；同步器会把一条记录中的多个城市拆成独立城市索引，只保留广东的城市，使“广州/上海/东莞”只生成广州和东莞两条记录。社区记录在页面中显示“社区聚合”，详情见根目录 `THIRD_PARTY_NOTICES.md`。这类记录不是企业官方确认，投递前必须核验。

## 广东范围

允许的 21 个城市为：广州、深圳、珠海、汕头、佛山、韶关、河源、梅州、惠州、汕尾、东莞、中山、江门、阳江、湛江、茂名、肇庆、清远、潮州、揭阳、云浮。只有 `province: "广东"` 且 `city` 为空或属于上述清单的记录可以进入快照；`city: ""` 表示“广东/全省/地点未细分”。

“全国”“不限”“全球”等范围不会自动等同于广东。只有来源地点明确同时包含广东，或来源配置明确声明默认覆盖广东时，才会保留该记录；其他省份和没有广东证据的全国岗位会被丢弃。多地点岗位会拆分后只保留广东地点。

## 快照契约

顶层字段为：

| 字段 | 说明 |
| --- | --- |
| `schemaVersion` | 当前固定为 `1` |
| `generatedAt` | 本次候选快照生成时间，ISO 8601 |
| `sources` | 来源健康状态、更新时间、stale 标记和来源记录数 |
| `records` | 去重后的岗位记录 |

每条 `records` 记录固定包含以下字段：

`id`、`companyName`、`companyType`、`openDate`、`deadline`、`province`、`city`、`jobCategories`、`campusUrl`、`sourceId`、`sourceName`、`sourceType`、`sourceUpdatedAt`、`fetchedAt`、`status`、`statusUpdatedAt`、`isDemo`。

来源对象至少包含 `id`、`name`、`type`、`status`、`lastCheckedAt` 和 `recordCount`；有可验证的上游更新时间时还包含 `sourceUpdatedAt`，数据过旧、读取失败或被禁用时包含 `stale: true`。

岗位 ID 由来源 ID 和上游岗位 ID 的稳定摘要组成；上游没有 ID 时使用岗位链接、标题和地点等字段生成摘要。社区来源还会用“公司 + 城市 + 具体投递链接”关联历史投递状态，因此标题、批次或类别变化不会清空用户进度；没有具体链接的社区记录只能依赖现有 ID。相同 ID 或相同安全详情链接只保留一条（社区多城市记录按城市分别保留），并按 ID 稳定排序。城市会把常见的中文/英文城市名映射为统一的省份和城市；无法判断时保持空值或保留未映射的原始城市，不猜测省份。

`openDate`、`deadline`、`sourceUpdatedAt` 只有来源明确提供并且可验证时才写入；未知日期使用空字符串，不用抓取时间代替。来源若提供 `sourceUpdatedAt`，同步检查时间与其相差超过 14 天会额外标记 `stale: true`；读取失败或禁用的来源也会标记为 stale，但仍保留该来源上一次广东记录。新岗位的 `status` 为 `未投递`，再次同步时会按稳定 ID 保留已有的投递状态和状态更新时间；社区记录还会按公司、广东城市和具体投递链接关联状态，因此标题、批次或类别的小变化不会清空进度。初始空快照的来源状态为 `not_checked`；实际同步后使用 `ok`、`error` 或 `disabled`。

## 安全与容错

- API 地址、岗位详情链接和回退链接都必须是 HTTPS，`http:`、`javascript:`、`data:`、`file:` 以及含凭据的 URL 会被拒绝。
- 每个来源单独请求并设置超时；一个来源失败不会阻止其他来源同步。
- 来源失败或被禁用时，上一份该来源的广东记录会保留，投递状态也会保留；来源会记录 `status: "error"` 或 `status: "disabled"` 及错误信息，前端会提示 stale，不会把上一份外省记录带回广东快照。
- JSON 与 JS 通过同目录临时文件和替换写入，避免进程中断留下半份快照。
- 当岗位、来源健康状态或错误信息没有变化时，生成器保留原时间戳和文件内容，工作流不会因为一次例行检查产生空提交。

## 本地运行

Node.js 18 或更高版本即可，无需安装第三方依赖。下面的命令会访问配置中启用的公开接口：

```bash
node scripts/sync-jobs.mjs
```

常用参数：

```bash
node scripts/sync-jobs.mjs --dry-run
node scripts/sync-jobs.mjs --sources data/sources.json --timeout-ms 15000
node scripts/sync-jobs.mjs --now 2026-09-01T00:00:00.000Z
```

测试使用 fixtures 和 mock fetch，不联网：

```bash
npm test
```

## GitHub Actions

`.github/workflows/sync-jobs.yml` 同时支持手动触发和定时触发。工作流先运行完整测试，再运行同步器；只有生成文件的有效内容变化时才提交并推送。工作流不会把 `status` 当作自动投递状态来源，真实投递进度仍由用户在应用中维护。
