# my-reader — 英语阅读+词汇深度学习工具

> 最后更新：2026-07-17 | 当前阶段：全书音频上线 + Phase 7.1 生词本完成；待办：域名 + 分层静态词典 + 同步

## 一、项目概要

面向 SAT/AP Literature 备考的英语电子书阅读器。上传 epub/txt，自动解析章节、提取生词、标注考试词汇、生成可部署的阅读器。

- **部署**：GitHub Pages（静态托管）
- **TTS**：Kokoro 本地预生成逐章 MP3（48kbps mono + 段落时间表）+ browser speechSynthesis 兜底
- **前端**：Vue 3 + Vite + Vue Router（hash 模式）
- **后端（生成管道）**：Python Flask（本地 epub → JSON 数据）+ tts.py（Kokoro 逐章合成 CLI）
- **词典**：M-W 代理 Worker + D1 缓存（⚠️ workers.dev 国内被墙，待换自定义域名 + 分层静态词典）
- **同步（产品化阶段）**：Cloudflare Workers + D1 + R2

---

## 二、2026-07-17 完成进度

### 全书音频（Kokoro 方案落地）
- [x] `generator/pipeline/tts.py`：逐段合成 + 段落静音 + 断点续跑 + 多码率对比 + 段落时间表 timings.json；完全离线（HF_HUB_OFFLINE）
- [x] 码率定稿 48kbps mono（用户三档试听拍板）；全书 23 章 / ~4.5h 音频 / 95MB 上线
- [x] 实测生成速度 RTF≈0.9（快于预估一倍），全书约 4 小时
- [x] 前端 AudioPlayer 重构：静态 MP3 优先 → browser TTS 兜底，Cloud TTS 路径删除；20s 加载超时；iOS 手势合规
- [x] 段落定位播放：点击段落 ▶ 从该段播、进度记忆（localStorage）、高亮跟随（让位于手动滚动）

### Phase 6b：M-W 词典代理
- [x] Worker 重写为词典代理（GET /api/dict/<word>）+ D1 边缘缓存（库 my-reader-dict）；key 走 wrangler secret
- [x] 前端在线查词兜底 + 撇号/连字符分词修复（o'clock 不再查成 oclock）
- [x] ⚠️ **真机发现 workers.dev 被 DNS 污染**（移动端全挂，电脑靠 Clash）——见"四、已知问题"

### Phase 7.1：生词本
- [x] 分层存储：schema(版本+迁移链) → localAdapter(key reader-vocab-v1) → index(产品化替换点)；srs/quiz 槽位预留给 7.2/7.3
- [x] useVocabulary 单例：收藏按 lemma 归一、离线空快照联网自愈（双 key 查找）、导出/导入(merge)/清空
- [x] 弹窗三态按钮、正文已收藏词绿色点下划线、VocabularyView（搜索/筛选/排序/卡片/两步移除/导入导出）
- [x] Node 冒烟测试 smoke-test.mjs（7 场景含原型污染防御）全过

### 移动端白屏修复（真机验收发现）
- [x] 根因（用户实验证实）：斜滑误触发切章 + App.vue `:key="$route.fullPath"` 整页销毁重建
- [x] 四件套：手势方向约束(|dx|>80 且 |dx|>2|dy|)、去 :key + 拆 watch（换章零网络、修双重加载）、事件委托（5600 监听器→1）、passive touch
- [x] 用户真机复验通过：随意滑动不再白屏/跳章，横向快刷仍可翻章

---

## 三、历史进度（2026-07-16）

- Phase 1-5 完成：脚手架 / 数据合约 / Python 管道（parser/extractor/dictionary + NGSL 8,509 词）/ Vue 阅读器 MVP / GitHub Pages 部署
- 测试数据：The Giver（25 章 = 2 前言页 + 23 正文章，1,477 候选词）
- AudioPlayer 状态机重写（修 Chrome 卡死 5 根因）；Workers AI TTS 因额度不够废弃

---

## 四、已知问题 & 决策（2026-07-17 晚）

| # | 问题 | 根因（已实锤） | 已定方案 |
|---|---|---|---|
| 1 | 移动端在线查词全挂 | workers.dev 被 DNS 污染（解析到 Facebook IP）；media.merriam-webster.com 也被 SNI 阻断 | ① 买域名绑 Worker 自定义域（用户已同意，~¥10-70/年）② 分层静态词典：ECDICT 常见词层（带中文，用户拍板）+ M-W 生僻层（~1,500 词，2 天配额）③ 发音切有道 dictvoice（实测直连 0.14s） |
| 2 | 生词本跨设备不同步 | MVP 设计如此（localStorage 按设备） | 短期用 Export/Import JSON 手动搬；域名到位后做"同步码 + D1"极简同步（1-2 天） |
| 3 | dictionary.json 释义全空 | 生成时跳过了 M-W（网络慢） | 并入分层静态词典一起装填 |
| 4 | ~~滑动白屏~~ | ~~斜滑误触发 + :key 重建~~ | ✅ 已修复上线（ad78c0a） |

## 五、下一步（明天开始）

1. **域名**：购买（Cloudflare Registrar / Spaceship，.xyz 首年几块钱）→ Worker 绑自定义域 → 前端换常量 → 移动端查词复活
2. **分层静态词典**：ECDICT 打包 NGSL 常见词层（含中文）→ M-W 跑生僻层（断点续跑脚本）→ 装填 dictionary.json → 发音切有道
3. **极简同步**：同步码 + D1（复用现有 Worker/D1/merge 逻辑）
4. Phase 7.2 FSRS 闪卡 → 7.3 测验 → Phase 3.4 本地上传页

## 六、踩坑记录（新增）

- PowerShell 管道给 wrangler secret 传值会混入换行 → Worker 端 `.trim()` 防御 + 从注册表读值
- ffmpeg 输出文件名以 .tmp 结尾会认不出格式 → 显式 `-f mp3`（跑长任务前先做 1 秒烟囱测试）
- Vue reactive 与外部模块共享同一对象引用时，外部先原始写会吞掉 ADD/DELETE 通知 → storage 层与组件状态浅拷贝隔离
- 真机验收必须包含"无代理的移动网络"场景——开发机的 Clash 会掩盖被墙问题

## 七、关键链接

| 链接 | 用途 |
|---|---|
| https://ferrari-serena.github.io/my-reader/ | 线上阅读器 |
| https://github.com/Ferrari-Serena/my-reader | 代码仓库 |
| https://my-reader-tts.serena605371358.workers.dev | 词典 Worker（国内被墙，待换域名） |
| https://dash.cloudflare.com/ | Cloudflare 控制台（D1: my-reader-dict） |
| https://dictionaryapi.com/ | Merriam-Webster API（key 在用户环境变量 + Worker secret） |

---

## 附录 A：项目结构（2026-07-17 更新）

```
my-reader/
├── .github/workflows/deploy.yml    # GitHub Actions 自动部署
├── generator/                      # Python 本地生成管道
│   ├── app.py                      # Flask 主入口
│   ├── requirements.txt
│   └── pipeline/
│       ├── parser.py               # epub/txt 解析
│       ├── extractor.py            # 词汇提取 + NGSL 过滤
│       ├── dictionary.py           # M-W API 词典查询（待并入分层静态词典）
│       ├── tts.py                  # Kokoro 逐章合成 CLI（断点续跑 + 时间表）
│       └── ngsl.txt                # 8,509 常见词
├── reader/                         # Vue 3 SPA
│   ├── src/
│   │   ├── views/                  # ReaderView / BookListView / VocabularyView + 占位视图
│   │   ├── components/             # ChapterNav / WordPopup / AudioPlayer
│   │   ├── composables/            # useVocabulary（生词本单例）
│   │   ├── storage/                # schema / localAdapter / index（产品化换 apiAdapter）
│   │   ├── router/index.js         # Hash 模式路由
│   │   └── style.css               # CSS 变量（亮色/暗色主题）
│   ├── smoke-test.mjs              # storage 链路 Node 冒烟测试
│   └── public/books/the-giver/     # The Giver 数据 + audio/（23 章 MP3 + timings）
├── worker/                         # Cloudflare 词典代理 Worker（原 TTS Worker 改造）
│   ├── src/index.js                # /api/dict/<word> + D1 缓存
│   ├── schema.sql                  # dict_cache 表
│   └── wrangler.toml               # D1 绑定：my-reader-dict
├── data/                           # 数据格式合约文档
└── README.md                       # 本文件
```

## 附录 B：工作习惯守则（2026-07-16 立，持续有效）

| 过去犯的错误 | 改进措施 | 验证方式 |
|---|---|---|
| 多文件编辑不逐条验证 | 每改一个文件 → 立刻 `npm run build` | 构建不过立刻停 |
| 出问题随手补丁，不系统诊断 | 先停下来用子代理排查根因，确认后再动手 | 子代理多次找到漏掉的根因 |
| 自己决定换方案不等确认 | **遇到选择/阻塞 → 停下来问用户** | 不再擅自改方案 |
| 删函数时误切相邻代码 | 编辑后通读一遍确认无游离代码 | 构建 + 目视检查 |
| 首次异常就怀疑代码 | 先分层排查是代码还是基础设施问题 | workers.dev 被墙即此类 |
| 长任务直接全量跑 | 先做 1 秒级烟囱测试再启动 | ffmpeg .tmp 扩展名坑 |
