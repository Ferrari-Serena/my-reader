/**
 * 账号界面层的**纯逻辑**验证（不碰网络、不碰 vue）：
 *   utils/authForm.js — 邮箱/密码校验、二次确认、错误码文案
 * 用法: node verify-authui.mjs
 *
 * 为什么测这些「一句话」：端点真伪在 worker 侧有 421 条断言，前端真正会错的是
 * 「同一个错误码该说什么」「按钮什么时候该禁用」这类**埋在组件里就测不到**的判断。
 * 本文件只测纯函数 —— 组件的渲染/提交不在这一层（那要靠真机手点）。
 */

import * as A from './src/utils/authForm.js'

let pass = 0, fail = 0
function t(name, cond) {
  if (cond) { pass++; console.log(`  ok ${name}`) }
  else { fail++; console.log(`  FAIL ${name}`) }
}

console.log('\n[authForm — emailProblem（与后端 normalizeEmail 同口径）]')
t('正常邮箱 -> 过', A.emailProblem('ferrari@qq.com') === null)
t('两端空白被容忍 -> 过', A.emailProblem('  a@b.co  ') === null)
t('大写也过（后端会归一化）', A.emailProblem('Ferrari@QQ.com') === null)
t('空 / 只有空白 -> 提示必填', A.emailProblem('') === 'Enter your email address.' && A.emailProblem('   ') === 'Enter your email address.')
t('非字符串 -> 提示必填', A.emailProblem(null) === 'Enter your email address.' && A.emailProblem(42) === 'Enter your email address.')
t('没有 @ -> 拦', A.emailProblem('nope') !== null)
t('没有点 -> 拦（与后端一致：a@b 不算）', A.emailProblem('a@b') !== null)
t('两个 @ -> 拦', A.emailProblem('a@@b.com') !== null)
t('带空格 -> 拦', A.emailProblem('a b@c.com') !== null)
t('超长（>254）-> 拦', A.emailProblem('x'.repeat(250) + '@a.com') !== null)
t('恰好 254 边界内 -> 过（与后端边界一致）', A.emailProblem('x'.repeat(246) + '@a.com') === null)

console.log('\n[authForm — passwordProblem（8–200，与后端 checkPasswordPolicy 同口径）]')
t('8 字符 -> 过（下限）', A.passwordProblem('12345678') === null)
t('200 字符 -> 过（上限）', A.passwordProblem('x'.repeat(200)) === null)
t('7 字符 -> 拦且文案带 8', A.passwordProblem('1234567').includes('8'))
t('201 字符 -> 拦', A.passwordProblem('x'.repeat(201)) !== null)
t('非字符串 -> 拦', A.passwordProblem(null) !== null && A.passwordProblem(undefined) !== null)
t('口径常量与后端对齐 8 / 200', A.PASSWORD_MIN === 8 && A.PASSWORD_MAX === 200)

console.log('\n[authForm — confirmProblem]')
t('一致 -> 过', A.confirmProblem('abcd1234', 'abcd1234') === null)
t('不一致 -> 拦', A.confirmProblem('abcd1234', 'abcd1235') !== null)
t('大小写不同也算不一致（密码不做归一化）', A.confirmProblem('Abcd1234', 'abcd1234') !== null)
t('空 vs 空 -> 过（「必填」由组件那层管）', A.confirmProblem('', '') === null)

console.log('\n[authForm — retryMinutes]')
t('0 / 负 / 非数字 -> 0（不编分钟数）', A.retryMinutes(0) === 0 && A.retryMinutes(-5) === 0 && A.retryMinutes('x') === 0)
t('30 秒 -> 1 分钟（不是 0）', A.retryMinutes(30) === 1)
t('60 秒 -> 1 分钟', A.retryMinutes(60) === 1)
t('61 秒 -> 2 分钟', A.retryMinutes(61) === 2)
t('3600 秒（注册/重置窗口）-> 60 分钟', A.retryMinutes(3600) === 60)

console.log('\n[authForm — authErrorMessage]')
t('invalid-credentials -> 说「邮箱或密码不对」', A.authErrorMessage(401, { error: 'invalid-credentials' }).includes('incorrect'))
t('email-taken -> 引导去登录（不是干说占用）', A.authErrorMessage(409, { error: 'email-taken' }).includes('signing in'))
t('weak-password(too-short) -> 提 8 位', A.authErrorMessage(400, { error: 'weak-password', reason: 'too-short' }).includes('8'))
t('weak-password(too-long) -> 提 200', A.authErrorMessage(400, { error: 'weak-password', reason: 'too-long' }).includes('200'))
t('too-many-attempts + retryAfter=3600 -> 约 60 分钟（用具体值，不吞掉）', A.authErrorMessage(429, { error: 'too-many-attempts', retryAfter: 3600 }).includes('60 minute'))
t('too-many-attempts + retryAfter=90 -> 约 2 分钟', A.authErrorMessage(429, { error: 'too-many-attempts', retryAfter: 90 }).includes('2 minutes'))
t('429 但没带 retryAfter -> 照样说「试太多次」，不乱编数字', (() => {
  const m = A.authErrorMessage(429, { error: 'too-many-attempts' })
  return m.includes('Too many attempts') && !/\d/.test(m)
})())
t('bad-csrf -> 提示刷新重试（不是「未知错误」）', A.authErrorMessage(403, { error: 'bad-csrf' }).includes('reload'))
t('network（status 0）-> 提示检查网络', A.authErrorMessage(0, { error: 'network' }).includes('connection'))
t('裸 status 0 -> 也当网络（没有 code 时不许说「未知错误」）', A.authErrorMessage(0, {}).includes('connection'))
t('unknown 5xx -> 说「我们这边出问题」', A.authErrorMessage(503, {}).includes('our side'))
t('完全认不出来 -> 兜底一句，且不抛', typeof A.authErrorMessage(400, {}) === 'string' && A.authErrorMessage(undefined, undefined).length > 0)
t('code 优先于 status：invalid-email + 429 仍是「邮箱不对」', A.authErrorMessage(429, { error: 'invalid-email' }) === 'Enter a valid email address.')


console.log('\n[authForm — 注销 / 撤销的文案]')
t('password-required -> 要求输密码确认', A.authErrorMessage(400, { error: 'password-required' }).includes('password'))
t('gone -> 说明冷静期已过、救不回来', A.authErrorMessage(410, { error: 'gone' }).includes('30-day'))
t('not-pending -> 说明这号没在注销中', A.authErrorMessage(409, { error: 'not-pending' }).includes('not scheduled'))
t('注销时密码不对沿用 invalid-credentials 文案', A.authErrorMessage(401, { error: 'invalid-credentials' }).includes('incorrect'))

console.log(`\n═══ 结果: ${pass} 通过, ${fail} 失败 ═══`)
process.exit(fail ? 1 : 0)
