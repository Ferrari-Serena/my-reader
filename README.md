# my-reader — 英语阅读+词汇深度学习工具

> v1.0 · 2026-07-18 · `my-reader.ferrari11.com`（2026-10-04 由 `www.ferrari11.com` 迁入）

## 功能

- 📖 **分章节阅读** 带 Kokoro TTS 逐章音频 + 段落定位播放
- 🔍 **点击查词** ECDICT 本地中文释义 + M-W 英文兜底
- 📝 **生词本** 收藏/搜索/筛选/一键备份（导出/回导 JSON）+ 跨设备同步
- 🔄 **FSRS 闪卡** 间隔复习 + 背面拼写默写
- ✅ **测验** 句子语境填空 + 选择题 + 错题重练 + SAT 专项 + 词组测试
- 📗 **词组高亮** 阅读页收藏词所在词组整体标记

## 当前有 2 本书

- **The Giver**（25章，含 23 章 Kokoro 音频 ~95MB）
- **SAT Practice**（4,437 词，5,988 真实例句）

## 测试

`reader` 16 套 ＋ `worker` 9 套，合计 2,738 条纯逻辑测试；CI 在部署前跑；本地也可单跑：

```bash
cd reader && npm test   # 16 套（verify-*.mjs ＋ smoke-test.mjs）
cd worker && npm test   # 9 套（verify-*.mjs）
```

- `reader/verify-core.mjs` — 词典 / 分词 / 词组 / 存储核心
- `reader/verify-vueimports.mjs` — 组件卫生闸：`src/**` 里调用的 Vue API 必须在本文件 import 过（0823b05 白屏事故的防复发闸）
- `reader/verify-sync.mjs` — 同步合并、keepalive 预算裁剪、进度迁移、脏词持久化
- `reader/verify-booksync.mjs` — BYO 书体上云的前端一半（租户闸 / 原文 / 元信息 / 发布编排）
- `reader/verify-import.mjs` — BYO 导入解析层（错误口径 / 格式识别 / 编号 / 出口净化）
- `reader/verify-books.mjs` — BYO 书库与书架聚合（聚合口径 / 入库净化 / 删除）
- `reader/verify-importui.mjs` — 导入界面层纯逻辑（先验检查 / 进度换算 / 按钮门）
- `reader/smoke-test.mjs` — 生词本读写冒烟（含 0.6 备份包导出/回导）
- `reader/verify-authui.mjs` — 账号界面层纯逻辑（邮箱/密码校验 / 二次确认 / 错误码文案）
- `reader/verify-audio.mjs` — 云端音频读取侧（路径 / 就绪索引 / timings 口径 / 清空音频后的读侧口径）
- `reader/verify-genui.mjs` — 服务端合成的客户端（提交章节 / 状态 / 清空该书音频 ＋ 入口三态、My Books 常驻条与书级入口；D4 清空的确认原话与结果四档）
- `reader/verify-generate.mjs` — 生成后处理（段内切块 / 段间静音 / timings / WAV→mp3）
- `reader/verify-hotswitch.mjs` — 浏览器朗读 → 云端音色就地热切
- `reader/verify-feedbackui.mjs` — 反馈通道客户端（匿名键 / 诊断采集与白名单收口 / 最近错误环 / 路由记忆 / 提交与拉取；含与 `worker/src/feedback.js` 的逐常量漂移闸）
- `reader/verify-offline.mjs` — 离线「手感」（第 14 步块 C）：`navigator.onLine` 判定与文案（0 条不说话／单复数）、监听幂等与解除，+ **真调** `mrSwPrecache()` 看注入后的 `PRECACHE`（书架入口索引在不在壳里）；另含 `main.js`／`App.vue` 的接线来源级断言
- `reader/verify-sw.mjs` — Service Worker（`sw.js` ＋ `reader/src/utils/swUpdate.js`）：路由分流 / 壳预缓存与 runtime 体量闸 / 更新横幅与 `SKIP_WAITING`；页面侧注册 URL 带构建版本查询串（换缓存键，躲开 CF 边缘缓存）
- `worker/verify-worker.mjs` — Worker 路由 / 缓存 / CORS / 限流纯函数
- `worker/verify-auth.mjs` — `auth.js` 纯逻辑（base64url / tokenHash / 会话上限）
- `worker/verify-authapi.mjs` — 认证接口（cookie 解析 / Origin 闸 / 真 SQLite 跑真 SQL）
- `worker/verify-sql.mjs` — 用 `node:sqlite` 真跑 D1 SQL（同步 / 限流 / 音频任务表迁移链）
- `worker/verify-audioalias.mjs` — 音频访问口径（下架书 404 / BYO 别名映射）
- `worker/verify-booksync.mjs` — `booksync.js` 服务端契约（第 16 步 D14）
- `worker/verify-bookaudio.mjs` — 书籍音频上传/读取路由 ＋ 配额 ＋ 书级清空音频（D25）
- `worker/verify-audiogen.mjs` — 音频任务表与合成端点（第 17 步 D24）

## 部署

GitHub Pages (`my-reader.ferrari11.com`) + Cloudflare Worker（词典 + 同步 API）+ D1 数据库

## 本地工具

```
D:/PythonEnv/abogen-venv/Scripts/python.exe generator/app.py
→ http://127.0.0.1:5174
```

加新书、回填词典、生成 TTS 均通过此工具。

## 完整文档

[my-reader v1.0（含产品化衔接、数据管线速查、环境依赖）](https://github.com/Ferrari-Serena/my-reader/blob/main/README.md)
