#!/usr/bin/env node
/**
 * verify-quizui.mjs · 测验设置页纯逻辑（题量/题型过滤/生成量）
 * 跑法：node verify-quizui.mjs（已挂进 npm test 链）
 */
import * as Q from './src/utils/quizView.js'

let pass = 0, fail = 0
function t(name, cond) {
  if (cond) { pass++; console.log('  ok ' + name) }
  else { fail++; console.log('  FAIL ' + name) }
}

const choice = { type: 'wordChoice', options: ['a', 'b'], answerIndex: 0 }
const spelling = { type: 'wordChoice', answer: 'apple' }

console.log('[quizView — 题型]')
{
  t('选项题识别', Q.isChoiceQuestion(choice) === true)
  t('输入题识别', Q.isChoiceQuestion(spelling) === false)
  t('坏题不算选项题', Q.isChoiceQuestion(null) === false && Q.isChoiceQuestion({ options: [] }) === false)

  const all = [choice, spelling, choice]
  t('mixed 原样', Q.filterQuestionsByType(all, 'mixed').length === 3)
  t('choice 只留选项题', Q.filterQuestionsByType(all, 'choice').length === 2)
  t('spelling 只留输入题', Q.filterQuestionsByType(all, 'spelling').length === 1)
  t('空输入 -> []', Q.filterQuestionsByType(null, 'choice').length === 0)
  t('未知题型不吞题', Q.filterQuestionsByType(all, 'x').length === 3)
}

console.log('[quizView — 生成量]')
{
  t('全部 -> 可用数', Q.generationCount('All', 'mixed', 24) === 24)
  t('混合 10 -> 10', Q.generationCount(10, 'mixed', 100) === 10)
  t('单一题型 10 -> 30', Q.generationCount(10, 'choice', 100) === 30)
  t('封顶可用数', Q.generationCount(10, 'choice', 5) === 5)
  t('少于可用数', Q.generationCount(20, 'spelling', 100) === 60)
  t('全部时单题型也按可用数', Q.generationCount('All', 'choice', 12) === 12)
  t('坏题量 -> 0', Q.generationCount(0, 'mixed', 10) === 0 && Q.generationCount(-1, 'mixed', 10) === 0)
  t('可选常量', Q.QUIZ_COUNT_OPTIONS.join(',') === '10,20,All' && Q.QUIZ_TYPES.length === 3)
}

console.log(`\n═══ 结果: ${pass} 通过, ${fail} 失败 ═══`)
process.exit(fail ? 1 : 0)
