# my-reader 项目工作约定

## 入口

- 先读 `docs/00-CURRENT.md`，再读 `README.md`。
- 内部状态不放在公开仓；唯一指针如下（相对 Obsidian vault）：

```text
internal_status: 2-活动项目/my-reader/my-reader-STATUS.md
```

## 项目雷区

- Worker 是手工 `wrangler deploy`；GitHub Actions 只发布 Pages 前端。
- 部署顺序固定为：D1 迁移 → Worker → 线上验证 → 前端。不要先推前端再部署 Worker。
- 第 11 步等未完成改动不得混入第 0 步或文档提交；禁止 `git add -A`，只显式提交本批文件。
- 云端词组消歧会把被点句子送到 Worker/provider；新增解释、证据或更长上下文前，先补告知与授权边界。
- 公开仓不写真实缺陷、原始验收分数、内部路线取舍或 provider 账单信息。

## 验证

- `cd worker && npm test`
- `cd reader && npm test`
- `cd reader && npm run build`
- 文档或流程改动至少跑一次 `git diff --check`。
