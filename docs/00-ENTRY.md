# my-reader · 当前工程入口

> 更新：2026-10-24

本文件是 `my-reader` 公开仓的工程入口，只记录**可公开的工程事实**。内部进度、真实缺陷、验收分数和未公开的产品取舍不在本仓镜像，见私有状态件。

## 项目定位

- 线上地址：`https://my-reader.ferrari11.com`
- 代码仓库：`Ferrari-Serena/my-reader`
- 产品方向：把学生手里的读物变成可查词、可复习、可朗读的学习工具；不持有书库，重点做“任意一本书进入学习链路”的工具层。

## 阅读顺序

1. 先读本文件。
2. 再看 `README.md` 的功能与本地开发说明。
3. 动代码前看 `git status`，不要把未完成分支的改动混入当前提交。
4. 需要内部状态时，只通过本仓 `AGENTS.md` 的 `internal_status` 指针访问私有状态件；不要把私有内容复制回公开仓。

## 当前公开接口与版本信息

- `GET /api/phrase/config`：返回词组消歧的版本信息；不返回 provider 地址或密钥。
- `POST /api/phrase/resolve`：词组语境消歧。`bk_` 开头的私有书需要有效会话；公开书按服务端白名单放行。
- 词组云端判断会把用户选中的句子送到 Worker 和模型 provider；涉及新增字段或解释输出时，必须同时检查告知、授权和输入注入边界。
- D1 迁移按编号追加；已执行的一次性 `ALTER` 迁移不得重跑。

## 部署事实

- 前端由 GitHub Pages 发布。
- Worker 是手工部署，不由 `deploy.yml` 自动发布。
- 变更顺序固定为：**D1 迁移 → Worker → 线上验证 → 前端**。
- Worker 部署前先确认提交只含本批文件；第 11 步等未完成改动不得混入。

### Worker 部署核对单

- [ ] `git status` 只含本批文件；第 11 步等未完成改动未 stage。
- [ ] 需要迁移时，先执行对应 D1 迁移；一次性 `ALTER` 不重跑。
- [ ] 云端词组关闸状态下，部署命令带 `--keep-vars --var PHRASE_CLOUD_DISABLED:1`；漏带会静默重开。
- [ ] 记录新 Worker version 与上一版回滚目标。
- [ ] 线上复核：`GET /api/phrase/config` 的 `ready` 与 `POST /api/phrase/resolve` 的 503／正常口径。

## 文档边界

- 本文件与 `README.md` 面向公开仓。
- 内部状态、风险、验收证据和路线取舍只写私有 `my-reader-STATUS.md`。
- 已冻结的 v2 实施方案只作历史设计与决策记录，不再作为每日状态源。
