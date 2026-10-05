/**
 * 阅读设置的读写与同步（第 8 步 8.1）。
 *
 * 存储层直接用记录通道的 setting 记录（键 = 'setting:s_reader'），于是
 * 「本地持久化」与「跨设备同步」是同一件事 —— 不必再另开一个 localStorage 键
 * 让两份数据互相打架；记录通道本来就为「设置」留了 kind（worker/src/sync.js）。
 *
 * 远程把设置改掉（另一台设备）后，recordStore 被写新值，useSync 的 recordRevision 自增，
 * 这里 watch 到就重读 —— 已打开的阅读页当场跟着变，不用重开。
 *
 * 本机没配对同步码时，putRecord 只写本机并标脏；一旦配对，脏记录会被推上去。
 */
import { reactive, computed, watch, effectScope } from 'vue'
import * as recordStore from '../sync/recordStore.js'
import { useSync } from './useSync.js'
import { fromRecordValue, toRecordValue, toCssVars, withSetting, READER_SETTING_KEY, READER_SETTING_RECORD_ID } from '../utils/readerSettings.js'

const RECORD_KEY = 'setting:' + READER_SETTING_RECORD_ID

function readStored() {
  const rec = recordStore.loadRecordsMap()[RECORD_KEY]
  return fromRecordValue(rec && rec.value)
}

const state = reactive({ settings: readStored() })

function persist(next) {
  state.settings = next
  recordStore.putRecord(
    'setting',
    { key: READER_SETTING_KEY, value: toRecordValue(next) },
    { id: READER_SETTING_RECORD_ID }
  )
}

// 分离式 effectScope：watcher 不挂在某个组件上，组件反复挂载/卸载也只注册一次。
// 首次调用 useReaderSettings() 时才建 —— 避免 import 本模块就触发 useSync 的自动拉取。
let scope = null

export function useReaderSettings() {
  if (!scope) {
    scope = effectScope(true)
    scope.run(() => {
      // 首次使用即对齐盘上现状：模块 import 时（state 初值）到这次调用之间，
      // 启动的自动拉取可能已经把远端设置写进 recordStore —— 那时还没有 watcher，
      // 只 watch recordRevision 会漏掉它（阅读页会沿用本机旧档）。
      state.settings = readStored()
      watch(useSync().recordRevision, () => { state.settings = readStored() })
    })
  }
  return {
    settings: computed(() => state.settings),
    cssVars: computed(() => toCssVars(state.settings)),
    set: (key, value) => persist(withSetting(state.settings, key, value)),
    reset: () => persist(fromRecordValue(null)),
  }
}
