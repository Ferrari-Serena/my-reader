/**
 * 探针专用的本地夹具（W-13 步骤 3）。
 *
 * 为什么自写文本：探针要测的是「章节 → 切块 → 合成 → 时间轴」这条链，不是模型能力，
 * 所以用读音稳定、不含专名与生僻词的短句；也避免任何书名、引言、歌词、教材原文。
 *
 * 规模为什么是 1 章 3 段、每段 150–250 字符：`TTS_CHUNK_CHARS = 400`（audioPost.js），
 * 单段 < 400 才会「一段一块」，段间那 0.35 s 才测得到；3 段够算 rtf，又不把探针拖长。
 *
 * sentinel 为什么放 title：title 会被朗读、也会进产物，`grep` 有东西可抓；放正文里
 * 会被 omit 类逻辑绕开。
 */
export const PROBE_FIXTURE_SENTINEL = 'MR_PROBE_FIXTURE_v1'

export const PROBE_FIXTURE = {
  title: `Probe fixture (${PROBE_FIXTURE_SENTINEL})`,
  chapters: [
    {
      id: 'ch-01',
      title: 'Fixture · Chapter 1',
      paragraphs: [
        {
          id: 'p-001',
          text: 'The old harbour lights came on one by one, and the fishing boats rocked gently against the stone wall. Nobody spoke for a while, because the evening was the kind that asks for quiet, not for talk.',
        },
        {
          id: 'p-002',
          text: 'Mira counted the coins in her pocket twice, then a third time, as if the number might change if she looked at it long enough. It did not change. She bought bread anyway, and the baker smiled at her in a way that suggested he already knew.',
        },
        {
          id: 'p-003',
          text: 'On the way home the wind pushed against her coat and the rain began, soft at first, then steady. Was it worth the walk? She decided that it was, and she kept going until the small warm room at the end of the street.',
        },
      ],
    },
  ],
}
