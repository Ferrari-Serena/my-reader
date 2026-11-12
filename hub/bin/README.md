# hub/bin · W11 本地音频生成链

这两个脚本运行在 hub 主机（沙箱外），不是浏览器端代码。

## 依赖与环境

| 项 | 默认位置 | 覆盖变量 |
|---|---|---|
| 脚本运行目录 | `~/hub/bin` | — |
| Node 依赖 | `~/hub/bin/node_modules -> ~/hub/library/fw/.repos/my-reader-deps/reader/node_modules` | — |
| my-reader 代码（lib 导入） | `~/hub/library/fw/my-reader` | `MY_READER_REPO` |
| Kokoro 模型 | `~/hub/models/kokoro-82m/onnx-community/Kokoro-82M-v1.0-ONNX` | `KOKORO_MODEL_ROOT` |
| 输入 | `~/hub/_scratch/campaigns/<campaignId>/input/book.json` | `HUB_SCRATCH` |
| 输出（本地 `_archive`） | `~/hub/_archive/audio-campaigns/<campaignId>/<bookId>/` | `HUB_AUDIO_ARCHIVE` |

## 脚本

### `hub-audio-fetch.mjs`（W11-2a）

用 Worker 现签的短时 R2 读凭据取 `books/<code>/<bookId>.json`，落 `input/book.json`；`--delete-after` 用完即删。hub 对 Cloudflare CDN 有 SNI 阻断，脚本固定走 `curl + HTTP/1.1`，并经 `127.0.0.1:7890` 代理重试。

### `hub-audio-campaign.mjs`（W11-2b）

```bash
node hub-audio-campaign.mjs --campaign <id> [--input <book.json>] [--voice am_michael|af_heart] \
  [--max-chapters 60] [--fail-chapter ch-03] [--delete-input] [--out-root <dir>]
```

- 60 章硬上限；断点续跑按 `sha256` 跳过；单章 3 次重试。
- 产物：`manifest.json` / `result.json` / `stats.json` / `ch-*.mp3` / `ch-*.timings.json`。
- `result.json.outputs[].path` 相对 `outDir`；`outDir` 在 `result.json` 与 `stats.json` 中给出。
- 不接 R2、不写索引、不打印正文。
- `--fail-chapter` 只用于验收（C3）；`--delete-input` 按设计 §12.4a 清掉输入。

## 部署

```bash
# 在 hub 上
cp hub/bin/hub-audio-{fetch,campaign}.mjs ~/hub/bin/
chmod +x ~/hub/bin/hub-audio-*.mjs
ln -sfn ~/hub/library/fw/.repos/my-reader-deps/reader/node_modules ~/hub/bin/node_modules
# 模型
mv ~/hub/_scratch/kokoro-spike/models ~/hub/models/kokoro-82m
```
