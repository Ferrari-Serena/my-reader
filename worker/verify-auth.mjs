/**
 * auth.js 纯逻辑验证（不碰网络、不碰 D1，node 内置 crypto 即可）
 * 用法: node verify-auth.mjs
 *
 * 重点不是「函数能跑」，而是三件容易写错的事：
 *   ① base64url 的字节序/填充不能自创 —— 用 Node 的 Buffer.toString('base64url') 交叉验证
 *   ② tokenHash 的输入必须是「原文的 UTF-8 字节」，错一个字符整条会话就查不到
 *   ③ 会话判据必须在「绝对上限」处收口（30 天滚动不能把 180 天的顶撞穿）
 */

import * as A from './src/auth.js'

let pass = 0, fail = 0
function t(name, cond) {
  if (cond) { pass++; console.log(`  ok ${name}`) }
  else { fail++; console.log(`  FAIL ${name}`) }
}

console.log('\n[auth.js — normalizeEmail]')
t('去空白 + 转小写', A.normalizeEmail('  Ferrari@QQ.com ') === 'ferrari@qq.com')
t('已经是归一形态则原样返回', A.normalizeEmail('a@b.co') === 'a@b.co')
t('非字符串 -> null', A.normalizeEmail(null) === null && A.normalizeEmail(42) === null)
t('空串 -> null', A.normalizeEmail('') === null && A.normalizeEmail('   ') === null)
t('无点域名 -> null（a@b）', A.normalizeEmail('a@b') === null)
t('带空格 -> null', A.normalizeEmail('a b@c.com') === null)
t('两个 @ -> null', A.normalizeEmail('a@@b.com') === null)
t('超长（>254）-> null', A.normalizeEmail('x'.repeat(250) + '@a.com') === null)
t('恰好 254 边界内可用', A.normalizeEmail('x'.repeat(246) + '@a.com') !== null)

console.log('\n[auth.js — bytesToBase64url（与 Node 交叉验证）]')
{
  let same = true
  for (let i = 0; i < 200; i++) {
    const b = new Uint8Array(1 + (i % 33))
    crypto.getRandomValues(b)
    if (A.bytesToBase64url(b) !== Buffer.from(b).toString('base64url')) { same = false; break }
  }
  t('200 组随机字节与 Buffer.toString("base64url") 完全一致', same)
  t('已知向量：61 62 63 -> YWJj', A.bytesToBase64url(new Uint8Array([0x61, 0x62, 0x63])) === 'YWJj')
  t('已知向量：fb ff -> -_8（无填充、+/ 换 -_）', A.bytesToBase64url(new Uint8Array([0xfb, 0xff])) === '-_8')
  t('无 "=" 填充', !A.bytesToBase64url(new Uint8Array([0x61])).includes('='))
}

console.log('\n[auth.js — newToken]')
{
  const a = A.newToken(), b = A.newToken()
  t('默认 32 字节 -> 43 字符 base64url', a.length === 43)
  t('只含 base64url 字符集', /^[A-Za-z0-9_-]+$/.test(a))
  t('两次调用不相同', a !== b)
  t('16 字节 -> 22 字符', A.newToken(16).length === 22)
  const seen = new Set()
  for (let i = 0; i < 500; i++) seen.add(A.newToken(8))
  t('500 次 8 字节无碰撞', seen.size === 500)
}

console.log('\n[auth.js — tokenHash / toHex]')
{
  t('sha256("abc") 已知向量', await A.tokenHash('abc') ===
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  t('非 ASCII 走 UTF-8 字节（中文不炸）', (await A.tokenHash('中文')).length === 64)
  t('toHex 补零（0x00 0x0f -> 000f）', A.toHex(new Uint8Array([0x00, 0x0f])) === '000f')
  t('同一输入稳定同值', (await A.tokenHash('x')) === (await A.tokenHash('x')))
}

console.log('\n[auth.js — timingSafeEqual]')
t('相同 -> true', A.timingSafeEqual('abcd', 'abcd') === true)
t('不同字 -> false', A.timingSafeEqual('abcd', 'abce') === false)
t('长度不同 -> false', A.timingSafeEqual('abcd', 'abcde') === false)
t('非字符串 -> false', A.timingSafeEqual(null, 'a') === false && A.timingSafeEqual('a', 1) === false)
t('空串相等 -> true', A.timingSafeEqual('', '') === true)

console.log('\n[auth.js — sessionState（C 块单一判据）]')
{
  const NOW = Date.UTC(2026, 9, 4, 12, 0, 0)
  const mk = (createdOffsetDays, expiresOffsetDays) => ({
    created_at: NOW - createdOffsetDays * 86400000,
    expires_at: NOW + expiresOffsetDays * 86400000,
  })
  t('刚建的会话 -> ok', A.sessionState(mk(0, 30), NOW) === 'ok')
  t('滚动窗口已过 -> expired', A.sessionState(mk(40, -1), NOW) === 'expired')
  t('越过 180 天绝对上限 -> absolute', A.sessionState(mk(181, 30), NOW) === 'absolute')
  t('刚好 180 天（未越）-> ok', A.sessionState(mk(180, 1), NOW) === 'ok')
  t('缺字段（坏数据）-> unknown', A.sessionState(null, NOW) === 'unknown'
    && A.sessionState({ created_at: 1 }, NOW) === 'unknown')
  t('口径常量：滚动 30 天 / 绝对 180 天', A.SESSION_ROLLING_MS === 30 * 86400000
    && A.SESSION_ABSOLUTE_MS === 180 * 86400000)
  t('令牌有效期：验证 24h / 重置 1h', A.VERIFY_TOKEN_MS === 86400000 && A.RESET_TOKEN_MS === 3600000)
}

console.log('\n[auth.js — rollSession（续期不能撞穿绝对上限）]')
{
  const NOW = Date.UTC(2026, 9, 4, 12, 0, 0)
  const fresh = { created_at: NOW - 86400000, expires_at: NOW + 86400000 }
  const r = A.rollSession(fresh, NOW)
  t('有效会话续到 now + 30 天', r && r.expires_at === NOW + A.SESSION_ROLLING_MS && r.last_seen_at === NOW)

  const nearCap = { created_at: NOW - 179 * 86400000, expires_at: NOW + 86400000 }
  const r2 = A.rollSession(nearCap, NOW)
  t('贴近绝对上限时被顶上（不越 180 天）', r2 && r2.expires_at === nearCap.created_at + A.SESSION_ABSOLUTE_MS)
  t('且确实小于 now + 30 天', r2.expires_at < NOW + A.SESSION_ROLLING_MS)

  t('已过期 -> null（不续）', A.rollSession({ created_at: NOW - 86400000, expires_at: NOW - 1 }, NOW) === null)
  t('越过绝对上限 -> null', A.rollSession({ created_at: NOW - 181 * 86400000, expires_at: NOW + 86400000 }, NOW) === null)
  t('坏数据 -> null', A.rollSession({}, NOW) === null)
}

console.log('\n[auth.js — cookie 属性]')
{
  const c = A.sessionCookie('TOK', 2592000)
  t('带 httpOnly', c.includes('HttpOnly'))
  t('带 Secure', c.includes('Secure'))
  t('SameSite=Lax', c.includes('SameSite=Lax'))
  t('Path=/', c.includes('Path=/'))
  t('Max-Age 正确', c.includes('Max-Age=2592000'))
  t('名 = mr_session', c.startsWith('mr_session=TOK'))
  const d = A.clearSessionCookie()
  t('清除 cookie：同名 + Max-Age=0', d.startsWith('mr_session=;') && d.includes('Max-Age=0'))
  t('清除时属性不缩水', d.includes('HttpOnly') && d.includes('Secure') && d.includes('SameSite=Lax'))
}

// ─── 密码段（PBKDF2）───
// 默认 100000 圈（生产口径）只算一次，供多组断言复用；低圈数串走快速路径，
// 只验证「互逆/解析」这些与成本无关的性质。
const PW_PLAIN = 'correct horse battery staple'
const PW_STORED = await A.hashPassword(PW_PLAIN)
const PW_STORED2 = await A.hashPassword(PW_PLAIN)
const PW_CHEAP = await A.hashPassword(PW_PLAIN, { iterations: 1000 })

console.log('\n[auth.js — base64urlToBytes（与 bytesToBase64url 互逆）]')
{
  let same = true
  for (let i = 0; i < 100; i++) {
    const b = new Uint8Array(1 + (i % 33))
    crypto.getRandomValues(b)
    const back = A.base64urlToBytes(A.bytesToBase64url(b))
    if (!back || back.length !== b.length || !A.timingSafeEqualBytes(back, b)) { same = false; break }
  }
  t('100 组随机字节往返一致', same)
  const v = A.base64urlToBytes('YWJj')
  t('已知向量 YWJj -> 61 62 63', !!v && v.length === 3 && v[0] === 0x61 && v[1] === 0x62 && v[2] === 0x63)
  t('非法字符（+ / =）-> null', A.base64urlToBytes('ab+cd') === null && A.base64urlToBytes('ab/cd') === null && A.base64urlToBytes('ab=cd') === null)
  t('空串 / 非字符串 -> null', A.base64urlToBytes('') === null && A.base64urlToBytes(null) === null && A.base64urlToBytes(123) === null)
}

console.log('\n[auth.js — timingSafeEqualBytes]')
t('相同 -> true', A.timingSafeEqualBytes(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 3])) === true)
t('不同字节 -> false', A.timingSafeEqualBytes(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 4])) === false)
t('长度不同 -> false', A.timingSafeEqualBytes(new Uint8Array([1, 2]), new Uint8Array([1, 2, 3])) === false)
t('非 Uint8Array -> false', A.timingSafeEqualBytes([1, 2, 3], new Uint8Array([1, 2, 3])) === false && A.timingSafeEqualBytes(null, null) === false)

console.log('\n[auth.js — hashPassword（默认生产口径）]')
{
  const parts = PW_STORED.split('$')
  t('格式 4 段：algo$圈数$盐$哈希', parts.length === 4 && parts[0] === 'pbkdf2-sha256')
  t('默认圈数 = 平台顶格 100000', parts[1] === '100000' && A.PBKDF2_ITERATIONS === 100000)
  t('平台上限常量 = 100000', A.PBKDF2_MAX_ITERATIONS === 100000)
  const rec = A.parsePasswordRecord(PW_STORED)
  t('盐 16 字节 / 哈希 32 字节', !!rec && rec.salt.length === 16 && rec.hash.length === 32)
  t('同一密码两次哈希不同（盐随机）', PW_STORED !== PW_STORED2)
  t('两串盐确实不同', A.parsePasswordRecord(PW_STORED).salt.join() !== A.parsePasswordRecord(PW_STORED2).salt.join())
  t('圈数给超上限 -> 夹到 100000', (A.parsePasswordRecord(await A.hashPassword(PW_PLAIN, { iterations: 999999 })) || {}).iterations === 100000)
  t('圈数给 0 -> 回落默认 100000', (A.parsePasswordRecord(await A.hashPassword(PW_PLAIN, { iterations: 0 })) || {}).iterations === 100000)
}

console.log('\n[auth.js — verifyPassword]')
{
  t('正确密码 -> true（默认 100000 圈）', (await A.verifyPassword(PW_PLAIN, PW_STORED)) === true)
  t('第二串同样验过（盐不同不妨碍）', (await A.verifyPassword(PW_PLAIN, PW_STORED2)) === true)
  t('错密码 -> false', (await A.verifyPassword(PW_PLAIN + '!', PW_STORED)) === false)
  t('大小写不同 -> false', (await A.verifyPassword(PW_PLAIN.toUpperCase(), PW_STORED)) === false)
  t('空密码 -> false', (await A.verifyPassword('', PW_STORED)) === false)
  t('undefined 密码 -> false（不抛）', (await A.verifyPassword(undefined, PW_STORED)) === false)
  t('坏存储串 -> false（不抛）', (await A.verifyPassword(PW_PLAIN, 'garbage')) === false && (await A.verifyPassword(PW_PLAIN, null)) === false)
  const rec = A.parsePasswordRecord(PW_CHEAP)
  const wrong = new Uint8Array(rec.hash)
  wrong[0] ^= 0xff
  const forged = ['pbkdf2-sha256', rec.iterations, A.bytesToBase64url(rec.salt), A.bytesToBase64url(wrong)].join('$')
  t('哈希被改（同盐同圈数）-> false', (await A.verifyPassword(PW_PLAIN, forged)) === false)
  t('低圈数自造串：圈数写进串', PW_CHEAP.startsWith('pbkdf2-sha256$1000$'))
}

console.log('\n[auth.js — parsePasswordRecord（坏数据一律 null）]')
{
  const good = PW_CHEAP
  const [algo, iters, salt, hash] = good.split('$')
  t('好串 -> 对象', A.parsePasswordRecord(good) !== null)
  t('非字符串 -> null', A.parsePasswordRecord(null) === null && A.parsePasswordRecord(123) === null)
  t('段数不对 -> null', A.parsePasswordRecord('a$b$c') === null && A.parsePasswordRecord(good + '$x') === null)
  t('算法名不对 -> null', A.parsePasswordRecord(['bcrypt', iters, salt, hash].join('$')) === null)
  t('圈数非整数 -> null', A.parsePasswordRecord([algo, 'abc', salt, hash].join('$')) === null && A.parsePasswordRecord([algo, '1000.5', salt, hash].join('$')) === null)
  t('圈数 < 1 -> null', A.parsePasswordRecord([algo, '0', salt, hash].join('$')) === null && A.parsePasswordRecord([algo, '-5', salt, hash].join('$')) === null)
  t('圈数越平台上限（100001）-> null', A.parsePasswordRecord([algo, '100001', salt, hash].join('$')) === null)
  t('盐太短（< 8 字节）-> null', A.parsePasswordRecord([algo, iters, A.bytesToBase64url(new Uint8Array(4)), hash].join('$')) === null)
  t('盐含非法字符 -> null', A.parsePasswordRecord([algo, iters, 'ab+cd', hash].join('$')) === null)
  t('哈希长度不对（16 字节）-> null', A.parsePasswordRecord([algo, iters, salt, A.bytesToBase64url(new Uint8Array(16))].join('$')) === null)
  t('空串 -> null', A.parsePasswordRecord('') === null)
}

console.log('\n[auth.js — needsRehash（圈数升档）]')
{
  t('低于目标 -> true', A.needsRehash(PW_CHEAP, 100000) === true)
  t('等于目标 -> false', A.needsRehash(PW_CHEAP, 1000) === false)
  t('高于目标 -> false', A.needsRehash(PW_CHEAP, 100) === false)
  t('默认口径下不再升档', A.needsRehash(PW_STORED) === false)
  t('目标给超上限按 100000 夹后仍不升档', A.needsRehash(PW_STORED, 999999) === false)
  t('解析不了 -> true', A.needsRehash('garbage') === true && A.needsRehash(null) === true)
}

console.log('\n[auth.js — dummyVerify（防枚举：恒 false 且烧同等时间）]')
{
  t('恒回 false（默认 100000 圈）', (await A.dummyVerify('anything')) === false)
  t('undefined 也不抛', (await A.dummyVerify(undefined, 1000)) === false)
  t('自定义圈数可用', (await A.dummyVerify('x', 1000)) === false)
}

console.log('\n[auth.js — checkPasswordPolicy]')
{
  t('8 字符 -> 过（下限）', A.checkPasswordPolicy('12345678') === null)
  t('200 字符 -> 过（上限）', A.checkPasswordPolicy('x'.repeat(200)) === null)
  t('7 字符 -> too-short', A.checkPasswordPolicy('1234567') === 'too-short')
  t('201 字符 -> too-long', A.checkPasswordPolicy('x'.repeat(201)) === 'too-long')
  t('非字符串 -> not-a-string', A.checkPasswordPolicy(null) === 'not-a-string' && A.checkPasswordPolicy(12345678) === 'not-a-string')
  t('口径常量：最小 8 / 最大 200', A.PASSWORD_MIN === 8 && A.PASSWORD_MAX === 200)
}
console.log('\n[auth.js — CSRF 第二层（会话派生令牌）]')
{
  const s = 'SESSION-TOKEN-abc123'
  const a = await A.csrfToken(s)
  t('同一会话令牌 -> 同一 CSRF 令牌（派生式，不用落库）', a === await A.csrfToken(s))
  t('不同会话令牌 -> 不同 CSRF 令牌', a !== await A.csrfToken('another-session'))
  t('是 64 位十六进制（sha256）', /^[0-9a-f]{64}$/.test(a))
  t('没有会话令牌 -> 空串', (await A.csrfToken('')) === '' && (await A.csrfToken(null)) === '' && (await A.csrfToken(undefined)) === '')
  t('匹配 -> true', (await A.csrfMatches(s, a)) === true)
  t('两端的空白被容忍（HTTP 头里容易带出来）', (await A.csrfMatches(s, '  ' + a + ' ')) === true)
  t('改一个字符 -> false', (await A.csrfMatches(s, a.slice(0, -1) + (a.endsWith('0') ? '1' : '0'))) === false)
  t('缺值 / 非字符串 -> false', (await A.csrfMatches(s, undefined)) === false && (await A.csrfMatches(s, 42)) === false && (await A.csrfMatches(s, null)) === false)
  t('空会话令牌 -> false（派生不出值，不能当成匹配）', (await A.csrfMatches('', a)) === false && (await A.csrfMatches(null, null)) === false)
  t('跨会话不通用：拿 A 的令牌套 B 的会话 -> false', (await A.csrfMatches('another-session', a)) === false)
  t('令牌里不含会话令牌本身（不是简单拼接）', a.indexOf(s) === -1)
}
console.log(`\n═══ 结果: ${pass} 通过, ${fail} 失败 ═══`)
process.exit(fail ? 1 : 0)