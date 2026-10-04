# backup.json — 最小导出数据契约（第 0 步 · 0.6）

用户在生词本页面一键导出的**本机全量备份**，由 `reader/src/utils/exportBundle.js`（形状/校验）与
`reader/src/composables/useVocabulary.js` 的 `exportBackup()` / `importBackup(file)`（落盘）产出与消费。
用途：域名迁移前备份（见 Obsidian `2-活动项目/my-reader/域名迁移-操作方案` §1 硬前置）、换机迁移、误删恢复。

## Schema

```json
{
  "app": "my-reader",
  "type": "my-reader-backup",
  "exportVersion": 1,
  "exportedAt": "ISO-8601 string",
  "data": {
    "vocabulary": {
      "version": 1,
      "updatedAt": "ISO-8601 string",
      "words": { "<lemma>": { "...WordEntry, 见 storage/schema.js..." } }
    },
    "tombstones": { "<lemma>": "ISO-8601 — 删除时刻" },
    "dirty": ["lemma — 导出时还没推出去的脏词"],
    "progress": {
      "reading:<bookId>": { "chapterId": "string", "paragraphIndex": 0, "updatedAt": "ISO-8601" },
      "audio:<bookId>/<chapterId>": { "seconds": 0, "updatedAt": "ISO-8601" }
    }
  }
}
```

## 收录范围

| 数据 | 落在哪 | 说明 |
|---|---|---|
| 生词 | `data.vocabulary.words` | 含 `quiz`（**错题池**）与 `srs`（FSRS）槽位 —— 错题没有独立存储键 |
| 删除台账 | `data.tombstones` | 未推出去的删除，回导后并入本地、下次推送发出 |
| 待推脏词 | `data.dirty` | 导出瞬间尚未成功推送的词 |
| 阅读 / 音频进度 | `data.progress` | 键由 `sync/progress.js` 唯一给出，**全量不截断**（推送窗口的 300 条上限不适用于备份） |

**未收录（目前本机根本没有独立存储键，不是遗漏）**：
- 笔记 —— 产品尚未实现笔记存储；
- 设置 —— 字号等设置尚未实现，唯一像「设置」的 `reader-sync-code`（同步码）**故意不导出**：
  它是配对凭据，写进可下载文件等于外泄读写权限；迁移时按 §1 手抄即可（是否纳入留待裁）。

## 导入（回导）口径

- **版本闸**：`type` 必须等于 `my-reader-backup`；`exportVersion` 高于本机支持的版本**一律拒收**，不降级。
- **词表闸**：`data.vocabulary` 过 `storage/schema.js` 的 `migrate()`，未知版本拒收。
- **合并**：与「跨设备拉取」同一条 `planMerge` 链（`useSync.mergeAndApply`）——
  - 生词 LWW；本地已存在且更新的一律保留，回导不覆盖更晚的学习记录；
  - 备份里仍生效的删除**并入**本地台账（下次推送发出去），但**绝不删除本地已有的墓碑**；
  - 进度 LWW 写回同名 `localStorage` 键。
- 回导进来的词会标脏推一次；备份自带的 `dirty` 一并标记。
- 文件上限 10 MB（`MAX_BACKUP_BYTES`）。
- 严拒原型污染：`__proto__` / `constructor` / `prototype` 作词键、墓碑键、进度键一律丢弃。

## 边界

- 文件名：`my-reader-backup-<YYYY-MM-DD>.json`。
- `exportJSON()` / `importJSON()`（`type: "vocabulary"`，只含生词）是**旧的最小导出**，仍在代码里与测试中，
  但 UI 菜单已经统一走 `Export Backup` / `Import Backup` 这条备份链。
