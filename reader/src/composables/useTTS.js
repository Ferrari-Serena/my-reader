/**
 * useTTS — 共享单词级 TTS
 *
 * 浏览器 SpeechSynthesis 优先（cancel + resume timer + 超时哨兵），
 * 静默失败或语音不可用时自动降级到有道 dictvoice（国内可达）。
 *
 * 用法：
 *   const tts = useTTS()
 *   tts.speak('hello')
 */

const YDY_BASE = 'https://dict.youdao.com/dictvoice'
const RESUME_MS = 200
const SENTINEL_MS = 1500

// 浏览器语音就绪检测（getVoices 可能异步填充）
let voicesReady = false
let voicesReadyPromise = null

function ensureVoices() {
  if (voicesReady) return Promise.resolve(true)
  if (!('speechSynthesis' in window)) return Promise.resolve(false)

  const voices = speechSynthesis.getVoices()
  if (voices.length > 0) {
    voicesReady = true
    return Promise.resolve(true)
  }

  // 首次调用，语音尚未加载——等待 voiceschanged 事件
  if (!voicesReadyPromise) {
    voicesReadyPromise = new Promise((resolve) => {
      const onChanged = () => {
        voicesReady = true
        speechSynthesis.removeEventListener('voiceschanged', onChanged)
        resolve(true)
      }
      speechSynthesis.addEventListener('voiceschanged', onChanged)
      // 安全网：3s 后无论如何 resolve
      setTimeout(() => {
        if (!voicesReady) {
          speechSynthesis.removeEventListener('voiceschanged', onChanged)
          voicesReady = true // 标记为已尝试过，不再重复等待
        }
        resolve(true)
      }, 3000)
    })
  }
  return voicesReadyPromise
}

function hasEnglishVoice() {
  if (!('speechSynthesis' in window)) return false
  return speechSynthesis.getVoices().some(v => v.lang.startsWith('en'))
}

function speakOnline(word) {
  try {
    const audio = new Audio(`${YDY_BASE}?audio=${encodeURIComponent(word)}&type=0`)
    // 播放失败静默忽略（两种方案都不可用）
    audio.play().catch(() => {})
  } catch {
    // 极端情况：Audio 构造失败
  }
}

// ---- 模块级状态：防快速连续调用竞态 + 与 AudioPlayer 共存 ----

let sessionId = 0   // 每次 speak() 递增，回调中比对防止过期操作
let _active = false // 当前是否有 useTTS 的 utterance 在播放

export function useTTS() {
  /**
   * 朗读单个单词（同步执行以保持 Chrome 用户手势链）
   * @param {string} word  要朗读的词
   * @param {object} [opts]
   * @param {string} [opts.lang='en-US']
   * @param {number} [opts.rate=0.9]
   */
  function speak(word, opts = {}) {
    if (!word) return
    const { lang = 'en-US', rate = 0.9 } = opts

    // 语音尚未就绪 → 等待后重试（仅页面首次加载时触发）
    if (!voicesReady && ('speechSynthesis' in window)) {
      ensureVoices().then(() => speak(word, opts))
      return
    }

    // 无浏览器 TTS 或无英文语音 → 直接走有道
    if (!('speechSynthesis' in window) || !hasEnglishVoice()) {
      speakOnline(word)
      return
    }

    // ---- 浏览器 TTS（主路径，自此全部同步）----
    const mySid = ++sessionId

    // 决定是否 cancel：
    // - 自己的旧 utterance 还在播 → cancel，换上新的
    // - 没有任何东西在播 → cancel 重置 Chrome 空闲超时后的僵死引擎（safe: 无物可打断）
    // - AudioPlayer 等外部源在播 → 不 cancel，避免打断章节朗读
    const extSpeaking = speechSynthesis.speaking || speechSynthesis.pending
    if (_active || !extSpeaking) {
      speechSynthesis.cancel()
      _active = false
    }

    let resolved = false
    let resumeTimer = null
    let sentinelTimer = null

    function cleanup() {
      if (resumeTimer) { clearInterval(resumeTimer); resumeTimer = null }
      if (sentinelTimer) { clearTimeout(sentinelTimer); sentinelTimer = null }
    }

    function fallback() {
      if (resolved || mySid !== sessionId) return
      resolved = true
      _active = false
      cleanup()
      try { speechSynthesis.cancel() } catch { /* ignore */ }
      speakOnline(word)
    }

    const utt = new SpeechSynthesisUtterance(word)
    utt.lang = lang
    utt.rate = rate

    utt.onstart = () => {
      if (mySid !== sessionId) return
      _active = true
      // 启动 resume 定时器：Chrome 在长静默后会暂停引擎
      resumeTimer = setInterval(() => {
        try {
          if (speechSynthesis.paused) speechSynthesis.resume()
        } catch { /* ignore */ }
      }, RESUME_MS)
    }

    utt.onend = () => {
      if (mySid !== sessionId) return
      resolved = true
      _active = false
      cleanup()
    }

    utt.onerror = (e) => {
      if (mySid !== sessionId) return
      // canceled/interrupted 是正常操作（用户点其他词、切章等），不算失败
      if (e.error === 'canceled' || e.error === 'interrupted') {
        resolved = true
        _active = false
        cleanup()
        return
      }
      // 真正的错误 → 降级有道
      fallback()
    }

    speechSynthesis.speak(utt)

    // 超时哨兵：onstart 在 SENTINEL_MS 内不触发则降级
    sentinelTimer = setTimeout(() => {
      if (mySid !== sessionId) return
      if (!resolved) fallback()
    }, SENTINEL_MS)
  }

  return { speak }
}
