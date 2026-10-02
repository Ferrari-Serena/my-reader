/**
 * 词典表面形索引（纯函数，无 reactive）。
 *
 * 词典以词头（lemma）为键，但正文里点到的是屈折形（abandoned）。没有索引就只能
 * 走联网兜底（离线点不出来、也没有绿点线）。`surfaces` 由生成管线写出：该书正文里
 * 映射到这个词头的全部表面形（小写去重，含自身）。
 */

/** words（dictionary.json 的 words 主体）→ Map<表面形, 词条 key> */
export function buildDictAlias(words) {
  const alias = new Map()
  for (const [key, e] of Object.entries(words || {})) {
    const k = (key || '').toLowerCase()
    if (!k) continue
    const lem = (e?.lemma || '').toLowerCase()
    if (lem) alias.set(lem, k)
    for (const s of (Array.isArray(e?.surfaces) ? e.surfaces : [])) {
      const t = (s + '').toLowerCase()
      if (t) alias.set(t, k)
    }
  }
  return alias
}

/**
 * 把点击的表面形解析成词典里真正存在的 key；解析不出返回 null。
 * 索引里的 key 可能已被在线结果覆盖/删除，所以命中后仍在词典里复核一次。
 */
export function resolveDictKey(word, words, alias) {
  const w = (word || '').toLowerCase()
  if (!w || !words) return null
  if (words[w]) return w
  const k = alias && alias.get(w)
  return (k && words[k]) ? k : null
}

/** 生词条目的所有已知写法（词头 + 表面形）加进查找集合，供收藏态高亮 */
export function addEntryForms(set, entry) {
  const lem = (entry?.snapshot?.lemma || '').toLowerCase()
  if (lem) set.add(lem)
  const surfaces = entry?.snapshot?.surfaces
  if (Array.isArray(surfaces)) {
    for (const s of surfaces) {
      const t = (s + '').toLowerCase()
      if (t) set.add(t)
    }
  }
}
