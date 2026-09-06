# Third-party data notices

## xiaozhao-radar community feed

- Project: [jiabaobei/xiaozhao-radar](https://github.com/jiabaobei/xiaozhao-radar)
- Feed: `jobs.json`
- License: [Apache License 2.0](licenses/xiaozhao-radar-Apache-2.0.txt), sourced from the upstream [LICENSE](https://github.com/jiabaobei/xiaozhao-radar/blob/main/LICENSE)
- Usage: the scheduled sync reads the public feed and converts its company, position, location, deadline and application-link fields into this project's snapshot format.

The complete Apache License 2.0 text is included in this repository for redistribution. This project modifies the upstream feed by normalizing fields, splitting multi-city entries, filtering incomplete and non-Guangdong records, and retaining source attribution; it does not imply that the community links are employer-authoritative.

The feed is a community aggregation rather than an employer-authoritative source. Records are labeled “社区聚合” in the interface. Users should verify the employer, deadline and application link before submitting personal information.

## recruit-hub community CSV

- Project: [kknee-dev/recruit-hub](https://github.com/kknee-dev/recruit-hub)
- Data: dated `data/jobs-YYYY-MM-DD.csv` snapshots discovered through the GitHub contents API for the `data/` directory
- License: [MIT License](licenses/recruit-hub-MIT.txt), sourced from the upstream [LICENSE](https://github.com/kknee-dev/recruit-hub/blob/main/LICENSE)
- Usage: the scheduled sync discovers the latest dated CSV snapshot, converts its company, position, industry, publish date, city and application-link fields into this project's snapshot format, and keeps only Guangdong records.

The complete MIT License text is included in this repository for redistribution. This project modifies the upstream data by normalizing fields, splitting multi-city entries, filtering non-Guangdong records, and retaining source attribution; it does not imply that the community links are employer-authoritative. The CSV is a community aggregation rather than an employer-authoritative source, and its records are labeled “社区聚合” in the interface. Users should verify the employer, deadline and application link before submitting personal information.

## xixicc2027 company-level feed

- Project: [xixicc186/xixicc2027](https://github.com/xixicc186/xixicc2027)
- Data: `jobs.json`（2027届秋招信息聚合，每日更新）
- License: 上游仓库未声明开源许可
- Usage: the scheduled sync reads the public feed and converts its company, batch, industry, locations, deadline and application-link fields into this project's snapshot format, splitting multi-city company entries per Guangdong city.

上游未声明许可。本仓库仅引用其中的事实性招聘条目（企业名、批次、地点、截止日期与官方投递链接），逐条保留上游来源与原始链接；如权利人提出异议会移除相关内容。该源为社区聚合，记录在界面上标注“社区聚合”，投递前请以企业官方页面为准。

## 2027-autumn-recruitment company-level feed

- Project: [houhouhou218/2027-autumn-recruitment](https://github.com/houhouhou218/2027-autumn-recruitment)
- Data: `data.json`（2027届秋招投递信息，每日核验更新，含 openDate/deadline/applyUrl）
- License: 上游仓库未声明开源许可
- Usage: the scheduled sync reads the public feed and converts its company, recruitment type, nature, location, open/deadline dates and application-link fields into this project's snapshot format, splitting multi-city company entries per Guangdong city.

上游未声明许可。本仓库仅引用其中的事实性招聘条目并逐条保留上游来源与原始链接；如权利人提出异议会移除相关内容。该源为社区聚合，记录在界面上标注“社区聚合”，投递前请以企业官方页面为准。
