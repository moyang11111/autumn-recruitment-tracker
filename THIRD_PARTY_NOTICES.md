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
