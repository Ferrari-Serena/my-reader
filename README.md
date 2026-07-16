# my-reader — 英语阅读+词汇深度学习工具

> 最后更新：2026-07-16 | 当前阶段：Phase 6 中途（TTS 接入受阻，等待方案决策）

## 一、项目概要

面向 SAT/AP Literature 备考的英语电子书阅读器。上传 epub/txt，自动解析章节、提取生词、标注考试词汇、生成可部署的阅读器。

- **部署**：GitHub Pages（静态托管）
- **TTS**：Cloudflare Worker 代理（方向确认，实现受阻，见下文）
- **前端**：Vue 3 + Vite + Vue Router（hash 模式）
- **后端（生成管道）**：Python Flask（本地 epub → JSON 数据）
- **同步（产品化阶段）**：Cloudflare Workers + D1 + R2

---

## 二、今日（2026-07-16）完成进度

### Phase 1-5：已完成

- [x] 项目脚手架：Vue 3 + Vite + Python Flask + Git repo + GitHub Actions 部署
- [x] 数据格式合约：`chapters.json` / `dictionary.json` / `book-index.json`（`data/` 目录）
- [x] Python 生成管道：`generator/pipeline/parser.py` / `extractor.py` / `dictionary.py`
- [x] NGSL 词表：8,509 个词形式（从 `NGSL_1.2_lemmatized_for_teaching.csv` 转换）
- [x] Vue 阅读器 MVP：章节阅读 / 点击查词弹窗 / 响应式三端布局 / 滑动翻页
- [x] GitHub Pages 部署：`https://ferrari-serena.github.io/my-reader/`
- [x] 测试数据：The Giver（25 章，1,310 段落，1,477 候选词汇，9 个 SAT/AP 标记）

### Phase 6（Cloudflare Worker TTS）：受阻

- [x] Cloudflare Workers 项目创建并部署
- [x] Worker URL：`https://my-reader-tts.serena605371358.workers.dev`
- [ ] **TTS 功能未完成**：Workers AI Deepgram Aura 模型每天免费额度仅 10,000 神经元，读几页书就用完
- [ ] **等待决策**：Workers AI 付费 vs 换 Microsoft Edge TTS

### Phase 7（学习功能）：未开始

---

## 三、当前项目结构

```
my-reader/
├── .github/workflows/deploy.yml    # GitHub Actions 自动部署
├── generator/                      # Python 本地生成管道
│   ├── app.py                      # Flask 主入口
│   ├── requirements.txt
│   └── pipeline/
│       ├── parser.py               # epub/txt 解析
│       ├── extractor.py            # 词汇提取 + NGSL 过滤
│       ├── dictionary.py           # M-W API 词典查询（国内网络慢）
│       └── ngsl.txt                # 8,509 常见词
├── reader/                         # Vue 3 SPA
│   ├── src/
│   │   ├── views/                  # ReaderView / BookListView + 占位视图
│   │   ├── components/             # ChapterNav / WordPopup / AudioPlayer
│   │   ├── router/index.js         # Hash 模式路由
│   │   └── style.css               # CSS 变量（亮色/暗色主题）
│   └── public/books/the-giver/     # The Giver 测试数据
├── worker/                         # Cloudflare TTS Worker
│   ├── src/index.js                # 当前使用 Workers AI，500 报错
│   └── wrangler.toml
├── data/                           # 数据格式合约文档
└── README.md                       # 本文件
```

---

## 四、已知问题 & 排查记录

### 问题 1：AudioPlayer 重构引发浏览器崩溃

**现象**：Chrome 完全卡死无法关闭，按钮快速闪烁，无声音。

**根因**（经子代理确认，共 5 个原因）：
1. `audio.play()` 放在 `await fetch()` 之后，Chrome 不再认为是用户主动操作 → 拒绝播放
2. `.catch()` 和 `onAudioError` 两个回调同时触发同一失败 → 互相踩踏
3. `speechSynthesis.cancel()` 和后续 `speak()` 竞态 → Chrome TTS 引擎崩溃
4. 4 个不同事件源直接改 `isPlaying`，没有状态机协调
5. 整章 24 万字塞进一个 speechSynthesis utterance → 超长文本隐患

**修复**：重写为状态机 + session ID + 预暖音频 + 单一降级路径。**桌面端功能正常**。

### 问题 2：移动端 TTS 无声音

**现象**：手机和 Pad 上播放按钮正常切换但完全无声。

**根因**：browser speechSynthesis API 在移动端（特别是 iOS Safari）不可靠。`onend` 回调不触发、长文本被截断、iOS 需要同帧触发。

**修复方向**：Cloud TTS Worker（返回真实 MP3 用 `<audio>` 播放），但因 Workers AI 免费额度不够而受阻。

### 问题 3：Workers AI 免费额度不够

**现象**：Cloud TTS Worker 返回 500 Internal Server Error。

**根因**：Cloudflare Workers AI 免费层每天限制 10,000 神经元。测试请求耗尽了额度。

**Cloudflare Dashboard 提示**：`您已超过今天的神经元限制 10000`

**待决策**：方案 A（Workers AI 付费）vs 方案 B（Microsoft Edge TTS 免费）vs 其他？

### 问题 4：M-W API 国内网络极慢

**现象**：Python pipeline 逐词查词典，每个请求 3-4 秒。1,477 词需 70+ 分钟。

**当前方案**：MVP 阶段跳过 M-W API，生成空释义 dictionary.json。Phase 6 由 Cloudflare Worker 边缘节点代理。

---

## 五、踩坑总结 — 工作习惯改进

| 过去犯的错误 | 改进措施 | 验证方式 |
|---|---|---|
| 多文件编辑不逐条验证 | 每改一个文件 → 立刻 `npm run build` | 构建不过立刻停 |
| CSS import 被意外删除 | 改动后通读变动区域 | 检查缺失行 |
| 出问题随手补丁，不系统诊断 | 先停下来用子代理排查根因，确认后再动手 | 子代理两次找到漏掉的根因 |
| 自己决定换方案不等确认 | **遇到选择/阻塞 → 停下来问用户** | 不再擅自改方案 |
| 删函数时误切相邻代码 | 编辑后通读一遍确认无游离代码 | 构建 + 目视检查 |
| 首次点击无声音就怀疑代码 | 先排查是代码问题还是基础设施问题 | 分层诊断 |

---

## 六、下一步

1. **立即决策**：Workers AI 付费 vs Microsoft Edge TTS vs 其他方案？
2. Phase 6 完成：Cloud TTS Worker 修复 + 前端接入验证
3. Phase 6b：M-W 词典 API 通过 Worker 代理
4. Phase 7：学习功能开发（生词本 → FSRS 闪卡 → 测验）
5. 词典过滤优化：NGSL 当前用 `teaching.csv` 转换，可考虑直接使用 `stats.csv`（仅 lemma）

---

## 七、关键链接

| 链接 | 用途 |
|---|---|
| https://ferrari-serena.github.io/my-reader/ | 线上阅读器 |
| https://github.com/Ferrari-Serena/my-reader | 代码仓库 |
| https://my-reader-tts.serena605371358.workers.dev | Cloud TTS Worker |
| https://dash.cloudflare.com/ | Cloudflare 控制台 |
| https://dictionaryapi.com/ | Merriam-Webster API |
