/**
 * keepalive 请求体的字节预算。
 *
 * 浏览器对 keepalive 请求体的总量上限是 64 KiB，超了不是截断而是**整条丢弃**：
 * 页面卸载时那次「最后一次保存」的推送会静默消失。所以载荷必须先裁到预算内再发。
 *
 * 裁剪顺序 = 谁漏传的代价大谁优先：
 *   ① 脏词 —— 用户刚改的东西，漏传等于这次编辑要等到下一次推送才上云。
 *      （0.1 起脏集合已持久化、且推送成功才落账，被裁掉的词下次会自动补上。）
 *   ② 墓碑 —— 台账在 localStorage，推送成功才清；漏了下次自动重推。
 *   ③ 进度 —— 每次都全量采集，漏了下次自然带上。
 * 后两类自愈得更快（台账/进度每次全量采集），所以优先裁它们。
 * 每一类内部按时间戳倒序：最近动过的先上，久未触碰的下次再说。
 */

export const KEEPALIVE_BODY_LIMIT = 60000 // 留 ~4 KB 给信封、逗号与估算误差

const encoder = new TextEncoder()

/** UTF-8 字节数（不用 String.length：那是 UTF-16 码元数，中文会少算一半） */
export function utf8Bytes(s) {
  return encoder.encode(s).length
}

/** 一条条目在 JSON 里的成本（含它后面的逗号：多算一点总比少算安全） */
function entryCost(key, value) {
  return utf8Bytes(JSON.stringify([key, value])) + 1
}

/** 按时间戳倒序；无时间戳的排最后 */
function byRecency(map) {
  return Object.entries(map)
    .map(([k, v]) => {
      const ts = v && typeof v === 'object' ? v.updatedAt : v
      return [k, v, typeof ts === 'string' ? ts : '']
    })
    .sort((a, b) => (a[2] < b[2] ? 1 : a[2] > b[2] ? -1 : 0))
}

/**
 * 把 /push 与 /progress 两个 keepalive 请求体一起裁到预算内。
 * 只裁子集，不改语义：每一类在本地都还在，下次推送自会补上。
 *
 * @param {object} parts { words, tombstones, progress }
 * @returns {{words: object, tombstones: object, progress: object, droppedWords: string[]}}
 */
export function budgetKeepaliveParts({ words = {}, tombstones = {}, progress = {} } = {},
                                      limit = KEEPALIVE_BODY_LIMIT) {
  // 两个请求各自的最小信封：它们无论如何都要占用 64 KiB
  // （D16 起 /push 与 /progress 的请求体都不再带 code —— 租户由服务端按会话反推）
  const envelope = utf8Bytes(JSON.stringify({ words: {}, tombstones: {} }))
    + utf8Bytes(JSON.stringify({ entries: {} }))

  const out = { words: {}, tombstones: {}, progress: {}, droppedWords: [] }
  let budget = limit - envelope

  const fill = (map, sink, onDrop) => {
    for (const [k, v] of byRecency(map)) {
      const cost = entryCost(k, v)
      if (cost > budget) { if (onDrop) onDrop(k); continue }
      budget -= cost
      sink[k] = v
    }
  }

  fill(words, out.words, k => out.droppedWords.push(k))
  fill(tombstones, out.tombstones, null)
  fill(progress, out.progress, null)

  return out
}
