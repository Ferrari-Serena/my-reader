/**
 * 划线笔记的读写与同步（第 9 步 9.1 / 9.2）。
 *
 * 存的就是记录通道的 note 记录（键 = 'note:<id>'）——「本地持久化」与「跨设备同步」
 * 是同一件事，跟 8.1 的设置同款；远程拉回来写进 recordStore 后 recordRevision 自增，
 * 这里 watch 到就重读（别的设备划的线会自己出现）。
 */
import { reactive, watch, effectScope } from 'vue'
import * as recordStore from '../sync/recordStore.js'
import { useSync } from './useSync.js'
import { normalizeNote, noteIdFromKey, toNotePayload } from '../utils/notes.js'

function loadAll() {
  const out = {}
  const all = recordStore.loadRecordsMap()
  for (const key of Object.keys(all)) {
    const id = noteIdFromKey(key)
    if (!id) continue
    const n = normalizeNote(id, all[key])
    if (n) out[n.id] = n
  }
  return out
}

const state = reactive({ notes: loadAll() })
let scope = null

export function useNotes() {
  if (!scope) {
    scope = effectScope(true)
    scope.run(() => {
      // 首次使用即对齐盘上现状：模块 import 时（state 初值）到这次调用之间，
      // 启动的自动拉取可能已经把远端笔记写进 recordStore —— 那时还没有 watcher，
      // 只 watch recordRevision 会漏掉这一批（书架/阅读页会显示「没有笔记」）。
      state.notes = loadAll()
      watch(useSync().recordRevision, () => { state.notes = loadAll() })
    })
  }
  return {
    count: () => Object.keys(state.notes).length,
    all: () => Object.values(state.notes),
    get: id => state.notes[id] || null,
    /** 某书某章的笔记（按段内位置排） */
    forChapter: (bookId, chapterId) => Object.values(state.notes)
      .filter(n => n.bookId === bookId && (!chapterId || n.chapterId === chapterId))
      .sort((a, b) => (a.paraId === b.paraId ? a.charStart - b.charStart : a.paraId < b.paraId ? -1 : 1)),
    /** 某本书的全部笔记（跨章，列表用） */
    forBook: bookId => Object.values(state.notes).filter(n => n.bookId === bookId),
    add(parts) {
      const rec = recordStore.putRecord('note', toNotePayload(parts))
      if (!rec) return null
      const n = normalizeNote(rec.id, rec.payload)
      if (!n) return null
      state.notes = { ...state.notes, [n.id]: n }
      return n
    },
    update(id, patch) {
      const cur = state.notes[id]
      if (!cur) return null
      const rec = recordStore.putRecord('note', toNotePayload({ ...cur, ...patch }), { id })
      if (!rec) return null
      const n = normalizeNote(rec.id, rec.payload)
      if (!n) return null
      state.notes = { ...state.notes, [n.id]: n }
      return n
    },
    remove(id) {
      if (!state.notes[id]) return false
      recordStore.removeRecord('note', id)
      const next = { ...state.notes }
      delete next[id]
      state.notes = next
      return true
    }
  }
}
