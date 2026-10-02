/**
 * 时钟校正（有状态包装）。
 *
 * 为什么需要：服务端按时间戳判新旧（last-write-wins）。客户端时钟慢 1 小时的设备，
 * 它的**真实新编辑**会被服务端判为不占优而拒收——原来的 bug 是「错的值赢了」，
 * 不校正的话就会变成「对的值被无声抹掉」，那更糟。
 *
 * 做法：每次同步从响应里读 serverNow，求出与本地时钟的偏移，此后本地打的时间戳
 * 都加上这个偏移。纯计算在 merge.js 里（可单测），这里只持有那个偏移量。
 *
 * 单独成一个模块是为了打断循环导入：useVocabulary 要打时间戳，
 * 而 useSync 反过来要 import useVocabulary。本模块谁都不依赖。
 */

import { computeClockOffset, adjustedNowIso } from './merge.js'

let _offset = 0

/** 用服务端时间校准本地时钟；返回新的偏移量（毫秒） */
export function syncClock(serverNow, localNowMs = Date.now()) {
  _offset = computeClockOffset(serverNow, localNowMs)
  return _offset
}

export function getClockOffset() {
  return _offset
}

/** 校正后的当前时刻，统一 ISO 毫秒精度——精度一致，字符串比较才可靠 */
export function nowIso() {
  return adjustedNowIso(_offset, Date.now())
}
