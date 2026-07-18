# my-reader — 英语阅读+词汇深度学习工具

> v1.0 · 2026-07-18 · `www.ferrari11.com`

## 功能

- 📖 **分章节阅读** 带 Kokoro TTS 逐章音频 + 段落定位播放
- 🔍 **点击查词** ECDICT 本地中文释义 + M-W 英文兜底
- 📝 **生词本** 收藏/搜索/筛选/导出导入 + 跨设备同步
- 🔄 **FSRS 闪卡** 间隔复习 + 背面拼写默写
- ✅ **测验** 句子语境填空 + 选择题 + 错题重练 + SAT 专项 + 词组测试
- 📗 **词组高亮** 阅读页收藏词所在词组整体标记

## 当前有 2 本书

- **The Giver**（25章，含 23 章 Kokoro 音频 ~95MB）
- **SAT Practice**（4,437 词，5,988 真实例句）

## 部署

GitHub Pages (`www.ferrari11.com`) + Cloudflare Worker（词典 + 同步 API）+ D1 数据库

## 本地工具

```
D:/PythonEnv/abogen-venv/Scripts/python.exe generator/app.py
→ http://127.0.0.1:5174
```

加新书、回填词典、生成 TTS 均通过此工具。

## 完整文档

[my-reader v1.0（含产品化衔接、数据管线速查、环境依赖）](https://github.com/Ferrari-Serena/my-reader/blob/main/README.md)
