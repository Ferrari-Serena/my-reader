/**
 * 邮件发送（Resend HTTP API）
 *
 * 只做一件事：把一封邮件交给 Resend。密钥走 env.RESEND_API_KEY（wrangler secret，不进代码）。
 *   POST https://api.resend.com/emails  →  { id }
 *
 * 为什么自己 fetch 而不用 SDK：Worker 里零依赖最省事，REST 就一个 JSON 体。
 *
 * 失败姿态（**与限流表相反**）：这里是 fail-closed。
 *   发不出去就是没发出去 —— 调用方必须如实告诉用户，不能假装成功让人干等一封信。
 *   （限流表是 fail-open：计数挂了宁可少挡，别把正常功能打停。）
 *
 * 密钥缺失 / 网络错 / Resend 报错：一律返回 { ok: false, ... }，**不抛**。
 */

const RESEND_ENDPOINT = 'https://api.resend.com/emails'

/** 默认发件人：必须在已 verified 的域下（send.ferrari11.com）。可用 env.MAIL_FROM 覆盖。 */
export const DEFAULT_FROM = 'my-reader <no-reply@send.ferrari11.com>'

/** 站点地址：邮件里的链接用它拼；本地/预览可用 env.SITE_URL 覆盖 */
export const DEFAULT_SITE = 'https://my-reader.ferrari11.com'

export function mailFrom(env = {}) {
  const v = env && env.MAIL_FROM
  return (v && String(v).trim()) || DEFAULT_FROM
}

export function siteUrl(env = {}) {
  const v = env && env.SITE_URL
  return ((v && String(v).trim()) || DEFAULT_SITE).replace(/\/+$/, '')
}

/**
 * 发一封 HTML 邮件。
 * 返回 { ok: true, id } 或 { ok: false, status, detail }。
 */
export async function sendMail(env, { to, subject, html, text }) {
  const key = ((env && env.RESEND_API_KEY) || '').trim()
  if (!key) return { ok: false, status: 0, detail: 'RESEND_API_KEY missing' }

  const body = { from: mailFrom(env), to: [to], subject, html }
  if (text) body.text = text

  try {
    const res = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const txt = await res.text()
    if (!res.ok) {
      // 常见原因：域未 verified / from 不在域下 / 超日限（100 封/天）
      console.error('resend failed:', res.status, txt.slice(0, 300))
      return { ok: false, status: res.status, detail: txt.slice(0, 300) }
    }
    let id = ''
    try { id = (JSON.parse(txt) || {}).id || '' } catch { /* 非 JSON 就当没有 id */ }
    return { ok: true, id }
  } catch (e) {
    console.error('resend error:', e.message)
    return { ok: false, status: 0, detail: e.message }
  }
}

/**
 * 验证信正文。
 * ⚠️ link 只由「本站固定地址 + 我们自己生成的 base64url 令牌」拼成，不含用户输入
 *    → 直接插进 HTML 没有转义问题；将来若要拼用户可控内容，先加转义。
 * 不含追踪像素（不为测量牺牲内容）。
 */
export function verifyEmailContent({ link, site, validHours = 24 }) {
  const subject = 'my-reader · 验证你的邮箱'
  const text = [
    '你好，',
    '',
    '点开下面这条链接，就能验证这个邮箱并开始使用 my-reader：',
    link,
    '',
    `链接 ${validHours} 小时内有效，只能用一次。`,
    '如果这不是你本人操作，忽略这封邮件即可，我们不会做任何事。',
    '',
    `my-reader · ${site}`,
  ].join('\n')

  const html = `<!doctype html>
<html lang="zh-CN"><body style="font-family:system-ui,-apple-system,'Segoe UI',sans-serif;line-height:1.7;color:#222;max-width:560px">
  <p>你好，</p>
  <p>点下面这个按钮，就能验证这个邮箱并开始使用 my-reader：</p>
  <p><a href="${link}" style="display:inline-block;padding:10px 18px;background:#1a73e8;color:#ffffff;border-radius:6px;text-decoration:none">验证邮箱</a></p>
  <p>链接 <strong>${validHours} 小时</strong>内有效，只能用一次。<br>
     按钮点不开，就把下面这条地址粘到浏览器里：<br>
     <span style="color:#555555;word-break:break-all">${link}</span></p>
  <p style="color:#777777">如果这不是你本人操作，忽略这封邮件即可，我们不会做任何事。</p>
  <p style="color:#777777">my-reader · ${site}</p>
</body></html>`

  return { subject, text, html }
}
