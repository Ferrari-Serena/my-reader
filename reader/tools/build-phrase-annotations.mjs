#!/usr/bin/env node
/**
 * 离线词组消歧标注生成器。
 *
 * 目标：为内置书或 BYO 书预先算出「本句义」标注，前端点击时先查标注，
 * 未命中才回落 L1 cue；LLM/云端只用于生成期或最后兜底，不做运行时依赖。
 *
 * 用法（在 reader/ 目录下）：
 *   node tools/build-phrase-annotations.mjs --chapters public/books/dr-jekyll-and-mr-hyde/chapters.json
 *   node tools/build-phrase-annotations.mjs --epub ../uploads/Divergent.epub --only-chapter ch-25 --use-llm
 *
 * 默认只写 L1 高置信（unique）标注；加 --use-llm 后，zero/multi/fallback 交给本机
 * Ollama 批量判定。输出 `public/data/phrase-annotations/<bookId>.json`。
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname, basename, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { importBook } from '../src/import/index.js'
import {
  buildMatchIndex,
  scanParagraphText,
  sentenceForToken,
  resolvePhraseSense,
} from '../src/utils/phraseSolve.js'

const READER_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DEFAULT_OUT_DIR = join(READER_DIR, 'public', 'data', 'phrase-annotations')
const PHRASES_PATH = join(READER_DIR, 'public', 'data', 'phrases.json')

function arg(name, fallback = '') {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--')
    ? process.argv[i + 1]
    : fallback
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`)
}

function parseBookArgs() {
  return {
    chaptersPath: arg('chapters'),
    epubPath: arg('epub'),
    onlyChapter: arg('only-chapter'),
    useLlm: hasFlag('use-llm'),
    llmUrl: arg('llm-url', 'http://127.0.0.1:11434'),
    llmModel: arg('llm-model', 'qwen2.5-3b'),
    batchSize: Math.max(1, Number(arg('batch-size', '6')) || 6),
    maxItems: Math.max(0, Number(arg('max-items', '0')) || 0),
    outDir: arg('out-dir', DEFAULT_OUT_DIR),
  }
}

function readBookFromChapters(path) {
  const doc = JSON.parse(readFileSync(path, 'utf8'))
  const bookId = doc.bookId || basename(dirname(resolve(path)))
  return { bookId, chapters: doc.chapters || [] }
}

async function readBookFromEpub(path) {
  const bytes = readFileSync(path)
  const book = await importBook(
    { name: basename(path), bytes },
    { title: basename(path).replace(/\.[a-z0-9]+$/i, '') }
  )
  return { bookId: book.bookId, chapters: book.chapters || [] }
}

function collectWorkItems(book, phrases, matchIndex, maxPhraseWords, onlyChapter) {
  const items = []
  const l1Ready = []

  for (const chapter of book.chapters || []) {
    if (onlyChapter && chapter.id !== onlyChapter) continue
    for (const para of chapter.paragraphs || []) {
      if (!para.text) continue
      const spans = scanParagraphText(para.text, matchIndex, maxPhraseWords)
      for (const span of spans) {
        const entry = phrases[span.base]
        if (!entry?.senses?.length) continue
        const sentence = sentenceForToken(para.text, span.start)
        const resolution = resolvePhraseSense(entry, sentence)
        const record = {
          chapterId: chapter.id,
          paragraphId: para.id,
          start: span.start,
          end: span.end,
          phrase: span.base,
          sentence,
          senses: entry.senses,
          resolution,
        }
        if (resolution.state === 'unique') {
          l1Ready.push({
            chapterId: record.chapterId,
            paragraphId: record.paragraphId,
            start: record.start,
            end: record.end,
            phrase: record.phrase,
            rank: resolution.rank,
            source: 'l1',
          })
        } else {
          items.push(record)
        }
      }
    }
  }

  return { items, l1Ready }
}

function parseJsonFromText(text) {
  const s = String(text || '').trim()
  const start = s.indexOf('{')
  const end = s.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    return JSON.parse(s.slice(start, end + 1))
  } catch {
    return null
  }
}

async function callOllamaBatch(baseUrl, model, batch) {
  const prompt = [
    'Disambiguate phrasal verb senses in context. Return JSON only, shape:',
    '{"items":[{"i":0,"rank":1}, ...]}',
    'For each item, choose the single best rank from that item\'s senses. If none clearly fits, use rank:null.',
    'Items:',
    JSON.stringify(batch.map((item, i) => ({
      i,
      phrase: item.phrase,
      sentence: item.sentence,
      senses: item.senses.map(s => ({ rank: s.rank, zh: s.zh, en: s.en, pattern: s.pattern })),
    }))),
  ].join('\n')

  const res = await fetch(`${baseUrl.replace(/\/$/, '')}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model,
      stream: false,
      format: 'json',
      options: { temperature: 0 },
      messages: [{ role: 'user', content: prompt }],
    }),
  })
  if (!res.ok) {
    throw new Error(`Ollama ${res.status}: ${await res.text()}`)
  }
  const data = await res.json()
  const parsed = parseJsonFromText(data?.message?.content || data?.response)
  if (!parsed || !Array.isArray(parsed.items)) {
    throw new Error('Ollama response is not in expected JSON shape')
  }
  return parsed.items
}

async function resolveWithLlm(records, options) {
  const resolved = []
  const batch = []
  const pushBatch = async () => {
    if (!batch.length) return
    const current = batch.splice(0, options.batchSize)
    const answers = await callOllamaBatch(options.llmUrl, options.llmModel, current)
    for (const ans of answers || []) {
      const record = current[ans.i]
      if (!record) continue
      const rank = Number(ans.rank)
      if (Number.isInteger(rank) && record.senses.some(s => s.rank === rank)) {
        resolved.push({
          chapterId: record.chapterId,
          paragraphId: record.paragraphId,
          start: record.start,
          end: record.end,
          phrase: record.phrase,
          rank,
          source: 'llm',
        })
      }
    }
  }

  for (const record of records) {
    batch.push(record)
    if (batch.length >= options.batchSize) await pushBatch()
  }
  await pushBatch()
  return resolved
}

async function main() {
  const options = parseBookArgs()
  if (!options.chaptersPath && !options.epubPath) {
    console.error('需要 --chapters <path> 或 --epub <path>')
    process.exit(1)
  }

  const book = options.epubPath
    ? await readBookFromEpub(options.epubPath)
    : readBookFromChapters(options.chaptersPath)

  const phrases = JSON.parse(readFileSync(PHRASES_PATH, 'utf8'))
  const { matchIndex, maxPhraseWords } = buildMatchIndex(phrases)
  const { items, l1Ready } = collectWorkItems(book, phrases, matchIndex, maxPhraseWords, options.onlyChapter)

  let llmReady = []
  if (options.useLlm && items.length) {
    const limited = options.maxItems > 0 ? items.slice(0, options.maxItems) : items
    console.log(`[llm] ${limited.length}/${items.length} unresolved items -> ${options.llmModel}`)
    llmReady = await resolveWithLlm(limited, options)
  }

  const annotations = l1Ready.concat(llmReady)
  const payload = {
    version: 1,
    bookId: book.bookId,
    generatedAt: new Date().toISOString(),
    engine: options.useLlm ? `l1-unique + ${options.llmModel}` : 'l1-unique',
    scope: options.onlyChapter ? `chapter:${options.onlyChapter}` : 'all-chapters',
    counts: {
      total: annotations.length,
      l1: l1Ready.length,
      llm: llmReady.length,
      unresolved: options.useLlm ? Math.max(0, items.length - llmReady.length) : items.length,
    },
    annotations,
  }

  mkdirSync(options.outDir, { recursive: true })
  const outPath = join(options.outDir, `${book.bookId}.json`)
  writeFileSync(outPath, JSON.stringify(payload, null, 2), 'utf8')
  console.log(`[done] ${outPath}`)
  console.log(`[counts] total=${payload.counts.total} l1=${payload.counts.l1} llm=${payload.counts.llm} unresolved=${payload.counts.unresolved}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
