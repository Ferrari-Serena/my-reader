# -*- coding: utf-8 -*-
"""第 10 步 块 B′：义项库**人工层** —— 学习义筛 ＋ rank ＋ 中文 ＋ pattern ＋ 例句分派。本件是**权威件**。

形状落 §5.3（`senses[]` 带 `id/rank/zh/en/pattern/cue/tier/wn/rank_basis/src/reviewed/examples`，
**例句空缺走 `examples_gap` 点名**）。种子 **27 词 / 61 义项**（2026-10-10 五续：**锚 dr-jekyll ch.01 的 16 词组**，＋14 词）；扩到全部目标词是块 C 的事，扩完才 merge 进 `phrases.json`。

五处 2026-10-10 的改动：
  ① 每条义项补 `wn`（WordNet synset 锚）→ `id` 换全局键 `<phrase>#<synset>`，骨架 ↔ 人工层可逐条对账（解 §17.11 阻塞 ③）；
  ② 零覆盖/WordNet 不收的义项（如 `account for`=占比）写 `wn:null` ＋ 人工 slug ＋ `src:"drafted"`；
  ③ **工序 4 例句**：`EX` 是人工分派的结果（机器只抽候选，见 `extract_examples.py`）；
     **抽不到的写 `GAP` 点名** —— 闸规定「examples 为空却没有 examples_gap」＝ 报错（防 §17.11 的「空满足」）。
  ④ **2026-10-10 扩语料回查**：语料 25 → 44 本（补 1900–1929 全公版），对 11 条缺口
     **逐条回源重核**，救回 4 条（`turn out`×2／`put off`＝搪塞／`give up`＝戒除），
     余 7 条改写 `GAP` 理由（含撤回上一轮一处误分派：`account for` 引的 1661 那句实为「解释」义）。
  ⑤ **2026-10-10 五续 · 块 B″ 第一批**：按**验收基准取样**（dr-jekyll ch.01 的 16 词组）把人工层 13 → **27 词**；
     新增 14 词均有 WordNet 覆盖，其中 3 条义项 WordNet 未收（`light up`＝脸放光／`put in`＝投入／`in a body`）
     ⇒ `wn:null` ＋ 人工 slug ＋ `src:"drafted"`。
  ⑥ **2026-10-10 七续 · 块 C 前置（ch.01 探测后，§17.19 的 A 案）**：给 ch.01 里 6 处「正解不在学习义库」的用法补 sense
     （`come about`＝空间义／`lay out`＝花费／`put in`＝习语「露面」／`stick out`＝硬撑／`give in`＝递交／`look on`＝朝向），
     **排在既有学习义之后**（rank 靠后）。注：`tier` 由 rank 推导（`core ⟺ rank≤5`），故这 6 条仍 `core` —— 「低频/字面」的提示落在 **rank 序 ＋ `pattern` 文字**上。
  ⑦ **2026-10-10 九续 · 块 C 第二步（cue）**：`cue`（机器线索，正则源码串）从新件 `generator/cues.py` 注入
     （只覆盖 ch.01 的 16 词/39 义项，其余留空）—— L1 引擎读它判「本句义」，语义 / 盲区见 `cues.py` 头注。
     闸：非空 cue 必须能编译成合法正则（`cue_gate`）＋ 自咬（`cue_selftest`）。
  ⑧ **2026-10-10 十续 · 块 B″ 第一批（13 词/33 义项）**：按 §17.22 锁标准扩量（排序轴＝语料计数降序、批 30 词）。
     13 词（`go on`／`come in`／`sit down`／`go out`／`go down`／`get up`／`go back`／`look up`／`go into`／`come down`／`go up`／`come up`／`hand in`）
     ＋ cue（`cues.py`）＋ **人工核过、逐字取自语料的例句 28 条**；5 条「44 本 0 正据」走 `GAP`：
     `go out`＃2（交往义系 20 世纪口语）／`go down`＃3（下跌）／`look up`＃3（好转）／`come up`＃3（意外出现）／`go up`＃3（盖起／着火）。
     另修 cue 两处：`come down`＃3 补「come down in (their) price」支（救回 1 条正据）、`go up`＃3 的 flames 支补 `went` 等（原支缺 `went` 系漏配）。
  ⑨ **2026-10-10 十二续 · 块 B″ 第二批（30 词/82 义项）＋可分离式口径**：第二批 30 词（`come on` 357 … `turn away` 141）
     ＋ cue ＋ **人工核过的例句 63 条**、19 条 GAP；**可分离式短语**（宾语插入，如 `take sb out`）改由 sense 标 `separable: true`，
     例句闸随之放宽为「头词(含屈折)＋间隔≤4词＋粒子」（`senses_schema.has_form_gapped`）—— `take out`＃2（带某人出去）
     由 GAP 转为例句（`gutenberg:1400`），并给形状自咬闸加 3 条注入故障（连成分都不含 / 间隔超限 / 非布尔）。

  ⑩ **2026-10-10 二十六续后 · LLM 物理锁（Ferrari 批「可，限生产端」）**：LLM **只许进生产端**（帮我们产候选），
     **不许进运行时**（用户上传的书不出设备 ⇒ 离线优先）；候选**只许落 `generator/output/` 下的中间件**，
     **任何构建脚本都不得读它** —— 闸 `llm_lock_gate()` 扫本目录全部 `.py` 源码、出现候选件名即报错，
     自咬 `llm_lock_selftest()` **2 例**（塞候选件名必报、正常件不报红）。
     理由：`ALLOWED_SRC` 已禁「LLM 直出」，但**闸看不出「直出冒充人工审过」**（`src` 照样能写 `drafted`）
     ⇒ **闸看不出的东西，就不该让流程有产生的机会**。

  ⑪ **2026-10-10 二十七续后 · 裁 c（三词补「字面义」样板）**：给 `go through`／`take up`／`go over` 各补 **1 条字面义义项**
     （`take up`＝拿起／`go through`＝穿过／`go over`＝走过去），**排在既有学习义之后**（rank 靠后，沿用 ⑥ 的先例、不重编号）；
     **`wn:null` ＋ 人工 slug ＋ `src:"drafted"`** —— 本机 WordNet 数据不可用（`nltk` 报 `Resource 'wordnet' not found`），
     **按「不猜 synset」办**；例句逐字取自 44 本语料（`120`／`345`／`217`）；
     **cue ＝ 兜底型 `^(?!…)` ⇒ 置信度 `low`**（只作排序、不当「本句义」，见 `l1_probe.py` 的 `cue_tier`）。

  ⑫ **2026-10-10 二十八续 · 裁甲（删「字面义重复件」）**：按 CC `T1857-cc` 的判据（**该兜底义与词条级 `literal` 是否逐字对应**），
     把装置 (b)「后排兜底」15 条切成两半 —— **① 字面义重复件 7 条删净**（`take up` r4／`go through` r4／`go over` r3／`fall through` r2／
     `get across` r2／`lay off` r3／`pull over` r2；**义项 ＋ catch-all cue 一起删**，中间 rank 顺移保连续）；**② 主义被排除法兜住 8 条不动**
     （`act up`／`back up`／`blow up`／`build up`／`check in`／`cheer up`／`warm up`／`wipe out` 的 r2 ⇒ 留待**块 B″ cue 校准**换各自正向 cue）。
     **装置 (a)「rank1 默认义负向预查」123 条一律不动**（`ch.01` 的 3 条 fallback 靠它，误删会把 `zero ≤ 2` 门打穿）。
     回归闸 `fallback_gate()`：**rank>1 的 catch-all 只许白名单那 8 条**（多一条未登记／少一条都报），自咬 `fallback_selftest()` 2 例。
     **2026-10-10 三十续（清账）**：那 8 条已全部换**正向 cue**（唯 `build up` r2 有意留空）⇒ **白名单清空**，闸改断言「rank>1 一条都不许有」；自咬升 **3 例**（＋反向：rank1 的 catch-all 不许被误报）。读数与手判见 `Phase1-实施方案.md` §17.42。

**2026-10-10 三十一续 · 裁甲 ＋ 三词 r1 校准**：`build up` 的 r2「逐步积累；积聚」**并入 r1**（`build_up.v.02` 退役；措辞扩为「逐步建立；发展；壮大；积聚」，EX 的 cards 例句随之退役、GAP 键 r3→r2）；`build up` r1／`wipe out` r1／`blow up` r1 的 cue 由「`the` ＋ 单数枚举」改为「**定冠词/形容词槽 ＋ 类别词表 ＋ 窗口（禁跨 `,;`）** ＋ 宾语前置支」。读数见 `Phase1-实施方案.md` §17.43。
**2026-10-10 三十二续 · `wipe out` 判据句写死 ＋ 两类补词**（CC 判）：r1 措辞补「使（实体/事态）彻底不复存在」、`pattern` 补「事态」；r2 中文 gloss 由「抹去；使（过去/记忆）一笔勾销；抵消」收成「**勾销；抵消；（旧账/往事）一笔勾销**」（把与词条级 `literal`「擦掉」中文同义的「抹去」摘掉）、`en` 收成「to cancel out; to offset (a loss, a debt, a past)」；r2 cue 补账目-盈亏类、摘 `everything`。见 §17.44。
     删后 `literal` 字段（320/320）独任「字面义」，不再与义项表双写（同义双写必分叉）。

**尚未做**（留给块 B″：人工层扩量）：§17.11 Q2 的**三道筛**没对种子跑过 ——
筛① 语料存在性、筛② pattern 可区分（写不出两条不同 pattern 就合并）、筛③ 字面可推则不单列。
筛③ 会动 `give up` 第 3 义（让出／交出）、`break up` 第 3 义（打碎）这类**字面可推**的项，
所以现在不把它们塞进 `LITERAL_SYNSETS`（免得「闸说这是字面义、数据又把它单列」自相矛盾）。
"""
import os, io, json, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from senses_schema import check_entry, check_selftest, CORE_CAP
from targets import match_keys
from cues import CUE, cue_gate, cue_selftest

ROOT = r"D:\睿谊的WPS\Ferrariwork\my-reader"
PHRASES = os.path.join(ROOT, "reader", "public", "data", "phrases.json")
OUT = os.path.join(ROOT, "generator", "output", "phrases_senses_curated.json")

# 字面义 synset 常量表（人工标注一次）。块 D 的回归闸断言 senses[rank=1].wn 不在其中。
# 定位写死：它是**回归闸**（钉住不许回退），**不承担「正确性」证明** —— 它可主观。
LITERAL_SYNSETS = {
    "bring about": ["bring_about.v.01"],       # cause to move into the opposite direction
    "turn out": ["turn_out.v.10"],             # turn outward
    "take off": ["take_off.v.02"],             # take away or remove
    "set up": ["raise.v.09", "pitch.v.08"],    # 竖起来／架起
}


def sense(phrase, rank, zh, en, pattern, wn, slug):
    """拼一条义项。id 规则：有 wn 用 synset 名；零覆盖用人工 slug（**定了不许改**）。"""
    assert (wn is None) != (slug is None), (phrase, rank, "wn 与 slug 只能给一个")
    return {
        "id": "%s#%s" % (phrase, wn if wn else slug),
        "rank": rank,
        "zh": zh,
        "en": en,
        "pattern": pattern,
        "cue": "",
        "tier": "core" if rank <= CORE_CAP else "extended",
        "wn": wn,
        "rank_basis": "manual",
        "src": "wn" if wn else "drafted",
        "reviewed": True,
        "examples": [],
    }


# (phrase, literal, [(rank, zh, en, pattern, wn, slug), ...])
RAW = [
    ("turn out", "turn(转) + out(向外) → 转出去", [
        (1, "结果是；原来是", "to be discovered or found to be", "it turns out (that)… / turn out to be + 名/形", "prove.v.01", None),
        (2, "（人群）聚集；出席", "to come or gather to an event", "turn out (for/to) + 人/活动", "turn_out.v.08", None),
        (3, "生产；产出", "to produce, usually with machinery", "turn out + 产品", "turn_out.v.03", None),
    ]),
    ("account for", "", [
        (1, "解释；说明（原因）", "to be the reason or explanation for", "account for + 现象/差异", "account_for.v.01", None),
        (2, "占（比例）；构成", "to form a particular part of a total", "account for + 百分比/份额", None, "share"),
    ]),
    ("bring about", "bring(带) + about(周围) → 带来→促成", [
        (1, "导致；引起；使发生", "to cause to happen", "bring about + 变化/结果", "produce.v.03", None),
    ]),
    ("put off", "", [
        (1, "推迟；延期", "to postpone", "put off + 活动/时间（put off the meeting）", "postpone.v.01", None),
        (2, "使反感；使失去兴趣", "to make sb dislike or lose interest", "put sb off (sth)", "turn_off.v.03", None),
        (3, "搪塞；敷衍", "to evade by excuses", "put sb off (with sth)", "hedge.v.01", None),
    ]),
    ("give up", "", [
        (1, "放弃；认输", "to stop trying; to surrender", "give up (sth/doing) / give up on sb", "drop_out.v.01", None),
        (2, "戒除", "to stop using/doing habitually", "give up + 习惯/嗜好", "kick.v.06", None),
        (3, "让出；交出", "to yield or hand over", "give up + 位置/权利（give up one's seat）", "surrender.v.02", None),
    ]),
    ("set up", "", [
        (1, "建立；创办", "to establish or found", "set up + 组织/公司", "establish.v.01", None),
        (2, "安装；架设", "to assemble/install", "set up + 设备/舞台", "install.v.01", None),
        (3, "安排；设置", "to arrange or configure", "set up + 系统/账户/会议", "set_up.v.04", None),
    ]),
    ("take off", "", [
        (1, "起飞", "(of an aircraft) to leave the ground", "飞机 + take off", "take_off.v.03", None),
        (2, "脱下", "to remove (clothing)", "take off + 衣物", "take_off.v.06", None),
        (3, "突然走红；迅速成功", "to become successful/popular suddenly", "商品/人 + take off", "get_off_the_ground.v.01", None),
    ]),
    ("break up", "", [
        (1, "分手；（关系）破裂", "to end a relationship", "人 + break up (with sb)", "separate.v.08", None),
        (2, "解散；散开", "to disperse", "团体/人群 + break up", "disperse.v.02", None),
        (3, "打碎；分裂", "to break into pieces", "break up + 物", "break_up.v.16", None),
    ]),
    ("carry out", "", [
        (1, "执行；实施；进行", "to perform or put into practice", "carry out + 计划/任务/实验", "carry_through.v.01", None),
    ]),
    ("point out", "", [
        (1, "指出；指明", "to draw attention to", "point out (that)… / point sth out", "signalize.v.03", None),
    ]),
    ("come up with", "", [
        (1, "想出；提出；找到", "to think of or produce (an idea/solution)", "come up with + 主意/方案/借口", None, "devise"),
    ]),
    ("look forward to", "", [
        (1, "期待；盼望", "to await with pleasure", "look forward to + n/doing（to 是介词，后接动名词）", None, "anticipate"),
    ]),
    ("put up with", "", [
        (1, "忍受；容忍", "to tolerate", "put up with + 人/事", None, "tolerate"),
    ]),
    ("come about", "come(来) + about(四周) → 四处来到 → 发生", [
        (1, "发生；出现（某事如何发生）", "to happen, especially in a particular way", "it comes about that… / how did it come about?", "happen.v.01", None),
        (2, "（古／文学）来到…附近；在…一带走动", "to come near or around (a place)", "（古／文学）come about + 处所", None, "come-near"),
    ]),
    ("set aside", "set(放) + aside(到一旁) → 放到一边", [
        (1, "留出；拨出（钱/时间）", "to keep or save (money/time) for a special purpose", "set aside + 钱/时间 (for)", "allow.v.04", None),
        (2, "搁置；暂不考虑", "to put out of consideration for the time being", "set aside + 分歧/争议/决定", "suspend.v.05", None),
    ]),
    ("lay out", "lay(放) + out(向外) → 铺开来", [
        (1, "铺开；布置；陈列", "to spread out or arrange in a planned way", "lay out + 物品/场地（a well laid-out garden）", "range.v.05", None),
        (2, "陈述；规划说明", "to present or explain (a plan/idea) in detail", "lay out + 计划/理由/观点", "present.v.02", None),
        (3, "花费；花掉（钱）", "to spend or invest (money)", "lay out + 钱 (on/in)", "lay_out.v.03", None),
    ]),
    ("light up", "light(点亮) + up(起来) → 点亮起来", [
        (1, "照亮；点亮", "to make (a place) bright with light", "light up + 房间/物体 ／ be lit up (with)", "light.v.01", None),
        (2, "（脸/眼睛）放光；容光焕发", "(of the face or eyes) to become bright with a feeling", "sb’s face/eyes light up (with joy)", None, "face-brighten"),
    ]),
    ("run into", "", [
        (1, "偶遇；碰见", "to meet (sb) by chance", "run into + 人（碰见熟人）", "meet.v.01", None),
        (2, "撞上；撞到", "to hit (sth) with force", "run into + 物体（车/墙/树）", "hit.v.02", None),
        (3, "陷入（债务/麻烦）", "to get into (debt/trouble)", "run into + debt/trouble/difficulty", "run_into.v.01", None),
    ]),
    ("bring out", "bring(带) + out(向外) → 带出来", [
        (1, "使显现；衬托出（特质/差异）", "to make (a quality) visible or noticeable", "bring out + 特质/差异（bring out the best in sb）", "bring_out.v.04", None),
        (2, "出版；发行", "to publish or release (a book/record)", "bring out + 书/专辑/新版", "publish.v.02", None),
    ]),
    ("put in", "", [
        (1, "投入；花费（时间/精力）", "to spend or devote (time/effort)", "put in + 时间/精力（put in years）", None, "invest"),
        (2, "安装；装上", "to install or fix (sth) in place", "put in + 设备（put in a window）", "put_in.v.04", None),
        (3, "插话；插一句", "to interrupt with a remark", "put in + a word（插一句）", "chime_in.v.01", None),
        (4, "（习语 put in an appearance）露面；到场", "to make a brief appearance", "put in an appearance（露面）", None, "appearance"),
    ]),
    ("stick out", "stick(伸) + out(向外) → 伸出来", [
        (1, "伸出；探出（身体部位）", "to extend or protrude (a body part)", "stick out + 舌头/头/脚", "stick_out.v.01", None),
        (2, "显眼；突出（引人注意）", "to be very noticeable", "stick out（显得扎眼）", "leap_out.v.01", None),
        (3, "（口语）硬撑；不松口", "to hold out; to refuse to give in", "stick out (against/for sth)（不松口）", None, "hold-out"),
    ]),
    ("come back", "come(来) + back(回) → 回来", [
        (1, "回来；返回", "to return to a place", "come back (to + 处所)", "return.v.01", None),
        (2, "（记忆/意识）恢复；重新想起", "to return to the mind or consciousness", "it all comes back (to sb) ／ the memory came back", "come_back.v.01", None),
    ]),
    ("come out", "come(来) + out(向外) → 出来", [
        (1, "出来；出现", "to move out of a place; to appear", "come out (of + 处所)", "come_on.v.01", None),
        (2, "出版；刊出；发行", "to be published or issued", "come out（书/消息）+ 时间", "appear.v.03", None),
        (3, "结果是；结局（如何）", "to end or result in a particular way", "it comes out + 形（well/right/all right）", "turn_out.v.04", None),
    ]),
    ("set off", "set(使) + off(离开) → 使动身", [
        (1, "出发；启程", "to begin a journey", "set off (for + 目的地)", "depart.v.03", None),
        (2, "引发；激起（连锁反应）", "to cause (sth) to start happening", "set off + 警报/连锁反应/恐慌", "trip.v.04", None),
        (3, "衬托；使更显眼", "to make (sth) look more attractive by contrast", "A sets off B（A 衬托 B）", "bring_out.v.04", None),
    ]),
    ("in a body", "", [
        (1, "全体；一起（成群行动）", "all together, as a group", "do sth in a body（全体一起）", None, "as-a-body"),
    ]),
    ("give in", "give(给) + in(进去) → 交出去 → 屈服", [
        (1, "屈服；让步；认输", "to stop resisting; to yield", "give in (to + 人/要求)", "submit.v.06", None),
        (2, "交上；递交（文件/支票）", "to hand in or submit (a document)", "give in + 文件/支票（交上）", None, "hand-in"),
    ]),
    ("look on", "look(看) + on(在旁) → 在旁边看", [
        (1, "旁观；观看", "to watch sth without taking part", "look on (while/as…)", "watch.v.04", None),
        (2, "看待；认为（look on sb as）", "to regard or consider (sb/sth) as", "look on sb/sth as + 名", "think_of.v.03", None),
        (3, "（建筑/窗）朝向；面对", "(of a building or window) to face onto", "look on(to) + 处所（窗户朝向…）", None, "face-onto"),
    ]),
    ("go on", "go(去) + on(继续) → 一直走下去", [
        (1, "继续；不停地做（某事）", "to continue or keep doing something", "go on (doing sth)／go on with sth", "continue.v.01", None),
        (2, "发生；在进行", "to happen or be taking place", "what's going on／something going on", "happen.v.01", None),
        (3, "（灯/机器）亮起；开始运转", "to start operating (of a light, machine, etc.)", "（灯/机器）go on", "go_on.v.05", None),
    ]),
    ("come in", "come(来) + in(进) → 进来", [
        (1, "进来；进入", "to enter a room or building", "come in (to + 处所)", "enter.v.01", None),
        (2, "到手；被收到（消息/钱）", "to be received (of news, money, etc.)", "（消息/钱）come in", "come.v.16", None),
        (3, "（come in handy）派上用场", "to be useful or convenient", "come in handy／come in useful", None, "come-in-handy"),
    ]),
    ("sit down", "sit(坐) + down(下) → 坐下", [
        (1, "坐下", "to take a seat", "sit down (on／in + 处所)", "sit_down.v.01", None),
    ]),
    ("go out", "go(去) + out(外) → 出去", [
        (1, "出去；外出（离开家）", "to leave a place, especially one's home", "go out (of／to + 处所)", "go_out.v.02", None),
        (2, "（与某人）交往；谈恋爱", "to have a romantic relationship with sb", "go out with + 人", "go_steady.v.01", None),
        (3, "熄灭（灯/火）", "to be extinguished (of a light or fire)", "（灯/火）go out", "go_out.v.04", None),
    ]),
    ("go down", "go(去) + down(下) → 下去", [
        (1, "下去；往下走", "to move down to a lower place", "go down (to／into + 处所)", "descend.v.01", None),
        (2, "下沉；沉没（船）／落下（太阳）", "to sink or go under (of a ship); to set (of the sun)", "（船/太阳）go down", "sink.v.04", None),
        (3, "下降；下跌（价格/温度）", "to become lower (of prices, temperature, etc.)", "（价格/温度）go down", "decline.v.04", None),
    ]),
    ("get up", "get(使) + up(起) → 起来", [
        (1, "起床", "to get out of bed", "get up (early／late／at six)", "get_up.v.02", None),
        (2, "站起来；起身", "to rise to one's feet", "get up (from + 处所／and + 动作)", "arise.v.03", None),
    ]),
    ("go back", "go(去) + back(回) → 回去", [
        (1, "回去；返回", "to return to a place", "go back (to + 处所)", "return.v.01", None),
        (2, "追溯到；回到（时间/话题）", "to date back to; to return in thought or speech to", "go back to + 时间/话题", "go_back.v.01", None),
    ]),
    ("look up", "look(看) + up(向上) → 往上看", [
        (1, "查阅；查（词典/资料）", "to seek information (in a book or list)", "look up + 词/资料 (in a dictionary)", "consult.v.02", None),
        (2, "抬头看", "to raise one's eyes", "look up (from／at + 人/物)", None, "raise-eyes"),
        (3, "好转；改善（生意/形势）", "to get better (of business or a situation)", "（生意/形势）look up", "improve.v.02", None),
    ]),
    ("go into", "go(去) + into(进入) → 走进去", [
        (1, "进入（某地/房间）", "to enter (a place)", "go into + 处所", "enter.v.01", None),
        (2, "详细讨论；深究", "to discuss or examine (sth) in detail", "go into + 细节/原因", "go_into.v.02", None),
        (3, "从事（某行业）", "to become involved in (a profession/activity)", "go into + 行业/职业", "enter.v.02", None),
    ]),
    ("come down", "come(来) + down(下) → 下来", [
        (1, "下来；往下走", "to move down to a lower place", "come down (from／to + 处所)", "descend.v.01", None),
        (2, "（雨/雪）下起来；落下", "to fall (of rain, snow, etc.)", "（雨/雪）come down", "precipitate.v.03", None),
        (3, "（价格）降下来", "to become lower (of a price)", "（价格）come down", "decline.v.04", None),
    ]),
    ("go up", "go(去) + up(上) → 上去", [
        (1, "上去；往上走", "to move upward", "go up (to／into + 处所)", "rise.v.01", None),
        (2, "上涨；增加（价格/数字）", "to increase in value or amount", "（价格/数字）go up", "rise.v.02", None),
        (3, "（建筑）盖起来／（房屋）着火", "to be built; to be destroyed by fire", "（建筑）go up／go up in flames", "go_up.v.04", None),
    ]),
    ("come up", "come(来) + up(上) → 上来", [
        (1, "走近；上来", "to approach or move toward", "come up (to + 人/处所)", "come.v.01", None),
        (2, "被提及；被提出（话题）", "to be mentioned or raised (of a topic)", "（话题）come up", "come_up.v.07", None),
        (3, "出现；发生（意外的事）", "to arise or occur unexpectedly", "（事情）come up", "arise.v.04", None),
    ]),
    ("hand in", "hand(手/递) + in(进) → 递进去", [
        (1, "交上；上交（给上级／机构）", "to give or submit (sth) to a person in authority", "hand in + 物（交给上级／机构：作业/文件/公物）", None, "hand-in"),
    ]),
    ("come on", "come(来) + on(上/向前) → 上前来", [
        (1, "（催促）快来；跟上；加油", "used to urge sb to hurry or try harder", "Come on!（催促／鼓劲）", None, "urge"),
        (2, "（灯/机器）亮起；开始运转", "(of a light or machine) to start working", "（灯/机器）come on", "come_on.v.01", None),
        (3, "（雨/雪/夜色）开始袭来；降临", "to begin (of rain, night, etc.)", "（雨/雪/夜）come on", None, "onset"),
        (4, "进步；进展（如何）", "to make progress; to fare", "how is sb/sth coming on?", "progress.v.01", None),
    ]),
    ("go away", "go(去) + away(离开) → 走开", [
        (1, "走开；离开", "to leave a place", "go away (from + 处所)", "leave.v.01", None),
        (2, "消失；不复存在（疼痛/烦恼）", "to disappear; to stop existing", "（疼痛/烦恼）go away", "disappear.v.01", None),
    ]),
    ("look out", "look(看) + out(向外) → 向外看", [
        (1, "当心；留神（警告）", "used to warn sb of danger", "Look out!（警告）", "watch.v.05", None),
        (2, "留心找；留意（look out for）", "to keep watching for (sb/sth)", "look out for + 人/物", None, "watch-for"),
    ]),
    ("make up", "make(做) + up(完全) → 凑成/补足", [
        (1, "编造；虚构（故事/借口）", "to invent (a story or excuse)", "make up + 故事/借口/谎言", "fabricate.v.02", None),
        (2, "构成；组成（整体/比例）", "to form or compose", "make up + 整体/比例", "constitute.v.01", None),
        (3, "和好；和解（make up with）", "to become friendly again", "make up (with sb)", "reconcile.v.03", None),
        (4, "化妆；涂（化妆品）", "to apply cosmetics", "make up / make oneself up", "make_up.v.09", None),
        (5, "弥补；补偿（make up for）", "to compensate for", "make up for + 损失/过失", "compensate.v.01", None),
        (6, "（make up one's mind）下定决心", "to decide", "make up one's mind", "decide.v.01", None),
    ]),
    ("get out", "get(得到) + out(出) → 弄出来", [
        (1, "出去；离开", "to leave or exit", "get out (of + 处所)", "exit.v.01", None),
        (2, "拿出；取出", "to take (sth) out", "get out + 物（从…取出）", "bring_out.v.07", None),
        (3, "（消息/真相）传出去；泄露", "(of news) to become known", "（消息/真相）get out", "break.v.46", None),
    ]),
    ("take up", "take(拿) + up(起来) → 拿起", [
        (1, "开始从事；学着做（爱好/职业）", "to start (a hobby, job)", "take up + 爱好/职业", "take_up.v.03", None),
        (2, "占用；花费（时间/空间）", "to occupy (time or space)", "take up + 时间/空间", "take_up.v.04", None),
        (3, "继续；接下去（被打断的话题）", "to continue (after an interruption)", "take up + 话题/故事", "take_up.v.01", None),
    ]),
    ("find out", "find(找到) + out(出来) → 找出来", [
        (1, "查明；弄清楚（经调查）", "to discover by inquiry or effort", "find out + 真相/答案", "determine.v.01", None),
        (2, "发现；得知（无意中）", "to learn or become aware of", "find out (that)…", "learn.v.02", None),
    ]),
    ("put on", "put(放) + on(上面) → 放上去→穿上", [
        (1, "穿上；戴上", "to dress oneself in", "put on + 衣物/帽子", "wear.v.09", None),
        (2, "打开（灯/暖气/音乐）", "to switch on (a device)", "put on + 灯/音乐", None, "switch-on"),
        (3, "上演；举办（演出/节目）", "to present (a performance)", "put on + 戏/节目/展览", "put_on.v.04", None),
        (4, "假装；装出（put on an act/airs）", "to pretend; to behave unnaturally", "put on + an act/airs", None, "feign"),
    ]),
    ("get on", "get(得到) + on(上) → 上去", [
        (1, "上车；登上（公交/火车）", "to board (a vehicle)", "get on + 车/船", "board.v.01", None),
        (2, "相处；合得来（get on with）", "to have a good relationship", "get on (well) with sb", "get_along_with.v.01", None),
        (3, "进展；进行（如何）", "to make progress; to fare", "how is sb getting on?", "progress.v.01", None),
    ]),
    ("go through", "go(去) + through(穿过) → 穿过", [
        (1, "经历；遭受（困难/变故）", "to experience (sth difficult)", "go through + 困难/变故", "experience.v.01", None),
        (2, "仔细检查；翻看", "to examine or search carefully", "go through + 材料/口袋", "check.v.01", None),
        (3, "（提案/法案）获通过", "to be approved or accepted", "（法案/申请）go through", None, "be-approved"),
    ]),
    ("stand up", "stand(站) + up(起来) → 站起来", [
        (1, "站起来；起立", "to rise to one's feet", "stand up", "arise.v.03", None),
        (2, "（说法/论点）站得住脚", "to remain valid under scrutiny", "（论点/指控）stand up", "stand_up.v.06", None),
        (3, "（stand up for）为…辩护；支持", "to defend or support (sb/sth)", "stand up for + 人/权利", "stand_up.v.05", None),
    ]),
    ("pick up", "pick(拣) + up(起来) → 拣起来", [
        (1, "捡起；拾起", "to take hold of and lift", "pick up + 物（从地上）", "pick_up.v.02", None),
        (2, "（开车）接（人）；搭载", "to give sb a lift", "pick up + 人", "pick_up.v.03", None),
        (3, "（无意中）学会；习得", "to learn (a skill/language) casually", "pick up + 语言/技能", "learn.v.02", None),
        (4, "收拾；整理", "to tidy up", "pick up + 房间/东西", None, "tidy"),
    ]),
    ("lie down", "lie(躺) + down(下) → 躺下", [
        (1, "躺下（休息）", "to lie flat; to rest", "lie down (on + 处所)", "lie_down.v.01", None),
    ]),
    ("come over", "come(来) + over(过来) → 过来", [
        (1, "过来；到（某人处）来", "to come to where sb is", "come over (to + 处所)", None, "drop-in"),
        (2, "（某种感觉）突然袭来", "(of a feeling) to affect sb suddenly", "（感觉）come over + sb", None, "wash-over"),
    ]),
    ("go off", "go(去) + off(离开) → 走开", [
        (1, "爆炸；（枪）走火", "to explode or be fired", "（炸弹/枪）go off", "fire.v.05", None),
        (2, "（闹钟/警报）响起", "(of an alarm) to ring", "（闹钟/警报）go off", "go_off.v.02", None),
        (3, "离开；走掉", "to leave", "go off", "abscond.v.01", None),
    ]),
    ("run away", "run(跑) + away(离开) → 跑开", [
        (1, "逃跑；逃走", "to flee", "run away (from + 人/处所)", "scat.v.01", None),
        (2, "离家出走", "to leave home secretly", "run away from home", "run_away.v.02", None),
    ]),
    ("take out", "take(拿) + out(出去) → 拿出去", [
        (1, "拿出；取出", "to remove from a place/container", "take out + 物", "take_away.v.03", None),
        (2, "带（某人）出去（社交/散步）", "to take sb out (socially)", "take sb out (to + 处所)", "take_out.v.01", None),
        (3, "取得；办理（执照/保险/专利）", "to obtain (officially)", "take out + 执照/保险/专利", "take_out.v.04", None),
    ]),
    ("go over", "go(去) + over(越过) → 越过→过一遍", [
        (1, "复习；温习；仔细检查", "to review or examine carefully", "go over + 材料/笔记", "check.v.01", None),
        (2, "（演出/建议）受欢迎；效果好", "to be received in a specified way", "（演出/建议）go over (well/badly)", None, "be-received"),
    ]),
    ("get away", "get(得到) + away(离开) → 离开", [
        (1, "逃脱；逃走", "to escape", "get away (from + 人/处所)", "escape.v.01", None),
        (2, "抽身走开；（去）度假", "to go away for a rest", "get away (for a holiday)", "escape.v.05", None),
        (3, "侥幸逃过（处罚）（get away with）", "to escape blame or punishment", "get away with + 错事", "get_off.v.05", None),
    ]),
    ("sit up", "sit(坐) + up(起来) → 坐起来", [
        (1, "坐起来；坐直", "to move into a sitting position", "sit up", "sit_up.v.02", None),
        (2, "熬夜；不睡", "to stay up late", "sit up (late/all night)", "stay_up.v.01", None),
    ]),
    ("go by", "go(去) + by(经过) → 经过", [
        (1, "（时间）过去；流逝", "(of time) to pass", "（时间）go by", "elapse.v.01", None),
        (2, "经过；路过", "to pass by (a place)", "go by + 处所", "travel_by.v.01", None),
        (3, "依照；根据（go by）", "to be guided by", "go by + 规则/直觉/经验", "go_by.v.04", None),
        (4, "以…之名；叫做（go by the name of）", "to be known by the name of", "go by the name of + 名称", "go_by.v.03", None),
    ]),
    ("get in", "get(得到) + in(进去) → 进去", [
        (1, "进入；进去（房/车）", "to enter", "get in (to + 处所/车)", "enter.v.01", None),
        (2, "（车/船）到达", "(of a vehicle) to arrive", "（火车/船）get in", "pull_in.v.03", None),
        (3, "（被）录取；选上", "to be admitted to (a school)", "get in (to + 学校)", "get_in.v.03", None),
    ]),
    ("get back", "get(得到) + back(回) → 回来", [
        (1, "回来；回到（某处）", "to return", "get back (to + 处所)", "return.v.01", None),
        (2, "取回；找回", "to recover (sth)", "get back + 物", "win_back.v.01", None),
        (3, "报复；算账（get back at）", "to take revenge on", "get back at + 人", "get_even.v.02", None),
    ]),
    ("look into", "look(看) + into(进入) → 往里看", [
        (1, "调查；深入了解", "to investigate", "look into + 案件/问题", "investigate.v.01", None),
    ]),
    ("make out", "make(做) + out(出) → 做出来→辨出", [
        (1, "辨认出；看清/听清", "to manage to see or hear", "make out + 物（暗处/远处）", "spot.v.02", None),
        (2, "理解；弄明白", "to understand", "make out + 意思/内容", "make_out.v.03", None),
        (3, "填写；开（支票/单据）", "to write out (a cheque/list)", "make out + 支票/清单", "write_out.v.02", None),
    ]),
    ("look back", "look(看) + back(后) → 往后看", [
        (1, "回头看", "to look behind one", "look back (at + 人/物)", "look_back.v.01", None),
        (2, "回顾；回想（look back on）", "to think about the past", "look back on + 往事", "review.v.05", None),
    ]),
    ("hold out", "hold(握) + out(向外) → 伸出去", [
        (1, "伸出；递出", "to extend (a hand/object)", "hold out + 手/物", "exsert.v.01", None),
        (2, "坚持；抵抗（hold out against）", "to resist; to refuse to yield", "hold out (against + 压力)", "resist.v.02", None),
        (3, "维持；够用（物资/耐心）", "to last or remain sufficient", "（补给/耐心）hold out", "wear.v.06", None),
    ]),
    ("come along", "come(来) + along(沿) → 沿着来→跟来", [
        (1, "一起来；跟着来", "to come with sb", "come along (with + 人)", None, "tag-along"),
        (2, "（机会等）出现；到来", "to appear or arrive", "（机会）come along", "appear.v.05", None),
        (3, "进展；进步", "to make progress", "how is sth coming along?", "progress.v.01", None),
    ]),
    ("look after", "look(看) + after(在…之后) → 在后面照看", [
        (1, "照顾；照料", "to take care of", "look after + 人/物", "attend.v.02", None),
    ]),
    ("turn away", "turn(转) + away(离开) → 转开", [
        (1, "转过脸去；移开视线", "to move one's face away", "turn away (from + 人/物)", "turn_away.v.01", None),
        (2, "拒之门外；不接纳", "to refuse to admit or accept", "turn away + 人", "reject.v.06", None),
    ]),
    # ===== 块 B″ 第三批（2026-10-10 十三续 · 30 词）=====
    ("break out", "break(破) + out(向外) → 破出来", [
        (1, "爆发；（战争/火灾/骚乱）突然发生", "to begin suddenly (of war, fire, etc.)", "（战事/火灾/骚乱）break out", "break_out.v.02", None),
        (2, "（说/笑/唱）突然迸发；脱口而出", "to burst out (speaking, laughing)", "sb broke out (in/with + 言语/笑声)", "erupt.v.01", None),
        (3, "逃脱；越狱", "to escape (from prison)", "break out of + 牢狱/围困", "break.v.07", None),
        (4, "（疹子/汗）冒出来；突发", "to erupt (of a rash, sweat)", "break out in + 疹子/汗", "erupt.v.08", None),
    ]),
    ("call on", "call(叫) + on(向) → 向…叫", [
        (1, "拜访；看望（某人）", "to pay a short visit to", "call on + 人", None, "visit"),
        (2, "要求；呼吁（call on sb to do / for sth）", "to appeal to; to ask sb to act", "call on sb to do sth / for help", "call_on.v.01", None),
    ]),
    ("run down", "run(跑) + down(向下) → 追下去/跑垮", [
        (1, "撞倒；撞伤（车/机器）", "to injure or kill by running over", "be run down by + 车", "run_down.v.03", None),
        (2, "追捕；追到", "to pursue until captured", "run down + 目标（人/兽）", "run_down.v.07", None),
        (3, "身体垮掉；精疲力竭", "to be worn out in health", "be/feel run down", "poop_out.v.01", None),
        (4, "贬低；说…的坏话", "to disparage; to speak ill of", "run sb/sth down", None, "belittle"),
    ]),
    ("stand by", "stand(站) + by(在旁) → 站在旁边", [
        (1, "支持；忠于（stand by sb/sth）", "to remain loyal to", "stand by + 人/承诺/原则", "stand_by.v.03", None),
        (2, "袖手旁观；不行动", "to look on without acting", "stand by and watch / while…", "stand_by.v.01", None),
        (3, "待命；作好准备", "to be ready for action", "stand by to + 动作（航海/军事）", "stand_by.v.02", None),
    ]),
    ("go about", "go(去) + about(四处) → 四处去", [
        (1, "着手做；着手处理（go about sth）", "to begin to deal with", "go about + 事务/活计", "set_about.v.01", None),
        (2, "四处走动；往来活动", "to move about (in a place)", "go about + 走动/带着…", None, "circulate"),
        (3, "（船）掉头；抢风转向", "to tack (of a ship)", "（船）go about / stand by to go about", None, "tack"),
    ]),
    ("put up", "put(放) + up(向上) → 放上去", [
        (1, "举起；抬起（手/旗/帆）", "to raise (a hand, flag, sail)", "put up + 手/旗/帆", "raise.v.02", None),
        (2, "建造；搭建（房屋/围墙）", "to build or erect", "put up + 建筑/围墙", "raise.v.09", None),
        (3, "住宿；留宿（put sb up / put up at）", "to lodge; to give lodging to", "put sb up / put up at + 处所", "house.v.02", None),
        (4, "张贴；公布（告示/海报）", "to post or display publicly", "put up + 告示/海报", "post.v.10", None),
        (5, "表现出；进行（战斗/抵抗）（put up a fight）", "to offer (resistance, a fight)", "put up a fight/resistance", None, "fight"),
    ]),
    ("bring up", "bring(带) + up(向上) → 带上来", [
        (1, "抚养；养大", "to raise (a child)", "bring up + 孩子 / be brought up", "rear.v.02", None),
        (2, "提出（话题/问题）", "to raise for discussion", "bring up + 话题/问题", "raise.v.19", None),
        (3, "使突然停住；（船）停住", "to come to a sudden stop", "bring up against/at + 处所", "bring_up.v.05", None),
        (4, "（bring up the rear）殿后；走在最后", "to come last in a line", "bring up the rear", None, "rearguard"),
    ]),
    ("hold up", "hold(持) + up(向上) → 举起来", [
        (1, "举起；抬（手/头/物）", "to raise and support", "hold up + 手/头/物", "raise.v.02", None),
        (2, "耽搁；延误（交通/行程）", "to delay; to stop by force", "be held up by/at", "delay.v.01", None),
        (3, "持械抢劫", "to rob at gunpoint", "hold up + 银行/马车/人", "hold_up.v.04", None),
        (4, "举…为例；作为榜样", "to hold sth up as an example", "hold up … as + 榜样", "hold_up.v.02", None),
        (5, "撑住；不垮（经得住考验）", "to endure; to hold out", "hold up (well/under)", "stand_up.v.06", None),
    ]),
    ("turn up", "turn(转) + up(向上) → 转出来", [
        (1, "出现；露面（意外地）", "to appear or arrive unexpectedly", "sb/sth turns up", "come_on.v.01", None),
        (2, "调高（音量/灯火/火）", "to increase (volume, light, heat)", "turn up + 音量/灯火", None, "increase"),
        (3, "卷起；向上翻（衣袖/衣领）", "to roll up (sleeves, collar)", "turn up + 衣袖/衣领/裤脚", None, "rollup"),
        (4, "翻出；发现（牌/旧事/证据）", "to find or bring to light by searching", "turn up + 牌/旧事/证据", "locate.v.01", None),
    ]),
    ("keep up", "keep(保持) + up(向上) → 保持住", [
        (1, "保持；维持（速度/士气/水平）", "to maintain a required pace or level", "keep up + 速度/士气/水平", "keep_up.v.01", None),
        (2, "跟上；不落后（keep up with）", "to keep pace with", "keep up with + 人/时势", None, "keep_pace"),
        (3, "持续不断；不间断", "to continue without stopping", "keep up + 谈话/歌声/通信", "prolong.v.02", None),
    ]),
    ("take in", "take(拿) + in(向内) → 拿进来", [
        (1, "收留；收容（供住宿）", "to provide shelter for", "take in + 房客/寄宿者", "take_in.v.01", None),
        (2, "欺骗；哄骗", "to deceive or cheat", "take sb in", "gull.v.02", None),
        (3, "理解；领会（所见所闻）", "to understand or absorb mentally", "take in + 话/情形", "absorb.v.02", None),
        (4, "吸收；吸纳（水/煤/知识）", "to take up or in (liquid, fuel, etc.)", "take in + 煤/水/供给", "absorb.v.06", None),
        (5, "一眼看清；打量（用眼收入）", "to perceive with the eyes at a glance", "one's eye(s) took in + 物", "watch.v.03", None),
    ]),
    ("hold on", "hold(持) + on(在上) → 抓住不放", [
        (1, "抓住；握牢（hold on to）", "to keep a firm hold of", "hold on to + 物", "grasp.v.01", None),
        (2, "等一下；（电话）别挂", "to wait or stop briefly", "Hold on! / hold on a minute", "hold_on.v.02", None),
        (3, "坚持；撑住（不中断）", "to persist; to keep going", "hold on (its course/bravely)", "persevere.v.01", None),
    ]),
    ("call out", "call(喊) + out(向外) → 喊出去", [
        (1, "大声喊；呼喊", "to shout aloud", "call out (to sb)", "exclaim.v.01", None),
        (2, "点名；高声叫（名字/号码）", "to call aloud (names or numbers)", "call out + 名字/号码", "call_out.v.02", None),
        (3, "召唤…出动；请…来（call out the guard）", "to summon (troops, doctors) into action", "call out + 军警/医生", None, "summonout"),
    ]),
    ("look over", "look(看) + over(遍) → 看一遍", [
        (1, "查看；检查（过一道）", "to examine or inspect", "look over + 文件/房舍", "inspect.v.01", None),
        (2, "宽恕；不计较（look over a fault）", "to pass over without censure", "look over + 过错", None, "condone"),
    ]),
    ("settle down", "settle(安顿) + down(下来) → 安顿下来", [
        (1, "定居；安顿下来（成家立业）", "to settle in a place or way of life", "settle down in/to + 处所/事业", "settle.v.07", None),
        (2, "安静下来；平静下来；（心）定下来", "to become calm or quiet", "settle down (to + 事)", "calm.v.03", None),
        (3, "（鸟/物）落定；栖下", "to come to rest on a surface", "（鸟/雪/夜色）settle down", "settle.v.01", None),
    ]),
    ("cut off", "cut(切) + off(离) → 切离开", [
        (1, "切掉；砍下（肢体/头发/一端）", "to remove by cutting", "cut off + 毛发/肢体/末端", "cut_off.v.03", None),
        (2, "打断；使中断（供给/话语）", "to interrupt or stop (a supply, speech)", "cut off + 供给/话语", "interrupt.v.01", None),
        (3, "隔绝；使与外界断联", "to isolate; to sever from others", "be cut off from + 外界", None, "isolate"),
    ]),
    ("live on", "live(活) + on(靠) → 靠…活", [
        (1, "靠…为生；以…为食", "to subsist on", "live on + 食物/收入", "survive.v.01", None),
        (2, "继续存在；（名声）长存", "to continue to exist", "live on (for ever/in memory)", None, "persist"),
    ]),
    ("turn back", "turn(转) + back(回) → 转回来", [
        (1, "折回；往回走", "to retrace one's course", "turn back (and/to + 处所)", "backtrack.v.01", None),
        (2, "驱回；挡住（来敌/潮水）", "to check or drive back", "turn back + 敌人/潮水", "check.v.18", None),
        (3, "翻回（书页）", "to turn back (the pages)", "turn back to + 页/处", None, "pageback"),
    ]),
    ("turn over", "turn(转) + over(翻过) → 翻过去", [
        (1, "翻转；翻过来（侧/身/物）", "to turn from one side to the other", "turn over (on one's side)", "overturn.v.01", None),
        (2, "移交；交给（pass to）", "to hand over to another", "turn over + 财物/权柄 (to sb)", "pass.v.05", None),
        (3, "翻（书页）；翻阅", "to turn the pages (of a book)", "turn over + 书页", None, "leafthrough"),
        (4, "反复考虑（turn sth over in one's mind）", "to consider carefully", "turn sth over in one's mind", "consider.v.05", None),
    ]),
    ("put out", "put(放) + out(出) → 放出去", [
        (1, "伸出（手/头/舌）", "to extend or stretch out", "put out + 手/头", "exsert.v.01", None),
        (2, "熄灭；扑灭（灯/火）", "to extinguish", "put out + 灯/火", "douse.v.01", None),
        (3, "使不便；打扰；惹恼", "to inconvenience or annoy", "be/feel put out", "trouble.v.02", None),
        (4, "出版；发布（书刊/文告）", "to publish or issue", "put out + 书刊/文告", "publish.v.02", None),
    ]),
    ("set out", "set(放) + out(出) → 放出去/走出去", [
        (1, "出发；动身", "to start a journey", "set out for/at + 处所/时刻", "depart.v.03", None),
        (2, "着手；开始（set out to do）", "to begin with a purpose", "set out to do sth", "get_down.v.07", None),
        (3, "陈列；陈述（有条理地摆出）", "to arrange or state in order", "set out + 事实/货物", "range.v.05", None),
    ]),
    ("turn in", "turn(转) + in(向内) → 转进去", [
        (1, "上交；交出", "to hand over or surrender", "turn in + 报告/赃物/人", "hand_over.v.01", None),
        (2, "上床睡觉", "to go to bed", "turn in (early/late)", "go_to_bed.v.01", None),
        (3, "拐进；转入（路/门）", "to turn into (a road, gate)", "turn in at/into + 门/路", "turn_in.v.01", None),
    ]),
    ("hand over", "hand(手) + over(过) → 手递过去", [
        (1, "交出；移交（权力/财物/人）", "to surrender into another's keeping", "hand over + 物/权 (to sb)", "hand_over.v.01", None),
    ]),
    ("break off", "break(断) + off(离) → 断离", [
        (1, "突然停止；中止（说话/谈话）", "to stop abruptly", "break off (in the middle of)", "cut_short.v.01", None),
        (2, "掰下；折断（一块/一端）", "to detach by breaking", "break off + 一块/枝", "chip.v.01", None),
        (3, "断绝（关系/联系）", "to sever (relations, an engagement)", "break off + 关系/婚约", None, "sever"),
    ]),
    ("turn into", "turn(转) + into(成为) → 转成", [
        (1, "变成；变为", "to become; to change into", "turn into + 名词", "become.v.01", None),
    ]),
    ("grow up", "grow(生长) + up(向上) → 长起来", [
        (1, "长大；成年", "to become an adult", "grow up (in/to be)", "grow_up.v.01", None),
        (2, "（城镇/习俗）兴起；发展起来", "to come into existence and develop", "（城镇/风习）grow up", None, "arise"),
    ]),
    ("wake up", "wake(醒) + up(起来) → 醒起来", [
        (1, "醒来；睡醒", "to stop sleeping", "wake up (early/and + 动作)", "wake_up.v.02", None),
        (2, "唤醒；叫醒（他人）", "to cause sb to wake", "wake sb up", "awaken.v.01", None),
        (3, "醒悟；意识到（wake up to）", "to become aware of", "wake up to + 事实/危险", None, "awaken_to"),
    ]),
    ("look around", "look(看) + around(周围) → 四下看", [
        (1, "环顾；四下张望", "to look about oneself", "look around (one/him)", "look_around.v.01", None),
        (2, "到处寻找（look around for）", "to search about for", "look around for + 目标", None, "search_about"),
    ]),
    ("run out", "run(跑) + out(出去) → 跑光", [
        (1, "用完；耗尽（run out of）", "to become used up; to exhaust a supply", "run out of + 物 / 物 run out", "run_out.v.01", None),
        (2, "（期限）到期；失效", "to lose validity", "（licence/term）run out", "run_out.v.04", None),
    ]),
    ("get over", "get(得到) + over(越过) → 越过去", [
        (1, "克服；战胜（困难/反对）", "to surmount (difficulties, objections)", "get over + 困难/反对", "overcome.v.02", None),
        (2, "（从…中）恢复过来；缓过来", "to recover from (illness, shock)", "get over + 病/打击", "get_well.v.01", None),
        (3, "越过；跨过（墙/溪/障碍）", "to pass over (an obstacle)", "get over + 墙/溪/障碍", "traverse.v.01", None),
        (4, "把…了结；做完（不快的事）", "to bring (a task) to an end", "get sth over (with)", "get_over.v.02", None),
    ]),
    # ===== 块 B″ 第四批（2026-10-10 十五续 · 30 词）=====
    ("keep on", "keep(保持) + on(继续) → 保持下去", [
        (1, "继续（做）；不停", "to continue doing sth", "keep on doing / keep on", "retain.v.02", None),
        (2, "（keep on at sb）不停地纠缠／唠叨", "to pester sb persistently", "keep on at + sb", None, "pester_on"),
    ]),
    ("pass away", "", [
        (1, "去世；逝世", "to die", "（人）pass away", "die.v.01", None),
        (2, "消逝；不复存在", "to go out of existence", "（事物/风俗）pass away", "pass_away.v.02", None),
    ]),
    ("turn on", "turn(转) + on(开) → 转开", [
        (1, "打开（电器/灯/水）", "to cause to operate by a switch", "turn on + 灯/电器/水", "switch_on.v.01", None),
        (2, "取决于；有赖于（turn on sth）", "to be contingent on", "sth turns on + 名词", "depend_on.v.01", None),
        (3, "突然攻击；翻脸（turn on sb）", "to become hostile towards", "turn on + sb", "turn_on.v.04", None),
        (4, "使兴奋；激起（turn sb on）", "to excite or rouse", "turn sb on (to sth)", "agitate.v.02", None),
    ]),
    ("break in", "break(破) + in(入) → 破入", [
        (1, "闯入；破门而入", "to enter illegally or by force", "break in (to) + 处所", "break_in.v.01", None),
        (2, "插话；打断", "to break into a conversation", "break in (on sb / with sth)", "chime_in.v.01", None),
        (3, "使磨合；驯服（新鞋/新马/新手）", "to make submissive, obedient, or useful", "break in + 新鞋/新马/新手", "break_in.v.06", None),
    ]),
    ("put down", "put(放) + down(下) → 放下", [
        (1, "放下；搁下", "to put into a settled position", "put down + 物", "put_down.v.01", None),
        (2, "写下；记下", "to put down in writing", "put down + 名字/地址/数目", "write_down.v.01", None),
        (3, "贬低；羞辱", "to reduce in worth or character, verbally", "put sb down", "put_down.v.04", None),
        (4, "镇压；平定", "to put down by force or authority", "put down + 叛乱/骚乱", "suppress.v.01", None),
    ]),
    ("get off", "get(得) + off(离) → 离开", [
        (1, "下车；下马", "to leave a vehicle", "get off + 车/马", "get_off.v.01", None),
        (2, "下班；获准离开（工作）", "to be relieved of one’s duties", "get off (work)", "get_off.v.02", None),
        (3, "逃脱惩罚；获从轻发落", "to escape unpleasant consequences", "get off (with/lightly)", "get_off.v.05", None),
        (4, "寄出；发出（信件）", "to send by post", "get + 信 + off", "get_off.v.03", None),
    ]),
    ("pass on", "pass(过) + on(向前) → 传下去", [
        (1, "转交；传给", "to hand over to another", "pass on + 物 (to sb)", "pass.v.05", None),
        (2, "传授；传播（知识/消息）", "to transmit (knowledge or skills)", "pass on + 知识/消息", "impart.v.01", None),
        (3, "继续前行；往前走", "to move forward", "pass on (down the road)", "advance.v.01", None),
        (4, "（婉辞）去世", "to die (euphemism)", "（人）pass on", "die.v.01", None),
    ]),
    ("take away", "take(拿) + away(走) → 拿走", [
        (1, "拿走；带走", "to remove from a place", "take away + 物", "take_away.v.01", None),
        (2, "从…处拿走；夺走", "to take from a person or place", "take away + 物 + from sb", "take_away.v.04", None),
        (3, "削减；减弱（效果）", "to diminish", "take away from + 效果/印象", "take_away.v.07", None),
        (4, "外带；买走（食物）", "to buy prepared food to eat elsewhere", "take away + 食物", "take_out.v.12", None),
    ]),
    ("come through", "come(来) + through(穿过) → 穿过来", [
        (1, "挺过；安然渡过（难关/危险）", "to survive (an adversity)", "come through + 难关/危险", "survive.v.02", None),
        (2, "兑现；如期履行（come through with）", "to do what is expected or promised", "come through (with sth)", None, "come_through_with"),
        (3, "穿透；透过", "to penetrate", "come through + 窗/墙/门", "break_through.v.02", None),
        (4, "（消息/申请）到达；获准", "to succeed in reaching after overcoming problems", "（消息/申请）come through", "get_through.v.03", None),
    ]),
    ("carry on", "carry(进行) + on(向前) → 进行下去", [
        (1, "继续（做）；坚持下去", "to keep or maintain in unaltered condition", "carry on + doing / carry on", "continue.v.03", None),
        (2, "继续（说下去）", "to continue talking", "carry on (speaking)", "continue.v.02", None),
        (3, "经营；进行（事业/业务）", "to manage or control", "carry on + 生意/买卖", "conduct.v.01", None),
        (4, "（carry on with sb）与…有暧昧；调情／私通", "to have a flirtatious or illicit affair with sb", "carry on (a flirtation/an intrigue) with + 人", "philander.v.01", None),
    ]),
    ("shut up", "shut(关) + up(上) → 关起来", [
        (1, "闭嘴；安静", "to stop talking; fall silent", "shut up!", "close_up.v.04", None),
        (2, "使闭嘴；堵住（嘴）", "to cause sb to be quiet", "shut sb up", "hush.v.02", None),
        (3, "关起来；锁起来", "to lock in or confine", "shut sb up in + 处所", "lock_in.v.02", None),
    ]),
    ("break down", "break(破) + down(下) → 破下去", [
        (1, "（机器/车）坏掉；出故障", "to stop operating or functioning", "（机器/车）break down", "fail.v.04", None),
        (2, "情绪崩溃；失声痛哭", "to lose control of one’s emotions", "break down (in tears)", "break_down.v.03", None),
        (3, "拆解；分解（分析成分）", "to analyze into components", "break down + 数据/成本/成分", "analyze.v.02", None),
        (4, "垮掉；（体力）崩溃", "to collapse from fatigue or illness", "break down (from overwork)", "break_down.v.08", None),
        (5, "（物质）分解；腐烂", "to decompose", "（食物/物质）break down", "decompose.v.01", None),
    ]),
    ("bring in", "bring(带) + in(入) → 带进来", [
        (1, "引进；带入（新人/新物）", "to bring in a new person or object", "bring in + 人/物", "bring_in.v.01", None),
        (2, "带来（收入）；赚得", "to earn as income", "bring in + 收入/利润", "gain.v.08", None),
        (3, "卖得（某价钱）", "to be sold for a certain price", "（货物）bring in + 价钱", "fetch.v.02", None),
        (4, "（陪审团）做出（裁决）", "to submit (a verdict)", "bring in + 裁决", "bring_in.v.04", None),
    ]),
    ("come across", "come(来) + across(越过) → 走过去撞见", [
        (1, "偶然遇到；碰见", "to encounter by chance", "come across + 人/物", "fall_upon.v.01", None),
        (2, "给人…印象；显得", "to be perceived in a certain way", "come across as + 形/名", "come_across.v.02", None),
        (3, "（意思）被理解；传达出", "to communicate the intended impression", "（话/意思）come across", "come_across.v.04", None),
    ]),
    ("go along", "go(去) + along(沿) → 顺着走", [
        (1, "（go along with sb）与…同行；一起走", "to go or travel along with", "go along with + 人", "accompany.v.02", None),
        (2, "同意；配合；随大流（go along with sth）", "to cooperate or pretend to cooperate", "go along with + 提议/做法", "play_along.v.01", None),
        (3, "进行；（事情）进展", "to continue in a certain state", "（事情）go along", "continue.v.01", None),
    ]),
    ("run through", "run(跑) + through(穿过) → 跑穿", [
        (1, "匆匆过一遍；浏览", "to examine hastily", "run through + 文件/清单", "scan.v.02", None),
        (2, "贯穿；刺穿", "to pierce through", "run through + 人/物 (with sth)", "transfix.v.02", None),
        (3, "耗尽；用光（钱财/资源）", "to use up (resources or materials)", "run through + 钱/财产", "run_through.v.02", None),
        (4, "通读；推敲（think through）", "to apply thoroughly; think through", "run through + 方案/步骤", "run_through.v.01", None),
    ]),
    ("get down", "get(得) + down(下) → 下来", [
        (1, "下来；下去", "to move downward", "get down (from sth)", "descend.v.01", None),
        (2, "咽下；吞下", "to pass through the esophagus", "get down + 食物", "swallow.v.01", None),
        (3, "写下；记下", "to set down in writing", "get down + 名字/要点", "write_down.v.01", None),
        (4, "使沮丧；使消沉", "to lower someone’s spirits", "（事）get sb down", "depress.v.01", None),
        (5, "着手（get down to sth）", "to take the first step in doing sth", "get down to + 工作/正事", "get_down.v.07", None),
    ]),
    ("stand out", "stand(立) + out(出) → 立出来", [
        (1, "显眼；引人注目", "to be highly noticeable", "stand out (against/from)", "leap_out.v.01", None),
        (2, "出众；鹤立鸡群", "to distinguish oneself", "stand out (among/as)", "excel.v.01", None),
        (3, "坚持；不屈服", "to be stubborn in resolution or resistance", "stand out (against + 压力)", "stand_out.v.04", None),
    ]),
    ("pull out", "pull(拉) + out(出) → 拉出来", [
        (1, "拔出；取出", "to bring or take out of a container", "pull out + 物", "draw.v.05", None),
        (2, "驶出；开走（车/船）", "to move out or away", "（车/船）pull out (of)", "pull_out.v.01", None),
        (3, "退出；撤出（协议/活动）", "to withdraw from an undertaking", "pull out of + 协议/活动", "withdraw.v.01", None),
        (4, "抽出；提取（信息/要点）", "to remove with force or effort", "pull out + 信息/要点", "extract.v.01", None),
    ]),
    ("pass out", "pass(过) + out(出) → 过去/发出去", [
        (1, "昏倒；失去知觉", "to faint", "pass out (from + 原因)", "faint.v.01", None),
        (2, "分发；散发", "to give to several people", "pass out + 物品", "pass_out.v.02", None),
        (3, "（军校）毕业", "to graduate from a military academy", "pass out (of + 军校)", "graduate.v.01", None),
    ]),
    ("bring back", "bring(带) + back(回) → 带回来", [
        (1, "带回；归还", "to bring back to the point of departure", "bring back + 物 (from)", "bring_back.v.01", None),
        (2, "使苏醒；使恢复知觉", "to return to consciousness", "bring sb back (to life)", "bring_back.v.02", None),
        (3, "使回忆起；使想起", "to call to mind", "bring back + 回忆/往事", "suggest.v.05", None),
    ]),
    ("come forward", "come(来) + forward(向前) → 走上前", [
        (1, "站出来；挺身而出", "to make oneself visible; take action", "come forward (with/to)", "come_to_the_fore.v.01", None),
        (2, "主动提出；自愿（提供）", "to agree freely to give", "come forward with + 帮助/信息", "volunteer.v.02", None),
    ]),
    ("move in", "move(移) + in(入) → 移入", [
        (1, "搬进；迁入（新居）", "to move into a new house or office", "move in (to + 处所)", "move_in.v.03", None),
        (2, "占据；进驻", "to occupy a place", "move in (on/together)", "move_in.v.01", None),
    ]),
    ("move on", "move(移) + on(向前) → 往前移", [
        (1, "继续前进；往前走", "to move forward", "move on (to + 处所)", "advance.v.01", None),
        (2, "转向（新话题/新阶段）", "to travel onward in time or space", "move on to + 话题/事情", "proceed.v.02", None),
    ]),
    ("pass by", "pass(过) + by(旁) → 从旁过", [
        (1, "经过；路过", "to move past", "pass by + 处所/人", "travel_by.v.01", None),
        (2, "（对…）不起作用；未理会；错过", "to fail to notice or affect", "（机会/运气）pass sb by", "overlook.v.01", None),
    ]),
    ("set down", "set(放) + down(下) → 放下", [
        (1, "放下；搁下", "to put or settle into a position", "set down + 物", "set_down.v.03", None),
        (2, "记下；写下", "to set down in writing", "set down + 事实/话", "write_down.v.01", None),
        (3, "让（乘客）下车", "to let (a passenger) leave a vehicle", "set down + 乘客", "drop.v.08", None),
    ]),
    ("accompany by", "accompany(伴随) + by(被) → 被…伴随", [
        (1, "由…陪同；伴随", "to be present or associated with", "be accompanied by + 人/物", "accompany.v.01", None),
        (2, "（音乐）由…伴奏", "to perform an accompaniment to", "be accompanied by + 乐器", "accompany.v.03", None),
    ]),
    ("hang on", "hang(挂) + on(上) → 挂在上面", [
        (1, "抓住；握紧不放", "to hold on tightly or tenaciously", "hang on (to + 物)", "cling.v.03", None),
        (2, "稍等；（打电话）别挂断", "to hold the phone line open", "hang on (a moment)", "hang_on.v.03", None),
        (3, "坚持；不放弃", "to be persistent, refuse to stop", "hang on (until/through)", "hang_on.v.02", None),
        (4, "取决于；有赖于（hang on sth）", "to be contingent on", "sth hangs on + 名词", "depend_on.v.01", None),
    ]),
    ("take on", "take(拿) + on(上) → 拿起来", [
        (1, "承担；接受（责任/工作）", "to take on duties or responsibilities", "take on + 责任/工作", "assume.v.02", None),
        (2, "呈现；带有（性质/面貌）", "to take on a certain form or aspect", "take on + 性质/面貌", "assume.v.03", None),
        (3, "雇用；招收", "to engage or hire for work", "take on + 人手/员工", "hire.v.01", None),
        (4, "与…较量；迎战", "to contend against an opponent", "take on + 对手", "meet.v.10", None),
    ]),
    ("absorb in", "absorb(吸) + in(入) → 吸进去", [
        (1, "全神贯注于；专心于（be absorbed in）", "to consume all of one’s attention", "be absorbed in + 事/书", "absorb.v.09", None),
    ]),
    # ===== 块 B″ 第五批（2026-10-10 十六续 · 30 词）=====
    ("get through", "get(得到) + through(穿过) → 穿过去", [
        (1, "完成；办完（工作/任务）", "to finish a task completely", "get through + 工作/任务", "get_through.v.01", None),
        (2, "通过（考试）；获准", "to succeed in an examination or be approved", "get through + 考试/审查", None, "pass_exam"),
        (3, "到达；抵达（目的地）", "to reach a destination after overcoming problems", "get through (to + 处所)", "get_through.v.03", None),
        (4, "度过；消磨（时间）", "to spend or pass (time)", "get through + 时间", "while_away.v.01", None),
        (5, "接通（电话）；联系上", "to be in or establish communication with sb", "get through (to sb)", "reach.v.04", None),
    ]),
    ("run over", "run(跑) + over(越过) → 跑过去", [
        (1, "（车辆）撞倒；碾过", "to injure or kill by running over", "（车）run over + 人", "run_down.v.03", None),
        (2, "溢出；漫过", "to flow or run over a limit or brim", "（液体）run over", "overflow.v.01", None),
        (3, "匆匆过一遍；复习", "to go over (a list or text) quickly", "run over + 要点/课文", None, "run_over_review"),
    ]),
    ("look through", "look(看) + through(穿过) → 看穿", [
        (1, "翻阅；浏览", "to read or examine (papers/books) quickly", "look through + 书/文件", None, "look_through_scan"),
        (2, "看穿；识破", "to perceive the true nature of", "look through + 人/伪装", "see_through.v.02", None),
        (3, "透过…看（字面）", "to look through a transparent thing", "look through + 窗/玻璃", None, "look_through_window"),
    ]),
    ("come off", "come(来) + off(离开) → 掉下来", [
        (1, "脱落；掉下", "to come to be detached", "come off (from sth)", "detach.v.03", None),
        (2, "（事情）结果；成功", "to happen in a particular manner", "come off (well/badly)", "go_off.v.05", None),
        (3, "举行；发生", "to take place", "（事件）come off", None, "come_off_occur"),
    ]),
    ("get along", "get(变) + along(沿着) → 往前走", [
        (1, "相处（get along with sb）", "to have smooth relations", "get along with + 人", "get_along_with.v.01", None),
        (2, "进展；过得（如何）", "to proceed or fare", "get along (well/badly)", "do.v.04", None),
        (3, "（继续）往前走", "to move along", "get along (down + 路)", None, "get_along_move"),
    ]),
    ("see through", "see(看) + through(穿过) → 看穿", [
        (1, "看穿；识破", "to perceive the true nature of", "see through + 人/伪装", "see_through.v.02", None),
        (2, "支持…渡过（难关）", "to support (sb) through a period of time", "see sb through + 难期", "see_through.v.01", None),
        (3, "把…坚持做完", "to remain with until completion", "see sth through", "see_through.v.03", None),
    ]),
    ("throw out", "throw(扔) + out(出) → 扔出去", [
        (1, "扔掉；丢弃", "to throw or cast away", "throw out + 物", "discard.v.01", None),
        (2, "驱逐；赶出", "to force to leave or move out", "throw out + 人", "expel.v.01", None),
        (3, "提出（建议/想法）", "to bring forward for consideration", "throw out + 建议/想法", "advance.v.02", None),
        (4, "驳回；不予受理", "to cease to consider; dismiss (a case)", "throw out + 案子/诉状", "dismiss.v.02", None),
        (5, "撵走；罢免", "to remove from a position or office", "throw out + 官员", "oust.v.01", None),
    ]),
    ("throw up", "throw(扔) + up(上) → 往上扔", [
        (1, "呕吐", "to eject the contents of the stomach", "throw up (食物)", "vomit.v.01", None),
        (2, "举起（手/双臂）", "to raise (the hands/arms) suddenly", "throw up + 手/双臂", None, "throw_up_raise"),
        (3, "放弃；辞去（职位/机会）", "to give up (a job or opportunity)", "throw up + 职位/机会", None, "throw_up_abandon"),
    ]),
    ("affected by", "affect(影响) + ed + by(被) → 被…影响", [
        (1, "受…影响", "to be influenced or acted on by", "be affected by + 事/人", "affect.v.01", None),
        (2, "受…感动；被…打动", "to be moved or touched emotionally by", "be affected by + 事", "affect.v.05", None),
    ]),
    ("take down", "take(拿) + down(下) → 拿下", [
        (1, "取下；放下", "to move something to a lower position", "take down + 物 (from)", "lower.v.01", None),
        (2, "记下；写下", "to make a written note of", "take down + 话/要点", "note.v.04", None),
        (3, "拆除；拆掉", "to tear down so as to make flat", "take down + 建筑/帐篷", "level.v.02", None),
        (4, "（言语）贬低；使丢脸", "to reduce in worth or character, usually verbally", "take sb down (a peg)", "take_down.v.02", None),
    ]),
    ("wear out", "wear(穿) + out(尽) → 穿旧", [
        (1, "穿破；用坏", "to deteriorate through use or stress", "wear out + 衣/鞋", "wear.v.04", None),
        (2, "使筋疲力尽", "to exhaust through overuse or strain", "（事）wear sb out", "tire.v.02", None),
        (3, "（物件）磨损报废", "to go to pieces", "（物）wear out", "break.v.42", None),
    ]),
    ("catch up", "catch(抓住) + up(上) → 追上", [
        (1, "追上；赶上", "to reach the point where one should be after a delay", "catch up (with sb)", "catch_up.v.01", None),
        (2, "补上；了解（最新情况）", "to learn belatedly; find out about sth after it happened", "catch up on + 消息/功课", "catch_up.v.02", None),
    ]),
    ("throw away", "throw(扔) + away(掉) → 扔掉", [
        (1, "扔掉；丢弃", "to throw or cast away", "throw away + 物", "discard.v.01", None),
        (2, "浪费；白费（机会/钱财）", "to get rid of (wastefully)", "throw away + 机会/财产", "shed.v.01", None),
    ]),
    ("work on", "work(工作) + on(向) → 对…做功", [
        (1, "从事；忙于（工作/课题）", "to exert effort in order to do or make sth", "work on + 事/课题", "work_at.v.01", None),
        (2, "（对材料）加工；摆弄", "to shape, form, or improve a material", "work on + 材料", "work.v.05", None),
        (3, "（对…）起作用；设法影响", "to try to influence or persuade sb", "work on + 人", None, "work_on_influence"),
    ]),
    ("keep out", "keep(保持) + out(在外) → 挡在外面", [
        (1, "（使）留在外面；不让进入", "to prevent from entering; shut out", "keep out (of + 处所)", "exclude.v.02", None),
        (2, "待在（…）外面；勿入", "to remain outside", "keep out of + 处所", "keep_out.v.02", None),
    ]),
    ("run after", "run(跑) + after(追) → 追着跑", [
        (1, "追赶；追着跑", "to pursue (sb/sth) on foot", "run after + 人/物", None, "run_after_pursue"),
        (2, "追求；追逐（名利/异性）", "to pursue (a person or goal) assiduously", "run after + 名/利/人", None, "run_after_chase"),
    ]),
    ("pick out", "pick(挑) + out(出) → 挑出来", [
        (1, "挑出；选出", "to select from a number of alternatives", "pick out + 物/人", "choose.v.01", None),
        (2, "辨认出；看出", "to detect with the senses; distinguish", "pick out + 人/物 (in)", "spot.v.02", None),
    ]),
    ("step in", "step(迈步) + in(进) → 走进来", [
        (1, "介入；干预", "to get involved so as to alter or hinder an action", "step in (to + 事)", "intervene.v.01", None),
        (2, "暂代；顶替", "to act as a substitute", "step in (for sb)", "substitute.v.03", None),
    ]),
    ("work out", "work(工作) + out(出) → 做出", [
        (1, "算出；解出（答案）", "to make a mathematical calculation or computation", "work out + 数目/答案", "calculate.v.01", None),
        (2, "想出；拟定（办法）", "to come up with (a plan or solution)", "work out + 办法/方案", "work_out.v.01", None),
        (3, "解决；弄明白", "to find the solution to (a problem) or understand the meaning", "work out + 问题/意思", "solve.v.01", None),
        (4, "（结果）发展得；结局（如何）", "to happen in a certain way, leading to a certain outcome", "（事）work out (well/badly)", "work_out.v.02", None),
        (5, "锻炼；健身", "to do physical exercise", "work out (身体)", "exercise.v.04", None),
    ]),
    ("break through", "break(破) + through(穿过) → 破穿而过", [
        (1, "突破；冲破（障碍）", "to pass through (a barrier)", "break through + 防线/障碍", "break_through.v.01", None),
        (2, "取得突破（进展）", "to penetrate; make a breakthrough", "break through (in + 领域)", "break_through.v.02", None),
        (3, "突然出现；喷涌（阳光/欢呼）", "to break out; erupt", "（阳光/欢呼）break through", "erupt.v.04", None),
    ]),
    ("add in", "add(加) + in(入) → 加进去", [
        (1, "加进；加入（配料/内容）", "to add (sth) in", "add in + 物", None, "add_in_include"),
    ]),
    ("cut out", "cut(切) + out(出) → 切掉", [
        (1, "剪下；切掉", "to form and create by cutting out", "cut out + 物", "cut_out.v.02", None),
        (2, "删掉；去掉", "to delete or remove", "cut out + 段落/字句", "cut_out.v.01", None),
        (3, "停止；戒掉", "to cease (doing sth)", "cut out + 习惯/坏毛病", None, "cut_out_stop"),
        (4, "（机器）突然停止运转", "to cease operating", "（引擎）cut out", "cut_out.v.06", None),
    ]),
    ("fall out", "fall(落) + out(出) → 掉出来", [
        (1, "掉出；落下", "to come off; fall out (of sth)", "（物）fall out (of + 处所)", "come_out.v.05", None),
        (2, "争吵；闹翻（fall out with sb）", "to have a breach in relations", "fall out with + 人", "fall_out.v.01", None),
        (3, "（事情）结果是；发生", "to come to pass; turn out", "（事情）fall out", "happen.v.01", None),
    ]),
    ("mix up", "mix(混合) + up(上) → 混起来", [
        (1, "混淆；弄错", "to confuse (one thing with another)", "mix up + A 和 B", "mistake.v.01", None),
        (2, "使困惑；把…搞糊涂", "to cause to be perplexed or confounded", "（事）mix sb up", "stump.v.01", None),
    ]),
    ("give out", "give(给) + out(出) → 发出去", [
        (1, "分发；散发", "to give to several people", "give out + 物 (to sb)", "distribute.v.04", None),
        (2, "发出（光/热/声音）", "to give off or send forth (light/heat/sound)", "give out + 光/热/声", "emit.v.02", None),
        (3, "用尽；耗尽", "to prove insufficient; run out", "（供应/钱）give out", "fail.v.10", None),
        (4, "（机器/体力）垮掉；失灵", "to stop operating or functioning", "（机器/体力）give out", "fail.v.04", None),
    ]),
    ("clear up", "clear(清) + up(上) → 清干净", [
        (1, "（天气）放晴", "to become clear (of weather)", "（天）clear up", "clear_up.v.04", None),
        (2, "澄清；弄清楚（疑团）", "to make clear and comprehensible", "clear up + 疑团/误会", "clarify.v.01", None),
        (3, "收拾；清理", "to make tidy; clear (a mess) away", "clear up + 残局/房间", None, "clear_up_tidy"),
        (4, "（病）痊愈；好转", "to become better or disappear (of an illness)", "（病/症状）clear up", None, "clear_up_heal"),
    ]),
    ("follow up", "follow(跟随) + up(上) → 跟上去", [
        (1, "跟进；追查（后续）", "to increase the effectiveness of by further action", "follow up + 事 (with)", "follow_up.v.02", None),
        (2, "（把…）进行到底；贯彻", "to pursue to a conclusion", "follow up + 计划/线索", "follow_through.v.02", None),
    ]),
    ("speak out", "speak(说) + out(出) → 说出来", [
        (1, "大声说出；直言不讳", "to express one’s opinion openly and without fear", "speak out (against/about)", "opine.v.01", None),
    ]),
    ("think over", "think(想) + over(遍) → 想过一遍", [
        (1, "仔细考虑；反复想", "to reflect deeply on a subject", "think over + 事", "chew_over.v.01", None),
    ]),
    ("fill up", "fill(填) + up(满) → 填满", [
        (1, "填满；装满", "to make full", "fill up + 容器", "fill.v.01", None),
        (2, "（容器）变满；加满（油）", "to become full", "（容器）fill up", "fill.v.02", None),
        (3, "堵塞；填塞", "to fill or stop up", "fill up + 洞/缝", "close.v.15", None),
        (4, "吃饱", "to eat until one is sated", "（人）fill up (on sth)", "fill_up.v.04", None),
    ]),
    # ===== 块 B″ 第六批（2026-10-10 十七续 · 30 词）=====
    ("hang up", "hang(挂) + up(上) → 挂上去", [
        (1, "挂断电话；放下听筒", "to end a telephone call by replacing the receiver", "hang up (the receiver/phone) / hang up on sb", "hang_up.v.01", None),
        (2, "把…挂起来（衣物/帽子）", "to hang (clothes, a hat) on a hook or peg", "hang up + 衣物/帽子", "hang.v.02", None),
    ]),
    ("look down on", "look(看) + down(下) + on(向) → 向下看", [
        (1, "蔑视；看不起", "to regard with contempt or condescension", "look down on + 人", "look_down_on.v.01", None),
        (2, "俯视；往下看（字面）", "to look downward at (from above)", "look down on/at + 下方的人/物", None, "look_down_literal"),
    ]),
    ("push on", "push(推) + on(向前) → 向前推", [
        (1, "继续前进；坚持推进", "to continue moving forward or persevere", "push on (with sth)", "press_on.v.01", None),
    ]),
    ("die out", "die(死) + out(出) → 死绝", [
        (1, "灭绝；绝迹；消失", "to become extinct or gradually disappear", "（物种/风俗/火）die out", "die_out.v.01", None),
    ]),
    ("show off", "show(展示) + off(离开) → 拿出来显摆", [
        (1, "炫耀；卖弄", "to display proudly; to act ostentatiously", "show off (sth/to sb)", "flaunt.v.01", None),
        (2, "使显眼；衬托得好看", "to display (sth) to advantage; to set off", "show off + 优点/身材", "bring_out.v.04", None),
    ]),
    ("wrap up", "wrap(包) + up(起来) → 包起来", [
        (1, "全神贯注于；倾心于（be/get wrapped up in）", "to be absorbed or engrossed in", "be wrapped up in + 人/事", None, "wrapped_up_in"),
        (2, "包起来；裹好", "to cover or enclose by wrapping", "wrap up + 物品", "wrap.v.01", None),
        (3, "穿得暖和", "to dress warmly (in clothes)", "be wrapped up (warm)", "cover.v.26", None),
        (4, "完成；收尾（工作）", "to finish (a task, a meeting)", "wrap up + 工作/会议", "get_through.v.01", None),
    ]),
    ("run across", "run(跑) + across(横过) → 跑着穿过", [
        (1, "偶然碰见；无意发现", "to meet or find by chance", "run across + 人/物", "meet.v.01", None),
        (2, "跑着穿过（字面）", "to run across (a space or room)", "run across + 场地", None, "run_across_literal"),
    ]),
    ("count on", "count(数) + on(在…上) → 数着…指望", [
        (1, "指望；依靠；信赖", "to rely on; to expect confidently", "count on + 人/事", None, "rely_on"),
    ]),
    ("leave out", "leave(留) + out(在外) → 留在外面", [
        (1, "排除在外；不包括", "to exclude from a group or list", "leave out + 人/内容", "exclude.v.01", None),
        (2, "省去；漏掉（词语/部分）", "to omit (a word or a part)", "leave out + 词/部分", "neglect.v.01", None),
    ]),
    ("put away", "put(放) + away(离开) → 放到一边", [
        (1, "收起来；放回原处；收拾好", "to put (things) in their proper place", "put away + 物品（收好）", "tidy.v.01", None),
        (2, "储存；储蓄（钱）", "to save (money) for future use", "put away + 钱", "save.v.05", None),
        (3, "把…关起来（监狱/精神病院）", "to confine (in prison or an asylum)", "put away + 人（关起来）", "imprison.v.01", None),
        (4, "大吃；吃光", "to eat up (a large quantity of food)", "put away + 食物", "tuck_in.v.01", None),
    ]),
    ("turn down", "turn(转) + down(下) → 转下去", [
        (1, "调低；拧小（灯火/煤气/音量）", "to reduce (a light, gas, or volume)", "turn down + 灯火/煤气/音量", "turn_down.v.05", None),
        (2, "拒绝；回绝（请求/人）", "to reject or refuse (a request or person)", "turn down + 请求/人", "refuse.v.02", None),
        (3, "拐入；沿（街）走去", "to go down (a street or lane) by turning", "turn down + 街道/巷", "turn_down.v.04", None),
    ]),
    ("hand out", "hand(手) + out(出) → 递出去", [
        (1, "分发；散发", "to distribute (to several people)", "hand out + 物品 (to sb)", "distribute.v.04", None),
    ]),
    ("bring down", "bring(带) + down(下) → 带下来", [
        (1, "使下降；使降低（水平/价格）", "to reduce (a level, a price)", "bring down + 水平/价格", "reduce.v.01", None),
        (2, "击落；打倒（鸟/飞机/人）", "to cause to fall; to shoot down", "bring down + 鸟/飞机/人", "land.v.02", None),
        (3, "招致；引起（怒/祸）", "to cause (anger or punishment) to come upon sb", "bring down + 怒/祸 (on sb)", "inflict.v.01", None),
        (4, "把…拿下来（从楼上/高处）", "to carry (sth) down (from upstairs or above)", "bring down + 物品", None, "bring_down_carry"),
    ]),
    ("cut in", "cut(切) + in(入) → 切入", [
        (1, "插话；打断（谈话）", "to interrupt (a conversation)", "cut in (with sth / on sb)", "chime_in.v.01", None),
        (2, "（车辆）抢道；加塞", "to drive into the space in front of another vehicle", "（车）cut in (in front of sb)", "cut_in.v.02", None),
        (3, "让…分一份；算…一份（cut sb in on sth）", "to allow sb a share of the profit", "cut sb in (on + 收益)", "cut_in.v.01", None),
    ]),
    ("go after", "go(去) + after(追随) → 跟着去", [
        (1, "追赶；追捕", "to pursue (with intent to catch)", "go after + 人/物", "chase.v.01", None),
        (2, "追求；谋求", "to try to obtain or achieve", "go after + 目标/机会", "quest_for.v.01", None),
    ]),
    ("show up", "show(现) + up(上) → 露出来", [
        (1, "出现；露面；到场", "to appear or arrive", "show up (at/in + 地点)", "come_on.v.01", None),
        (2, "显露；暴露（缺点/问题）", "to become or make visible; to reveal", "show up + 缺点/问题", "show.v.08", None),
        (3, "引…上楼；带…上楼", "to escort (sb) upstairs", "show sb up (to a room)", None, "show_up_escort"),
    ]),
    ("keep away", "keep(保持) + away(远离) → 保持远离", [
        (1, "远离；不接近；使…远离", "to stay away or prevent from coming near", "keep away (from + 人/物) / keep sb away", "keep_away.v.01", None),
    ]),
    ("let out", "let(让) + out(出) → 让出去", [
        (1, "泄露；说漏（秘密/心事）", "to reveal (a secret)", "let out + 秘密/心事", "unwrap.v.02", None),
        (2, "发出（声音/叫喊）；吐（气）", "to utter (a sound or cry) or let out (breath)", "let out + 叫声/叹息/气", "utter.v.02", None),
        (3, "放出；放走；放开", "to release or allow to go out", "let out + 人/物", None, "let_out_release"),
        (4, "出租", "to rent out (a house or rooms)", "let out + 房屋/房间", "lease.v.03", None),
    ]),
    ("put aside", "put(放) + aside(一边) → 放到一边", [
        (1, "搁置；暂不理会；放下", "to put (sth) aside; to set aside temporarily", "put aside + 事/心情", "put_away.v.07", None),
        (2, "储蓄；存下（钱）", "to save (money) for future use", "put aside + 钱", "save.v.05", None),
        (3, "挪开；拨开（挡路之物）", "to move (sth) to one side", "put aside + 遮挡物", None, "put_aside_move"),
    ]),
    ("take back", "take(拿) + back(回) → 拿回来", [
        (1, "收回（说过的话）；认错", "to retract (a statement)", "take back + 话", "swallow.v.05", None),
        (2, "取回；要回；拿回", "to regain possession of", "take back + 物品", "take_back.v.02", None),
        (3, "带回（原处）；送回", "to bring back to a place", "take back + 人/物 (to + 处所)", "return.v.05", None),
        (4, "使…愣住；使吃惊（be taken back）", "to surprise or startle (be taken back)", "be taken back (by sth)", None, "taken_back_surprise"),
    ]),
    ("drop off", "drop(落) + off(离开) → 掉下去", [
        (1, "睡着；打盹", "to fall asleep", "drop off (to sleep)", "fall_asleep.v.01", None),
        (2, "掉落；脱落", "to fall off (of a part)", "（部分）drop off", None, "drop_off_fall"),
        (3, "减少；下降；（渐渐）消失", "to diminish or fall off", "（数量/兴趣）drop off", "drop_off.v.01", None),
        (4, "顺路送到；让…下车", "to leave or unload (sb or sth)", "drop sb/sth off (at + 地点)", "drop.v.08", None),
    ]),
    ("move out", "move(移) + out(出) → 移出去", [
        (1, "搬出；迁出", "to move out of a residence or office", "move out (of + 处所)", "move_out.v.02", None),
        (2, "（列车/队伍）开出；出发", "to depart (of a train or troops)", "（车/队）move out", None, "move_out_depart"),
    ]),
    ("pass down", "pass(过) + down(下) → 往下传", [
        (1, "传下来；传给后代", "to be passed on (as by inheritance) to descendants", "pass sth down (to sb) / be passed down", "hand_down.v.01", None),
        (2, "沿（过道/楼梯）走下去；走过", "to go down (along a passage or stairs)", "pass down + 走道/楼梯", None, "pass_down_along"),
    ]),
    ("sit back", "sit(坐) + back(后) → 往后坐", [
        (1, "靠回（椅背）；往后坐", "to settle back into a comfortable sitting position", "sit back (in one's chair)", "sit_back.v.01", None),
        (2, "袖手旁观；不插手", "to be inactive or indifferent while sth happens", "sit back (and let sth happen)", "sit_by.v.01", None),
    ]),
    ("cut down", "cut(砍) + down(下) → 砍下去", [
        (1, "削减；减少（数量/开支）", "to reduce (an amount or spending)", "cut down (on) + 数量/开支", "reduce.v.01", None),
        (2, "砍倒（树）", "to fell (a tree)", "cut down + 树", "fell.v.01", None),
        (3, "砍杀；击倒（人）", "to kill or knock down (a person)", "cut down + 人", "down.v.05", None),
    ]),
    ("go around", "go(走) + around(绕) → 绕着走", [
        (1, "传开；流传（消息/病）", "to become widely known and passed on", "（消息/病）go around", "go_around.v.02", None),
        (2, "旋转；转动", "to revolve; to turn on an axis", "（轮/指针）go around", "revolve.v.01", None),
        (3, "绕过；回避", "to bypass or avoid", "go around + 障碍/问题", "bypass.v.01", None),
        (4, "四处走动；串门", "to go about (visiting places or people)", "go around (to + 处所)", None, "go_around_visit"),
        (5, "够用；人人有份", "to be sufficient for everyone", "enough to go around", "go_around.v.01", None),
    ]),
    ("hold back", "hold(握) + back(后) → 往后拉住", [
        (1, "拦住；阻挡（前进/靠近）", "to hold back; to restrain physically", "hold back + 人/物", "check.v.18", None),
        (2, "抑制；忍住（情绪/冲动）", "to restrain (an urge or tears)", "hold back + 冲动/泪", "restrain.v.01", None),
        (3, "保留；隐瞒（不透露）", "to withhold (information or a share)", "hold back + 消息/真相", "conceal.v.02", None),
        (4, "退缩；犹豫不前", "to refrain or hesitate (from doing)", "hold back (from doing)", "forbear.v.01", None),
    ]),
    ("pull off", "pull(拉) + off(脱) → 拉下来", [
        (1, "脱掉（衣物/鞋帽）", "to remove (clothing) by pulling", "pull off + 衣物/鞋帽", "draw_off.v.01", None),
        (2, "成功办成；圆满完成（难事）", "to succeed in achieving (sth difficult)", "pull off + 计划/把戏", "pull_off.v.03", None),
        (3, "（船）驶离；划开", "to move off (of a boat)", "（船）pull off (for/to)", None, "pull_off_depart"),
    ]),
    ("go ahead", "go(去) + ahead(前) → 往前走", [
        (1, "干吧；进行；动手", "to proceed (with an action)", "go ahead (and do sth) / go ahead with sth", "go_ahead.v.01", None),
        (2, "先行；走在前面（go ahead of）", "to go in advance (of sb)", "go ahead (of + 人)", None, "go_ahead_advance"),
    ]),
    ("put together", "put(放) + together(一起) → 放到一起", [
        (1, "组装；拼装；汇集", "to assemble (parts or a team)", "put together + 部件/队伍", "assemble.v.01", None),
        (2, "合起来（总计）；加在一起", "taken collectively; added together", "all ... put together", None, "put_together_total"),
        (3, "拼凑；编成（故事/文字）", "to compose (from parts)", "put together + 故事/句子", None, "put_together_compose"),
    ]),
    # ===== 块 B″ 第七批（2026-10-10 十八续 · 30 词）=====
    ("turn around", "turn(转) + around(绕) → 转过来", [
        (1, "转身；回头（朝反方向）", "to turn abruptly and face the other way", "（人）turn around (and + do)", "swing_around.v.01", None),
        (2, "好转；扭转（局面）", "to improve significantly; to go from bad to good", "turn around + 局面/生意", "turn_around.v.03", None),
        (3, "绕行；绕过", "to go around (an obstacle or along a curve)", "turn around + 障碍/沿…绕行", None, "turn_around_go_round"),
    ]),
    ("back up", "back(向后) + up(向上) → 往后靠", [
        (1, "后退；倒退（车/人）", "to move backwards from a position", "（车/人）back up (against/to + 处所)", "back_up.v.02", None),
        (2, "支持；声援；为…撑腰", "to give moral or practical support to", "back sb up / back up + 主张", "support.v.01", None),
        (3, "备份（文件/资料）", "to make a security copy of (data)", "back up + 文件/资料", "back_up.v.04", None),
    ]),
    ("cheer up", "cheer(鼓舞) + up(起来) → 振作起来", [
        (1, "使高兴；给…打气", "to make sb feel happier or more cheerful", "cheer sb up / cheer up + 人/心", "cheer.v.03", None),
        (2, "振作起来；高兴起来", "to become cheerful", "（人）cheer up", "cheer.v.04", None),
    ]),
    ("drop out", "drop(落) + out(出) → 掉出来", [
        (1, "掉出；落出（从…掉下来）", "to fall out (of sth)", "drop out (of + 处所)", None, "drop_out_fall"),
        (2, "退出；中途退出（比赛/名单）", "to withdraw from (a contest or list)", "drop out (of + 比赛/名单)", None, "drop_out_quit"),
        (3, "退学；辍学", "to leave school or a course prematurely", "drop out (of + 学校)", "drop_out.v.03", None),
        (4, "（从社会/常规中）退出；离群索居", "to withdraw from established society", "drop out (of + 社会)", "drop_out.v.02", None),
    ]),
    ("write down", "write(写) + down(下) → 写下来", [
        (1, "写下；记下", "to put down in writing", "write down + 内容/名字/地址", "write_down.v.01", None),
        (2, "减低（账面价值）；贬低", "to reduce the estimated value of", "write down + 资产/价值", "expense.v.01", None),
    ]),
    ("get together", "get(得到) + together(一起) → 聚到一起", [
        (1, "相聚；聚会；碰头", "to meet socially or for a purpose", "（人）get together (and + do)", "meet.v.02", None),
        (2, "召集；聚拢；凑集", "to get people or things together", "get together + 人/物", "assemble.v.03", None),
        (3, "合作；共同（get together on sth）", "to work together on a common enterprise", "get together (on + 事)", "collaborate.v.01", None),
    ]),
    ("keep back", "keep(保持) + back(后) → 留在后面", [
        (1, "隐瞒；不透露（事实/真相）", "to withhold (facts, the truth)", "keep back + 事实/消息", "withhold.v.01", None),
        (2, "拦住；阻挡（人群/前进）", "to restrain or hold back (a crowd)", "keep back + 人群/敌人", "restrain.v.01", None),
        (3, "扣下；截留（部分钱财）", "to retain (part of money or goods)", "keep back + 部分（钱/物）", "retain.v.03", None),
        (4, "退后；别靠近", "to stay back; to keep one’s distance", "Keep back!（叫退后）", None, "keep_back_stay"),
    ]),
    ("wear off", "wear(磨损) + off(掉) → 磨掉", [
        (1, "（药效/印象/感觉）逐渐消退；减弱", "to diminish or fade gradually", "（效果/印象）wear off", None, "wear_off_fade"),
        (2, "磨掉；磨去（字面）", "to diminish by friction; to rub away", "wear off + 涂层/字迹", "wear_away.v.02", None),
    ]),
    ("base on", "base(基于) + on(在…上) → 以…为基", [
        (1, "以…为基础；根据…（be based on）", "to use as a basis for; to found on", "be based on + 事实/证据", "establish.v.08", None),
    ]),
    ("die down", "die(死) + down(下) → 平息下去", [
        (1, "（火/风/声音/情绪）渐渐平息；减弱；熄灭", "to become progressively weaker", "（火/风/声）die down", "die_down.v.02", None),
    ]),
    ("tear down", "tear(撕) + down(下) → 拆下来", [
        (1, "拆毁；拆除（建筑/制度）", "to tear down so as to make flat with the ground", "tear down + 建筑/制度", "level.v.02", None),
        (2, "扯下；撕下（挂着的东西）", "to pull down (sth hanging)", "tear down + 挂饰/蛛网", None, "tear_down_pull"),
        (3, "飞奔；疾驰（沿街）", "to rush or race (along a street)", "（人）tear down + 街/路", None, "tear_down_race"),
    ]),
    ("tear up", "tear(撕) + up(碎) → 撕碎", [
        (1, "撕碎；撕毁（纸/布/票）", "to tear into shreds", "tear up + 纸/信/票", "shred.v.01", None),
        (2, "拔起；连根拔起（树/路轨）", "to pull up by or as if by the roots", "tear up + 树/路面", "uproot.v.03", None),
    ]),
    # wipe out 判据句（2026-10-10 三十二续 · CC 判）：r1 ＝「**使之彻底不复存在（实体或事态）**」、**不含两量相抵**；
    #   r2 ＝「**两量相抵／勾销**」（锚 `cancel_out.v.01`）⇒ r2 只许由**正向相抵 cue** 认领，不收 `everything` 这类兜底词（歧义宾语默认给 r1）。
    ("wipe out", "wipe(擦) + out(掉) → 擦掉", [
        (1, "消灭；根除；歼灭；使（实体/事态）彻底不复存在", "to eliminate completely and without a trace", "wipe out + 敌人/害虫/事态（假象·信心·势力）", "wipe_out.v.03", None),
        (2, "勾销；抵消；（旧账/往事）一笔勾销", "to cancel out; to offset (a loss, a debt, a past)", "wipe out + 旧账/损失/罪/往事", "cancel_out.v.01", None),
    ]),
    ("advantage in", "advantage(优势) + in(在…上) → 在…有优势", [
        (1, "（在…方面的）好处；优势", "a benefit or superiority in (doing sth)", "advantage in + 事/动名词", None, "advantage_in_benefit"),
        (2, "（网球）发球占先", "a tennis score favouring the server", "advantage in（网球计分）", None, "advantage_in_tennis"),
    ]),
    ("call back", "call(喊) + back(回) → 喊回来", [
        (1, "回喊；大声回答（朝身后）", "to call out in reply; to shout back", "（人）call back (to sb)", None, "call_back_shout"),
        (2, "召回；叫回", "to summon or cause to return", "call sb back (to + 处所)", "recall.v.07", None),
        (3, "回电话", "to return or repeat a telephone call", "call sb back（回电话）", "call_back.v.03", None),
    ]),
    ("fall through", "fall(落) + through(穿过) → 落穿过去", [
        (1, "（计划/交易）落空；失败", "to fail utterly; to collapse", "（计划/交易）fall through", "fall_through.v.01", None),
    ]),
    ("give away", "give(给) + away(离开) → 送出去", [
        (1, "赠送；送掉；捐出", "to make a gift of", "give away + 钱/物 (to sb)", "give_away.v.01", None),
        (2, "泄露；暴露；出卖", "to make known (a secret); to betray", "give away + 秘密/行踪", "unwrap.v.02", None),
        (3, "（婚礼上）把新娘交给新郎", "to hand over (a bride) to the bridegroom", "give away + 新娘", "give_away.v.03", None),
    ]),
    ("hand down", "hand(手) + down(下) → 往下递", [
        (1, "传给后代；传下来（遗产/习俗）", "to pass on (as by inheritance) to descendants", "hand sth down (to + 后代)", "hand_down.v.01", None),
        (2, "往下递；传下来（物）", "to pass (sth) down by hand", "hand down + 物（往下递）", None, "hand_down_pass"),
    ]),
    ("let in", "let(让) + in(进) → 让进来", [
        (1, "让…进来；放进", "to allow to enter; to admit", "let sb in", "admit.v.02", None),
        (2, "使（光/空气）透入", "to let (light or air) enter", "let in + 光/空气", None, "let_in_light"),
        (3, "让…参与；接纳（let sb in on sth）", "to allow sb to participate in or share", "let sb in (on + 事)", "admit.v.03", None),
    ]),
    ("hang out", "hang(挂) + out(出) → 挂出去", [
        (1, "挂出去；伸出去；晾在外面", "to hang outside (of a window); to put out to dry", "hang out (of + 窗/处所)", None, "hang_out_hang"),
        (2, "闲逛；厮混（hang out with sb）", "to spend time idly (with sb)", "hang out (with + 人)", "hang_out.v.01", None),
    ]),
    ("let down", "let(让) + down(下) → 放下去", [
        (1, "放下；放低（窗帘/窗）", "to move (sth) to a lower position", "let down + 窗帘/窗/物", "lower.v.01", None),
        (2, "放长（衣服/裙摆）", "to lengthen (a garment) by letting out a hem", "let down + 衣/裙摆", None, "let_down_lengthen"),
        (3, "使失望；辜负", "to fail to meet the hopes of", "let sb down（使失望）", "disappoint.v.01", None),
    ]),
    ("put forward", "put(放) + forward(向前) → 往前放", [
        (1, "提出；建议（观点/方案）", "to put before (an idea for consideration)", "put forward + 建议/观点", "submit.v.02", None),
        (2, "伸出（手/脚）", "to stretch out (a hand or foot)", "put forward + 手/脚", None, "put_forward_reach"),
        (3, "提名；推举（候选人）", "to propose as a candidate", "put forward + 人选", "nominate.v.01", None),
    ]),
    ("turn off", "turn(转) + off(关) → 转开", [
        (1, "关掉；关上（煤气/灯/水）", "to cause to stop operating by a switch", "turn off + 煤气/灯/水", "switch_off.v.01", None),
        (2, "拐入；转入（街道/岔路）", "to make a turn (off a road)", "turn off (into/on + 路)", "turn_off.v.02", None),
        (3, "使…反感；使失去兴趣", "to cause to feel dislike or distaste", "turn sb off（使反感）", "turn_off.v.03", None),
    ]),
    ("butt in", "butt(顶) + in(进) → 顶进来", [
        (1, "插嘴；插一手；干涉", "to break into a conversation; to intrude", "butt in (on + 事)", "chime_in.v.01", None),
        (2, "（用头）撞入；顶入", "to push in with the head", "butt in + 处所（用头撞）", None, "butt_in_head"),
    ]),
    ("slow down", "slow(慢) + down(下) → 慢下来", [
        (1, "减速；慢下来", "to lose velocity; to move more slowly", "（车/人）slow down", "decelerate.v.01", None),
        (2, "放慢；减缓（进度/速度）", "to cause to proceed more slowly", "slow down + 进度/工作", "slow.v.03", None),
        (3, "松弛下来；别太拼命", "to relax; to take one’s ease", "slow down（别太累）", "relax.v.01", None),
    ]),
    ("build up", "build(建) + up(起) → 建起来", [
        (1, "逐步建立；发展；壮大；积聚", "to enlarge, develop or accumulate by degrees", "build up + 事业/城镇/声望/力量", "build_up.v.01", None),
        (2, "增强（体力/信心）；使强健", "to bolster or strengthen", "build up + 体力/信心", "build_up.v.04", None),
    ]),
    ("come around", "come(来) + around(绕) → 绕过来", [
        (1, "（到某处）来；过来（串门）", "to come to a place (on a visit)", "come around (to + 处所)", None, "come_around_visit"),
        (2, "（定期）到来；又到了", "to happen regularly; to come round again", "（时节/日子）come around", "come_around.v.02", None),
        (3, "回心转意；改变看法", "to change one’s position or opinion", "come around (to + 看法)", "come_round.v.01", None),
    ]),
    ("fall back on", "fall(落) + back(后) + on(在…上) → 退回去靠", [
        (1, "转而依靠；求助于；退而求其次", "to have recourse to; to turn to for help", "fall back on + 人/物/办法", "fall_back.v.05", None),
        (2, "仰倒在…上；靠回（字面）", "to fall or rest back on (a pillow)", "fall back on + 枕/垫", None, "fall_back_on_rest"),
    ]),
    ("shut down", "shut(关) + down(下) → 关下来", [
        (1, "停工；关厂；停业", "to cease to operate", "（工厂/机器）shut down", "close_up.v.01", None),
        (2, "关下；合上（盖子/门窗/桌面）", "to close down (a lid or desk)", "shut down + 盖/门/桌", None, "shut_down_close"),
        (3, "（夜色/寂静）降临；笼罩", "to descend and settle (of darkness, silence)", "（夜色/寂静）shut down (on + 处所)", None, "shut_down_descend"),
    ]),
    ("speak up", "speak(说) + up(上) → 大声说", [
        (1, "大声说；说响点", "to speak louder; to raise one’s voice", "（人）speak up", "speak_up.v.02", None),
        (2, "直言不讳；大胆说出（意见）", "to express one’s opinion openly", "speak up (for/against + 事)", "opine.v.01", None),
    ]),
# ===== 块 B″ 第八批（2026-10-10 十九续 · 30 词）=====
    ("bustle about", "bustle(忙乱) + about(四处) → 忙来忙去", [
        (1, "忙碌地走动；四处奔忙", "to move about busily and energetically", "（人）bustle about (+ doing)", "bustle.v.01", None),
    ]),
    ("convert into", "convert(转变) + into(成为) → 变成", [
        (1, "把…变成；使转变为", "to change sth into another form or substance", "convert sth into + 名", "convert.v.01", None),
        (2, "（把房屋）改建为；（被）改作", "to adapt a building for a different use", "be converted into + 房间/用途", None, "convert_into_remodel"),
    ]),
    ("fill in", "fill(填) + in(进) → 填进去", [
        (1, "填写（表格/空白处）", "to write the required information on a form", "fill in + the form/blank/space", "complete.v.05", None),
        (2, "补上；补全（细节/轮廓）", "to supply the missing information or detail", "fill in + the outline/details", "fill_in.v.01", None),
        (3, "消磨（时间）；打发（时间）", "to pass the time while waiting", "fill in the time (by doing)", None, "fill_in_time"),
        (4, "临时替补；代替（他人）", "to act as a substitute for sb", "fill in for + 人", "substitute.v.02", None),
    ]),
    ("fill out", "fill(填) + out(出来) → 填满", [
        (1, "填写（表格）", "to complete a form by writing information", "fill out + the blanks/form", "complete.v.05", None),
        (2, "（人/身体）变丰满；长胖", "to become rounder or plumper", "（人/脸/身体）fill out", "round.v.07", None),
        (3, "使更完整；充实；补充", "to make sth more complete or full", "fill out + 内容", "eke_out.v.01", None),
        (4, "（帆）鼓起；张开", "(of sails) to swell and take the wind", "（帆）fill out", None, "fill_out_sail"),
    ]),
    ("pay off", "pay(付) + off(清) → 付清", [
        (1, "还清；偿清（债务/欠款）", "to pay all of a debt", "pay off + debt/loan", "liquidate.v.02", None),
        (2, "付清工资（并遣散）；（结账）打发走", "to pay workers or servants and discharge them", "pay off + 工人/仆人/车夫", "pay.v.05", None),
        (3, "有回报；见成效；成功", "to bring a good result", "（努力/风险）pay off", "pay_off.v.01", None),
        (4, "贿赂；收买", "to bribe", "pay sb off", "buy_off.v.01", None),
        (5, "报复；算账", "to take revenge on sb", "pay sb off (for sth)", "pay_back.v.02", None),
    ]),
    ("pull in", "pull(拉) + in(进) → 拉进来", [
        (1, "吸引；招徕（观众/顾客）", "to attract a crowd or customers", "pull in + 观众/顾客", "attract.v.01", None),
        (2, "赚（钱）；挣得", "to earn money", "pull in + 钱", "gain.v.08", None),
        (3, "（车/船）驶入；进站；靠岸", "(of a train or boat) to move in and stop", "pull in (+ to + 地点)", "pull_in.v.03", None),
        (4, "拉进；收拢；缩回（肢体等）", "to draw or pull sth in", "pull in + 物/肢体", None, "pull_in_draw"),
        (5, "集合；聚集（人/物）", "to gather together", "pull in + 人/物", "collect.v.04", None),
    ]),
    ("send off", "send(送) + off(出去) → 送出去", [
        (1, "寄出；发出；派出（信件/电报/人）", "to send a letter, telegram, or person away", "send off + 信/电报/人", "dispatch.v.01", None),
        (2, "使迸发；放出（火花/光等）", "to give off or throw out sparks or light", "send off + 火花/光", "project.v.11", None),
        (3, "送别；为…送行", "to say goodbye to sb who is leaving", "send sb off", "send.v.06", None),
    ]),
    ("take after", "take(取) + after(随后) → 跟着来", [
        (1, "长得像（长辈/亲属）", "to resemble a parent or relative", "take after + 人", "take_after.v.01", None),
        (2, "追赶；追捕", "to chase after sb/sth", "take after + 人/物", None, "take_after_chase"),
        (3, "仿效；学…的样；以…为榜样", "to imitate the behavior of sb", "take after + 人", "take_after.v.02", None),
    ]),
    ("wind up", "wind(绕) + up(上) → 绕上去", [
        (1, "以…告终；最后落得", "to end up doing sth", "wind up + doing/by doing", "finish_up.v.02", None),
        (2, "（给钟表）上发条", "to wind the spring of a clock or watch", "wind up + the watch/clock", "wind.v.05", None),
        (3, "结束；收尾（讲话/列举）", "to bring a speech or list to an end", "wind up (+ with + 名)", None, "wind_up_end"),
        (4, "了结；清理（事务）；结业", "to settle and close an estate or business", "wind up + the estate/business", None, "wind_up_settle"),
        (5, "使兴奋；激起（情绪）", "to excite or arouse sb", "wind sb up", "arouse.v.07", None),
        (6, "（投球前）抡臂；挥臂", "to swing the arm before pitching", "wind up the arm", "wind_up.v.02", None),
    ]),
    ("keep off", "keep(保持) + off(离开) → 保持离开", [
        (1, "别靠近；站开（远离）", "to stay away from sth", "keep off (+ 地点)", "keep_off.v.02", None),
        (2, "避免（食物/饮料）；戒（酒）", "to refrain from food or drink", "keep off + the drink", "keep_off.v.01", None),
        (3, "挡住；使不近；驱散", "to ward off; to hold at a distance", "keep off + the darkness/evil spirits", None, "keep_off_ward"),
        (4, "不下（雨）；（雨）暂未落", "(of rain) to hold off", "（雨）keep off", None, "keep_off_refrain"),
    ]),
    ("sell out", "sell(卖) + out(出去) → 卖出去", [
        (1, "卖光；售完（存货）", "to sell all of one’s stock", "sell out (of + 货)", "sell_out.v.01", None),
        (2, "卖掉（全部产业/股份）；变卖", "to sell all of a business, shares, or property", "sell out + 产业/股份", None, "sell_out_liquidate"),
        (3, "出卖；背弃（同伴）", "to betray or abandon a person", "you are sold out", "sell_out.v.02", None),
    ]),
    ("bridge over", "bridge(架桥) + over(越过) → 架桥越过", [
        (1, "弥合；跨越（分歧/隔阂）", "to connect or overcome a gap or difficulty", "bridge over + 分歧", "bridge.v.01", None),
        (2, "帮…渡过（难关）；接济度过", "to help sb get through a short period", "bridge sb over + 难关", "tide_over.v.01", None),
    ]),
    ("clean up", "clean(弄干净) + up(起来) → 收拾干净", [
        (1, "打扫；清理；收拾干净", "to put a place or things in order", "clean up (+ 房间/东西)", "tidy.v.01", None),
        (2, "梳洗整理；打扮（自己）", "to make oneself clean and neat", "（人）clean up", "clean_up.v.04", None),
        (3, "清除掉；肃清（不良事物）", "to dispose of or remove sth bad", "clean up + 垃圾/乱象", "clean_up.v.03", None),
        (4, "大赚一笔（短期暴利）", "to make a big profit in a short time", "clean up (on + 事)", "clean_up.v.02", None),
    ]),
    ("fit in", "fit(合适) + in(进) → 合进来", [
        (1, "合得来；融入（群体）", "to get along and be accepted in a group", "fit in (with + 人)", "harmonize.v.01", None),
        (2, "与…相符；吻合（事实/说法）", "to be in agreement with sth", "fit in with + 事实", None, "fit_in_agree"),
        (3, "装得进；塞进去（尺寸合适）", "to have the right size to go into a space", "fit in (+ 空间)", None, "fit_in_slot"),
    ]),
    ("hang around", "hang(挂) + around(周围) → 挂在周围", [
        (1, "闲荡；徘徊；（在附近）逗留", "to loiter or wait about", "hang around (+ 地点)", "loiter.v.01", None),
        (2, "挂在…周围；（头发等）垂在", "to hang loosely around sth", "hang around + the neck", None, "hang_around_hang"),
    ]),
    ("knock down", "knock(敲) + down(下) → 敲下去", [
        (1, "击倒；撞倒；打倒", "to cause sb/sth to fall by a blow", "knock down + 人/物", "down.v.05", None),
        (2, "打倒在地（重击）", "to knock sb down with force", "knock sb down", "deck.v.03", None),
        (3, "拆除；拆掉（建筑/棚屋）", "to demolish a building", "knock down + 建筑", None, "knock_down_demolish"),
        (4, "降价；压低（价格）", "to reduce a price", "knock down + the price", None, "knock_down_price"),
    ]),
    ("let off", "let(让) + off(离开) → 放走", [
        (1, "宽恕；免除（惩罚/责任）", "to excuse or release sb from a duty or punishment", "let sb off (+ 事)", "excuse.v.02", None),
        (2, "放（枪/炮/烟花）；使爆炸", "to fire a gun or set off fireworks", "let off + 枪/烟花", None, "let_off_fire"),
        (3, "发泄（怒气/情绪）", "to release anger or emotion", "let off + rage", None, "let_off_vent"),
        (4, "分租出去（房屋）", "to let out rooms to tenants", "let off + 楼层/房间", None, "let_off_rent"),
    ]),
    ("step up", "step(步) + up(上) → 迈步上前", [
        (1, "走近；上前；进来", "to come forward or up to a place", "step up (+ to + 地点)", None, "step_up_approach"),
        (2, "提高；增加（程度/强度）", "to increase in extent or intensity", "step up + 产量/行动", "escalate.v.01", None),
        (3, "加速（引擎转速）", "to speed up an engine", "step up + the engine", "rev_up.v.01", None),
        (4, "站出来；挺身而出；采取行动", "to come forward and take action", "step up (to do)", "come_to_the_fore.v.01", None),
    ]),
    ("use up", "use(用) + up(完) → 用完", [
        (1, "用光；耗尽；用完", "to consume all of one’s resources", "use up + 钱/物资", "consume.v.05", None),
        (2, "占掉；消耗（时间/空间）", "to take up time or space", "use up + 时间/空气", "take.v.02", None),
    ]),
    ("watch out", "watch(看) + out(外) → 往外看着", [
        (1, "当心；留神；提防", "to be careful; to be on the lookout", "watch out (for + 人/物)", "watch.v.05", None),
        (2, "小心！（危险警告）", "used as a warning of danger", "Watch out!", None, "watch_out_warn"),
    ]),
    ("acquiesce in", "acquiesce(默许) + in(在…上) → 默许", [
        (1, "（勉强地）默许；默认；听任", "to accept or assent to sth without protest", "acquiesce in + 事", "assent.v.01", None),
    ]),
    ("act up", "act(做) + up(上) → 行事", [
        (1, "（act up to sth）遵循；做到；按…行事", "to act in accordance with a principle or expectation", "act up to + 原则/期望", None, "act_up_to"),
        (2, "调皮捣蛋；（孩子）胡闹", "to misbehave; to behave badly", "（孩子/人）act up", "act_up.v.01", None),
        (3, "（旧病）发作；（机器）出毛病", "(of an illness or machine) to become troublesome", "（病/机器）act up", "act_up.v.02", None),
    ]),
    ("advantage over", "advantage(优势) + over(胜过) → 胜过", [
        (1, "（比…）占优势；有利条件", "a condition giving superiority over sb", "have/get an advantage over + 人", None, "advantage_over_edge"),
    ]),
    ("blow up", "blow(吹) + up(上) → 吹上去", [
        (1, "炸毁；炸掉", "to destroy sth by an explosion", "blow up + 目标", "explode.v.01", None),
        (2, "（被）炸开；爆炸", "to burst or explode", "（物）blow up", "detonate.v.02", None),
        (3, "（风）刮起来；变天", "(of wind or weather) to rise; to come up", "it is blowing up (+ 形)", None, "blow_up_wind"),
        (4, "发怒；大发脾气", "to become very angry", "（人）blow up", "flip_one's_lid.v.01", None),
        (5, "夸大；渲染（使显得更大）", "to exaggerate or make sth seem bigger", "blow up + 事件", "blow_up.v.02", None),
        (6, "充气；使膨胀", "to fill sth with air or gas", "blow up + 气球/轮胎", "inflate.v.02", None),
    ]),
    ("put back", "put(放) + back(回) → 放回去", [
        (1, "放回原处；送回", "to return sth to its place", "put back + 物", "replace.v.03", None),
        (2, "推迟；延后", "to postpone sth", "put back + 会议/议程", None, "put_back_defer"),
        (3, "（船）返航；回港", "(of a ship) to return to port", "（船）put back (+ into/to)", None, "put_back_return"),
        (4, "往后拢；拨回（头发/衣物）", "to push hair or cloth back", "put back + the hair/clothes", None, "put_back_sweep"),
        (5, "使花费（多少钱）", "to cost sb a certain amount", "set sb back + 钱", "set_back.v.03", None),
    ]),
    ("take over", "take(取) + over(过) → 接过来", [
        (1, "接管；接手；接任（职务/工作）", "to take control of or take charge of", "take over + 工作/案件", "take_over.v.05", None),
        (2, "占据；占用（场所）", "to occupy a place", "take over + 场所", None, "take_over_occupy"),
        (3, "占…上风；占…便宜", "to get the better of sb", "take over + 人", None, "take_over_best"),
        (4, "收购；接管（公司）", "to take over ownership of a company", "take over + 公司", "assume.v.06", None),
    ]),
    ("try out", "try(试) + out(出) → 试出来", [
        (1, "试验；试用；验证（理论/物）", "to test sth to see whether it works", "try out + 理论/机器", "test.v.01", None),
        (2, "熬炼（鲸脂）；炼出（油）", "to melt down blubber to obtain oil", "try out + the blubber", None, "try_out_render"),
        (3, "试演；参加选拔", "to audition for a role", "try out for + 角色", "audition.v.01", None),
        (4, "尝试（新事物）", "to try sth new in order to gain experience", "try out + 新事物", "experiment.v.02", None),
    ]),
    ("beset by", "beset(围困) + by(被) → 被围住", [
        (1, "被…包围；受…困扰；为…所苦", "to be troubled or plagued by sth", "be beset by + 困难/情绪", "harass.v.01", None),
        (2, "被…围攻；遭…袭击", "to be attacked on all sides by", "be beset by + 敌人/狗", "beset.v.02", None),
    ]),
    ("check in", "check(检查) + in(进) → 检查进来", [
        (1, "登记入住；报到（旅馆/机场）", "to register one’s arrival", "check in (at + 旅馆)", "check_in.v.01", None),
        (2, "骤然停住；制止（马/人）", "to stop suddenly; to check", "（人/动物）check in + 动作", None, "check_in_halt"),
    ]),
    ("give back", "give(给) + back(回) → 给回去", [
        (1, "归还；交还；还回", "to return sth to its owner", "give back + 物", "refund.v.01", None),
        (2, "反射（光）；回响（声音）；传回", "to reflect light or echo sound", "（光/声）give back", None, "give_back_reflect"),
    ]),
# ===== 块 B″ 第九批（2026-10-10 二十一续 · 30 词）=====
    ("knock out", "knock(敲) + out(出去) → 敲出去", [
        (1, "打昏；击倒（拳击中打晕对手）", "to knock sb unconscious, esp. in boxing", "knock sb out (with a blow)", "knock_cold.v.01", None),
        (2, "淘汰；击败（使不能继续参赛）", "to eliminate sb from a competition", "knock out + 对手/队（be knocked out of + 赛事）", "knock_out.v.01", None),
        (3, "打掉；砸掉；毁坏（使之脱落／破损）", "to destroy or break sth forcefully", "knock out + 物（the bottom / one's eye）", "knock_out.v.03", None),
        (4, "使倾倒；使惊叹（着迷）", "to overwhelm sb with admiration", "knock sb out (with sth)", "knock_out.v.04", None),
        (5, "敲出；磕掉（烟斗里的灰）", "to empty a pipe by knocking out the ashes", "knock out + the pipe/ashes", "knock_out.v.05", None),
        (6, "使精疲力尽；累垮", "to exhaust sb completely", "（人）be knocked out (by/after sth)", None, "knock_out_exhaust"),
    ]),
    ("stay up", "stay(留) + up(上) → 留在上面／不睡", [
        (1, "熬夜；不睡（很晚才睡）", "to not go to bed", "stay up (late/all night/(doing))", "stay_up.v.01", None),
        (2, "留在（上面／原处）不下来；待着不走", "to remain up in a place rather than come down", "stay up (there/in + 地点)", None, "stay_up_remain"),
    ]),
    ("step down", "step(跨步) + down(向下) → 往下走", [
        (1, "走下（台阶／平台）；往下走", "to move down by stepping", "step down (from/off/into + 地点)", "step.v.01", None),
        (2, "（从高位）退下；辞职；下台", "to give up a position or office", "step down (from + 职位/高位)", "leave_office.v.01", None),
        (3, "降低；减弱（程度／规模）", "to reduce the level or intensity of sth", "step down + 程度/规模", "de-escalate.v.02", None),
    ]),
    ("try on", "try(试) + on(上身) → 试穿", [
        (1, "试穿；试戴（衣物／帽子／鞋）", "to put on a garment to see whether it fits", "try on + 衣物/帽/鞋", "try_on.v.01", None),
        (2, "试用；试行（办法／手段）", "to attempt or try out a measure", "try on + 措施/办法", "try.v.01", None),
        (3, "耍（花招）；拿…试探／戏弄", "to attempt sth risky, or to tease sb", "try it on (with sb)", None, "try_on_trick"),
    ]),
    ("warm up", "warm(暖) + up(起来) → 暖起来", [
        (1, "热身；做准备活动", "to do exercises to prepare for sports", "（运动员）warm up (before + 活动)", "limber_up.v.02", None),
        (2, "（人）活跃起来；谈得起劲；热络起来", "to become more friendly, lively, or animated", "（人）warm up (to + 话题/人)", "warm_up.v.02", None),
        (3, "加热（食物）；使变暖", "to make sth warm or warmer", "warm up + 食物/房间", "warm.v.02", None),
        (4, "变暖；转暖", "to get warm or warmer", "（天气/房间/人）warm up", "warm.v.01", None),
        (5, "（机器／引擎）预热", "to run until the normal working temperature is reached", "（引擎/机器）warm up", "warm_up.v.01", None),
    ]),
    ("beam on", "beam(发光/含笑) + on(朝向) → 朝着…放光／堆笑", [
        (1, "对…笑容满面；愉快地看着", "to smile radiantly at sb", "beam on + 人", "beam.v.01", None),
        (2, "（光／阳光）照在…上；照耀", "to shine brightly on sth", "（光/太阳）beam on + 地点", "shine.v.02", None),
        (3, "（向…）播送；发送（电波／节目）", "to broadcast in a given direction", "beam + 节目/电波 + on/to + 地点", "air.v.03", None),
    ]),
    ("branch off", "branch(分枝) + off(分出去) → 岔出去", [
        (1, "分岔；岔开；（人／车）岔到别的路上", "to divide into a branch, or to turn off a way", "（路/河/线/车）branch off (from/to/through + 地点)", "branch.v.02", None),
        (2, "（话题）岔开；转到别的话题上", "to turn to a different subject", "branch off into + 话题", None, "branch_off_topic"),
    ]),
    ("call off", "call(叫) + off(离开) → 叫开／喊停", [
        (1, "取消；叫停（活动／比赛／计划）", "to cancel or call to a halt", "call off + 活动/计划/比赛", "cancel.v.01", None),
        (2, "把…叫走；唤开（人／狗）", "to summon sb or an animal away", "call off + 人/狗 (from sth)", None, "call_off_summon_away"),
        (3, "引开；转移（注意力）", "to divert sb's attention", "call off + sb's attention", None, "call_off_divert"),
        (4, "喊出（方阵舞的舞步）", "to give the calls for a square dance", "call off + the dance", "call.v.16", None),
    ]),
    ("catch on", "catch(抓住) + on(上) → 抓住／挂上", [
        (1, "明白过来；领会（catch on to sth）", "to understand after some initial difficulty", "catch on (to + 事)", "catch_on.v.01", None),
        (2, "流行起来；为大众所接受", "to become popular", "（做法/书/人）catch on", "catch_on.v.02", None),
        (3, "挂住；钩住（被尖物勾住）", "to become hooked or caught on sth", "（衣物）catch on + 尖物", None, "catch_on_hook"),
    ]),
    ("get across", "get(到达) + across(横过) → 过去／传过去", [
        (1, "把…讲清楚；使（对方）明白", "to communicate successfully", "get sth across (to sb)", "get_across.v.01", None),
        (2, "（话／意思）被听懂；被接受", "to become clear to sb", "（话语）get across (to sb)", "click.v.07", None),
    ]),
    ("get ahead", "get(变得) + ahead(在前) → 走到前头", [
        (1, "领先；超过（get ahead of）", "to get in front of sb or sth", "get ahead of + 人/物", "gain.v.05", None),
        (2, "发迹；出人头地；有出息", "to prosper or succeed in life", "（人）get ahead (in life/the world)", None, "get_ahead_prosper"),
    ]),
    ("look ahead", "look(看) + ahead(前头) → 往前看", [
        (1, "朝前看；看前方", "to direct one's gaze in front", "look ahead (+ to/at + 前方)", "look.v.01", None),
        (2, "着眼未来；为将来打算", "to think about or plan for the future", "look ahead (+ to + 将来)", None, "look_ahead_future"),
    ]),
    ("calm down", "calm(平静) + down(下来) → 平静下来", [
        (1, "平静下来；镇静下来", "to become quiet or calm", "（人/人群）calm down", "calm.v.03", None),
        (2, "使平静；安抚（某人）", "to make sb calm or still", "calm sb down", "calm.v.01", None),
        (3, "（风／海／局势）平息；缓和", "to become quiet or less intense", "（风/局势/事态）calm down", "lull.v.02", None),
    ]),
    ("get by", "get(到达) + by(旁边) → 从旁边过去", [
        (1, "过得去；勉强应付（生活／收入）", "to manage to live or cope", "（人）get by (on + 收入)", "cope.v.01", None),
        (2, "从旁走过；让路通过", "to pass or move in front of", "（人）get by (+ 人/物)", "get_by.v.02", None),
        (3, "侥幸逃过；未受惩罚", "to escape unpleasant consequences", "get by (with sth)", "get_off.v.05", None),
    ]),
    ("condense into", "condense(浓缩) + into(成为) → 缩成", [
        (1, "把…压缩／凝缩成（简短形式）", "to make more concise", "condense + 内容 + into + 简短形式", "digest.v.07", None),
        (2, "凝结成；冷凝成（气体变成液体）", "to change from a gas to a liquid", "（水汽）condense into + 水珠", "condense.v.01", None),
    ]),
    ("lay off", "lay(放) + off(离开) → 放下／停下", [
        (1, "解雇；暂时停雇（工人）", "to dismiss workers, usually for economic reasons", "lay off + 工人（be laid off）", "furlough.v.01", None),
        (2, "停止；搁下（工作／嗜好）", "to put an end to an activity", "lay off + 事/嗜好", "discontinue.v.01", None),
        (3, "（船）在（某处外）停泊等待", "to anchor or lie off a place", "（船）lay off + 地点", None, "lay_off_anchor"),
    ]),
    ("pull over", "pull(拉) + over(过去) → 拉过去", [
        (1, "（车）靠边停车；把车开到路边", "to steer a vehicle to the side of the road", "（车/司机）pull over", "pull_over.v.01", None),
        (2, "（船／划桨）靠过去；划到一旁", "to row or move over to a place", "（船）pull over (+ to + 地点)", None, "pull_over_row"),
    ]),
    ("put through", "put(放) + through(穿过) → 送过去", [
        (1, "完成；实现；使（计划／改革）通过", "to carry sth through to a successful issue", "put through + 计划/改革/议案", "follow_through.v.02", None),
        (2, "做完；干完（一批活计）", "to finish or carry out a task", "put through + 活儿/一批活", None, "put_through_finish"),
        (3, "接通（电话）；为…接通电话", "to connect by telephone", "put sb through (to + 人/处)", "put_through.v.02", None),
    ]),
    ("think through", "think(想) + through(透) → 想透", [
        (1, "彻底想清楚；通盘考虑（再动手）", "to consider sth thoroughly", "think through + 方案/问题", None, "think_through_fully"),
        (2, "揣摩（他人的心思）；顺着…的思路想", "to think following sb's mind or reasoning", "think through + sb's mind", None, "think_through_mind"),
    ]),
    ("think up", "think(想) + up(出来) → 想出来", [
        (1, "想出；想到（办法／去处）", "to devise or invent an idea", "think up + 办法/去处", "think_up.v.01", None),
        (2, "凭空编造；捏造（借口／谎话）", "to invent a story or excuse", "think up + 借口/谎话", None, "think_up_fabricate"),
    ]),
    ("back down", "back(后退) + down(向下) → 往回退", [
        (1, "让步；退缩；打退堂鼓", "to withdraw from a stand or claim", "（人）back down (from/on + 事)", "chicken_out.v.01", None),
        (2, "（沿原路）往回走；退回去", "to move backwards down or along", "（人）back down + 路/方向", "back_up.v.02", None),
    ]),
    ("brush up", "brush(刷) + up(起来) → 刷上来", [
        (1, "温习；复习（brush up on sth）", "to refresh one's memory of sth", "brush up (on) + 知识/语言", "review.v.04", None),
        (2, "（重新）修饰；使完善；改进", "to bring to a finished or refined state", "brush up + 外表/作品", "polish.v.03", None),
        (3, "刷亮；掸净；梳齐（胡须／衣服）", "to clean or smarten by brushing", "brush up + 胡须/衣服", None, "brush_up_clean"),
    ]),
    ("circle around", "circle(绕圈) + around(周围) → 绕着转", [
        (1, "绕圈；盘旋；兜圈子", "to move around in a circular motion", "（人/鸟/物）circle around", "revolve_around.v.02", None),
        (2, "围绕（某物）转；绕到…去", "to move around sth or to get round to it", "circle around (+ to/behind + 物)", None, "circle_around_about"),
    ]),
    ("drop by", "drop(落下) + by(顺路) → 顺路一落", [
        (1, "顺路拜访；随便来访", "to visit informally and spontaneously", "drop by (+ 人/处)", "drop_by.v.01", None),
    ]),
    ("end up", "end(结束) + up(上来) → 最后到了", [
        (1, "最终来到；结果落到（某处／某境地）", "to finally be or arrive somewhere", "end up (+ 地点/状态)", "finish_up.v.02", None),
        (2, "以…收尾；最后（做某事）", "to finish by doing sth", "end up + doing/by doing/with + 名", None, "end_up_with"),
    ]),
    ("pull through", "pull(拉) + through(穿过) → 拉过来", [
        (1, "挺过来；恢复健康；度过难关", "to survive an adversity or illness", "（人/事）pull through (+ 病/难关)", "survive.v.02", None),
        (2, "把…救过来；帮…渡过（危机）", "to bring sb into safety", "pull sb through + 病/难关", "save.v.03", None),
    ]),
    ("set back", "set(放) + back(后) → 往后放", [
        (1, "推迟；延后", "to hold back to a later time", "set back + 时间/计划", "postpone.v.01", None),
        (2, "阻碍；延缓（进展）", "to slow down the progress of", "set back + 进展/发展", "set_back.v.02", None),
        (3, "使花费（多少钱）", "to cost a certain amount", "set sb back + 钱", "set_back.v.03", None),
        (4, "把…往后放；（房屋）内退／缩进", "to place back or away from the front", "be set back (from + 街/路)", None, "set_back_position"),
    ]),
    ("sort out", "sort(分类) + out(出来) → 分出来", [
        (1, "整理；挑拣出；分门别类", "to arrange or select by sorting", "sort out + 文件/物", "classify.v.01", None),
        (2, "解决；理清（混乱／问题）", "to make clear or settle", "sort out + 问题/纠纷", "clear.v.10", None),
        (3, "惩罚；整治（某人）", "to punish or deal with sb", "sort sb out", "discipline.v.02", None),
    ]),
    ("coil in", "coil(盘绕) + in(里) → 盘在里头", [
        (1, "盘绕在（里面）；绕成卷（盘在容器中）", "to wind in coils within sth", "coil in + 容器/位置", "coil.v.03", None),
    ]),
    ("contract in", "contract(收缩) + in(向里) → 往里缩", [
        (1, "收缩；缩紧（因冷等往里缩）", "to squeeze or press together; become smaller", "（物/身体）contract in + 冷/热", "contract.v.03", None),
    ]),
    # ===== 块 B″ 第十批（2026-10-10 二十二续 · 30 词）=====
    ("figure out", "figure(算出) + out(出来) → 算出来／弄出来", [
        (1, "弄明白；搞清楚（弄清所以然）", "to understand or find out about sb or sth", "figure out + 事/人；(人) figure out that…", "figure.v.05", None),
        (2, "想出；定出（办法／计划／路线）", "to devise or work out a plan or a way", "figure out + 办法/计划/路线", None, "figure_out_devise"),
        (3, "算出；算清（数目／费用）", "to calculate or work out by arithmetic", "figure out + 数目/费用", "calculate.v.01", None),
    ]),
    ("get around", "get(到达) + around(周围) → 到各处去", [
        (1, "到处走动；四处游历", "to move about from place to place", "（人）get around (+ 地点/in + 时间)", "get_around.v.04", None),
        (2, "绕开；避开（难题／规定）", "to avoid or circumvent", "get around + 难题/规定/人", "bypass.v.01", None),
        (3, "（消息／谣言）传开；流传", "to become known or circulate", "（消息/事）get around", "break.v.46", None),
        (4, "交游广；到处交际", "to be socially active", "（人）get around", "swing.v.11", None),
    ]),
    ("give off", "give(给) + off(出去) → 发出去", [
        (1, "发出；散发（光／热／气味／烟）", "to send forth light, heat, smell, smoke, etc.", "give off + 光/热/气/烟/味", "emit.v.02", None),
        (2, "产生（副产品）；附带生出", "to have as a by-product", "give off + 副产物", "give_off.v.01", None),
    ]),
    ("add on", "add(加) + on(上去) → 加上去", [
        (1, "另外加上；附加（额外之物）", "to add as an extra", "add on + 物 / add + 物 + on", "add_on.v.01", None),
        (2, "扩（建）；在末尾添建", "to add at the end; to make an extension", "add on (to + 房/建筑)", "append.v.01", None),
    ]),
    ("add up", "add(加) + up(合起来) → 加起来", [
        (1, "把…加起来；算出总和", "to determine the sum of", "add up + 数目/账", "total.v.02", None),
        (2, "加起来（是）；合计（达）", "to amount to; to total", "（数目）add up to + 数", "total.v.01", None),
        (3, "（说法／情况）说得通；对得上", "to be reasonable, logical or consistent", "（说法/事）add up", "make_sense.v.01", None),
        (4, "累积成；最终意味着（add up to）", "to develop into; to amount to", "add up to + 结果/结论", "come.v.15", None),
    ]),
    ("back off", "back(后退) + off(离开) → 退开", [
        (1, "退后；往后退（让开）", "to move backwards away from sth", "（人/车）back off", "back_up.v.02", None),
        (2, "（从主张／承诺上）退缩；放弃", "to withdraw from a stand or commitment", "（人）back off (from + 事)", "chicken_out.v.01", None),
    ]),
    ("base in", "base(设基) + in(在) → 设在…", [
        (1, "把…设在（某地）；以…为基地／本部", "to station or establish in a place", "be based in + 地点；base + 人/公司 + in + 地点", "base.v.02", None),
    ]),
    ("branch out", "branch(分枝) + out(出去) → 分枝出去", [
        (1, "扩展（业务／范围）；另辟新方向", "to expand into new areas or activities", "branch out (into + 新领域)", "diversify.v.03", None),
        (2, "（路／河／线）岔出去；分出支线", "to divide into branches; to turn off", "（路/河/线）branch out (of/from + 处)", "branch.v.02", None),
    ]),
    ("bridge across", "bridge(架桥) + across(横跨) → 架桥跨过", [
        (1, "架桥横跨；在…上架桥（跨越）", "to build a bridge across; to span", "bridge + 河/谷/鸿沟 + across", "bridge.v.02", None),
    ]),
    ("center on", "center(居中) + on(在…上) → 聚在…上", [
        (1, "以…为中心；围绕（主题／人）", "to have as a center; to focus on", "（思绪/讨论/注意）center on + 主题/人", "focus_on.v.01", None),
        (2, "把…置于中心；把中心放在…上", "to place at the center", "center + 物 + on + 处", "center_on.v.02", None),
    ]),
    ("cut back", "cut(切) + back(回) → 切回去", [
        (1, "削减；缩减（开支／规模）", "to reduce or cut down on", "cut back (on + 开支/产量)", "reduce.v.01", None),
        (2, "（沿原路）折返；往回走", "to turn back; to retrace one's way", "（人/车）cut back (+ to/over + 处)", None, "cut_back_return"),
        (3, "修剪（树枝／灌木）；剪短", "to prune or trim back growth", "cut back + 枝/树", "snip.v.02", None),
        (4, "（叙述）回溯；倒叙（cut back to）", "to return in time", "cut back (to + 过去)", "cut_back.v.01", None),
    ]),
    ("kick off", "kick(踢) + off(开) → 踢开", [
        (1, "踢掉；踢开（鞋等）", "to remove shoes or sth by kicking", "kick off + 鞋/物", None, "kick_off_remove"),
        (2, "开始；启动（活动／会议）", "to begin or launch", "kick off + 活动/会议", "inaugurate.v.01", None),
        (3, "（足球）开球；开赛", "to start a football match", "（球赛）kick off", None, "kick_off_play"),
    ]),
    ("pay back", "pay(付) + back(回) → 付回去", [
        (1, "还（钱）；偿还（欠款）", "to repay money owed", "pay back + 钱/债；pay + 人 + back", "repay.v.01", None),
        (2, "报复；以牙还牙（pay sb back）", "to take vengeance on; to get even", "pay + 人 + back (for + 事)", "pay_back.v.02", None),
        (3, "报答；答谢", "to act or give recompense in return", "pay back + 恩情/好意", "reward.v.03", None),
    ]),
    ("pick on", "pick(挑) + on(朝…) → 挑上", [
        (1, "挑中；选中（某人）", "to single out or choose sb", "pick on + 人/物", None, "pick_on_choose"),
        (2, "挑剔；找茬儿；欺负（某人）", "to find fault with; to bully or tease", "pick on + 人", None, "pick_on_bully"),
    ]),
    ("speed up", "speed(速) + up(上去) → 加起速来", [
        (1, "（使）加快；加速（进程）", "to cause to move or happen faster", "speed up + 进程/工作", "accelerate.v.02", None),
        (2, "（自身）加速；越走越快", "to move faster", "（人/车/物）speed up", "accelerate.v.01", None),
    ]),
    ("bounce off", "bounce(弹) + off(离开) → 弹开", [
        (1, "（从…上）弹起；弹开", "to rebound off a surface", "（球/物）bounce off + 表面", None, "bounce_off_rebound"),
        (2, "（把想法）说给…听以探反应", "to test an idea on sb", "bounce + 想法 + off + 人", None, "bounce_off_idea"),
    ]),
    ("brag about", "brag(吹) + about(关于) → 吹关于…", [
        (1, "吹嘘；炫耀（brag about/of sth）", "to boast about sth", "brag about/of + 事/物", "boast.v.01", None),
    ]),
    ("burn out", "burn(烧) + out(出去) → 烧完", [
        (1, "烧尽；烧完（燃料／火焰耗尽）", "to stop burning for lack of fuel", "（火/蜡烛/灯）burn out", "burn.v.01", None),
        (2, "（把…）烧坏；烧毁（内部烧坏）", "to destroy or become useless by burning", "burn out + 电灯/线圈；(物) burn out", "blow_out.v.01", None),
        (3, "精疲力竭；累垮（身心耗尽）", "to exhaust or wear out from overwork", "（人）burn out", None, "burn_out_exhaust"),
    ]),
    ("chip in", "chip(切块) + in(进去) → 投块进去", [
        (1, "凑钱；凑份子（chip in + 钱）", "to contribute money or help", "chip in (+ 钱/份子)", "contribute.v.02", None),
        (2, "插话；插嘴（加入谈话）", "to interrupt with a remark", "chip in (with + 话)", None, "chip_in_interject"),
    ]),
    ("clutter up", "clutter(杂乱) + up(堆起) → 堆杂", [
        (1, "使杂乱；堆满（clutter up + 地方）", "to fill or cover in a disorderly way", "clutter up + 地方/桌面", "clutter.v.01", None),
    ]),
    ("decrease by", "decrease(减少) + by(按…) → 按…减", [
        (1, "减少了（若干）；（按…幅度）下降", "to diminish by a certain amount", "decrease by + 数/比例", "decrease.v.01", None),
    ]),
    ("fall apart", "fall(落) + apart(分开) → 散开", [
        (1, "散架；破碎（物成碎片）", "to break into pieces; to come apart", "（物/结构）fall apart", "break.v.02", None),
        (2, "崩溃；瓦解（关系／计划／局面）", "to fail or come to pieces", "（关系/计划/局面）fall apart", "crumble.v.02", None),
        (3, "（精神）垮掉；情绪失控", "to lose one's emotional composure", "（人）fall apart", "fall_apart.v.01", None),
    ]),
    ("write off", "write(写) + off(划掉) → 划掉", [
        (1, "（把…）勾销；注销（债务／账目）", "to cancel a debt", "write off + 债/账", "write_off.v.03", None),
        (2, "把…看作没用；认定…不行", "to concede the loss or worthlessness of", "write off + 人/事 (as + 形容)", "write_off.v.01", None),
        (3, "（从资产中）减记；摊销（贬值）", "to reduce the estimated value of", "write off + 资产/设备", "expense.v.01", None),
        (4, "（不假思索地）一挥而就；顺手写出", "to write fluently and without hesitation", "write off + 文章/信", "write_off.v.02", None),
    ]),
    ("angle on", "angle(弄角度) + on(朝…) → 转向…", [
        (1, "拐弯抹角地引（人）上钩；诱引", "to guide or manoeuvre indirectly", "angle on + 人/事", None, "angle_on_manoeuvre"),
        (2, "斜向；对准（某角度）", "to slant or aim at an angle", "angle on/at + 目标", "angle.v.01", None),
    ]),
    ("ask around", "ask(问) + around(四周) → 四处问", [
        (1, "四处打听；到处问（ask around for sb/sth）", "to inquire of various people", "ask around (for + 人/物)", "ask.v.01", None),
    ]),
    ("aspire after", "aspire(渴望) + after(追求) → 追求", [
        (1, "渴望；追求（aspire after/to sth）", "to have a lofty goal; to long for", "aspire after + 名/目标", "draw_a_bead_on.v.02", None),
    ]),
    ("blunder away", "blunder(瞎撞) + away(掉) → 撞掉了", [
        (1, "挥霍掉；白白丢掉（机会／财产）", "to squander or waste", "blunder away + 机会/财产", None, "blunder_away_squander"),
        (2, "（笨手笨脚地）弄丢；失掉", "to lose by clumsiness", "blunder away + 物", None, "blunder_away_lose"),
    ]),
    ("bolster up", "bolster(垫) + up(起来) → 垫起来", [
        (1, "支撑；加固；加强（信心／制度）", "to support and strengthen", "bolster up + 信心/制度/说法", "bolster.v.01", None),
    ]),
    ("bounce back", "bounce(弹) + back(回) → 弹回来", [
        (1, "（受挫／病后）恢复；复元；重振", "to recover or improve after a setback", "（人/事/经济）bounce back", "get_well.v.01", None),
    ]),
    ("bulk up", "bulk(块) + up(起来) → 鼓起来", [
        (1, "（使）变厚实／增大；（练）长肌肉", "to increase in size, weight, or muscle", "（人/物）bulk up", "bulge.v.04", None),
        (2, "膨出；鼓起来", "to stick out or swell", "（物）bulk up", "bulk.v.01", None),
    ]),
    # ===== 块 B″ 第十一批（2026-10-10 二十三续 · 7 词 · 零语料收尾）=====
    ("check out", "check(核对) + out(出去) → 核过一遍", [
        (1, "检查；查看（是否正常／无误）", "to examine so as to determine accuracy or condition", "check out + 物/事", "check.v.01", None),
        (2, "（住客）结账离开（旅馆）", "to announce one's departure from a hotel", "（住客）check out (of + 旅馆)", "check_out.v.02", None),
        (3, "查证属实；对得上（经得起检查）", "to be verified or confirmed; to pass inspection", "（说法/物）check out", "check.v.08", None),
        (4, "办（借书／结账）手续；登记借出", "to record and receive payment for items purchased", "check out + 书/商品（from + 处）", "check_out.v.05", None),
        (5, "打量；试探（某人的底细／意向）", "to try to learn sb's opinions and intentions", "check out + 人", "check_out.v.07", None),
    ]),
    ("cipher out", "cipher(算) + out(出来) → 算出来", [
        (1, "算出；解出（数目／难题）", "to work out by arithmetic or calculation", "cipher out + 数目/难题", "cipher.v.02", None),
        (2, "琢磨出；想出（意思／办法）", "to puzzle out; to work out by contrivance", "cipher out + 意思/办法", None, "cipher_out_puzzle"),
    ]),
    ("cue in", "cue(提示) + in(进来) → 提示进来", [
        (1, "给…提示；（提示演员）上场／接话", "to give a cue to an actor to begin", "cue in + 演员/台词", None, "cue_in_prompt"),
        (2, "知会；把情况告诉（某人）", "to give sb the necessary information", "cue + 人 + in", None, "cue_in_inform"),
    ]),
    ("see off", "see(看) + off(离开) → 看着离开", [
        (1, "给…送行；送别", "to go to the station or port to say goodbye", "see off + 人 (at + 处)", None, "see_off_goodbye"),
        (2, "赶走；击退（入侵者／追兵）", "to drive away or repel", "see off + 人/敌", None, "see_off_repel"),
    ]),
    ("sign up", "sign(签) + up(上去) → 签上去", [
        (1, "报名参加；签约加入（sign up for/to do）", "to join an activity or course by signing", "sign up (for + 活动/课程)", "sign_up.v.02", None),
        (2, "签约；签约聘请（某人）", "to engage by written agreement", "sign up + 人（be signed up）", "sign.v.04", None),
    ]),
    ("stick around", "stick(粘) + around(周围) → 粘在附近", [
        (1, "待在原地；不走开", "to stay put; to remain in a place", "（人）stick around (+ 处)", "stay.v.02", None),
        (2, "留在旁边（等候）；待命", "to be available or ready nearby", "（人）stick around (+ for + 事)", "stand_by.v.02", None),
    ]),
    ("take apart", "take(拿) + apart(分开) → 拿开", [
        (1, "拆开；拆卸（拆成零件）", "to take into constituent pieces; to dismantle", "take apart + 机器/物", "disassemble.v.01", None),
        (2, "拆散；肢解", "to divide into pieces", "take apart + 物/身", "dismember.v.02", None),
        (3, "剖析；逐条分析（并痛批）", "to break down into components; to analyze", "take apart + 说法/论证", "analyze.v.02", None),
    ]),
    # ===== 块 B″ 收尾轮 ②（2026-10-10 二十四续 · 3 词 · 表级清理新增正形键）=====
    ("burn off", "burn(烧) + off(去掉) → 烧掉", [
        (1, "烧掉；烧除（用火烧掉地面的草木等）", "to clear land of its vegetation by burning", "burn off + 杂草/荒草/地面", "burn_off.v.02", None),
        (2, "（靠运动）消耗掉（脂肪／热量）", "to use up (energy or fat)", "burn off + 脂肪/热量（运动）", "burn_off.v.01", None),
    ]),
    ("burn through", "burn(烧) + through(穿过) → 烧穿", [
        (1, "（火柴／蜡烛）烧尽；烧到尽头", "to burn until consumed or burnt out", "（火柴/蜡烛）burn through（不带宾语）", None, "burn_through_burn_out"),
        (2, "烧穿；烧出洞（烧透某物）", "to burn a hole through; to penetrate by burning", "burn through + 墙/屋顶/绳", None, "burn_through_burn_hole"),
        (3, "迅速花光（钱／资金／燃料）", "to spend (significant amounts of money) rapidly", "burn through + 钱/资金/燃料", "burn.v.09", None),
    ]),
    ("cool down", "cool(凉) + down(下去) → 凉下去", [
        (1, "冷静下来；平息（怒气／激动）", "to lose intensity; to become calm", "（人）cool down（after/when…）", "cool.v.03", None),
        (2, "（物体／天气）变凉；冷却", "to lose heat; to become cooler", "（物/天气）cool down", "cool.v.02", None),
        (3, "使变凉；把…弄凉", "to make cool or cooler", "cool down + 物（或 cool + 物 + down）", "cool.v.01", None),
    ]),
]

# 例句（工序 4 的「人工分派」那一步）。机器只出候选池，**分派是人做的**（块 C 写完 cue 后可半自动）。
# `gutenberg:<id>` 的 id ＝ `generator/corpus/` 文件名的 PG 编号前缀。
EX = {
    ("break out", 1): ("gutenberg:120", "The explosion of disapproval, which nothing but Silver’s black looks had restrained, broke out immediately the doctor had left the house."),
    ("break out", 2): ("gutenberg:541", "\"My God--perhaps--I don't know,\" he broke out angrily."),
    ("break out", 3): ("gutenberg:43", "Hyde broke out of all bounds and clubbed him to the earth."),
    ("call on", 1): ("gutenberg:1056", "Marian had called on Martin in his room a short time before to announce her engagement, during which visit she had playfully inspected Martin’s palm and told his fortune."),
    ("call on", 2): ("gutenberg:84", "I called on him to stay."),
    ("run down", 2): ("gutenberg:120", "If we run down this Black Dog, now, there’ll be news for Cap’n Trelawney!"),
    ("run down", 3): ("gutenberg:233", "He was so run down, however, that his mind was not exactly clear."),
    ("stand by", 1): ("gutenberg:120", "And then, as we all slunk back to our places, “Gray,” he said, “I’ll put your name in the log; you’ve stood by your duty like a seaman."),
    ("stand by", 2): ("gutenberg:543", "“It isn't enough, to stand by while he fills an automobile radiator and chucks me bits of information."),
    ("stand by", 3): ("gutenberg:120", "But come now, stand by to go about."),
    ("go about", 1): ("gutenberg:2776", "He went about it thoughtfully."),
    ("go about", 2): ("gutenberg:289", "Toad of Toad Hall, going about the country disguised as a washerwoman!”"),
    ("go about", 3): ("gutenberg:1056", "The shore would compel him to go about, and the contact would be broken."),
    ("put up", 1): ("gutenberg:2226", "“He says”—Kim put up one hand."),
    ("put up", 2): ("gutenberg:543", "Martin Mahoney has put up a new fence around his chicken yard."),
    ("put up", 3): ("gutenberg:158", "Do put up your horse at the Crown, and come in.”"),
    ("put up", 4): ("gutenberg:780", "And we'll put up another notice, and jest arst all inquirers to go round to 'im and inquire."),
    ("put up", 5): ("gutenberg:780", "Suppose, after all, they put up a fight...."),
    ("bring up", 1): ("gutenberg:543", "I was brought up on a farm."),
    ("bring up", 2): ("gutenberg:543", "It was Kennicott who brought up the matter of the Smails at breakfast."),
    ("bring up", 3): ("gutenberg:217", "Then, brought up against a stile, he stood for some minutes, and did not move."),
    ("bring up", 4): ("gutenberg:120", "Dick, who had dropped behind us and now brought up the rear, was babbling to himself both prayers and curses as his fever kept rising."),
    ("hold up", 1): ("gutenberg:4397", "Small, holding up her hands, said: “My dear!"),
    ("hold up", 2): ("gutenberg:4397", "Greeting was almost held up by curiosity to see how June and he would take this encounter, for it was shrewdly suspected, if not quite known, that they had not met since that old and lamentable affair of her fiance Bosinney with Soames’ wife."),
    ("hold up", 3): ("gutenberg:910", "Inoffensive ranchers in remote valleys were held up by armed men and compelled to identify themselves; while the remains of Jim Hall were discovered on a dozen mountain-sides by greedy claimants for blood-money."),
    ("hold up", 4): ("gutenberg:158", "They might be more safely held up as a pattern."),
    ("hold up", 5): ("gutenberg:1056", "She was pale and trembling, but she held up and looked inquiringly."),
    ("turn up", 1): ("gutenberg:219", "These special recommendations were turning up again."),
    ("turn up", 2): ("gutenberg:541", "Archer mounted the stairs, turned up the light, and put a match to the brackets on each side of the library mantelpiece."),
    ("turn up", 3): ("gutenberg:1400", "What he did on those occasions was to turn up his cuffs, stick up his hair, and give us Mark Antony’s oration over the body of Caesar."),
    ("turn up", 4): ("gutenberg:1260", "Here was a new card turned up!"),
    ("keep up", 1): ("gutenberg:1056", "If you keep up the pace, you’ll be on thirty dollars only one month."),
    ("keep up", 2): ("gutenberg:1400", "I asked, keeping up with him."),
    ("keep up", 3): ("gutenberg:11", "“The game’s going on rather better now,” she said, by way of keeping up the conversation a little."),
    ("take in", 1): ("gutenberg:1056", "Besides, the servant’s room enabled them to take in two boarders instead of one."),
    ("take in", 2): ("gutenberg:1342", "Elizabeth felt herself completely taken in."),
    ("take in", 3): ("gutenberg:1260", "Miss Temple passed her handkerchief over her lips, as if to smooth away the involuntary smile that curled them; she gave the order, however, and when the first class could take in what was required of them, they obeyed."),
    ("take in", 4): ("gutenberg:2701", "Because the greatest necessity for so doing would seem to be, when in feeding he accidentally takes in water."),
    ("take in", 5): ("gutenberg:1661", "Sherlock Holmes’ quick eye took in my occupation, and he shook his head with a smile as he noticed my questioning glances."),
    ("hold on", 1): ("gutenberg:1056", "He held on to the bar, his legs wobbling under him, Martin’s arm around him and supporting him, while he thought."),
    ("hold on", 2): ("gutenberg:1056", "“Hold on, Arthur, my boy,” he said, attempting to mask his anxiety with facetious utterance."),
    ("hold on", 3): ("gutenberg:2701", "Slowly wading through the meadows of brit, the Pequod still held on her way north-eastward towards the island of Java; a gentle air impelling her keel, so that in the surrounding serenity her three tall tapering masts mildly waved to that languid breeze, as three mild palms on a plain."),
    ("call out", 1): ("gutenberg:1260", "And then they called out to him that she was on the roof, where she was standing, waving her arms, above the battlements, and shouting out till they could hear her a mile off: I saw her and heard her with my own eyes."),
    ("call out", 2): ("gutenberg:4397", "It seemed to Val unspeakably disgusting to have one’s name called out like this in public!"),
    ("call out", 3): ("gutenberg:233", "“They’ve called out the police."),
    ("look over", 1): ("gutenberg:1400", "Look over it, dear boy.”"),
    ("see off", 1): ("gutenberg:1260", "Mason got the start of you all this morning; he was gone before sunrise: I rose at four to see him off."),
    ("see off", 2): ("gutenberg:4397", "A few minutes later Bosinney rose to go, and Soames rose too, to see him off the premises."),
    ("settle down", 1): ("gutenberg:1260", "Will it keep you in England, induce you to marry Miss Oliver, and settle down like an ordinary mortal?”"),
    ("settle down", 2): ("gutenberg:1056", "He had settled down into a strange and comfortable state of mind."),
    ("settle down", 3): ("gutenberg:120", "As the last rays of daylight dwindled and disappeared, absolute blackness settled down on Treasure Island."),
    ("cut off", 1): ("gutenberg:345", "May I cut off the head of dead Miss Lucy?”"),
    ("cut off", 2): ("gutenberg:1400", "After I have crossed this bridge, I hoist it up—so—and cut off the communication.”"),
    ("cut off", 3): ("gutenberg:217", "The family was so cut off from the world actually."),
    ("live on", 1): ("gutenberg:1056", "How could he live on it?"),
    ("live on", 2): ("gutenberg:103", "People said that he resembled Byron—at least that his head was Byronic; but he was a bearded, tranquil Byron, who might live on a thousand years without growing old."),
    ("turn back", 1): ("gutenberg:2641", "He turned back into the room."),
    ("turn over", 1): ("gutenberg:4397", "He turned over and lay on his back."),
    ("turn over", 2): ("gutenberg:1056", "Manuscript after manuscript of his had been turned over to them by Ruth."),
    ("turn over", 3): ("gutenberg:1661", "Holmes turned over the leaves of the book upon his knee."),
    ("turn over", 4): ("gutenberg:2226", "The woman seemed to ask questions which the lama turned over in his mind before answering."),
    ("put out", 1): ("gutenberg:103", "“What’s the matter?” asked Sir Francis, putting out his head."),
    ("put out", 2): ("gutenberg:217", "He put out the gas."),
    ("put out", 3): ("gutenberg:863", "She was very much put out about it.”"),
    ("set out", 1): ("gutenberg:103", "I am setting out for Bordeaux, and shall go to Bordeaux.”"),
    ("set out", 2): ("gutenberg:236", "“They never do what they set out to do."),
    ("set out", 3): ("gutenberg:5200", "For the days that I have been living here I will, of course, pay nothing at all, on the contrary I will consider whether to proceed with some kind of action for damages from you, and believe me it would be very easy to set out the grounds for such an action.”"),
    ("turn in", 2): ("gutenberg:233", "Hanson had already turned in for the night."),
    ("turn in", 3): ("gutenberg:4397", "The cab turned in at the drive which might have been his own, and the sound of music met him."),
    ("hand over", 1): ("gutenberg:11", "“Hand it over here,” said the Dodo."),
    ("break off", 1): ("gutenberg:1056", "She broke off abruptly and laughed merrily at her predicament."),
    ("break off", 2): ("gutenberg:11", "However, at last she stretched her arms round it as far as they would go, and broke off a bit of the edge with each hand."),
    ("break off", 3): ("gutenberg:217", "“I have broken off with her,” he said."),
    ("turn into", 1): ("gutenberg:11", "“It turned into a pig,” Alice quietly said, just as if it had come back in a natural way."),
    ("grow up", 1): ("gutenberg:1056", "Martin Eden, I am afraid, will never grow up."),
    ("grow up", 2): ("gutenberg:1056", "The neighborhood was growing up fast."),
    ("wake up", 1): ("gutenberg:217", "“I only just woke up.”"),
    ("look around", 1): ("gutenberg:289", "The Rat looked around him."),
    ("look around", 2): ("gutenberg:233", "Then we’ll look around for a room for you."),
    ("run out", 1): ("gutenberg:780", "The crew ran out of food and subsisted on fish."),
    ("get over", 1): ("gutenberg:1056", "You get too excited; but you will get over that with practice."),
    ("get over", 2): ("gutenberg:1056", "They never got over it, and every letter they wrote him reflected their reverent awe of that first mysterious happening."),
    ("get over", 3): ("gutenberg:1260", "I got over the stile without a word, and meant to leave him calmly."),
    ("take out", 2): ("gutenberg:1400", "I thought so too, and I took him out for a walk next morning, and we talked immensely, understanding one another to perfection."),
    ("turn out", 1): ("gutenberg:1260", "Fairfax turned out to be what she appeared, a placid-tempered, kind-natured woman, of competent education and average intelligence."),
    ("account for", 1): ("gutenberg:120", "As for sounds, there was the steady drone of the snorers and a small occasional noise, a flickering or pecking that I could in no way account for."),
    ("bring about", 1): ("gutenberg:1260", "The discovery was brought about in the strangest way."),
    ("put off", 1): ("gutenberg:158", "I wanted them to put off the wedding."),
    ("give up", 1): ("gutenberg:120", "At that I gave up all attempts at commentary and read straight on."),
    ("give up", 3): ("gutenberg:1260", "He came down to Gateshead about three weeks ago and wanted missis to give up all to him."),
    ("set up", 1): ("gutenberg:1260", "The utmost I hope is, to save money enough out of my earnings to set up a school some day in a little house rented by myself."),
    ("set up", 3): ("gutenberg:158", "Perry's plan of setting up his carriage?"),
    ("take off", 2): ("gutenberg:11", "Take off your hat, the King said to the Hatter."),
    ("break up", 2): ("gutenberg:1260", "Classes were broken up, rules relaxed."),
    ("break up", 3): ("gutenberg:1260", "How much of the fall of the avalanche is in their anger? of the breaking up of the frozen sea in their displeasure?"),
    ("carry out", 1): ("gutenberg:103", "The other plan must be carried out; an opening in the walls of the pagoda must be made."),
    ("point out", 1): ("gutenberg:103", "When the folly as well as the uselessness of the adventure was pointed out to him, he contented himself with replying."),
    ("look forward to", 1): ("gutenberg:1342", "She looked forward to their entrance as the point on which all her chance of pleasure for the evening must depend."),
    ("put up with", 1): ("gutenberg:158", "Knightley was so obliging as to put up with it, and seek no farther explanation."),
    ("turn out", 2): ("gutenberg:43", "The people who had turned out were the girl’s own family; and pretty soon, the doctor, for whom she had been sent, put in his appearance."),
    ("turn out", 3): ("gutenberg:215", "Canned goods were turned out that made men laugh, for canned goods on the Long Trail is a thing to dream about."),
    ("put off", 3): ("gutenberg:2084", "But the inexorable Theobald was not to be put off with such absurd excuses."),
    ("give up", 2): ("gutenberg:4397", "After sounding him, the fellow pulled a face as long as your arm, and ordered him to stay in bed and give up smoking."),
    ("come about", 1): ("gutenberg:863", "Thus it came about that, three days later, I descended from the train at Styles St."),
    ("set aside", 1): ("gutenberg:1400", "I was beginning to be rather vain of my knowledge, for I spent my birthday guineas on it, and set aside the greater part of my pocket-money for similar investment; though I have no doubt, now, that the little I knew was extremely dear at the price."),
    ("set aside", 2): ("gutenberg:139", "Setting aside these entirely new forms of life, the plateau was very rich in known prehistoric forms, dating back in some cases to early Jurassic times."),
    ("lay out", 1): ("gutenberg:1342", "Collins invited them to take a stroll in the garden, which was large and well laid out, and to the cultivation of which he attended himself."),
    ("lay out", 2): ("gutenberg:345", "With a swift glance around the room, he at once laid out our plan of attack, and, without speaking a word, with a gesture, placed us each in position."),
    ("light up", 1): ("gutenberg:1400", "And there was no daylight in the room, but it was all lighted up with candles.”"),
    ("light up", 2): ("gutenberg:217", "The young farmer’s face lighted up as he saw his friend."),
    ("run into", 1): ("gutenberg:233", "“An old acquaintance of mine that I ran into just as I was coming up from the station,” explained Drouet."),
    ("run into", 2): ("gutenberg:43", "Well, sir, the two ran into one another naturally enough at the corner; and then came the horrible part of the thing; for the man trampled calmly over the child’s body and left her screaming on the ground."),
    ("run into", 3): ("gutenberg:4397", "Did he run into debt, or gamble, or swear; was he violent; were his friends rackety; did he stay out at night?"),
    ("bring out", 1): ("gutenberg:289", "“It was, to be sure, but a small thing that I asked—merely leave to blossom and expand for yet one more evening, to let myself go and hear the tumultuous applause that always seems to me—somehow—to bring out my best qualities."),
    ("bring out", 2): ("gutenberg:1056", "They had brought out a first edition of fifteen hundred copies and been dubious of selling it."),
    ("put in", 1): ("gutenberg:1056", "Because of the years I put in on the sea."),
    ("put in", 2): ("gutenberg:2084", "Once the old rector got hold of him as he was watching a new window being put in, which the rector had bought in Germany—the work, it was supposed, of Albert Dürer."),
    ("put in", 3): ("gutenberg:1260", "“She had a fall,” said Bessie, again putting in her word."),
    ("stick out", 1): ("gutenberg:233", "“May God starve ye yet,” yelled an old Irish woman, who now threw open a nearby window and stuck out her head."),
    ("come back", 1): ("gutenberg:103", "He has gone, and won’t come back!"),
    ("come back", 2): ("gutenberg:120", "Gradually my mind came back again, my pulses quieted down to a more natural time, and I was once more in possession of myself."),
    ("come out", 1): ("gutenberg:103", "An Indian came out of the hut, and, at their request, conducted them within the enclosure."),
    ("come out", 2): ("gutenberg:1056", "He had an idea that anything accepted by a paper was published immediately, and as he had sent the manuscript in on Friday he expected it to come out on the following Sunday."),
    ("come out", 3): ("gutenberg:233", "“Things will come out all right.”"),
    ("set off", 1): ("gutenberg:1400", "Having thus cleared the way for my expedition to Miss Havisham’s, I set off by the early morning coach before it was yet light, and was out on the open country road when the day came creeping on, halting and whimpering and shivering, and wrapped in patches of cloud and rags of mist, like a beggar."),
    ("set off", 3): ("gutenberg:4397", "Her little room, with its whitewashed walls, its floor and hearth of old pink brick, its black paint, and latticed window athwart which the last of the sunlight was shining, had never looked so charming, set off by this young figure, with the creamy, slightly frowning face."),
    ("in a body", 1): ("gutenberg:1260", "“If all these people came in a body and spat at me, what would you do, Jane?”"),
    ("give in", 1): ("gutenberg:1056", "And Cheese-Face did not give in, and the fight went on."),
    ("look on", 1): ("gutenberg:120", "The captain looked on for a while in silence."),
    ("look on", 2): ("gutenberg:1342", "You must, therefore, allow me to follow the dictates of my conscience on this occasion, which lead me to perform what I look on as a point of duty."),
    ("come about", 2): ("gutenberg:43", "And to such as these, so long as they came about his chambers, he never marked a shade of change in his demeanour."),
    ("lay out", 3): ("gutenberg:43", "The inhabitants were all doing well, it seemed, and all emulously hoping to do better still, and laying out the surplus of their gains in coquetry; so that the shop fronts stood along that thoroughfare with an air of invitation, like rows of smiling saleswomen."),
    ("put in", 4): ("gutenberg:43", "The people who had turned out were the girl’s own family; and pretty soon, the doctor, for whom she had been sent, put in his appearance."),
    ("stick out", 3): ("gutenberg:43", "Well, we screwed him up to a hundred pounds for the child’s family; he would have clearly liked to stick out; but there was something about the lot of us that meant mischief, and at last he struck."),
    ("give in", 2): ("gutenberg:43", "I gave in the cheque myself, and said I had every reason to believe it was a forgery."),
    ("look on", 3): ("gutenberg:43", "There are three windows looking on the court on the first floor; none below; the windows are always shut but they’re clean."),
    ("go on", 1): ("gutenberg:217", "They went on with the meal."),
    ("go on", 2): ("gutenberg:174", "What is going on in town?"),
    ("go on", 3): ("gutenberg:64317", "All the lights were going on in West Egg now; the electric trains, men-carrying, were plunging home through the rain from New York."),
    ("come in", 1): ("gutenberg:1400", "But come in, come in."),
    ("come in", 2): ("gutenberg:1056", "In the meantime the weeks were passing, his money was ebbing low, and there was no money coming in."),
    ("come in", 3): ("gutenberg:543", "When once, in a housewifely frenzy for getting rid of things, she raged, “Why don't you give these away?” he solemnly defended them, “Well, you can't tell; they might come in handy some day.”"),
    ("sit down", 1): ("gutenberg:217", "Then she sat down again."),
    ("go out", 1): ("gutenberg:543", "I'm going out for a walk."),
    ("go out", 3): ("gutenberg:1260", "At last both slept: the fire and the candle went out."),
    ("go down", 1): ("gutenberg:4397", "He went down to her."),
    ("go down", 2): ("gutenberg:217", "The sun was going down."),
    ("go down", 3): ("gutenberg:4397", "Not that he had many, personally, the rate of interest was too wretched; but he should advise his Companies—consols would assuredly go down."),
    ("get up", 1): ("gutenberg:217", "On the Monday morning the boy got up at six to start work."),
    ("get up", 2): ("gutenberg:2084", "He got up from his arm-chair and went to the piano."),
    ("go back", 1): ("gutenberg:8164", "We must go back at once."),
    ("go back", 2): ("gutenberg:2641", "One might have gone back six hundred years."),
    ("look up", 1): ("gutenberg:217", "“Number forty-six M.,” said the nurse; and the doctor looked up the case in his book."),
    ("look up", 2): ("gutenberg:4397", "He looked up at her."),
    ("go into", 1): ("gutenberg:2641", "They went into the hall."),
    ("go into", 2): ("gutenberg:2084", "Then we went into the subject of his finances."),
    ("go into", 3): ("gutenberg:233", "I’ll go into business again, and we’ll be happy."),
    ("come down", 1): ("gutenberg:217", "She came down for supper."),
    ("come down", 2): ("gutenberg:4517", "Then, when the loading finally began, a sleety rain was coming down once more, and the tree trunks were so slippery that it took twice as long as usual to lift them and get them in place on the sledge."),
    ("come down", 3): ("gutenberg:4397", "“Your people,” he said, “ought to come down in their price to me, considering that I shall be the first to build.”"),
    ("go up", 1): ("gutenberg:2226", "Go up the hill and ask."),
    ("go up", 2): ("gutenberg:4397", "Oh! they must have those—only the price of things had gone up so!"),
    ("come up", 1): ("gutenberg:8164", "She came up to me, and put her hand on my arm."),
    ("come up", 2): ("gutenberg:174", "Your name happened to come up in conversation, in connection with the miniatures you have lent to the exhibition at the Dudley."),
    ("hand in", 1): ("gutenberg:217", "Then he handed in his lamp and got his umbrella, which he had bought at an auction for one-and-six."),
    ("come on", 1): ("gutenberg:863", "Come on, let’s have tea."),
    ("come on", 2): ("gutenberg:780", "Then quietly the electric lights came on again, and an uproar of nocturnal newsvendors began in the streets."),
    ("come on", 3): ("gutenberg:2641", "Rain and darkness came on together."),
    ("go away", 1): ("gutenberg:217", "Now he was going away."),
    ("look out", 1): ("gutenberg:289", "Now, you look out, Rat!"),
    ("look out", 2): ("gutenberg:1056", "I’ll be looking out for you.”"),
    ("make up", 1): ("gutenberg:2776", "And when a girl in the laundry set down a hot iron on my hand this afternoon I was all the way home making up that story about the Welsh rabbit."),
    ("make up", 2): ("gutenberg:36", "Strange as it may seem to a human being, all the complex apparatus of digestion, which makes up the bulk of our bodies, did not exist in the Martians."),
    ("make up", 5): ("gutenberg:1661", "In a word, I turned over a new leaf and did my best to make up for the past."),
    ("make up", 6): ("gutenberg:217", "I had made up my mind."),
    ("get out", 1): ("gutenberg:543", "I must get out of this."),
    ("get out", 2): ("gutenberg:233", "Then in despair he got out his purse."),
    ("get out", 3): ("gutenberg:4397", "If a name gets out, or the watching is suspected, it may have very serious consequences.”"),
    ("take up", 1): ("gutenberg:4397", "His whim to take up farming was but a bit of sentiment, and about as likely to last."),
    ("take up", 2): ("gutenberg:233", "These little expeditions took up her time until quite four o’clock, when she was weary enough to go home."),
    ("take up", 3): ("gutenberg:2641", "The old man was refreshed by sleep, and took up the matter warmly."),
    ("find out", 1): ("gutenberg:863", "Find out how he did it."),
    ("find out", 2): ("gutenberg:64317", "I happened to find out that you’re taking Miss Baker to tea.”"),
    ("put on", 1): ("gutenberg:174", "He put on his fur coat and hat and went out into the hall."),
    ("put on", 3): ("gutenberg:233", "“They’re putting on a summer play at the Casino,” she announced, after figuratively putting her ear to the ground."),
    ("put on", 4): ("gutenberg:233", "She just put on more airs about it.”"),
    ("get on", 1): ("gutenberg:345", "Van Helsing says that our chance will be to get on the boat between sunrise and sunset."),
    ("get on", 2): ("gutenberg:2084", "I was about the closest friend he had, and I saw but little of him, for I could not get on with him for long together."),
    ("get on", 3): ("gutenberg:1661", "“How are you getting on?”"),
    ("go through", 1): ("gutenberg:1400", "I think I would have gone through a great deal to kiss her cheek."),
    ("go through", 2): ("gutenberg:345", "“She is going through the house, and wants to see every one in it,” I answered."),
    ("go through", 3): ("gutenberg:233", "“And then if that little real estate deal I’ve got on goes through, we’ll get married,” he said with a great show of earnestness, the while he took his place before the mirror and began brushing his hair."),
    ("stand up", 1): ("gutenberg:541", "Then she too stood up."),
    ("stand up", 3): ("gutenberg:25344", "They had fortitude and self-reliance, and, in time of difficulty or peril, stood up for the welfare of the state like a line of cliffs against a tempestuous tide."),
    ("pick up", 1): ("gutenberg:1661", "Windibank sprang out of his chair and picked up his hat."),
    ("pick up", 2): ("gutenberg:2641", "For they were to pick up Miss Bartlett at Summer Street, where she had been dropped as the carriage went down, to pay a call on Mr. Beebe’s old mother."),
    ("pick up", 3): ("gutenberg:4397", "Where they pick up their knowledge I can't tell, but they seem to know everything.”"),
    ("lie down", 1): ("gutenberg:174", "I think I must go and lie down."),
    ("come over", 1): ("gutenberg:64317", "“That’s why I came over tonight.”"),
    ("come over", 2): ("gutenberg:43", "A change had come over me."),
    ("go off", 1): ("gutenberg:103", "The bomb would not go off after all."),
    ("go off", 2): ("gutenberg:1056", "The alarm-clock went off, jerking Martin out of sleep with a suddenness that would have given headache to one with less splendid constitution."),
    ("go off", 3): ("gutenberg:1342", "Did he know of their intending to go off?"),
    ("run away", 1): ("gutenberg:1056", "But he had never run away."),
    ("run away", 2): ("gutenberg:2084", "He says he ought to have run away from home."),
    ("take out", 1): ("gutenberg:2641", "She took out her purse."),
    ("go over", 1): ("gutenberg:217", "Again he went over the scene, and again he hated her."),
    ("get away", 1): ("gutenberg:64317", "“It does her good to get away.”"),
    ("get away", 3): ("gutenberg:543", "Matter of principle: ought not to let her get away with it."),
    ("sit up", 1): ("gutenberg:8164", "I sat up in bed and spilt the tea."),
    ("sit up", 2): ("gutenberg:4397", "He had gone into every detail, known everything that went on, sometimes sat up all night over it."),
    ("go by", 1): ("gutenberg:217", "Still the days and the weeks went by."),
    ("go by", 2): ("gutenberg:120", "Every day when he came back from his stroll he would ask if any seafaring men had gone by along the road."),
    ("go by", 3): ("gutenberg:233", "“Yes,” he returned; “but you can’t go by what the papers say."),
    ("go by", 4): ("gutenberg:204", "A gaunt, red-haired labourer, with a dogged jaw and chin, but quite blank blue eyes, he went by the name of Israel Gow, and was the one silent servant on that deserted estate."),
    ("get in", 1): ("gutenberg:543", "I tried to get in."),
    ("get in", 2): ("gutenberg:217", "“The train gets in at half-past six,” she replied emphatically."),
    ("get back", 1): ("gutenberg:863", "I think I’ll be getting back."),
    ("get back", 2): ("gutenberg:541", "She'll never get back a dollar more of her money than what he's voluntarily returned to her: their damned heathen marriage settlements take precious good care of that."),
    ("get back", 3): ("gutenberg:8164", "“I should like to get back at them somehow; they’ve given me a bad enough time."),
    ("look into", 1): ("gutenberg:1661", "I shall look into the matter between this and then."),
    ("make out", 1): ("gutenberg:215", "The faint sound of Thornton’s voice came to them, and though they could not make out the words of it, they knew that he was in his extremity."),
    ("make out", 2): ("gutenberg:174", "I am sure I never can make out what you are talking about."),
    ("make out", 3): ("gutenberg:1056", "He spent long hours in the Oakland and Berkeley libraries, and made out application blanks for membership for himself, his sisters Gertrude and Marian, and Jim, the latter’s consent being obtained at the expense of several glasses of beer."),
    ("look back", 1): ("gutenberg:4397", "June looked back at him."),
    ("look back", 2): ("gutenberg:174", "As he looked back upon man moving through history, he was haunted by a feeling of loss."),
    ("hold out", 1): ("gutenberg:1661", "He unwound the handkerchief and held out his hand."),
    ("hold out", 2): ("gutenberg:541", "She held out as firmly as ever against that."),
    ("hold out", 3): ("gutenberg:1056", "“He said something about a schooner that’s gettin’ ready to go off to some outlandish place to look for buried treasure, that he’d sail on her if his money held out.”"),
    ("come along", 1): ("gutenberg:55", "“Come along, Toto,” she said."),
    ("come along", 3): ("gutenberg:4397", "They stood staring at each other in the steamy heat, redolent of the mushy scent of earth, of potted geranium, and of vines coming along fast."),
    ("look after", 1): ("gutenberg:217", "But he’ll look after him, I know."),
    ("turn away", 1): ("gutenberg:1342", "Elizabeth turned away to hide a smile."),
    ("keep on", 1): ("gutenberg:219", "He kept on looking out watchfully."),
    ("keep on", 2): ("gutenberg:2776", "You must keep on at your studies."),
    ("pass away", 1): ("gutenberg:1661", "I hurried to him, but he passed away without having ever recovered his consciousness."),
    ("pass away", 2): ("gutenberg:345", "It conveyed irresistibly the idea that life--animal life--was not the only thing which could pass away."),
    ("turn on", 1): ("gutenberg:1056", "He turned on the electric light and tried to read."),
    ("turn on", 2): ("gutenberg:4397", "Everything now turned on that!"),
    ("turn on", 3): ("gutenberg:217", "His mother turned on him like a fury."),
    ("break in", 1): ("gutenberg:863", "We must break in the door."),
    ("break in", 2): ("gutenberg:1056", "“What’s that?” he replied to a question from Olney that broke in upon his train of thought."),
    ("break in", 3): ("gutenberg:236", "Nearly all our horses for the English cavalry are brought to India from Australia, and are broken in by the troopers themselves."),
    ("put down", 1): ("gutenberg:217", "He put down the tray, and went to look over her shoulder."),
    ("put down", 2): ("gutenberg:233", "He was thinking what name he would put down."),
    ("get off", 1): ("gutenberg:217", "He got off the car."),
    ("get off", 2): ("gutenberg:345", "But ye’d better be up arter ’im soon in the mornin’, or maybe ye won’t ketch ’im; for Sam gets off main early, never mind the booze the night afore.”"),
    ("get off", 3): ("gutenberg:217", "“Nay,” he said, “you don’t get off as easy as that, my lad."),
    ("get off", 4): ("gutenberg:541", "\"Only some letters I'd forgotten, and wanted to get off before dinner.\""),
    ("pass on", 1): ("gutenberg:233", "The pieces of leather came from the girl at the machine to her right, and were passed on to the girl at her left."),
    ("pass on", 2): ("gutenberg:863", "I had had no opportunity as yet of passing on Poirot’s message to Lawrence."),
    ("pass on", 3): ("gutenberg:55", "Afterward they passed on through the gate into the Emerald City."),
    ("take away", 1): ("gutenberg:2226", "I only waited for the order to take away the tray.”"),
    ("take away", 2): ("gutenberg:1342", "Bingley, it is very hard to have her taken away from me."),
    ("come through", 1): ("gutenberg:345", "We are hedged in with difficulties, all of us, my poor old fellow; but, please God, we shall come through them all right."),
    ("come through", 3): ("gutenberg:4397", "A sound—the vague murmur of a woman's movements—was coming through the door."),
    ("carry on", 1): ("gutenberg:1260", "Reed interposed, telling me to sit down; she then proceeded to carry on the conversation herself."),
    ("carry on", 2): ("gutenberg:139", "It is but right, perhaps, that I should carry on the tale and show also the results."),
    ("carry on", 3): ("gutenberg:289", "Here, where we are standing, they lived, and walked, and talked, and slept, and carried on their business."),
    ("carry on", 4): ("gutenberg:4397", "He saw her bosom rise and fall, her eyes darkening with anger, and taking no notice of the taunt, he asked quietly: “Are you carrying on a flirtation with Bosinney?”"),
    ("shut up", 1): ("gutenberg:780", "“Shut up!” said the lieutenant."),
    ("shut up", 3): ("gutenberg:1260", "I must send away half the servants and shut up part of the house; or let it off."),
    ("break down", 1): ("gutenberg:780", "The car had broken down overnight."),
    ("break down", 2): ("gutenberg:2084", "Ernest broke down and wept as he had not done for years."),
    ("break down", 4): ("gutenberg:345", "The poor fellow was quite broken down; now and again he gave a low groan which he could not suppress--he was thinking of his wife."),
    ("break down", 5): ("gutenberg:217", "Before, with her husband, things had seemed to be breaking down in her, but they did not destroy her power to live."),
    ("bring in", 1): ("gutenberg:863", "Dorcas brought in fresh tea."),
    ("bring in", 2): ("gutenberg:1056", "A joke had brought in fifty cents, and a second one, sold to a high-grade comic weekly, had fetched a dollar."),
    ("bring in", 4): ("gutenberg:1661", "There was no sign of any violence, and the water was but two feet deep, so that the jury, having regard to his known eccentricity, brought in a verdict of ‘suicide.’"),
    ("come across", 1): ("gutenberg:863", "I came across a man in Belgium once, a very famous detective, and he quite inflamed me."),
    ("go along", 1): ("gutenberg:233", "“He’s going along with us, aren’t you, Bob?”"),
    ("go along", 3): ("gutenberg:103", "During the first days, they went along smoothly enough."),
    ("run through", 2): ("gutenberg:204", "And yet people do not get hanged or run through the body for the sake of a charade."),
    ("run through", 3): ("gutenberg:2084", "He ran through his money at about the same rate as other boys did, being pretty well cleaned out a few days after he had got back to school."),
    ("get down", 1): ("gutenberg:2641", "Then Persephone got down from the box."),
    ("get down", 5): ("gutenberg:543", "We've simply got to get down to work.”"),
    ("stand out", 1): ("gutenberg:217", "His dark-brown cropped moustache stood out like a brush."),
    ("stand out", 2): ("gutenberg:1056", "And yet his work stands out from the ruck of the contemporary versifiers as a balas ruby among carrots."),
    ("stand out", 3): ("gutenberg:543", "He was so much the man, the worker, the friend, that she liked him when she most tried to stand out against him; he was so much the successful executive that she did not want him to despise her."),
    ("pull out", 1): ("gutenberg:174", "Then he pulled out his watch."),
    ("pull out", 2): ("gutenberg:233", "The train was just pulling out of Waukesha."),
    ("bring back", 1): ("gutenberg:103", "What had he brought back from this long and weary journey?"),
    ("bring back", 3): ("gutenberg:139", "But amid these varied ornaments there were scattered the trophies which brought back strongly to my recollection the fact that Lord John Roxton was one of the great all-round sportsmen and athletes of his day."),
    ("come forward", 1): ("gutenberg:84", "Several witnesses were called who had known her for many years, and they spoke well of her; but fear and hatred of the crime of which they supposed her guilty rendered them timorous and unwilling to come forward."),
    ("come forward", 2): ("gutenberg:863", "He prepares no defence—no shadow of an alibi, yet he knows the chemist’s assistant must necessarily come forward with the facts."),
    ("move in", 1): ("gutenberg:233", "“That’s a real pretty woman who has moved in next door,” said Carrie to Hurstwood at the breakfast table."),
    ("move on", 1): ("gutenberg:217", "And directly the two women moved on."),
    ("pass by", 1): ("gutenberg:4397", "“Yes, pass by on the other side.”"),
    ("set down", 1): ("gutenberg:4517", "She flushed red as the question escaped her, and hastily set down the cup she was lifting."),
    ("set down", 2): ("gutenberg:62", "I cannot explain the phenomena; I can only set down here in the words of an ordinary soldier of fortune a chronicle of the strange events that befell me during the ten years that my dead body lay undiscovered in an Arizona cave."),
    ("accompany by", 1): ("gutenberg:910", "But fear was accompanied by another instinct—that of concealment."),
    ("hang on", 1): ("gutenberg:217", "He hung on to his tree."),
    ("hang on", 4): ("gutenberg:1056", "It puzzled him, and he pondered it as if life and death hung on the solution."),
    ("take on", 1): ("gutenberg:345", "If I could, I would take on myself the burden that you do bear."),
    ("take on", 2): ("gutenberg:233", "Her face took on the semblance of a look of happiness as she put on her hat to go below."),
    ("absorb in", 1): ("gutenberg:219", "They were looking on the ground, absorbed in thought."),
    # ===== 块 B″ 第五批（2026-10-10 十六续 · 30 词）=====
    ("get through", 1): ("gutenberg:4397", "He got through a vast amount of work, only soother of the nerves he knew."),
    ("get through", 3): ("gutenberg:217", "“There, you see where they got through,” he said."),
    ("get through", 4): ("gutenberg:233", "She sincerely wished he could get through the summer."),
    ("run over", 1): ("gutenberg:4397", "Old Jolyon raised his hand, and said slowly: “Young Bosinney has been run over in the fog and killed.”"),
    ("run over", 3): ("gutenberg:1661", "Now, let me just run over the course of events, and you will contradict me if I go wrong.”"),
    ("look through", 1): ("gutenberg:1661", "I have just been looking through all the recent papers in order to master the particulars."),
    ("look through", 2): ("gutenberg:543", "He looked through her with a contemptuousness such as she could not have imagined."),
    ("look through", 3): ("gutenberg:1260", "Looking through the window, I saw him traverse the garden."),
    ("come off", 1): ("gutenberg:55", "She was not much hurt, but in her fall one of the Silver Shoes came off; and before she could reach it, the Witch had snatched it away and put it on her own skinny foot."),
    ("come off", 2): ("gutenberg:219", "The manager was very placid, he had no vital anxieties now, he took us both in with a comprehensive and satisfied glance: the ‘affair’ had come off as well as could be wished."),
    ("come off", 3): ("gutenberg:345", "Arthur’s father is better, and wants the marriage to come off soon."),
    ("get along", 1): ("gutenberg:910", "Besides, he was learning how to get along with Grey Beaver."),
    ("get along", 2): ("gutenberg:233", "“How are you getting along?” he would blandly inquire."),
    ("get along", 3): ("gutenberg:1400", "Now, you get along to bed!”"),
    ("see through", 1): ("gutenberg:289", "They understood him, they saw through him, they had got ahead of him."),
    ("throw out", 1): ("gutenberg:910", "He knew the injustice and greediness of the older dogs when meat or fish was thrown out to be eaten."),
    ("throw out", 2): ("gutenberg:2701", "Captain Davis, who lay with his head on a gun, was thrown out of his cabin!”"),
    ("throw out", 3): ("gutenberg:2701", "Are these last throwing out oblique hints touching Tophet?"),
    ("throw up", 2): ("gutenberg:215", "“Undreamed of!” cried Mercedes, throwing up her hands in dainty dismay."),
    ("throw up", 3): ("gutenberg:4397", "Why, look at the way he threw up his chances when he left my office; going off like that for six months with a knapsack, and all for what?—to study foreign architecture—foreign!"),
    ("affected by", 1): ("gutenberg:1342", "I hope your plans in favour of the ----shire will not be affected by his being in the neighbourhood.”"),
    ("affected by", 2): ("gutenberg:84", "I saw no cause for their unhappiness, but I was deeply affected by it."),
    ("take down", 1): ("gutenberg:1661", "He took down a heavy brown volume from his shelves."),
    ("take down", 2): ("gutenberg:244", "I must warn you that your words will be taken down, and may be used against you.”"),
    ("take down", 3): ("gutenberg:215", "Buck watched them apprehensively as they proceeded to take down the tent and load the sled."),
    ("wear out", 1): ("gutenberg:1260", "And her clothes, they will wear out: how can she get new ones?”"),
    ("wear out", 2): ("gutenberg:1260", "Worn out with this torture of thought, I rose to my knees."),
    ("wear out", 3): ("gutenberg:4397", "No; they had to go the way of all flesh and furniture, and be worn out."),
    ("catch up", 1): ("gutenberg:4517", "In the black shade of the Varnum spruces he caught up with her and she turned with a quick “Oh!”"),
    ("catch up", 2): ("gutenberg:1056", "A year and a half of it might enable you to catch up that additional six months."),
    ("throw away", 1): ("gutenberg:2641", "“I believe it was my photographs that you threw away.”"),
    ("throw away", 2): ("gutenberg:1260", "I don’t wish to throw away my time and trouble on an offering you would deem worthless.”"),
    ("work on", 1): ("gutenberg:64317", "“Next week; I’ve got my man working on it now.”"),
    ("work on", 2): ("gutenberg:1260", "“And you can work on muslin and canvas?”"),
    ("work on", 3): ("gutenberg:1342", "You have widely mistaken my character, if you think I can be worked on by such persuasions as these."),
    ("keep out", 1): ("gutenberg:345", "It is well we have no sceptic here, or he would say that you were working some spell to keep out an evil spirit.”"),
    ("keep out", 2): ("gutenberg:910", "If you want to keep out of trouble, you’ll steer clear of him, that’s my talk."),
    ("run after", 1): ("gutenberg:345", "I could see Renfield’s figure just disappearing behind the angle of the house, so I ran after him."),
    ("run after", 2): ("gutenberg:217", "And tell your girls, my son, that when they’re running after you, they’re not to come and ask your mother for you."),
    ("pick out", 1): ("gutenberg:233", "We’ll go over here to Partridge’s and you pick out what you want."),
    ("pick out", 2): ("gutenberg:219", "Sometimes I would pick out a tree a little way ahead to measure our progress towards Kurtz by, but I lost it invariably before we got abreast."),
    ("step in", 1): ("gutenberg:2701", "For by a mysterious fatality, Heaven itself seemed to step in to take out of his hands into its own the damning thing he would have done."),
    ("work out", 1): ("gutenberg:1056", "He bought the text-books on physics and chemistry, and, along with his algebra, worked out problems and demonstrations."),
    ("work out", 2): ("gutenberg:8164", "He had his scheme of life worked out to a fine point."),
    ("work out", 3): ("gutenberg:345", "If you only knew the problem I have to face, and that I am working out, you would pity, and tolerate, and pardon me."),
    ("work out", 4): ("gutenberg:2641", "“So it will work out right if you give the pound to me.”"),
    ("break through", 1): ("gutenberg:910", "The cub had broken through the wall of the world, the unknown had let go its hold of him, and here he was without hurt."),
    ("break through", 3): ("gutenberg:910", "Dawn was breaking through the windows and dimming the electric lights."),
    ("add in", 1): ("gutenberg:345", "Read all, I pray you, with the open mind; and if you can add in any way to the story here told do so, for it is all-important."),
    ("cut out", 1): ("gutenberg:541", "We're all as like each other as those dolls cut out of the same folded paper."),
    ("cut out", 2): ("gutenberg:1056", "Phrases, lines, and stanzas were cut out, interchanged, or juggled about in the most incomprehensible manner."),
    ("cut out", 3): ("gutenberg:543", "Let's cut out jabbing at each other."),
    ("fall out", 1): ("gutenberg:345", "As it was, the point just cut the cloth of his coat, making a wide gap whence a bundle of bank-notes and a stream of gold fell out."),
    ("fall out", 2): ("gutenberg:139", "The two professors, their tempers aggravated no doubt by their injuries, had fallen out as to whether our assailants were of the genus pterodactylus or dimorphodon, and high words had ensued."),
    ("fall out", 3): ("gutenberg:1400", "It fell out as Wemmick had told me it would, that I had an early opportunity of comparing my guardian’s establishment with that of his cashier and clerk."),
    ("mix up", 1): ("gutenberg:204", "The modern mind always mixes up two different ideas: mystery in the sense of what is marvellous, and mystery in the sense of what is complicated."),
    ("mix up", 2): ("gutenberg:8164", "You know how it is sometimes when everything seems all mixed up and you suddenly get a clue."),
    ("give out", 1): ("gutenberg:543", "When she was giving out books the principal query was, “Can you tell me of a good, light, exciting love story to read?"),
    ("give out", 2): ("gutenberg:541", "He went into the summer-house, and sitting down on the rickety seat picked up the silken thing and looked at its carved handle, which was made of some rare wood that gave out an aromatic scent."),
    ("give out", 3): ("gutenberg:103", "The vessel continued to proceed with all steam on; but on the 18th, the engineer, as he had predicted, announced that the coal would give out in the course of the day."),
    ("give out", 4): ("gutenberg:120", "Once I looked into that bay, Jim Hawkins, and seen no schooner--well, I’m tough, but I gave out."),
    ("clear up", 1): ("gutenberg:103", "Passepartout cleared up with the weather."),
    ("clear up", 2): ("gutenberg:1661", "The second is to clear up the mystery and to punish the guilty parties.”"),
    ("clear up", 3): ("gutenberg:4517", "Then the girl had returned to her task of clearing up the kitchen for the night and he had taken his lantern and gone on his usual round outside the house."),
    ("follow up", 1): ("gutenberg:1661", "“Then I suggest that we turn our dinner into a supper and follow up this clue while it is still hot.”"),
    ("follow up", 2): ("gutenberg:158", "Knightley was to come at such a time, and follow up the beginning she was to make.—She was forced to speak, and to speak cheerfully too."),
    ("speak out", 1): ("gutenberg:1661", "I give you my word that I would have spoken out if it went against him at the Assizes.”"),
    ("think over", 1): ("gutenberg:233", "For an hour he thought over this plausible statement of the tangle."),
    ("fill up", 1): ("gutenberg:1400", "I had filled up the bottle from the tar-water jug."),
    ("fill up", 2): ("gutenberg:233", "The great open spaces were filling up."),
    ("fill up", 3): ("gutenberg:84", "“On examining my dwelling, I found that one of the windows of the cottage had formerly occupied a part of it, but the panes had been filled up with wood."),
    ("hang up", 1): ("gutenberg:8164", "I hung up the receiver, and crawled into bed."),
    ("hang up", 2): ("gutenberg:217", "He went into the passage, hung up his hat and coat."),
    ("look down on", 1): ("gutenberg:4397", "You can’t look down on a painter—you can’t take him seriously enough.”"),
    ("look down on", 2): ("gutenberg:217", "Pappleworth and Paul looking down on them from the far end of the room."),
    ("push on", 1): ("gutenberg:36", "I stepped over him gingerly and pushed on up the hill."),
    ("die out", 1): ("gutenberg:4397", "And yet he sometimes felt as if the family bolt was shot, their possessive instinct dying out."),
    ("show off", 1): ("gutenberg:1056", "He was not bragging, not showing off."),
    ("show off", 2): ("gutenberg:4397", "She was leaning back, almost upright, in a low black frock, with her knees crossed and her blue eyes half-closed; grey-blue smoke issued from her red, rather full lips, a fillet bound her chestnut hair, she wore the thinnest silk stockings, and shoes with very high heels showing off her instep."),
    ("wrap up", 1): ("gutenberg:4397", "Your mother is wrapped up in you, utterly, devotedly."),
    ("wrap up", 2): ("gutenberg:543", "He hastily wrapped up the leprous fragment of fish; he gaped as she trailed out."),
    ("wrap up", 3): ("gutenberg:217", "“Well,” he began apologetically, “she didn’t ask me; but one morning—and it _was_ cold—I found her on the station shivering, not able to keep still; so I asked her if she was well wrapped up."),
    ("run across", 1): ("gutenberg:1056", "I ran across a sample of it on my way here this evening."),
    ("run across", 2): ("gutenberg:174", "And she ran across the room and hugged him."),
    ("count on", 1): ("gutenberg:8164", "“You can count on me for all that sort of thing, Corky,” I said."),
    ("leave out", 1): ("gutenberg:543", "She rallied the five who had been left out, who would always be left out."),
    ("leave out", 2): ("gutenberg:158", "“Leave out the two last lines, and there is no reason why you should not write it into your book.”"),
    ("put away", 1): ("gutenberg:863", "We had just put away the last tea-spoon when a knock came at the door."),
    ("put away", 2): ("gutenberg:1400", "I’ve put away money, only for you to spend."),
    ("turn down", 1): ("gutenberg:217", "Then he turned down the gas and they set off."),
    ("turn down", 2): ("gutenberg:8164", "Have you ever been turned down by a girl who afterwards married and then been introduced to her husband?"),
    ("turn down", 3): ("gutenberg:1400", "“How do you do?” said I, shaking hands with him as we turned down the street together."),
    ("hand out", 1): ("gutenberg:233", "He approached Hurstwood, who handed out the tickets."),
    ("bring down", 1): ("gutenberg:139", "She looked so beautiful in her enthusiasm that I nearly brought down the whole level of the interview."),
    ("bring down", 2): ("gutenberg:139", "You will, no doubt, have the opportunity of describing in the Field how you brought down the rocketing dimorphodon."),
    ("bring down", 3): ("gutenberg:543", "An event which did not directly touch them brought down his wrath."),
    ("bring down", 4): ("gutenberg:103", "Bring down my mackintosh and traveling-cloak, and some stout shoes, though we shall do little walking."),
    ("cut in", 1): ("gutenberg:2226", "Kim cut in with a snort."),
    ("go after", 1): ("gutenberg:244", "“I will just go after him and see what he does with himself.”"),
    ("go after", 2): ("gutenberg:233", "There’s a lot of things coming to me if I want to go after them.”"),
    ("show up", 1): ("gutenberg:8164", "Diamond Jim Brady was there, as usual, and Laurette Taylor showed up with a party."),
    ("show up", 2): ("gutenberg:233", "In front of the line this showed up even more effectually."),
    ("show up", 3): ("gutenberg:345", "Van Helsing and I were shown up to Lucy’s room."),
    ("keep away", 1): ("gutenberg:55", "It is better for people to keep away from Oz, unless they have business with him."),
    ("let out", 1): ("gutenberg:2641", "“I only let out I didn’t like him."),
    ("let out", 2): ("gutenberg:2701", "“It was he, it was he!” cried Ahab, suddenly letting out his suspended breath."),
    ("let out", 3): ("gutenberg:289", "Panels and windows smashed, axles hopelessly bent, one wheel off, sardine-tins scattered over the wide world, and the bird in the bird-cage sobbing pitifully and calling to be let out."),
    ("let out", 4): ("gutenberg:46", "It was old enough now, and dreary enough, for nobody lived in it but Scrooge, the other rooms being all let out as offices."),
    ("put aside", 1): ("gutenberg:217", "Morel put aside her book."),
    ("put aside", 2): ("gutenberg:4397", "He was now putting aside some two thousand a year, and, with the care he was taking of himself, expected, so Aunt Hester said, to double his capital again before he died."),
    ("put aside", 3): ("gutenberg:217", "He put aside the thorns, and took out the eggs, holding them in the palm of his hand."),
    ("take back", 1): ("gutenberg:2641", "The same eternal worrying, the same taking back of words."),
    ("take back", 2): ("gutenberg:541", "\"I've just refused to take back a sum of money--that belonged to me.\""),
    ("take back", 3): ("gutenberg:62", "For ten years I have waited and prayed to be taken back to the world of my lost love."),
    ("take back", 4): ("gutenberg:233", "“I don’t know,” said Carrie, taken back by the question."),
    ("drop off", 1): ("gutenberg:1661", "So he sat as I dropped off to sleep, and so he sat when a sudden ejaculation caused me to wake up, and I found the summer sun shining into the apartment."),
    ("drop off", 2): ("gutenberg:2226", "Only my feet were frozen, and a toe dropped off."),
    ("drop off", 3): ("gutenberg:2084", "He thought of trying to live by his pen, but his writing had dropped off long ago; he no longer had an idea in his head."),
    ("move out", 1): ("gutenberg:2641", "I can’t have you moving out of your house when you like it, and perhaps losing money through it—all on my account."),
    ("move out", 2): ("gutenberg:4397", "The train moved out, and Jon fell on his knees."),
    ("pass down", 1): ("gutenberg:910", "It was a heritage he had received directly from One Eye and the she-wolf; but to them, in turn, it had been passed down through all the generations of wolves that had gone before."),
    ("pass down", 2): ("gutenberg:541", "She usually followed him; but he heard her passing down the passage to her bedroom."),
    ("sit back", 1): ("gutenberg:35", "He sat back in his chair at first, and spoke like a weary man."),
    ("sit back", 2): ("gutenberg:543", "But can I sit back all my life and be satisfied with 'Hey, folks'?"),
    ("cut down", 1): ("gutenberg:1056", "Cut down a third, there would be two thousand."),
    ("cut down", 2): ("gutenberg:2701", "My father, in old Tolland county, cut down a pine tree once, and found a silver ring grown over in it; some old darkey’s wedding ring."),
    ("cut down", 3): ("gutenberg:4397", "Twenty years old, and cut down like grass—to have no life at all!"),
    ("go around", 1): ("gutenberg:64317", "A momentary hush; the orchestra leader varies his rhythm obligingly for her, and there is a burst of chatter as the erroneous news goes around that she is Gilda Gray’s understudy from the Follies."),
    ("go around", 2): ("gutenberg:103", "Passepartout was getting nervous, for the hands on the face of the big clock over the judge seemed to go around with terrible rapidity."),
    ("go around", 3): ("gutenberg:55", "There was no way of going around it, for it seemed to extend to the right and left as far as they could see; and, besides, they did not dare change the direction of their journey for fear of getting lost."),
    ("go around", 4): ("gutenberg:233", "He would go around to Fitzgerald and Moy’s and get a cigar."),
    ("hold back", 1): ("gutenberg:543", "They were held back by the slow line of disembarking passengers."),
    ("hold back", 2): ("gutenberg:5200", "He held back the urge to move but swayed from side to side as he crouched there on the floor."),
    ("hold back", 3): ("gutenberg:2641", "Of course, I was holding back on my cousin’s account.”"),
    ("hold back", 4): ("gutenberg:345", "I am so glad that she consented to hold back and let us men do the work."),
    ("pull off", 1): ("gutenberg:233", "Then he pulled off his shoes and lay down."),
    ("pull off", 2): ("gutenberg:8164", "I felt like the proprietor of a performing dog on the vaudeville stage when the tyke has just pulled off his trick without a hitch."),
    ("pull off", 3): ("gutenberg:2701", "Issuing from the cabin, Stubb now called his boat’s crew, and pulled off for the stranger."),
    ("go ahead", 1): ("gutenberg:1056", "“Go ahead,” he said; “tell me about them beforehand."),
    ("go ahead", 2): ("gutenberg:345", "We are travelling fast, and as we have no driver with us to carry tales, we go ahead of scandal; but I daresay that fear of the evil eye will follow hard behind us all the way."),
    ("put together", 1): ("gutenberg:780", "To build an ironclad took from two to four years; an airship could be put together in as many weeks."),
    ("put together", 2): ("gutenberg:219", "Sends in as much ivory as all the others put together...’"),
    ("put together", 3): ("gutenberg:4517", "It was that night that I found the clue to Ethan Frome, and began to put together this vision of his story."),
    ("turn around", 1): ("gutenberg:233", "“Very well,” said Hurstwood, turning around."),
    ("turn around", 3): ("gutenberg:103", "The railway turned around the sides of the mountains, and did not attempt to violate nature by taking the shortest cut from one point to another."),
    ("back up", 1): ("gutenberg:64317", "We backed up to a grey old man who bore an absurd resemblance to John D. Rockefeller."),
    ("back up", 2): ("gutenberg:541", "\"As long as a member of a well-known family is backed up by that family it should be considered--final.\""),
    ("cheer up", 1): ("gutenberg:4397", "He spoke with relish, as though he felt that he was cheering up his old aunt."),
    ("cheer up", 2): ("gutenberg:233", "“Cheer up, old man,” whispered his companion."),
    ("drop out", 1): ("gutenberg:215", "The bottom had dropped out of the trail."),
    ("drop out", 2): ("gutenberg:4397", "And very soon he was thinking: 'Dash it! she's going beyond me!' His limit-six hundred-was exceeded; he dropped out of the bidding."),
    ("write down", 1): ("gutenberg:4397", "Instinctively he took a crumpled sheet of paper from his pocket, and wrote down some broken words."),
    ("get together", 1): ("gutenberg:158", "It is such a happiness when good people get together—and they always do."),
    ("get together", 2): ("gutenberg:2084", "There were no other pictures in the library, but in the dining-room there was a fine collection, which the doctor had got together with his usual consummate taste."),
    ("get together", 3): ("gutenberg:543", "Let me tell you----” “----isn't a theater-play; it's a serious effort to have us get together on fundamentals."),
    ("keep back", 1): ("gutenberg:863", "“I am not keeping back facts."),
    ("keep back", 2): ("gutenberg:103", "The police had great difficulty in keeping back the crowd, and as the hour when Phileas Fogg was due approached, the excitement rose to its highest pitch."),
    ("keep back", 3): ("gutenberg:2084", "The fact was that she sold as well as ever, but kept back part of the proceeds in order to buy gin, and she did this more and more till even the unsuspecting Ernest ought to have seen that she was not telling the truth."),
    ("keep back", 4): ("gutenberg:55", "They had nearly reached the first rock when they heard a rough voice cry out, “Keep back!”"),
    ("wear off", 1): ("gutenberg:2084", "With dinner his shyness wore off."),
    ("base on", 1): ("gutenberg:863", "My system is based on his—though of course I have progressed rather further."),
    ("die down", 1): ("gutenberg:233", "The sun had come out and the wind had died down."),
    ("tear down", 1): ("gutenberg:233", "The present one was to be torn down."),
    ("tear down", 2): ("gutenberg:204", "Wilfred recognised it indeed as a light Japanese or Chinese helmet torn down from a trophy that hung in the old family hall."),
    ("tear down", 3): ("gutenberg:863", "True enough, there he was, tearing down the street, hatless, and gesticulating as he went."),
    ("tear up", 1): ("gutenberg:217", "And he tore up the blue form irritably."),
    ("tear up", 2): ("gutenberg:1400", "So furious had been the gusts, that high buildings in town had had the lead stripped off their roofs; and in the country, trees had been torn up, and sails of windmills carried away; and gloomy accounts had come in from the coast, of shipwreck and death."),
    ("wipe out", 1): ("gutenberg:345", "“I care for nothing now,” he answered hotly, “except to wipe out this brute from the face of creation."),
    ("wipe out", 2): ("gutenberg:64317", "Just tell him the truth—that you never loved him—and it’s all wiped out forever.”"),
    ("advantage in", 1): ("gutenberg:158", "I see no advantage in consulting Miss Bates.”"),
    ("call back", 1): ("gutenberg:233", "“Rubber!” he called back as she looked after him."),
    ("call back", 2): ("gutenberg:1342", "Calling back the servant, therefore, she commissioned him, though in so breathless an accent as made her almost unintelligible, to fetch his master and mistress home instantly."),
    ("fall through", 1): ("gutenberg:8164", "There was a gleam of light when the brother of Bicky’s pawnbroker offered ten dollars, money down, for an introduction to old Chiswick, but the deal fell through, owing to its turning out that the chap was an anarchist and intended to kick the old boy instead of shaking hands with him."),
    ("give away", 1): ("gutenberg:174", "“People are very fond of giving away what they need most themselves."),
    ("give away", 2): ("gutenberg:4397", "To one so secretive as Soames the thought of reentry into quiet possession of his own property with nothing given away to the world was intensely alluring."),
    ("hand down", 1): ("gutenberg:1342", "We are each of an unsocial, taciturn disposition, unwilling to speak, unless we expect to say something that will amaze the whole room, and be handed down to posterity with all the _éclat_ of a proverb.”"),
    ("hand down", 2): ("gutenberg:1260", "I answered “Yes,” and was then lifted out; my trunk was handed down, and the coach instantly drove away."),
    ("let in", 1): ("gutenberg:4397", "Let me in at once—I insist on being let in!”"),
    ("let in", 2): ("gutenberg:1260", "I have just opened the window, to let in a little air and sunshine; for everything gets so damp in apartments that are seldom inhabited; the drawing-room yonder feels like a vault.”"),
    ("hang out", 1): ("gutenberg:4397", "She turned into her bedroom and hung out of the window to cool her face, which had suddenly grown very hot."),
    ("let down", 1): ("gutenberg:1260", "I let down the curtain and went back to the fireside."),
    ("let down", 2): ("gutenberg:1342", "“Yes, and her petticoat; I hope you saw her petticoat, six inches deep in mud, I am absolutely certain, and the gown which had been let down to hide it not doing its office.”"),
    ("put forward", 1): ("gutenberg:863", "And now, to-day, he puts forward a suggestion that he himself must have known was ridiculous."),
    ("put forward", 2): ("gutenberg:217", "Very gingerly she put forward her hand."),
    ("turn off", 1): ("gutenberg:103", "“To turn off the gas in my room!”"),
    ("turn off", 2): ("gutenberg:543", "Carol turned off on a side-street."),
    ("butt in", 1): ("gutenberg:543", "He'd simply resent my butting in.”"),
    ("butt in", 2): ("gutenberg:35", "As it slipped from my hand, I had to butt in the dark with my head—I could hear the Morlock’s skull ring—to recover it."),
    ("slow down", 1): ("gutenberg:233", "Carrie felt the train to be slowing down."),
    ("build up", 1): ("gutenberg:543", "Imagine how a person would feel, after working hard for years and helping to build up a nice town, to have you airily flit in and simply say 'Rotten!' Think that's fair?”"),
    ("come around", 1): ("gutenberg:233", "“Come around after the show."),
    ("come around", 2): ("gutenberg:1056", "“I got to drink when Saturday night comes around.”"),
    ("fall back on", 1): ("gutenberg:2226", "The lama fell back on Urdu, remembering that he was in a strange land."),
    ("fall back on", 2): ("gutenberg:120", "Between us, with much trouble, we managed to hoist him upstairs, and laid him on his bed, where his head fell back on the pillow as if he were almost fainting."),
    ("shut down", 1): ("gutenberg:233", "“The job I had I lost ’cause they shut down."),
    ("shut down", 2): ("gutenberg:2776", "Jerry shut down the trap and slashed his oat-fed horse."),
    ("shut down", 3): ("gutenberg:217", "Darkness shut down over the valley; work was done."),
    ("speak up", 1): ("gutenberg:120", "“Speak up to the others.”"),
    ("speak up", 2): ("gutenberg:120", "“Now, look here,” said the captain; “you’ve run me down; here I am; well, then, speak up; what is it?”"),
    ("bustle about", 1): ("gutenberg:543", "She bustled about, making calls."),
    ("convert into", 1): ("gutenberg:64317", "The intense vitality that had been so remarkable in the garage was converted into impressive hauteur."),
    ("convert into", 2): ("gutenberg:4397", "CHAPTER XIII JOLYON FINDS OUT WHERE HE IS Jolyon stood at the window in Holly’s old night nursery, converted into a studio, not because it had a north light, but for its view over the prospect away to the Grand Stand at Epsom."),
    ("fill in", 1): ("gutenberg:217", "In the morning he filled in the form for his season-ticket and took it to the station."),
    ("fill in", 2): ("gutenberg:1056", "It was a matter only of time, when he would fill in the outline."),
    ("fill in", 3): ("gutenberg:139", "We filled in the time by opening one of our food tins and making sure of our breakfast."),
    ("fill out", 1): ("gutenberg:1056", "He stood there and received the blanks for a million years or so, never letting one go by for fear it might be filled out."),
    ("fill out", 2): ("gutenberg:233", "Her form had filled out until it was admirably plump and well-rounded."),
    ("fill out", 3): ("gutenberg:2701", "Such portentous appetites had Queequeg and Tashtego, that to fill out the vacancies made by the previous repast, often the pale Dough-Boy was fain to bring on a great baron of salt-junk, seemingly quarried out of the solid ox."),
    ("fill out", 4): ("gutenberg:2701", "For again Starbuck’s downcast eyes lighted up with the stubbornness of life; the subterranean laugh died away; the winds blew on; the sails filled out; the ship heaved and rolled as before."),
    ("pay off", 1): ("gutenberg:174", "Isaacs has advanced us fifty pounds to pay off our debts and to get a proper outfit for James."),
    ("pay off", 2): ("gutenberg:345", "The Professor watched whilst I went downstairs with Quincey Morris, and sent one of the maids to pay off one of the cabmen who were waiting."),
    ("pull in", 1): ("gutenberg:543", "What she pulls in our store is to come in smiling with Christian Fortitude and keep a clerk busy for one hour while she picks out half a dozen fourpenny nails."),
    ("pull in", 3): ("gutenberg:1056", "The train pulled in to Sixteenth Street Station, and the waiting electric car could be seen, the conductor of which was impatiently clanging the gong."),
    ("pull in", 4): ("gutenberg:217", "Often, when wiping the dishes, she would stand in bewilderment and chagrin because she had pulled in two halves a cup or a tumbler."),
    ("send off", 1): ("gutenberg:2084", "On this she sent off a messenger to town, and desired him not to return without her lawyer and myself."),
    ("send off", 2): ("gutenberg:2701", "While yet a little distance from the forge, moody Ahab paused; till at last, Perth, withdrawing his iron from the fire, began hammering it upon the anvil—the red mass sending off the sparks in thick hovering flights, some of which flew close to Ahab."),
    ("take after", 1): ("gutenberg:4397", "“Val’s different,” said Winifred; “he takes after me.”"),
    ("take after", 2): ("gutenberg:910", "The moment the sled started, the team took after Lip-lip in a chase that extended throughout the day."),
    ("wind up", 1): ("gutenberg:1661", "And yet he would always wind up by muttering that no sister of his should ever have accepted such a situation."),
    ("wind up", 2): ("gutenberg:1661", "In the latter, as may be remembered, Sherlock Holmes was able, by winding up the dead man’s watch, to prove that it had been wound up two hours before, and that therefore the deceased had gone to bed within that time—a deduction which was of the greatest importance in clearing up the case."),
    ("wind up", 3): ("gutenberg:2701", "As we pluck out the shafts, stand aside! here’s the battering-ram, Capricornus, or the Goat; full tilt, he comes rushing, and headlong we are tossed; when Aquarius, or the Water-bearer, pours out his whole deluge and drowns us; and to wind up with Pisces, or the Fishes, we sleep."),
    ("wind up", 4): ("gutenberg:4397", "He felt that he should relish his soup—the entire morning had been given to winding up the estate of an old friend."),
    ("keep off", 1): ("gutenberg:1260", "Ladies, keep off, or I shall wax dangerous.”"),
    ("keep off", 2): ("gutenberg:217", "“You should tell him to keep off the drink,” pronounced the great cashier."),
    ("keep off", 3): ("gutenberg:345", "It’ll be something to keep off the darkness now and then."),
    ("keep off", 4): ("gutenberg:4397", "Under the grey heavens, whose drizzle just kept off, the dark concourse gathered to see the show."),
    ("sell out", 1): ("gutenberg:1661", "“Sold out of geese, I see,” continued Holmes, pointing at the bare slabs of marble."),
    ("sell out", 2): ("gutenberg:2084", "Midland stock at the end of August 1850, when I sold out Miss Pontifex’s debentures, stood at £32 per £100."),
    ("sell out", 3): ("gutenberg:4517", "“Looks as if we were all sold out."),
    ("bridge over", 1): ("gutenberg:345", "Of course you must bear in mind that I did not have full opportunity of examination such as I should wish; our very friendship makes a little difficulty which not even medical science or custom can bridge over."),
    ("clean up", 1): ("gutenberg:5200", "If only they had told this charwoman to clean up his room every day instead of letting her disturb him for no reason whenever she felt like it!"),
    ("clean up", 2): ("gutenberg:217", "“Now I’m cleaned up for thee: tha’s no ’casions ter stir a peg all day, but sit and read thy books.”"),
    ("clean up", 3): ("gutenberg:2084", "It was not only that he had to do so much household work, for even the cooking, cleaning up slops, bed-making and fire-lighting ere long devolved upon him, but his business no longer prospered."),
    ("fit in", 1): ("gutenberg:217", "She did not fit in with the others; she could very rarely get into human relations with anyone: so her friend, her companion, her lover, was Nature."),
    ("fit in", 2): ("gutenberg:863", "Does the next fit in with that? _A merveille!_ Good!"),
    ("fit in", 3): ("gutenberg:217", "He was trying to fit in the drawer."),
    ("hang around", 1): ("gutenberg:64317", "“You’re one of that bunch that hangs around with Meyer Wolfshiem—that much I happen to know."),
    ("hang around", 2): ("gutenberg:910", "Then Grey Beaver took a knife from a sheath that hung around his neck, and went into the thicket and cut a stick."),
    ("knock down", 1): ("gutenberg:2701", "Next instant, the heavy eye-splice in the rope’s final end flew out of the stark-empty tub, knocked down an oarsman, and smiting the sea, disappeared in its depths."),
    ("let off", 1): ("gutenberg:2084", "She begged and prayed to be let off."),
    ("let off", 2): ("gutenberg:219", "The fool-nigger had dropped everything, to throw the shutter open and let off that Martini-Henry."),
    ("let off", 3): ("gutenberg:2701", "As for Peleg, after letting off his rage as he had, there seemed no more left in him, and he, too, sat down like a lamb, though he twitched a little as if still nervously agitated."),
    ("let off", 4): ("gutenberg:2084", "Ellen told him that he might take a house in some small street, say near the “Elephant and Castle,” for 17s. or 18s. a week, and let off the two top floors for 10s., keeping the back parlour and shop for themselves."),
    ("step up", 1): ("gutenberg:120", "“Step up, lad,” cried Silver."),
    ("use up", 1): ("gutenberg:233", "On several days it rained and she used up car fare."),
    ("use up", 2): ("gutenberg:4397", "He had secured the corner seat next the conductor, where his long legs made it difficult for anyone to get in, and at all who passed him he looked resentfully, as if they had no business to be using up his air."),
    ("watch out", 1): ("gutenberg:910", "Also, he must watch out for the live things."),
    ("watch out", 2): ("gutenberg:1056", "Then watch out, he thought—’ware shoal, everybody!"),
    ("acquiesce in", 1): ("gutenberg:217", "Tacitly, she acquiesced in what he felt."),
    ("act up", 1): ("gutenberg:4397", "How wonderfully Dad had acted up to that philosophy!"),
    ("act up", 2): ("gutenberg:543", "About Vida's new jabot which made her look thirty-two (Vida's estimate) or twenty-two (Raymie's estimate), Vida's plan to have the high-school Debating Society give a playlet, and the difficulty of keeping the younger boys well behaved on the playground when a big lubber like Cy Bogart acted up so."),
    ("advantage over", 1): ("gutenberg:910", "It gave him a tremendous advantage over his antagonists."),
    ("blow up", 1): ("gutenberg:2084", "I don’t exactly wish they’d blow up Mr Gladstone, but if a mad bull would chivy him there, and he would never come back any more, I should not be sorry."),
    ("blow up", 2): ("gutenberg:103", "If this was an American craft, we should blow up, perhaps, but we should at all events go faster!”"),
    ("blow up", 3): ("gutenberg:233", "It was blowing up grey again."),
    ("put back", 1): ("gutenberg:55", "But he at once unlocked their spectacles, which he put back into the green box, and gave them many good wishes to carry with them."),
    ("put back", 2): ("gutenberg:4397", "I now move that the report and accounts be put back, and amended by striking out the grant altogether.”"),
    ("put back", 3): ("gutenberg:120", "I’ve seen his top-sails with these eyes, off Trinidad, and the cowardly son of a rum-puncheon that I sailed with put back--put back, sir, into Port of Spain.”"),
    ("put back", 4): ("gutenberg:345", "I put back the clothes from my face, and found, to my surprise, that all was dim around."),
    ("take over", 1): ("gutenberg:345", "Then he took over the care of the case himself, saying that he would watch this night and the next and would send me word when to come."),
    ("take over", 2): ("gutenberg:5200", "As it is this animal is persecuting us, it’s driven out our tenants, it obviously wants to take over the whole flat and force us to sleep on the streets."),
    ("take over", 3): ("gutenberg:2084", "It was a mean advantage to have taken over him, but he was glad they had taken it, for it made him realise more fully than ever that his one chance lay in separating himself completely from them."),
    ("try out", 1): ("gutenberg:2776", "I hastened to ask him a question because I wanted to try out a theory I had."),
    ("try out", 2): ("gutenberg:2701", "In a word, after being tried out, the crisp, shrivelled blubber, now called scraps or fritters, still contains considerable of its unctuous properties."),
    ("beset by", 1): ("gutenberg:1260", "He is beset by sharpers: John is sunk and degraded—his look is frightful—I feel ashamed for him when I see him.”"),
    ("beset by", 2): ("gutenberg:215", "Buck was beset by three huskies, and in a trice his head and shoulders were ripped and slashed."),
    ("check in", 2): ("gutenberg:46", "He was checked in his transports by the churches ringing out the lustiest peals he had ever heard."),
    ("give back", 1): ("gutenberg:345", "Death had given back part of her beauty, for her brow and cheeks had recovered some of their flowing lines; even the lips had lost their deadly pallor."),
    ("give back", 2): ("gutenberg:217", "Again it was given back, long and harsh."),
    ("knock out", 3): ("gutenberg:120", "There was a porch at the door, and under this porch the little spring welled up into an artificial basin of a rather odd kind--no other than a great ship’s kettle of iron, with the bottom knocked out, and sunk “to her bearings,” as the captain said, among the sand."),
    ("knock out", 5): ("gutenberg:120", "Captain Smollett rose from his seat and knocked out the ashes of his pipe in the palm of his left hand."),
    ("knock out", 6): ("gutenberg:8164", "Bicky seemed pretty well knocked out, so I put in a word."),
    ("stay up", 1): ("gutenberg:345", "How remiss I am to let you stay up so long."),
    ("stay up", 2): ("gutenberg:139", "\"The debbil get you sure if you stay up there.\""),
    ("step down", 1): ("gutenberg:174", "“Is it really finished?” he murmured, stepping down from the platform."),
    ("step down", 2): ("gutenberg:25344", "Be not silent from any mistaken pity and tenderness for him; for, believe me, Hester, though he were to step down from a high place, and stand there beside thee, on thy pedestal of shame, yet better were it so than to hide a guilty heart through life."),
    ("try on", 1): ("gutenberg:543", "But she tried on a pair at Kennicott's office."),
    ("try on", 2): ("gutenberg:1400", "Don’t try on useless measures."),
    ("warm up", 2): ("gutenberg:345", "I asked him a few questions on Transylvania history, and he warmed up to the subject wonderfully."),
    ("warm up", 3): ("gutenberg:543", "She bustled to the kitchen, stoked the wood-range, sang Schumann while she boiled the kettle, warmed up raisin cookies on a newspaper spread on the rack in the oven."),
    ("beam on", 1): ("gutenberg:289", "The Badger simply beamed on him."),
    ("branch off", 1): ("gutenberg:289", "In silence Mole rowed steadily, and soon they came to a point where the river divided, a long backwater branching off to one side."),
    ("call off", 1): ("gutenberg:8164", "I felt like one of those chappies in the novels who calls off the fight with his wife in the last chapter and decides to forget and forgive."),
    ("call off", 2): ("gutenberg:910", "The next moment the master arrived, and with one hand held White Fang, while the father called off the dogs."),
    ("call off", 3): ("gutenberg:1342", "Darcy was writing, and Miss Bingley, seated near him, was watching the progress of his letter, and repeatedly calling off his attention by messages to his sister."),
    ("catch on", 1): ("gutenberg:345", "She caught on to my meaning at once, and settled that matter in a word."),
    ("catch on", 3): ("gutenberg:543", "Her skirt caught on a barb; he carefully freed it."),
    ("get across", 1): ("gutenberg:217", "But he could not get across to her."),
    ("get ahead", 1): ("gutenberg:289", "They understood him, they saw through him, they had got ahead of him."),
    ("get ahead", 2): ("gutenberg:64317", "“Jimmy was bound to get ahead."),
    ("look ahead", 1): ("gutenberg:289", "Simply messing,” he went on dreamily: “messing—about—in—boats; messing——” “Look ahead, Rat!” cried the Mole suddenly."),
    ("look ahead", 2): ("gutenberg:217", "And looking ahead, the prospect of her life made her feel as if she were buried alive."),
    ("calm down", 1): ("gutenberg:863", "“Ah, why indeed?” said Poirot, calming down."),
    ("calm down", 2): ("gutenberg:5200", "The chief clerk had to be held back, calmed down, convinced and finally won over; the future of Gregor and his family depended on it!"),
    ("calm down", 3): ("gutenberg:2641", "“Yes, of course; to go to Constantinople until they are used to the idea and everything has calmed down.”"),
    ("get by", 1): ("gutenberg:1260", "“I shall get by very well,” I meditated."),
    ("get by", 2): ("gutenberg:233", "She was so excited that she got up and tried to get by him again."),
    ("condense into", 1): ("gutenberg:139", "I condensed into a few sentences the Professor's narrative."),
    ("lay off", 1): ("gutenberg:233", "When the rush or busy hours were over, they were laid off."),
    ("lay off", 3): ("gutenberg:36", "There were already a couple of score of passengers aboard, some of whom had expended their last money in securing a passage, but the captain lay off the Blackwater until five in the afternoon, picking up passengers until the seated decks were even dangerously crowded."),
    ("pull over", 2): ("gutenberg:120", "As we pulled over, there was some discussion on the chart."),
    ("put through", 1): ("gutenberg:543", "“Only I'm not sure I can put through my schemes."),
    ("put through", 2): ("gutenberg:1056", "He found her in the kitchen one morning groaning with pain, tears of weakness running down her cheeks, vainly endeavoring to put through a large ironing."),
    ("think through", 2): ("gutenberg:543", "She was saved from self-pity as she began to think through Erik's mind."),
    ("think up", 1): ("gutenberg:8164", "You’ve got to think up some way of getting me out of this mess."),
    ("back down", 2): ("gutenberg:2226", "Kim tore back down the ditch till he reached a point opposite his second resting-place, slipped across the road like a weasel, and re-coiled himself in the blanket."),
    ("brush up", 1): ("gutenberg:1260", "Millcote, ——shire; I brushed up my recollections of the map of England; yes, I saw it; both the shire and the town. ——shire was seventy miles nearer London than the remote county where I now resided: that was a recommendation to me."),
    ("brush up", 3): ("gutenberg:4397", "And he brushed up his moustache, having in nine months of Green Street domesticity regained almost all his flesh and his assurance."),
    ("circle around", 1): ("gutenberg:910", "He thrust her off with his shoulder, and, his retreat cut off and still intent on regaining the sled, he altered his course in an attempt to circle around to it."),
    ("end up", 1): ("gutenberg:64317", "They got into automobiles which bore them out to Long Island, and somehow they ended up at Gatsby’s door."),
    ("end up", 2): ("gutenberg:139", "I call them apes, but they carried sticks and stones in their hands and jabbered talk to each other, and ended up by tyin' our hands with creepers, so they are ahead of any beast that I have seen in my wanderin's."),
    ("pull through", 1): ("gutenberg:36", "If we were the size of ants we might pull through."),
    ("pull through", 2): ("gutenberg:543", "His work--one farmer he pulls through diphtheria is worth all my yammering for a castle in Spain."),
    ("set back", 4): ("gutenberg:233", "They crossed the park and went west along Washington Boulevard, beautiful with its broad macadamised road, and large frame houses set back from the sidewalks."),
    ("sort out", 1): ("gutenberg:2226", "He sorted out every scrap of manuscript, every map, and the native letters."),
    ("sort out", 2): ("gutenberg:5200", "That’s all been sorted out.”"),
    ("coil in", 1): ("gutenberg:2701", "In the English boats two tubs are used instead of one; the same line being continuously coiled in both tubs."),
    ("contract in", 1): ("gutenberg:910", "A tree, contracting in the cool of the night, made a loud noise."),
    ("figure out", 1): ("gutenberg:2776", "“Don’t you figure out that I might have had something to do with it?” said Soapy, not without sarcasm, but friendly, as one greets good fortune."),
    ("figure out", 2): ("gutenberg:543", "I'll figure out a definite plan tomorrow, and hereafter you'll be on a regular amount or percentage, with your own checking account.”"),
    ("figure out", 3): ("gutenberg:543", "Only, I'm not idiot enough to pay more than the government makes me pay, and Sam and I were just figuring out whether all automobile expenses oughn't to be exemptions."),
    ("get around", 1): ("gutenberg:233", "“It is rather large to get around in a week,” answered Ames, pleasantly."),
    ("give off", 1): ("gutenberg:36", "The burning heather had been extinguished, but the level ground towards Ottershaw was blackened as far as one could see, and still giving off vertical streamers of smoke."),
    ("add up", 1): ("gutenberg:1056", "“Of course it’s all valueless, just so much dull and sordid plodding; but it is no more dull and sordid than keeping books at sixty dollars a month, adding up endless columns of meaningless figures until one dies."),
    ("back off", 1): ("gutenberg:543", "They backed off and tried to rehearse."),
    ("branch out", 1): ("gutenberg:1056", "A stream of short stories flowed from his pen, and he branched out into the easier forms of verse—the kind he saw printed in the magazines—though he lost his head and wasted two weeks on a tragedy in blank verse, the swift rejection of which, by half a dozen magazines, dumfounded him."),
    ("branch out", 2): ("gutenberg:1661", "Now, if you are well up in your London, you will know that the office of the company is in Fresno Street, which branches out of Upper Swandam Lane, where you found me to-night."),
    ("center on", 1): ("gutenberg:543", "Her opinionation seemed dead; she had no apparent desire for escape; her brooding centered on Hugh."),
    ("cut back", 2): ("gutenberg:64317", "“Well, I’d like to, but—” We went on, cutting back again over the Park toward the West Hundreds."),
    ("kick off", 1): ("gutenberg:543", "Carol kicked off her silver slippers, and ignored the universal glance at her arches."),
    ("pay back", 1): ("gutenberg:217", "The second time he had not paid back."),
    ("pick on", 1): ("gutenberg:8164", "There was something in her eye that seemed to say: “Out of a city of six million people, why did you pick on me?”"),
    ("pick on", 2): ("gutenberg:1056", "And, of course, Cheese-Face had picked on him again, and there was another fight that was indeterminate, because at quarter to four the door of the press-room was thrown open and the gang of boys crowded in to fold their papers."),
    ("brag about", 1): ("gutenberg:2776", "I’ve seen men from Chicago sit in a gondola in Venice on a moonlight night and brag about their drainage canal."),
    ("burn out", 1): ("gutenberg:1260", "Mason, shivering as some one chanced to open the door, asked for more coal to be put on the fire, which had burnt out its flame, though its mass of cinder still shone hot and red."),
    ("chip in", 1): ("gutenberg:2776", "Delia Caruthers did things in six octaves so promisingly in a pine-tree village in the South that her relatives chipped in enough in her chip hat for her to go “North” and “finish.”"),
    ("chip in", 2): ("gutenberg:8164", "The water-supply cove chipped in: “You’re quite right, Simms."),
    ("fall apart", 1): ("gutenberg:910", "A log fell apart with a loud spluttering noise."),
    ("write off", 3): ("gutenberg:4397", "One night, as befitted a man who had arrived at so important a stage of his career, he made a calculation of what he was worth, and after writing off liberally for depreciation by the war, found his value to be some hundred and thirty thousand pounds."),
    ("burn through", 1): ("gutenberg:35", "It had almost burnt through when I reached the opening into the shaft."),
    ("cool down", 1): ("gutenberg:1056", "After a few months, when he is cooled down, if you want to, you can get the job of drivin’ delivery-wagon for him."),
}

# 抽不到例句的义项**必须点名**（闸：examples 为空却无 examples_gap ＝ 报错）。
# 2026-10-10 扩语料（+19 本 1900–1929）后**逐条回查**：11 条缺口救回 4（见 EX），余 7 条各自写明为什么仍缺。
GAP = {
    ("account for", 2): "回查 44 本：比例义线索词（per cent／proportion／part of…）全 0 ⇒ 0 条正据（1661 那句实为「解释」义，误分派已撤）",
    ("put off", 2): "回查「put sb off sth」0 条；158 的 put off 是「推迟／敷衍」不是「使反感」⇒ 宁缺勿错",
    ("set up", 2): "回查仅 780「set up transformers and a generating station」——与第 1 义「建立」难分 ⇒ 宁缺勿错",
    ("take off", 1): "回查 18 条 take off 全为「脱（衣帽）」；780「take off more removable parts」＝拆卸，非航空义 ⇒ 0 条",
    ("take off", 3): "回查「走红」线索词（popular／vogue／success）0 条 ⇒ 宁缺勿错",
    ("break up", 1): "回查无「break up with」；4397「break up the cloud」＝消散、217「home broken up」非直接分手 ⇒ 宁缺勿错",
    ("come up with", 1): "回查 21 条全为「追上（catch up with）」义 ⇒ 0 条「想出」",
    ("stick out", 2): "回查 0 条「显眼（引人注意）」义（stuck out 全为「伸出」）⇒ 宁缺勿错",
    ("set off", 2): "回查 0 条「引发／激起」正据（set off 全为「出发／衬托」）⇒ 宁缺勿错",
    ("go out", 2): "回查 44 本无「交往／谈恋爱」正据：`go out with` 全为「与…一同出门」（217 went out with Leonard and Annie／4397 went out with a curse）⇒ 该义为 20 世纪口语引申，1900 前后公版语料不载 ⇒ 宁缺勿错",
    ("look up", 3): "回查 44 本「好转／改善」正据 0 条：`look up` 全为「查阅／抬头看」；`business look up` 唯一命中（780）实为「（抬眼）看风筝」⇒ 0 条",
    ("come up", 3): "回查 44 本「（意外）出现／发生」独立正据 0 条：`came up` 1 条属「被提及」义，唯一含 something/what 的（4397 what came up）语境不明 ⇒ 宁缺勿错",
    ("go up", 3): "回查 44 本「（建筑）盖起／着火」正据 0 条：`went up` 全为「上去」义；`up in flames／smoke` 全语料 0 条 ⇒ 0 条",
    ("come on", 4): "回查 44 本无「进展（how is X coming on?）」正据；cue 命中 2 条均属「（天/季节）来临」义 ⇒ 0 条",
    ("go away", 2): "回查 44 本无「（疼痛/烦恼）消失」正据（`go away` 全为「走开／离开」义）⇒ 宁缺勿错",
    ("make up", 3): "回查 44 本无「和好（make up with sb）」正据 ⇒ 0 条",
    ("make up", 4): "回查 44 本无「化妆」正据（1900 前后语料不用此义）⇒ 0 条",
    ("put on", 2): "回查 44 本无「开（灯/音乐）」正据（light/music 与 put on 连用者皆非此义：light grey dress／by the light／put on the fire＝添煤）⇒ 0 条",
    ("stand up", 2): "回查 44 本无「（论点／指控）站得住脚」正据 ⇒ 0 条",
    ("pick up", 4): "回查「收拾／整理」正据弱（picked up the shoes／the lamp 皆＝拿起）⇒ 宁缺勿错",
    ("take out", 3): "回查 44 本无「取得（执照／保险／专利）」正据 ⇒ 0 条",
    ("go over", 2): "回查 44 本无「（演出／建议）受欢迎」正据 ⇒ 0 条",
    ("get away", 2): "回查 44 本无「抽身走开／度假」正据（`get away` 全为「逃走」或「侥幸逃脱」）⇒ 宁缺勿错",
    ("get in", 3): "回查 44 本无「（被）录取／选上」正据 ⇒ 0 条",
    ("come along", 2): "回查 44 本无「（机会）出现／到来」正据 ⇒ 0 条",
    ("turn away", 2): "回查 44 本无「拒之门外／不接纳」正据（`turned away` 全为「转过脸去」）⇒ 宁缺勿错",

    ("break out", 4): "回查 44 本无「（疹子/汗）break out in」正据 ⇒ 0 条（该义系近代医学口语）",
    ("run down", 1): "回查 44 本「被车撞倒」正据 0 条：863「he was run down in Brussels」实为「被追捕归案」（Abercrombie 伪案）⇒ 宁缺勿错",
    ("run down", 4): "回查 44 本无「run sb/sth down＝贬低/说坏话」正据 ⇒ 0 条",
    ("look over", 2): "回查 44 本无「look over a fault＝宽恕」正据（look over 全为「查看/越过肩看」）⇒ 0 条",
    ("turn back", 2): "回查 44 本「turn back the enemy/tide」正据 0 条（turned back 全为「折回」）⇒ 宁缺勿错",
    ("turn back", 3): "回查 44 本无「turn back to a page＝翻回书页」正据 ⇒ 0 条",
    ("put out", 4): "回查 44 本无「put out a book＝出版」正据（命中全为「伸出/熄灭/惹恼」）⇒ 0 条",
    ("turn in", 1): "回查 44 本无「turn in a report＝上交」正据（该义系 20 世纪职场口语）⇒ 0 条",
    ("wake up", 2): "回查 44 本无「wake sb up」宾语插入式正据（woke up 全为「自然醒来」）⇒ 0 条",
    ("wake up", 3): "回查 44 本无「wake up to＋事实」正据 ⇒ 0 条",
    ("run out", 2): "回查 44 本无「（期限/执照）run out＝到期」正据 ⇒ 0 条（20 世纪用法）",
    ("get over", 4): "回查 44 本无「get sth over (with)＝了结」正据 ⇒ 0 条",
    ("turn on", 4): "回查 44 本无「turn sb on＝使兴奋／激起兴致」正据（该义系 1960 年代俚语；唯一带 thrill 语感的 1260 句是 eye turned on me＝目光落在我身上）⇒ 0 条",
    ("put down", 3): "回查 44 本无「put sb down＝贬低／羞辱」正据（insult／impudence／snub 三类线索词全 0）⇒ 0 条（20 世纪口语）",
    ("put down", 4): "回查 44 本无「put down＋叛乱／骚动」正据（rebellion／revolt／riot／mutiny 等 6 个线索词全 0）⇒ 0 条",
    ("pass on", 4): "回查 44 本无「（婉辞）pass on＝去世」正据（`pass on` 全为「继续前行／时间流逝／发生」；death 类线索词只命中 2084「dead beat＝累坏」）⇒ 0 条",
    ("take away", 3): "回查 44 本无「take away from＋效果／印象＝削减」正据（from the effect／merit／pleasure／interest 等 0 条）⇒ 0 条",
    ("take away", 4): "回查 44 本无「take away＋食物＝外带」正据（food／dinner／supper 类命中 2 条均为「饭后拿走某物」，非外带）⇒ 0 条（20 世纪用法）",
    ("come through", 2): "回查 44 本「come through with sth」唯二近例均不合：217（came through with the same curious criticism）＝「带着挑剔」非「兑现」；543（come through for bonds）＝「出资认捐」且全句 275 字符 ⇒ 宁缺勿错",
    ("come through", 4): "回查 44 本无「（消息／申请）come through＝到达／获准」正据（message／news／word／telegram 类线索词命中均属「穿透（门／窗）」或「出（门）」义）⇒ 0 条",
    ("shut up", 2): "回查 44 本无「shut sb up」宾语插入式正据（shut him／her／them／you up 全 0）⇒ 0 条",
    ("break down", 3): "回查 44 本无「break down＋数据／成本＝拆解分析」正据（into／analysis／figures 类线索词命中全为「崩塌／崩溃／精疲力竭」义）⇒ 0 条",
    ("bring in", 3): "回查 44 本无「（货物）bring in＋价钱」正据（唯一 money 近例 46「a situation… would bring in… five-and-sixpence weekly」＝职位带来的收入，属 #2）⇒ 0 条",
    ("come across", 2): "回查 44 本无「come across as＋形／名＝给人印象」正据（`come across` 命中全为「偶然遇到」义）⇒ 0 条（近代口语）",
    ("come across", 3): "回查 44 本无「（意思）come across＝被理解」正据（meaning／understood 类线索词命中均属「遇到／被识破」义）⇒ 0 条",
    ("go along", 2): "回查 44 本无「go along with sth＝同意／配合」正据（agree／proposal／plan 类线索词命中为「沿街走」；217「Go along with you!」实为「走开／别胡说」）⇒ 0 条",
    ("run through", 1): "回查 44 本无「run through＋文件／清单＝匆匆过一遍」正据（list／account／pages 类线索词唯命中 1260「brook which runs through Deepden」＝流经）⇒ 0 条",
    ("run through", 4): "回查 44 本无「run through＋方案／步骤＝通读推敲」正据（again／step by step 类线索词命中均属「传遍（全身／人群）」义）⇒ 0 条",
    ("get down", 2): "回查 44 本无「get down＋食物＝咽下」正据（food／dinner 类线索词命中为「下楼赶上早饭／上哪儿弄早饭」，非咽下）⇒ 0 条",
    ("get down", 3): "回查 44 本无「get down＋名字／要点＝写下」正据（on paper／in writing 类线索词 0 条）⇒ 0 条",
    ("get down", 4): "回查 44 本无「（事）get sb down＝使沮丧」正据（depressed／spirits 类线索词唯一命中 236 为「get down into the muddy pools」＝趴下）⇒ 0 条",
    ("pull out", 3): "回查 44 本无「pull out of＋协议／活动＝退出」正据（war／treaty／scheme 类线索词命中均属「取出（钥匙）／（船）划开」义）⇒ 0 条",
    ("pull out", 4): "回查 44 本无「pull out＋信息／要点＝抽出」正据（information／secret／truth 等 0 条）⇒ 0 条",
    ("pass out", 1): "回查 44 本无「pass out＝昏倒」正据（faint／senses／conscious／swoon 类线索词全 0）⇒ 0 条",
    ("pass out", 2): "回查 44 本无「pass out＋物品＝分发」正据（hands／papers 类线索词命中 2 条均属「passed out of my view／hands」＝走出（视野）／脱离（我手））⇒ 0 条",
    ("pass out", 3): "回查 44 本无「（军校）pass out＝毕业」正据（academy／Sandhurst／college 类线索词 0 条）⇒ 0 条",
    ("bring back", 2): "回查 44 本无「bring sb back (to life)＝使苏醒」正据（life／consciousness 类线索词命中均属「把…带回生活／带回」义）⇒ 宁缺勿错",
    ("move in", 2): "回查 44 本无「move in (on)＋占据／进驻」正据（`move in` 命中全为「搬进」或「在…里移动」义）⇒ 0 条",
    ("move on", 2): "回查 44 本无「move on to＋新话题」正据（subject／question 类线索词命中均属「往前走／移动」义）⇒ 0 条",
    ("pass by", 2): "回查 44 本无「（机会）pass sb by＝不起作用／错过」正据（opportunity／luck／chance 类线索词命中均属「从旁经过」义）⇒ 0 条",
    ("set down", 3): "回查 44 本无「set down＋乘客＝让下车」正据（passenger／corner 类线索词命中 2 条均属 2701「set down＝记载／判定」义）⇒ 0 条",
    ("accompany by", 2): "回查 44 本「（音乐）由…伴奏」唯一近例 1056（it all accompanied by… music）是「歌声由音乐伴随」，与 #1 难分 ⇒ 宁缺勿错",
    ("hang on", 2): "回查 44 本无「hang on＝稍等／别挂断（电话）」正据（moment／telephone 类线索词命中为「抓住／悬于（毁灭边缘）」义）⇒ 0 条",
    ("hang on", 3): "回查 44 本无「hang on＝坚持不放弃」正据：唯一 ≤300 近例（2701 hung on to it to the last）与 #1「抓住不放」难分 ⇒ 宁缺勿错",
    ("take on", 3): "回查 44 本无「take on＋人手＝雇用」正据（men／hands／staff 类线索词命中的 4 条全属 #1「承担」或 #2「呈现」义）⇒ 0 条",
    ("take on", 4): "回查 44 本无「take on＋对手＝迎战」正据（fight／opponent／enemy 等 0 条；219「had taken on him a terrible vengeance」＝施加（报复）非此义）⇒ 0 条",
    # ===== 块 B″ 第五批（2026-10-10 十六续 · 30 词）=====
    ("get through", 2): "回查 44 本：`get through` 命中无「考试／审查」义（exam／test／examination 类线索词全 0）⇒ 0 条",
    ("get through", 5): "回查 44 本无「接通电话（get through to sb／by telephone）」正据（telephone／phone／wire／line 类线索词全 0）⇒ 0 条",
    ("run over", 2): "回查 44 本无「（液体）溢出／漫过」正据（brim／edge／banks／spill 类线索词全 0；`run over` 命中均为「撞倒」或「过一遍」义）⇒ 0 条",
    ("see through", 2): "回查 44 本无「see sb through + 难期＝支持渡过」正据（`see … through` 命中全为「看穿」或「透过…看（字面）」）⇒ 0 条",
    ("see through", 3): "回查 44 本无「see sth through＝把…坚持做完」正据 ⇒ 0 条",
    ("throw out", 4): "回查 44 本无「throw out + 案子／诉状＝驳回」正据（case／suit／claim 类线索词命中均属「抛出／扔掉／赶出」义）⇒ 0 条",
    ("throw out", 5): "回查 44 本无「throw out＝罢免／撵走（职位）」正据（office／position 类线索词 0 条）⇒ 0 条",
    ("throw up", 1): "回查 44 本无「throw up＝呕吐」正据（食物／sick／stomach 类线索词全 0；`throw up` 命中均为「举起」「放弃」义）⇒ 0 条",
    ("take down", 4): "回查 44 本无「take sb down (a peg)＝（言语）贬低」正据（peg／a peg 类线索词全 0）⇒ 0 条",
    ("step in", 2): "回查 44 本无「step in for sb＝暂代／顶替」正据（substitute／for sb 类线索词命中均为「走进来」义）⇒ 0 条",
    ("work out", 5): "回查 44 本无「work out＝锻炼／健身」正据（gym／exercise 类线索词 0 条；1400「the only time you worked out」是外出做工，非健身）⇒ 0 条",
    ("break through", 2): "回查 44 本无「break through (in + 领域)＝取得突破（进展）」正据（唯一近例 64317「breaking through his punctilious manner」是「冲破（举止）」义，属 #1）⇒ 宁缺勿错",
    ("cut out", 4): "回查 44 本无「（引擎／机器）cut out＝突然停止运转」正据（engine／motor 类线索词 0 条）⇒ 0 条",
    ("clear up", 4): "回查 44 本无「（病／症状）clear up＝痊愈」正据（cold／rash／illness／symptoms 类线索词全 0）⇒ 0 条",
    ("fill up", 4): "回查 44 本无「fill up＝吃饱」正据（eat／sated，food 类线索词 0 条）⇒ 0 条",
    ("put away", 3): "回查 44 本无「put away＝关起来／囚禁」正据（prison／jail／asylum 类线索词 0 条）⇒ 0 条",
    ("put away", 4): "回查 44 本无「put away＝大吃」正据（food／meal／dinner 类线索词 0 条）⇒ 0 条",
    ("cut in", 2): "回查 44 本无「（车辆）cut in＝抢道／加塞」正据（traffic／vehicle／driving 类线索词 0 条）⇒ 0 条",
    ("cut in", 3): "回查 44 本无「cut sb in on＝让…分一份」正据（profit／share 类线索词 0 条）⇒ 0 条",
    ("drop off", 4): "回查 44 本无「drop sb/sth off＝顺路送到」正据（at the／school 类线索词 0 条；`drop off` 命中均属「睡着／掉落／减少」义）⇒ 0 条",
    ("go around", 5): "回查 44 本无「go around＝够用／人人有份」正据（enough／sufficient 类线索词 0 条）⇒ 0 条",
    ("wrap up", 4): "回查 44 本无「wrap up＝完成／收尾」正据（meeting／business／affair 类线索词 0 条；`wrap up` 命中均属「全神贯注／包裹」义）⇒ 0 条",
    ("turn around", 2): "回查 44 本无「turn around＝好转／扭转」正据（business／fortunes／things 类线索词 0 条）⇒ 0 条",
    ("back up", 3): "回查 44 本无「back up＝备份」正据（file／data／disk 类线索词 0 条；1900 前无计算机语境）⇒ 0 条",
    ("drop out", 3): "回查 44 本无「drop out＝退学」正据（school／college 类线索词 0 条）⇒ 0 条",
    ("drop out", 4): "回查 44 本无「drop out＝离群索居」正据（society／world 类线索词 0 条）⇒ 0 条",
    ("write down", 2): "回查 44 本无「write down＝减记账面价值／贬低」正据（value／price／assets 类线索词 0 条）⇒ 0 条",
    ("wear off", 2): "回查 44 本无「wear off＝（字面）磨掉」正据（coat／paint／colour 类线索词 0 条）⇒ 0 条",
    ("advantage in", 2): "回查 44 本无「advantage in＝（网球）发球占先」正据（tennis／deuce 类线索词 0 条）⇒ 0 条",
    ("call back", 3): "回查 44 本无「call back＝回电话」正据（phone／telephone 类线索词 0 条；1900 前无电话回拨语境）⇒ 0 条",
    ("give away", 3): "回查 44 本无「give away＝（婚礼）把新娘交给新郎」正据（bride 类线索词 0 条）⇒ 0 条",
    ("let in", 3): "回查 44 本无「let sb in on＝让…参与」正据（in on 类线索词 0 条）⇒ 0 条",
    ("hang out", 2): "回查 44 本无「hang out＝闲逛」正据（with friends／park 类线索词 0 条）⇒ 0 条",
    ("let down", 3): "回查 44 本无「let down＝使失望」正据（disappoint 类线索词 0 条）⇒ 0 条",
    ("put forward", 3): "回查 44 本无「put forward＝提名」正据（candidate／election 类线索词 0 条）⇒ 0 条",
    ("turn off", 3): "回查 44 本无「turn off＝使反感」正据（disgust／repel 类线索词 0 条）⇒ 0 条",
    ("slow down", 2): "回查 44 本无「slow down＝减缓进度」正据（production／output 类线索词 0 条）⇒ 0 条",
    ("slow down", 3): "回查 44 本无「slow down＝松弛下来」正据（take it easy 类线索词 0 条）⇒ 0 条",
    ("build up", 2): "回查 44 本无「build up＝增强体力」正据（strength／stamina 类线索词 0 条）⇒ 0 条",
    ("come around", 3): "回查 44 本无「come around＝回心转意」正据（way of thinking／senses 类线索词 0 条）⇒ 0 条",
    ("fill in", 4): "回查 44 本无「fill in for＝临时替补」正据（fill in for + 人 类线索词 0 条）⇒ 0 条",
    ("pay off", 3): "回查 44 本无「pay off＝有回报／见成效」正据（risks／effort／investment 类线索词 0 条；唯一 mortgage 句实为还债义）⇒ 0 条",
    ("pay off", 4): "回查 44 本无「pay off＝贿赂」正据（bribe／hush 类线索词 0 条）⇒ 0 条",
    ("pay off", 5): "回查 44 本无「pay off＝报复」正据（revenge／for this 类线索词 0 条）⇒ 0 条",
    ("pull in", 2): "回查 44 本无「pull in＝赚（钱）」正据（money／fortune 类线索词 0 条）⇒ 0 条",
    ("pull in", 5): "回查 44 本无「pull in＝集合／聚集（人力物力）」正据（harvest／troops 类线索词 0 条；hand over hand 句实为「收拢」义）⇒ 0 条",
    ("send off", 3): "回查 44 本无「send off＝送别」正据（with cheers／to the station 类线索词 0 条）⇒ 0 条",
    ("take after", 3): "回查 44 本无「take after＝仿效／以…为榜样」正据（example／manner 类线索词 0 条）⇒ 0 条",
    ("wind up", 5): "回查 44 本无「wind up＝使兴奋」正据（wind sb up 类线索词 0 条）⇒ 0 条",
    ("wind up", 6): "回查 44 本无「wind up＝（投球）抡臂」正据（arm／pitch 类线索词 0 条）⇒ 0 条",
    ("bridge over", 2): "回查 44 本无「bridge sb over＝帮…渡过（难关）」正据（till／until／short period 类线索词 0 条）⇒ 0 条",
    ("clean up", 4): "回查 44 本无「clean up＝大赚一笔」正据（fortune／profit 类线索词 0 条）⇒ 0 条",
    ("knock down", 2): "与同词 rank1（击倒／撞倒）语义重叠，无独立可区分正据（deck.v.03 与 down.v.05 同指重击致倒）⇒ 0 条，建议后续与 rank1 合并",
    ("knock down", 3): "回查 44 本无「knock down＝拆除（建筑）」正据（building／house 类线索词 0 条；fire-irons 句为撞倒器物义）⇒ 0 条",
    ("knock down", 4): "回查 44 本无「knock down＝降价／压低价格」正据（price／auction 类线索词 0 条）⇒ 0 条",
    ("step up", 2): "回查 44 本无「step up＝提高／增加」正据（production／output 类线索词 0 条）⇒ 0 条",
    ("step up", 3): "回查 44 本无「step up＝加速（引擎）」正据（engine／revs 类线索词 0 条）⇒ 0 条",
    ("step up", 4): "回查 44 本无「step up＝挺身而出／采取行动」正据（to do／to help 类线索词 0 条）⇒ 0 条",
    ("act up", 3): "回查 44 本无「act up＝（旧病）发作／（机器）出毛病」正据（illness／machine 类线索词 0 条）⇒ 0 条",
    ("blow up", 4): "回查 44 本无「blow up＝发怒」正据（rage／anger 类线索词 0 条）⇒ 0 条",
    ("blow up", 5): "回查 44 本无「blow up＝夸大」正据（proportion／story 类线索词 0 条）⇒ 0 条",
    ("blow up", 6): "回查 44 本无「blow up＝充气／使膨胀」正据（balloon／bladder 类线索词 0 条）⇒ 0 条",
    ("put back", 5): "回查 44 本无「put back＝使花费（多少钱）」（实为 set sb back 搭配）正据（£／pounds 类线索词 0 条）⇒ 0 条",
    ("take over", 4): "回查 44 本无「take over＝收购（公司）」正据（company／shares 类线索词 0 条）⇒ 0 条",
    ("try out", 3): "回查 44 本无「try out＝试演／参加选拔」正据（for a part／role 类线索词 0 条）⇒ 0 条",
    ("try out", 4): "回查 44 本无「try out＝尝试（新事物）」正据（new kinds／ideas 类线索词 0 条）⇒ 0 条",
    ("check in", 1): "回查 44 本无「check in＝登记入住」正据（hotel／desk 类线索词 0 条；池中 checked in 全为「制止／停住」义）⇒ 0 条",
    ("knock out", 1): "回查 44 本无「knock out＝打昏／拳击 KO」正据（boxing/blow 类线索词 0 条；池中 knocked out 全为「磕掉烟灰」「打掉（眼）」「累垮」义）⇒ 0 条",
    ("knock out", 2): "回查 44 本无「knock out＝淘汰／击败出局」正据（contest／round 类线索词 0 条）⇒ 0 条",
    ("knock out", 4): "回查 44 本无「knock out＝使倾倒／使惊叹」正据（admiration 类线索词 0 条）⇒ 0 条",
    ("step down", 3): "回查 44 本无「step down＝降低（程度／规模）」正据（level／rate／scale 类线索词 0 条）⇒ 0 条",
    ("try on", 3): "回查 44 本无「try it on＝耍花招／试探」正据（it on 搭配 0 条）⇒ 0 条",
    ("warm up", 1): "回查 44 本无「warm up＝（运动前）热身」正据（exercise／stretch／muscles 类线索词 0 条）⇒ 0 条",
    ("warm up", 4): "回查 44 本无「warm up＝（天气／房间）变暖」独立正据（池中 warmed up 全为「（人）热络」「（食物）加热」义）⇒ 0 条",
    ("warm up", 5): "回查 44 本无「warm up＝（引擎／机器）预热」正据（engine／motor 类线索词 0 条）⇒ 0 条",
    ("beam on", 2): "回查 44 本无「beam on＝（光）照在…上」正据（sun／light 类线索词 0 条；池中 beamed on 全为「对人堆笑」义）⇒ 0 条",
    ("beam on", 3): "回查 44 本无「beam＝（向…）播送」正据（radio／waves 类线索词 0 条；1900 前后语料不载）⇒ 0 条",
    ("branch off", 2): "「branch off into（话题）」全语料仅 541 一条，且该句被切句器截在 Mrs.（缩写守卫 bug）⇒ 无可引全句，宁缺勿错",
    ("call off", 4): "回查 44 本无「call off＝喊方阵舞舞步」正据（square dance 类线索词 0 条）⇒ 0 条",
    ("catch on", 2): "回查 44 本无「catch on＝流行起来」正据（popular／vogue 类线索词 0 条；55 的 caught on fire 是「着火」）⇒ 0 条",
    ("get across", 2): "回查 44 本无「（话语）get across＝被听懂」独立正据（217 那句已归 rank1「使明白」）⇒ 0 条",
    ("get by", 3): "回查 44 本无「get by＝侥幸逃过」正据（punishment／consequence 类线索词 0 条；1400 的 be got by it 是「从中得到」）⇒ 0 条",
    ("condense into", 2): "回查 44 本无「condense into＝气态冷凝成液态」正据（vapour／drops 类线索词 0 条；池中 condensed into 全为「压缩／汇聚成」义）⇒ 0 条",
    ("lay off", 2): "回查 44 本无「lay off＝停止（某事）」正据（smoking／working 类线索词 0 条）⇒ 0 条",
    ("pull over", 1): "回查 44 本无「pull over＝（车）靠边停」正据（road／curb 类线索词 0 条；池中 pulled over 全为「（把衣物）拉过去套上」义）⇒ 该义为汽车时代义，1900 前后公版语料不载 ⇒ 0 条",
    ("put through", 3): "回查 44 本无「put through＝电话接通」正据（telephone／wire 类线索词 0 条；1900 前后语料不载）⇒ 0 条",
    ("think through", 1): "回查 44 本无「think through＝彻底想清楚」正据（plan／problem 类线索词 0 条；池中 4 条多属「透过…想／直到」形式误匹配）⇒ 0 条",
    ("think up", 2): "回查 44 本无「think up＝编造（借口／谎话）」正据（excuse／lie 类线索词 0 条）⇒ 0 条",
    ("back down", 1): "回查 44 本无「back down＝让步／退缩」正据（claim／demand 类线索词 0 条；池中 back down 全为「往回走」义）⇒ 0 条",
    ("brush up", 2): "回查 44 本无「brush up＝使完善／改进（作品）」正据（style／work 类线索词 0 条；8164 的 a wash and brush up 是名词短语）⇒ 0 条",
    ("circle around", 2): "回查 44 本无「circle around + 物＝围在…周围转」正据（唯一含宾语的 541 句被切句器截在 Mr.；910 两条均无宾语）⇒ 0 条",
    ("drop by", 1): "回查 44 本无「drop by＝顺路拜访」正据（池中 3 条全为「一滴一滴（drop by drop）」「被…丢下」形式误匹配）⇒ 0 条",
    ("set back", 1): "回查 44 本无「set back＝推迟」正据（date／time 类线索词 0 条）⇒ 0 条",
    ("set back", 2): "回查 44 本无「set back＝阻碍进展」正据（progress／development 类线索词 0 条）⇒ 0 条",
    ("set back", 3): "回查 44 本无「set sb back + 钱」正据（£／pounds 类线索词 0 条）⇒ 0 条",
    ("sort out", 3): "回查 44 本无「sort sb out＝惩罚／整治」正据（discipline 类线索词 0 条；20 世纪口语）⇒ 0 条",
    ("get around", 2): "回查 44 本无「get around＝绕开／规避（难题、规定）」正据（difficulty／law／rule 类线索词 0 条；池中 2 条均为「四处走动」义）⇒ 0 条",
    ("get around", 3): "回查 44 本无「（消息）get around＝传开」正据（news／report 类线索词 0 条）⇒ 0 条",
    ("get around", 4): "回查 44 本无「get around＝交游广／常出入社交场合」正据（society／party 类线索词 0 条）⇒ 0 条",
    ("give off", 2): "回查 44 本无「give off＝产生（副产品）」独立正据（by-product／附带 类线索词 0 条；池中 2 条均为「散发（烟／生命气息）」义）⇒ 0 条",
    ("add on", 1): "池中唯一一条（64317）的 added on his own initiative 里 on 属状语 on his own initiative，非本短语正据 ⇒ 0 条",
    ("add on", 2): "回查 44 本无「add on＝扩建／在末尾添建」正据（extension／wing／building 类线索词 0 条）⇒ 0 条",
    ("add up", 2): "回查 44 本无「add up＝加起来是／合计达（+数）」正据（pounds／dollars／数目 类线索词 0 条）⇒ 0 条",
    ("add up", 3): "回查 44 本无「（说法）add up＝说得通／对得上」正据（池中 2 条均为「把…相加」义）⇒ 0 条",
    ("add up", 4): "回查 44 本无「add up to＝累积成／意味着」正据（conclusion／result 类线索词 0 条）⇒ 0 条",
    ("back off", 2): "回查 44 本无「back off＝（从主张／承诺）退缩」正据（claim／demand／threat 类线索词 0 条；池中 2 条均为「往后退」义）⇒ 0 条",
    ("base in", 1): "池中唯一一条（84）的 base in my own eyes 里 base 是形容词「卑贱的」，非本短语正据 ⇒ 0 条",
    ("bridge across", 1): "池中 2 条（139／55）的 bridge across 均为名词 bridge(s) ＋ 介词 across（a return bridge across／bridges across them），非本短语正据 ⇒ 0 条",
    ("center on", 2): "回查 44 本无「center + 物 + on＝把…置于中心」正据（宾语居中结构 0 条；池中 2 条均为「围绕／以…为中心」义）⇒ 0 条",
    ("cut back", 1): "回查 44 本无「cut back＝削减（开支／规模）」正据（expenses／production／staff 类线索词 0 条；池中 2 条一为「折返」、一为名词 short cut back to 误匹配）⇒ 0 条",
    ("cut back", 3): "回查 44 本无「cut back＝修剪（树枝／灌木）」正据（tree／hedge／branch 类线索词 0 条）⇒ 0 条",
    ("cut back", 4): "回查 44 本无「cut back＝（叙述）回溯／倒叙」正据（flashback 类线索词 0 条；1900 前后公版语料不载小说技巧术语）⇒ 0 条",
    ("kick off", 2): "回查 44 本无「kick off＝开始／启动（活动）」正据（meeting／game／season 类线索词 0 条；1900 前后语料不载此现代义）⇒ 0 条",
    ("kick off", 3): "回查 44 本无「kick off＝（足球）开球」正据（football／match 类线索词 0 条）⇒ 0 条",
    ("pay back", 2): "回查 44 本无「pay sb back＝报复／以牙还牙」正据（revenge／for that 类线索词 0 条；池中 2 条均为「还钱」义）⇒ 0 条",
    ("pay back", 3): "回查 44 本无「pay back＝报答／答谢」正据（kindness／good 类线索词 0 条）⇒ 0 条",
    ("speed up", 1): "池中 3 条（2776／62／345）的 sped up that perfect street／speed up the trail／speed up the river 均为「动词 sped/speed ＋ 介词短语 up + 地点」，非本短语正据 ⇒ 0 条",
    ("speed up", 2): "同批误匹配：池中 3 条全为 speed ＋ up + 地点 结构，无「加速」正据 ⇒ 0 条",
    ("bounce off", 1): "池中唯一一条（139）的 bounced off out of the room 里 off 属方向短语 off out of，非本短语正据 ⇒ 0 条",
    ("bounce off", 2): "回查 44 本无「bounce an idea off sb」正据（idea／proposal 类线索词 0 条；现代口语义）⇒ 0 条",
    ("burn out", 2): "回查 44 本无「burn out＝烧坏／烧毁（电灯、线圈等内部烧坏）」正据（lamp／coil／fuse 类线索词 0 条；池中 4 条全为「烧尽／烧完」义）⇒ 0 条",
    ("burn out", 3): "回查 44 本无「burn out＝精疲力竭／累垮」正据（exhausted／overwork 类线索词 0 条；20 世纪义）⇒ 0 条",
    ("clutter up", 1): "池中唯一一条命中超过 300 字符或不足 5 词，未过例句闸；回查无合格正据 ⇒ 0 条",
    ("decrease by", 1): "池中唯一一条（84）的 decreased by the absence of summer 里 by 表原因（因…而减少），非「按幅度减少」义 ⇒ 0 条",
    ("fall apart", 2): "回查 44 本无「fall apart＝（关系／计划／局面）崩溃」正据（scheme／plan／marriage 类线索词 0 条；池中唯一一条为「木头散架」义）⇒ 0 条",
    ("fall apart", 3): "回查 44 本无「fall apart＝（精神）垮掉／情绪失控」正据（nerve／composure 类线索词 0 条；20 世纪义）⇒ 0 条",
    ("write off", 1): "回查 44 本无「write off＝勾销／注销债务」正据（debt／bad 类线索词 0 条；池中唯一一条为「减记／摊销」义）⇒ 0 条",
    ("write off", 2): "回查 44 本无「write sb/sth off＝认定…不行」正据（as useless／as a failure 类线索词 0 条）⇒ 0 条",
    ("write off", 4): "回查 44 本无「write off＝一挥而就」正据（fluently 类线索词 0 条；该义无独立语料证据）⇒ 0 条",
    ("angle on", 1): "池 0 条（angle on 在 44 本中 0 命中）⇒ 0 条",
    ("angle on", 2): "池 0 条（同词 0 命中）⇒ 0 条",
    ("ask around", 1): "池 0 条（ask around 在 44 本中 0 命中）⇒ 0 条",
    ("aspire after", 1): "池 0 条（aspire after 在 44 本中 0 命中）⇒ 0 条",
    ("blunder away", 1): "池 0 条（blunder away 在 44 本中 0 命中）⇒ 0 条",
    ("blunder away", 2): "池 0 条（同词 0 命中）⇒ 0 条",
    ("bolster up", 1): "池 0 条（bolster up 在 44 本中 0 命中）⇒ 0 条",
    ("bounce back", 1): "池 0 条（bounce back 在 44 本中 0 命中）⇒ 0 条",
    ("bulk up", 1): "池 0 条（bulk up 在 44 本中 0 命中）⇒ 0 条",
    ("bulk up", 2): "池 0 条（同词 0 命中）⇒ 0 条",
    ("check out", 1): "本词 44 本中 0 命中（check out 系列屈折形全 0）⇒ 无「检查／查看」正据 ⇒ 0 条",
    ("check out", 2): "本词 0 命中 ⇒ 无「（住客）结账离开旅馆」正据（住客 check-out 义属 20 世纪用法）⇒ 0 条",
    ("check out", 3): "本词 0 命中 ⇒ 无「查证属实／对得上」正据 ⇒ 0 条",
    ("check out", 4): "本词 0 命中 ⇒ 无「办借出／结账手续」正据（图书馆流通义属现代）⇒ 0 条",
    ("check out", 5): "本词 0 命中 ⇒ 无「打量／试探底细」正据（现代口语义）⇒ 0 条",
    ("cipher out", 1): "本词 44 本中 0 命中（ciphered/ciphering/ciphers out 全 0）⇒ 无「算出／解出」正据 ⇒ 0 条",
    ("cipher out", 2): "本词 0 命中 ⇒ 无「琢磨出／想出」正据 ⇒ 0 条",
    ("cue in", 1): "本词 44 本中 0 命中（cued/cues/cuing in 全 0）⇒ 无「给演员提示上场」正据 ⇒ 0 条",
    ("cue in", 2): "本词 0 命中 ⇒ 无「知会／告知情况」正据 ⇒ 0 条",
    ("sign up", 1): "本词 44 本中 0 命中（signed/signing/signs up 全 0）⇒ 无「报名参加」正据 ⇒ 0 条",
    ("sign up", 2): "本词 0 命中 ⇒ 无「签约聘请」正据 ⇒ 0 条",
    ("stick around", 1): "本词 44 本中 0 命中（sticking/sticks/stuck around 全 0）⇒ 无「待在原地」正据 ⇒ 0 条",
    ("stick around", 2): "本词 0 命中 ⇒ 无「留旁等候／待命」正据 ⇒ 0 条",
    ("take apart", 1): "本词 44 本中 0 命中（taken/takes/taking/took apart 全 0）⇒ 无「拆开／拆卸」正据 ⇒ 0 条",
    ("take apart", 2): "本词 0 命中 ⇒ 无「拆散／肢解」正据 ⇒ 0 条",
    ("take apart", 3): "本词 0 命中 ⇒ 无「剖析／逐条分析」正据 ⇒ 0 条",
    ("burn off", 1): "本词 44 本中 0 命中（burn/burned/burnt/burning off 全 0）⇒ 无「烧掉（地面草木）」正据 ⇒ 0 条",
    ("burn off", 2): "本词 0 命中 ⇒ 无「（运动）消耗脂肪／热量」正据（健身义属 20 世纪后用法）⇒ 0 条",
    ("burn through", 2): "唯一 1 条正据（35 的火柴烧尽）已分派给 rank1 ⇒ 「烧穿（烧出洞）」正据 0 条",
    ("burn through", 3): "44 本 0 条「烧钱／耗尽资金」正据（该义属现代财经用法）⇒ 0 条",
    ("cool down", 2): "仅 2 条正据（1056／233）皆属「冷静下来」义 ⇒ 「变凉／冷却」正据 0 条",
    ("cool down", 3): "同上（1056／233 全为「冷静」义）⇒ 「使变凉」正据 0 条",
}


# 可分离式短语（宾语插入）：例句走「头词＋间隔≤4词＋粒子」，闸见 senses_schema.has_form_gapped。
SEPARABLE = {("take out", 2), ("hand over", 1), ("see off", 1), ("see off", 2)}  # hand over＃1 正据是「Hand it over」（宾语插入）


def build():
    out = {}
    for phrase, literal, rows in RAW:
        senses = []
        for r in rows:
            s = sense(phrase, *r)
            key = (phrase, r[0])
            if key in SEPARABLE:
                s["separable"] = True
            s["cue"] = CUE.get(key, "")
            if key in EX:
                src, text = EX[key]
                s["examples"] = [{"src": src, "text": text}]
            else:
                assert key in GAP, "义项既没例句也没 examples_gap：%r" % (key,)
                s["examples_gap"] = GAP[key]
            senses.append(s)
        out[phrase] = {"literal": literal, "senses": senses}
    return out


def literal_gate(out):
    """回归闸：rank1 的 synset 不得是「本短语的字面义」。"""
    bad = []
    for p, lit in LITERAL_SYNSETS.items():
        if p not in out:
            bad.append("%s: 常量表里的词不在人工层" % p)
            continue
        r1 = out[p]["senses"][0]
        if r1["wn"] and r1["wn"] in lit:
            bad.append("%s: rank1 落在字面义 synset %s" % (p, r1["wn"]))
    return bad


# 装置 (b)「后排兜底」白名单（2026-10-10 裁甲立、三十续清空）：rank>1 义项的 cue **不许**用排除式 catch-all。
# 那 8 条（`act up`／`back up`／`blow up`／`build up`／`check in`／`cheer up`／`warm up`／`wipe out` 的 r2）已换**各自正向 cue**
#   （唯 `build up` r2 有意留空：与 r1／r3 语义交叠、写不出可区分的正 cue）⇒ 白名单清空，闸从此断言「**一条都不许有**」。
# 另 7 条「字面义重复件」已删（`take up` r4／`go through` r4／`go over` r3／`fall through` r2／`get across` r2／`lay off` r3／`pull over` r2，见头注 ⑫）。
FALLBACK_ALLOW = set()


def fallback_gate(out):
    """回归闸：rank>1 的 catch-all（装置 b）**一条都不许有**（白名单已清空）。

    ① 多出未登记的 ⇒ 报（防「裁 c 式」把字面义／窄 cue 的漏判再塞成 catch-all）；
    ② 白名单登记却不在库里 ⇒ 也报（防误删）。**装置 (a)（rank1）不在本闸射程**（`ch.01` 门靠它）。
    """
    got = {(p, s["rank"]) for p, e in out.items() for s in e["senses"]
           if s["rank"] > 1 and (s.get("cue") or "").startswith("^")}
    bad = ["%r: 未登记的后排兜底（装置 b）" % (k,) for k in sorted(got - FALLBACK_ALLOW)]
    bad += ["%r: 白名单登记但库里没有" % (k,) for k in sorted(FALLBACK_ALLOW - got)]
    return bad


def fallback_selftest():
    """自咬闸：未登记的后排兜底必报；白名单原样时不许报红。返回被抓住的故障数。"""
    def mk(keys):
        o = {}
        for p, r in keys:
            o.setdefault(p, {"senses": []})
            o[p]["senses"].append({"rank": r, "cue": r"^(?!.*zz).*\b%s\b" % p.split()[0]})
        return o
    assert FALLBACK_ALLOW == set(), "白名单应已清空（三十续）"
    green = mk(sorted(FALLBACK_ALLOW))
    assert fallback_gate(green) == [], fallback_gate(green)
    assert fallback_gate(mk(sorted(FALLBACK_ALLOW) + [("zap up", 2)])), \
        "后排兜底闸咬不住自己（未登记的 catch-all 竟不报红）"
    # ③ 反向自咬：rank**1** 的 catch-all（装置 a，故意注入故障）**不许**被本闸误报
    assert fallback_gate(mk([("zap up", 1)])) == [], \
        "后排兜底闸射程过宽（把 rank1 的装置 (a) 也报红了）"
    return 3


LLM_CANDIDATE = "llm_" + "candidates"   # 拼写拆分：闸要能扫「源码里有没有候选件名」，本文件自身不许误报


def llm_lock_gate(sources=None):
    """**LLM 物理锁**（2026-10-10 Ferrari 批「可，限生产端」）。

    LLM 只许进**生产端**（产候选）、**不许进运行时**（用户的书不出设备；离线优先）；
    候选只许落 `generator/output/` 下的中间件，**任何构建脚本都不得读它** ——
    否则「LLM 直出冒充人工审过」在流程上就有了通路，而**闸看不出来**（`src` 照样能写 `drafted`）。
    实测：扫本目录下全部 `.py` 源码，出现候选件名即报错。返回错误清单（空 = 过）。
    """
    if sources is None:
        here = os.path.dirname(os.path.abspath(__file__))
        sources = {fn: io.open(os.path.join(here, fn), encoding="utf-8", errors="replace").read()
                   for fn in sorted(os.listdir(here)) if fn.endswith(".py")}
    errs = []
    for fn, text in sources.items():
        if LLM_CANDIDATE in text:
            errs.append("%s: 出现 LLM 候选件名（%s…）⇒ 破了物理锁（候选只许中间件、必过人手）" % (fn, LLM_CANDIDATE))
    return errs


def llm_lock_selftest():
    """自咬闸：源码里塞了候选件名必须被抓；正常件不许报红。返回被抓的故障数。"""
    bad = {"bogus.py": "p = os.path.join(HERE, '%s_2026.json')" % LLM_CANDIDATE}
    assert llm_lock_gate(bad), "LLM 物理锁咬不住自己（塞了候选件名竟不报）"
    good = {"fine.py": "import json  # 只读 phrases_senses_curated.json"}
    assert llm_lock_gate(good) == [], llm_lock_gate(good)
    return 2


def main():
    n_fault = check_selftest()
    print("形状自咬闸：%d 个注入故障全部被抓，正常件不报红" % n_fault)
    n_cue = cue_selftest()
    print("cue 形状自咬闸：%d 个注入故障全抓、正常件不报红" % n_cue)
    n_lock = llm_lock_selftest()
    print("LLM 物理锁自咬闸：%d 例全抓（源码塞候选件名必报）、正常件不报红" % n_lock)
    n_fb = fallback_selftest()
    print("后排兜底闸自咬：%d 例全抓（未登记 catch-all 必报／白名单缺件必报）" % n_fb)

    out = build()
    phrases = json.load(io.open(PHRASES, encoding="utf-8"))

    errs = []
    for p, e in out.items():
        errs += check_entry(p, e, True, forms=match_keys(p, phrases[p]))
    ids = [s["id"] for e in out.values() for s in e["senses"]]
    if len(ids) != len(set(ids)):
        errs.append("全局 id 有重复")
    # 例句与 GAP 必须恰好二者其一（EX/GAP 键集对得上 RAW）
    for phrase, literal, rows in RAW:
        for r in rows:
            k = (phrase, r[0])
            if (k in EX) == (k in GAP):
                errs.append("%r: EX/GAP 必须恰好其一" % (k,))
    raw_keys = {(p, r[0]) for p, _l, rows in RAW for r in rows}
    for k in SEPARABLE:
        if k not in raw_keys:
            errs.append("SEPARABLE 里的 %r 不在 RAW" % (k,))
    errs += literal_gate(out)
    errs += cue_gate(out)
    errs += llm_lock_gate()
    errs += fallback_gate(out)
    # 字面义闸的自咬：把 bring about 的 rank1 换成字面义 synset，必须报
    probe = json.loads(json.dumps(out))
    probe["bring about"]["senses"][0]["wn"] = "bring_about.v.01"
    probe["bring about"]["senses"][0]["id"] = "bring about#bring_about.v.01"
    assert literal_gate(probe), "字面义闸咬不住自己（换成字面义 synset 竟不报）"
    if errs:
        for e in errs[:20]:
            print("  !!", e)
        raise SystemExit("闸不过：%d 条" % len(errs))

    io.open(OUT, "w", encoding="utf-8").write(json.dumps(out, ensure_ascii=False, indent=1))
    ns = sum(len(e["senses"]) for e in out.values())
    drafted = sum(1 for e in out.values() for s in e["senses"] if s["src"] == "drafted")
    with_ex = sum(1 for e in out.values() for s in e["senses"] if s["examples"])
    print("curated: %d 词 | %d 义项 | 有 wn 锚 %d | drafted %d | **有例句 %d / 缺口 %d** | 字面义常量表 %d 词"
          % (len(out), ns, ns - drafted, drafted, with_ex, ns - with_ex, len(LITERAL_SYNSETS)))
    n_sep = sum(1 for e in out.values() for s in e["senses"] if s.get("separable"))
    print("separable（可分离式·宾语插入）标记：%d 条" % n_sep)
    books = sorted({s["examples"][0]["src"] for e in out.values() for s in e["senses"] if s["examples"]})
    print("例句来源 %d 本：" % len(books) + "、".join(books))
    n_cue = sum(1 for e in out.values() for s in e["senses"] if s["cue"])
    print("cue 已写：%d / %d 条（块 C 第二步 pilot = ch.01 的 16 词）" % (n_cue, ns))
    print("LLM 物理锁：全仓 .py 源码里候选件名引用 %d 处（必须 0）" % len(llm_lock_gate()))
    print("OUT:", OUT, os.path.getsize(OUT), "bytes")


if __name__ == "__main__":
    main()
