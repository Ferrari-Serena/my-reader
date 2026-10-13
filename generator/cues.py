# -*- coding: utf-8 -*-
"""第 10 步 块 C 第二步：`cue` —— 语境消歧 L1 的**机器线索**（正则源码串）。

口径（2026-10-10 定；块 C 第二步）：
  - `cue` ＝ **正则源码串**；L1 引擎对**命中句**（含命中 span 的那一句原文）做 **search**（大小写不敏感）。
  - 空串 ＝ 该义项**无机器线索** ⇒ 一律**不命中**（**不是**「匹配一切」）—— 故未写 cue 的词条一律判不出（zero）。
  - 逐义项求值：恰 1 条命中 → `unique`（唯一命中）／≥2 → `multi`（未消歧）／0 → `zero`（未能判断）。
  - 语法须**同时被 Python `re` 与 JS `RegExp` 接受**（产品引擎是 JS）⇒ 只用 `\\b`／`(?:)`／`|`／`(?!...)`，
    **不用 lookbehind**（老引擎不支持）。
  - 线索**主轴**＝该义项 `pattern` 里的语义槽（如「turn out + 人/活动」→ 人称呼应词表）。
    `pattern` 给人读、`cue` 给机器判；两者同源、措辞可不同（§5.7：上屏的只有 `pattern`）。
  - **盲区（须知道）**：regex 抓的是「词表式线索」，抓不到「主语是不是人」这类句法角色；
    也抓不到 `pattern` 里没写、只靠语义的用法（ch.01 的 `stick out`＝硬撑就是这样，正解无词可抓 ⇒ zero）。

本批次只覆盖 **ch.01 的 16 个词组（39 条义项）** —— 块 C 第二步的 pilot；其余词条留空（＝ L1 判不了）。

2026-10-10 二十八续 · 裁甲：删 **7 条「字面义重复件」的 catch-all cue**（`take up` r4／`go through` r4／`go over` r3／`fall through` r2／`get across` r2／`lay off` r3／`pull over` r2；见 `build_senses_curated.py` 头注 ⑫）⇒ 装置 (b)「后排兜底」只剩 **8 条**（`fallback_gate` 钉住）。
2026-10-10 二十九续 · cue 校准（三词 pilot）：`go through`／`take up`／`go over` 三条义项族从「固定搭配枚举」改为「类别／窗口」（窗口禁跨 `,;`、宾语须紧跟 `up/through/over`、先置支要求「疑问词＋主语＋助动词」、`go through` r1 主窗口禁跨 `without`、`times` 须带限定词、`list\\w*` 收窄为 `lists?`）。44 本实测 zero 235→192／280→267／164→147；增量 47／22／18 句逐句手判，误标 0（含 3 处已修的误标）；`multi` 未涨（1≤2）。读数与判据见 `Phase1-实施方案.md` §17.41。
2026-10-10 三十续 · 装置 (b) 清账：8 条「后排兜底」（rank>1 的排除式 catch-all）落地 —— 7 条换**正向 cue**（`act up`／`back up`／`blow up`／`check in`／`cheer up`／`warm up`／`wipe out` 的 r2），唯 `build up` r2 **有意留空**（与 r1／r3 语义交叠，见该行注释）。白名单随之清空 ⇒ `fallback_gate` 现在断言「**rank>1 不许再有 catch-all**」。读数与手判见 `Phase1-实施方案.md` §17.42。
2026-10-10 三十一续 · 三词 r1（＋`build up` r2 并入 r1）：`build up` r1／`wipe out` r1／`blow up` r1 的 cue 由「`the` ＋ 单数枚举」改为「**定冠词/形容词槽 ＋ 类别词表 ＋ 窗口（禁跨 `,;`）** ＋ 宾语前置支」；`build up` r2 并入 r1 ⇒ 其 r3 顺移为 r2。读数见 `Phase1-实施方案.md` §17.43。
2026-10-10 三十一续附 · `blow up` 手判修正 2 处：① r1 后置支删 `ammunition`／`magazines?`／`mines?`／`ships?`（与 r2「（被）炸开」的施动体词表撞车 ⇒ 曾出 `multi`）；② r3 的「it／风」支收紧为「主语紧邻（可选助动词）＋ 有限动词 ＋ `up` ＋ 后不接词」（原松窗口误抓 `It's a bomb to blow up`／`it were, blown up` 两处）；保留正据 `It was blowing up a disagreeable winter wind`（后接天气名词短语支）。
2026-10-10 三十二续 · `wipe out` 按 CC 判改（判据句：r1 ＝「**使之彻底不复存在（实体或事态）**」、**不含两量相抵**）：① r1 宾语表补**事态类**（`pretense`／`illusion`／`confidence`／`faith`／`hope`／`existence`／`influence`／`authority`／`traces`…）＋ `everything`／`everyone`／`everybody`（歧义宾语按「**r1 是主位**」默认给 r1）；② r2 补**账目-盈亏类**（`profits`／`losses`／`costs`／`deficits`…，锚 `cancel_out.v.01`＝相抵的另一半）并**摘掉 `everything`**（它是「什么都能勾销」的兜底思维）；③ r2 的 `it's all wiped out` 支**保留**（实测独扛语料正据，摘掉即 ZERO）。见 §17.44。
2026-10-10 三十三续 · 批次第二刀（`find out`／`come up`／`go into`／`pick up`）：**四词的 rank1 改成「默认义 ＋ 排除式守卫」**——四词的 rank1 都是「不带标记时的默认读法」（`find out`＝弄清、`come up`＝走近/上来、`go into`＝进入、`pick up`＝捡起），故不再枚举宾语，改写为 `^(?!.*<后排标记>).*<词组>`（**库内既有写法**：`come back` r1／`set off` r1，全库 rank1 已用 **123 条**）；后排（r2+）保留**正向 cue**、并被守卫**逐条点名** ⇒ 结构上 `multi` 必为 0。**分层后果（有意）**：以 `^` 开头 ⇒ `cue_tier` 判 **low（兜底／只作排序、不当「本句义」）**，后排仍是 high —— 即这四词的 rank1 从「断言」降为「默认读法」，只有在后排 marker 命中时才给断言。判据链：① `find out` r2 锚 `learn.v.02`（**无意中得知事实**）⇒ 表面判据＝`that` 从句（`that` 后是物/事类指示名词则不算），r1 ＝疑问从句／名词宾语／无宾语（＝「查一个已知存在的答案」）；② `come up` r2／r3 的「话题/事件名词 ＋ come up」加**后接处所名词则不算**的守卫（`something came up the path` 归 r1）；③ `go into` r3「从事」加同款守卫（`went into his business room` 归 r1）、r2「深究」的宾语限**紧跟 into 的中心词**；④ `pick up` r2「接人」的代词对象**后不许再跟名词**（`picked up her books` 归 r1）、**人/称呼语宾语还须带处所或车辆语境**（`pick up Miss Bartlett at Summer Street` 才算，孤零零的 `picked up Mrs.` 退回 r1）、**人/称呼语宾语还须带处所或车辆语境**（`pick up Miss Bartlett at Summer Street` 才算，孤零零的 `picked up Mrs.` 退回 r1）、r4「收拾」窗口**禁跨 `,;`** 且摘掉 `the papers`／`the books`（与 r1 撞车）。手判修正 4 处假阳性：`go into` r3 摘 `the church`（与「进教堂」大小写不可分 ⇒ 让给 r1）、`harness` 加动词守卫、`pick up` r2 的 `at the X` 收成车站/码头类、`find out` r2 窗口**禁跨第二个 `that`／`what`**（`find out what that marvellous…` 归 r1）、`come up` r2／r3 再加**动向介词守卫**（`winds coming up from the sea` 归 r1）、`things` 由事件类移入话题类（`These things never came up`＝被提起）。见 §17.45。
"""
import re

# (phrase, rank) → 正则源码串。只在有把握写「可区分」的线索时才写。
CUE = {
    # come about
    ("come about", 1): r"\b(?:it|how|what|this|that|which)\b[^.?!]{0,40}?\b(?:come|comes|came|coming) about\b|\b(?:come|comes|came|coming) about\b[^.?!]{0,20}?\bthat\b",
    ("come about", 2): r"\b(?:come|comes|came|coming) about\b[^.?!]{0,20}?\b(?:his|her|their|the|my|your|its|our|a|an)\b",
    # set aside
    ("set aside", 1): r"\bset(?:s|ting)? aside\b[^.?!]{0,30}?\b(?:money|time|hours?|minutes?|days?|weeks?|funds?|cash|sum|amount|part of|portion|guineas|pounds?)\b",
    ("set aside", 2): r"\bset(?:s|ting)? aside\b[^.?!]{0,30}?\b(?:occasions?|questions?|differences?|dispute|objections?|doubts?|decisions?|feelings?|concern|matters?|reservation|judgment|consideration|forms? of)\b",
    # lay out
    ("lay out", 1): r"\b(?:lay|lays|laying|laid) out\b[^.?!]{0,30}?\b(?:gardens?|grounds?|fields?|tables?|streets?|rooms?|houses?|goods|wares|merchandise|well laid|beautifully laid)\b",
    ("lay out", 2): r"\b(?:lay|lays|laying|laid) out\b[^.?!]{0,30}?\b(?:plans?|cases?|ideas?|reasons?|arguments?|proposals?|schemes?|views?|principles?|details?|methods?)\b",
    ("lay out", 3): r"\b(?:lay|lays|laying|laid) out\b[^.?!]{0,30}?\b(?:money|sum|surplus|pounds?|dollars?|fortune|capital|savings|funds?|expense|cost|thousands?|hundreds?)\b",
    # light up
    ("light up", 1): r"^(?!.*\b(?:face|faces|eyes?|countenance|features|cheeks?)\b).*\b(?:light|lights|lit|lighted|lighting) up\b",
    ("light up", 2): r"\b(?:faces?|eyes?|countenance|features|cheeks?)\b[^.?!]{0,30}?\b(?:light|lights|lit|lighted|lighting) up\b|\b(?:light|lights|lit|lighted|lighting) up\b[^.?!]{0,20}?\b(?:with joy|with delight|with pleasure|with happiness|with excitement|with interest)\b",
    # run into
    ("run into", 1): r"\bran into\b[^.?!]{0,20}?\b(?:an old|a friend|him|her|them|somebody|someone|mr|mrs|miss)\b|\b(?:an old|old) acquaintance\b[^.?!]{0,30}?\bran into\b",
    ("run into", 2): r"\bran into\b[^.?!]{0,20}?\b(?:one another|each other|a wall|the wall|a tree|the tree|a post|the post|a car|the car|a lamp|a rock|a stone|head-on|violently|with force|full tilt)\b",
    ("run into", 3): r"\bran into\b[^.?!]{0,20}?\b(?:debt|debts|trouble|difficulty|difficulties|problems?|opposition|resistance|losses?|a storm|an ambush)\b",
    # bring out
    ("bring out", 1): r"\b(?:bring|brings|bringing|brought) out\b[^.?!]{0,30}?\b(?:(?:the|my|your|his|her|its|our|their) best|the (?:sweat|worst|colour|color|flavour|meaning|difference|truth)|tears|a smile)\b",
    ("bring out", 2): r"\b(?:bring|brings|bringing|brought) out\b[^.?!]{0,30}?\b(?:a book|books|a novel|an edition|a first edition|a record|a play|a magazine|a volume)\b",
    # turn out
    ("turn out", 1): r"\bturn(?:s|ed|ing)? out (?:to be|that)\b|\bit (?:turns?|turned) out\b",
    ("turn out", 2): r"\b(?:people|crowds?|men|women|voters|numbers|they|we|everybody|everyone|all|the public)\b[^.?!]{0,40}?\bturn(?:s|ed|ing)? out\b",
    ("turn out", 3): r"\bturn(?:s|ed|ing)? out\b[^.?!]{0,25}?\b(?:goods?|products?|machines?|items?|wares|canned|manufactured|output)\b|\b(?:goods?|products?|machines?|items?|wares|canned)\b[^.?!]{0,25}?\bturn(?:s|ed|ing)? out\b",
    # put in
    ("put in", 1): r"\bput in\b[^.?!]{0,25}?\b(?:time|hours?|years?|days?|effort|work|practice|money|capital|service)\b|\b(?:time|hours?|years?|days?|effort|work|practice|money|capital)\b[^.?!]{0,25}?\bput in\b",
    ("put in", 2): r"\bput in\b[^.?!]{0,25}?\b(?:a window|windows?|a new|a lock|a stove|a bath|electricity|a telephone|wiring|a partition|fixtures|glass|a door|a grate|a fireplace)\b|\b(?:a window|windows?|a lock|a stove|a bath|wiring|glass|a door|a grate|a fireplace)\b[^.?!]{0,25}?\bput in\b",
    ("put in", 3): r"\bput in\b[^.?!]{0,20}?\b(?:a word|a good word|an oar|a remark|a question)\b",
    ("put in", 4): r"\bput in\b[^.?!]{0,15}?\bappearance\b",
    # stick out
    ("stick out", 1): r"\b(?:stick|sticks|sticking|stuck) out\b[^.?!]{0,20}?\b(?:tongue|head|hands?|feet|foot|legs?|arms?|chin|chest|elbows?|knees?|nose)\b|\b(?:tongue|head|hands?|feet|foot|legs?|arms?|chin|chest|elbows?|knees?|nose)\b[^.?!]{0,20}?\b(?:stick|sticks|sticking|stuck) out\b",
    ("stick out", 2): r"\b(?:stick|sticks|sticking|stuck) out\b[^.?!]{0,25}?\b(?:like|among|amid|above|against|from the|from a|a mile|thumb|sore)\b",
    ("stick out", 3): r"\bstick it out\b|\b(?:stick|sticks|sticking|stuck) out\b[^.?!]{0,25}?\b(?:for|against|until|till|to the (?:last|end)|a little longer|a bit longer)\b",
    # come back
    ("come back", 1): r"^(?!.*\b(?:memory|memories|mind|recollection|thoughts?|words|voice|consciousness|senses)\b).*\b(?:came|come|comes|coming) back\b",
    ("come back", 2): r"\bit (?:came|comes|come) back\b|\b(?:memory|memories|mind|recollection|thoughts?|words|voice|consciousness|senses)\b[^.?!]{0,25}?\b(?:came|come|comes|coming) back\b|\b(?:came|come|comes|coming) back to (?:him|her|me|them|us|his mind)\b",
    # point out
    ("point out", 1): r"\bpoint(?:s|ed|ing)? out\b",
    # come out
    ("come out", 1): r"\b(?:came|come|comes|coming) out\b[^.?!]{0,20}?\b(?:of|from|with|into)\b|\b(?:came|come|comes|coming) out\b\s*[.,;!?]",
    ("come out", 2): r"\b(?:book|books|novel|edition|story|article|paper|number|volume|magazine|issue)\b[^.?!]{0,20}?\b(?:came|come|comes|coming) out\b|\b(?:came|come|comes|coming) out\b[^.?!]{0,20}?\b(?:on (?:the )?(?:following|next)|last week|next month|in print|published)\b",
    ("come out", 3): r"\b(?:came|come|comes|coming) out (?:well|right|all right|wrong|badly|best|worst)\b",
    # set off
    ("set off", 1): r"^(?!.*\b(?:alarms?|panic|waves?|series|chains?|reactions?|explosions?|bombs?|fires?|rumours?|rumors?|debate|laughter|storms?|avalanches?|against|by contrast)\b).*\bset(?:s|ting)? off\b",
    ("set off", 2): r"\bset(?:s|ting)? off\b[^.?!]{0,25}?\b(?:alarms?|panic|a series|series|chains?|reactions?|explosions?|bombs?|fires?|rumours?|rumors?|debate|laughter|a storm|storms?|an avalanche)\b",
    ("set off", 3): r"\bset(?:s|ting)? off\b[^.?!]{0,15}?\bagainst\b|\bset(?:s|ting)? off\b\s+by\b[^.?!]{0,30}?\b(?:figure|beauty|charm|contrast|white|colour|color|black|light|frame|background)\b",
    # in a body
    ("in a body", 1): r"\bin a body\b",
    # give in
    ("give in", 1): r"\bg(?:ave|ive|ives|iving) in\b[^.?!]{0,20}?\b(?:to|under|at last|finally|at length|pressure|despair|temptation|nothing|nobody)\b",
    ("give in", 2): r"\bg(?:ave|ive|ives|iving) in\b[^.?!]{0,20}?\b(?:the (?:cheque|check|paper|papers|document|report|key|ticket|form|money|letter|account)|a (?:cheque|check|paper|document|report|form)|his|her|their|my|your)\b",
    # look on
    ("look on", 1): r"\blook(?:s|ing|ed)? on\b[^.?!]{0,25}?\b(?:while|as|silently|helplessly|in silence|with|at|from|without)\b",
    ("look on", 2): r"\blook(?:s|ing|ed)? on\b[^.?!]{0,20}?\bas\b",
    ("look on", 3): r"\blook(?:s|ing|ed)? on(?:to)?\b[^.?!]{0,20}?\b(?:the|a|his|her|their|my|your|its)\s+(?:court|street|garden|river|sea|park|square|road|yard|field|lawn|terrace|meadow|harbour|harbor|water|wood|woods|hill|inn|house)\b",
    ("go on", 1): r"\b(?:go|goes|going|went|gone) on\b[^.?!]{0,20}?\b(?:with|doing|talking|reading|working|living|speaking|telling|walking|crying|writing|as before|forever|for ever|and on)\b",
    ("go on", 2): r"(?:\b(?:what|something|anything|nothing|everything|much)\b[^.?!]{0,25}?\b(?:go|goes|going|went|gone) on\b|\bthere\b[^.?!]{0,25}?\b(?:go|goes|going|went|gone) on\b)(?!\s+(?:doing|with|living|talking|reading|working|speaking|telling|walking|crying|writing)\b)",
    ("go on", 3): r"\b(?:light|lights|lamp|lamps|radio|engine|heating|power|electricity)\b\s+(?:(?:was|were|is|are|had|has|have|been|all|now)\s+)*(?:go|goes|going|went|gone) on\b",
    ("come in", 1): r"^(?!.*\b(?:handy|useful|news|word|report|answer|reply|money|funds|income|payment|cheque|check|letter|order|results?)\b).*\b(?:come|comes|came|coming) in\b",
    ("come in", 2): r"\b(?:news|word|report|answer|reply|money|funds|income|payment|cheque|check|letter|order|results?|complaints?)\b[^.?!]{0,25}?\b(?:come|comes|came|coming) in\b",
    ("come in", 3): r"\b(?:come|comes|came|coming) in\b[^.?!]{0,15}?\b(?:handy|useful)\b",
    ("sit down", 1): r"\bsit(?:s|ting)? down\b|\bsat down\b",
    ("go out", 1): r"^(?!.*\b(?:light|lights|lamp|candle|fire|flame|tide|fashion)\b).*\b(?:go|goes|going|went|gone) out\b(?!\s+with\b)",
    ("go out", 2): r"\b(?:go|goes|going|went|gone) out with\b",
    ("go out", 3): r"\b(?:light|lights|lamp|lamps|candle|fire|flame|gas)\b[^.?!]{0,25}?\b(?:go|goes|going|went|gone) out\b",
    ("go down", 1): r"^(?!.*\b(?:ship|ships|boat|vessel|sun|price|prices|cost|costs|temperature|rate|rates|value|wages|sales|numbers|figures)\b).*\b(?:go|goes|going|went|gone) down\b",
    ("go down", 2): r"\b(?:ship|ships|boat|vessel|submarine|sun)\b[^.?!]{0,25}?\b(?:go|goes|going|went|gone) down\b",
    ("go down", 3): r"\b(?:price|prices|cost|costs|temperature|rate|rates|value|wages|sales|numbers|figures)\b[^.?!]{0,25}?\b(?:go|goes|going|went|gone) down\b",
    ("get up", 1): r"\b(?:get|gets|getting|got) up\b[^.?!]{0,25}?\b(?:early|late|at (?:once|dawn|five|six|seven|eight)|in the morning|out of bed|from bed|before (?:dawn|daylight))\b",
    ("get up", 2): r"\b(?:get|gets|getting|got) up\b(?!\s*(?:\w+\s+){0,25}?\b(?:early|late|at (?:once|dawn|five|six|seven|eight)|in the morning|out of bed|from bed|before (?:dawn|daylight))\b)[^.?!]{0,25}?\b(?:from (?:the|his|her|a|my) \w+|to (?:his|her|their|my) feet|and (?:go|walk|leave|open|dress|dressed|put))\b",
    ("go back", 1): r"^(?!.*\b(?:century|centuries|year|years|time|times|days|past|history|tradition|ago)\b).*\b(?:go|goes|going|went|gone) back\b",
    ("go back", 2): r"\b(?:go|goes|going|went|gone) back\b[^.?!]{0,20}?\b(?:century|centuries|year|years|time|times|days|past|history|tradition)\b",
    ("look up", 1): r"\blook(?:s|ing|ed)? up\b[^.?!]{0,25}?\b(?:in (?:a|the|his|her) (?:dictionary|book|list|volume|encyclopedia)|dictionary|word|words|address|number|passage|reference)\b",
    ("look up", 2): r"\blook(?:s|ing|ed)? up\b(?:[^.?!]{0,20}?\b(?:at|from|into|with|again)\b|[^.?!]{0,20}?\b(?:suddenly|sharply|quickly|eagerly|quietly|coolly|hurriedly|astonished|interested|blinking)\b|\s*[.,;!?])",
    ("look up", 3): r"\b(?:things|business|affairs|prospects|trade|matters|outlook)\b\s+(?:are|is|were|was|seem|seems|seemed|begin|began|begins|will|would|may|might|had|has|have|looks?|looked)\b[^.?!]{0,15}?\blook(?:s|ing|ed)? up\b|\b(?:things|business|affairs|prospects|trade|matters|outlook)\b\s+look(?:s|ing|ed)? up\b",
    ("go into", 1): r"^(?!.*(?:\b(?:go|goes|going|went|gone)\s+into\s+(?:(?:the|a|an|his|her|my|your|their|our|its|this|that|these|those|some|any|no|every|all the|[A-Za-z\u2019\x27]+[\u2019\x27]s)\s+)?(?:\w+\s+){0,2}?\b(?:detail|details|particulars?|explanation|explanations|reasons?|questions?|problems?|the whole|merits|matter|subjects?|history|argument|arguments|pros and cons|cost|costs|figures)\b|(?:\b(?:go|goes|going|went|gone)\s+into\s+(?:(?:the|a|an|his|her|my|your|their|our|its|this|that|these|those|some|any|no|every|all the|[A-Za-z\u2019\x27]+[\u2019\x27]s)\s+)?(?:\w+\s+){0,2}?\b(?:business|politics|trade|teaching|medicine|law|the army|the navy|the ministry|partnership|service|acting|the profession|parliament|public|regulars|society)\b(?!\s*[^.?!;,]{0,4}?\b(?:rooms?|house|hall|kitchen|office|shop|store|place|building|premises|parlour|parlor|study|library|bedroom|bedchamber|garden|yard|courtyard|street|town|city|country|church|chapel|cabin|camp|castle|box|bar|bank|court|square|station|inn|hotel|club|theatre|theater|cellar|attic|wing|pool|forge|vault|scullery|pantry)\b)|\b(?:go|goes|going|went|gone)\s+into\s+harness\b(?!\s+(?:the|a|an|his|her|my|your|their|our|its|this|that|these|those)\b)))).*\b(?:go|goes|going|went|gone)\s+into\b",
    ("go into", 2): r"\b(?:go|goes|going|went|gone)\s+into\s+(?:(?:the|a|an|his|her|my|your|their|our|its|this|that|these|those|some|any|no|every|all the|[A-Za-z\u2019\x27]+[\u2019\x27]s)\s+)?(?:\w+\s+){0,2}?\b(?:detail|details|particulars?|explanation|explanations|reasons?|questions?|problems?|the whole|merits|matter|subjects?|history|argument|arguments|pros and cons|cost|costs|figures)\b",
    ("go into", 3): r"(?:\b(?:go|goes|going|went|gone)\s+into\s+(?:(?:the|a|an|his|her|my|your|their|our|its|this|that|these|those|some|any|no|every|all the|[A-Za-z\u2019\x27]+[\u2019\x27]s)\s+)?(?:\w+\s+){0,2}?\b(?:business|politics|trade|teaching|medicine|law|the army|the navy|the ministry|partnership|service|acting|the profession|parliament|public|regulars|society)\b(?!\s*[^.?!;,]{0,4}?\b(?:rooms?|house|hall|kitchen|office|shop|store|place|building|premises|parlour|parlor|study|library|bedroom|bedchamber|garden|yard|courtyard|street|town|city|country|church|chapel|cabin|camp|castle|box|bar|bank|court|square|station|inn|hotel|club|theatre|theater|cellar|attic|wing|pool|forge|vault|scullery|pantry)\b)|\b(?:go|goes|going|went|gone)\s+into\s+harness\b(?!\s+(?:the|a|an|his|her|my|your|their|our|its|this|that|these|those)\b))",
    ("come down", 1): r"^(?!.*\b(?:rain|snow|hail|sleet|price|prices|cost|costs|temperature|rate|rates|value|rent)\b).*\b(?:come|comes|came|coming) down\b",
    ("come down", 2): r"\b(?:rain|snow|hail|sleet)\b[^.?!]{0,25}?\b(?:come|comes|came|coming) down\b",
    ("come down", 3): r"\b(?:price|prices|cost|costs|temperature|rate|rates|value|rent)\b[^.?!]{0,25}?\b(?:come|comes|came|coming) down\b|\b(?:come|comes|came|coming) down in (?:their |the |his |her |our |a )?prices?\b",
    ("go up", 1): r"^(?!.*\b(?:price|prices|cost|costs|temperature|rate|rates|value|wages|sales|numbers|figures|building|house|houses|shops|flats|wall|walls|mast|flames|smoke)\b).*\b(?:go|goes|going|went|gone) up\b",
    ("go up", 2): r"\b(?:price|prices|cost|costs|temperature|rate|rates|value|wages|sales|numbers|figures)\b[^.?!]{0,25}?\b(?:go|goes|going|went|gone) up\b",
    ("go up", 3): r"\b(?:building|house|houses|shops|flats|walls|masts?|monument)\b[^.,;?!]{0,20}?\b(?:go|goes|going|went|gone|be|been|being|was|were|is|are)\b[^.,;?!]{0,10}?\bup\b|\b(?:go|goes|going|went|gone|is|are|was|were|been|being) up in (?:flames|smoke)\b",
    ("come up", 1): r"^(?!.*(?:\b(?:subject|question|matter|matters|topic|name|point|idea|opportunity|occasion|case|business|suggestion|proposal|plan|scheme|rumour|rumor|story|complaint|claim|things?)\b\s+(?:(?:has|had|have|will|would|may|might|can|could|did|does|do|is|was|were|shall|should|must|being|been|are|am|never|not|just|still|already|soon)\s+)?(?:come|comes|came|coming)\s+up\b(?!\s+(?:\w+\s+){0,2}?(?:path|paths|stairs?|steps?|road|roads|street|streets|lane|drive|walk|walks|side|gangway|hill|slope|track|trail|room|rooms|hall|passage|passages|corridor|garden|lawn|bank|deck|ladder|staircase|avenue|alley|bridge|floor|verandah|veranda|companionway)\b)(?!\s+(?:from|to|with|along|alongside|into|through|across|out of|beside|behind)\b)|\b(?:something|anything|nothing|everything|what|trouble|difficulty|difficulties|emergency|duty|duties|accident|problem|problems|issue|issues|affair|company|storms?|thunderstorms?|gales?|tempest|winds?|fog|mist|clouds?)\b\s+(?:(?:has|had|have|will|would|may|might|can|could|did|does|do|is|was|were|shall|should|must|being|been|are|am|never|not|just|still|already|soon)\s+)?(?:come|comes|came|coming)\s+up\b(?!\s+(?:\w+\s+){0,2}?(?:path|paths|stairs?|steps?|road|roads|street|streets|lane|drive|walk|walks|side|gangway|hill|slope|track|trail|room|rooms|hall|passage|passages|corridor|garden|lawn|bank|deck|ladder|staircase|avenue|alley|bridge|floor|verandah|veranda|companionway)\b)(?!\s+(?:from|to|with|along|alongside|into|through|across|out of|beside|behind)\b))).*\b(?:come|comes|came|coming)\s+up\b",
    ("come up", 2): r"\b(?:subject|question|matter|matters|topic|name|point|idea|opportunity|occasion|case|business|suggestion|proposal|plan|scheme|rumour|rumor|story|complaint|claim|things?)\b\s+(?:(?:has|had|have|will|would|may|might|can|could|did|does|do|is|was|were|shall|should|must|being|been|are|am|never|not|just|still|already|soon)\s+)?(?:come|comes|came|coming)\s+up\b(?!\s+(?:\w+\s+){0,2}?(?:path|paths|stairs?|steps?|road|roads|street|streets|lane|drive|walk|walks|side|gangway|hill|slope|track|trail|room|rooms|hall|passage|passages|corridor|garden|lawn|bank|deck|ladder|staircase|avenue|alley|bridge|floor|verandah|veranda|companionway)\b)(?!\s+(?:from|to|with|along|alongside|into|through|across|out of|beside|behind)\b)",
    ("come up", 3): r"\b(?:something|anything|nothing|everything|what|trouble|difficulty|difficulties|emergency|duty|duties|accident|problem|problems|issue|issues|affair|company|storms?|thunderstorms?|gales?|tempest|winds?|fog|mist|clouds?)\b\s+(?:(?:has|had|have|will|would|may|might|can|could|did|does|do|is|was|were|shall|should|must|being|been|are|am|never|not|just|still|already|soon)\s+)?(?:come|comes|came|coming)\s+up\b(?!\s+(?:\w+\s+){0,2}?(?:path|paths|stairs?|steps?|road|roads|street|streets|lane|drive|walk|walks|side|gangway|hill|slope|track|trail|room|rooms|hall|passage|passages|corridor|garden|lawn|bank|deck|ladder|staircase|avenue|alley|bridge|floor|verandah|veranda|companionway)\b)(?!\s+(?:from|to|with|along|alongside|into|through|across|out of|beside|behind)\b)",
    ("hand in", 1): r"\b(?:handed|handing) in\b(?!\s+(?:a|the)\s+(?:\w+\s+){0,2}?\b(?:box|boxes|basket|baskets|tray|trays|case|cases|dish|dishes)\b)",
    ("come on", 1): r"\bcome on\b[^.?!]{0,20}?[!]|\bcome on\b\s*[,.]|\b(?:do|please)\s+come on\b",
    ("come on", 2): r"\b(?:light|lights|lamp|lamps|gas|electricity|heating|power|engine|radio|wireless)\b[^.?!]{0,25}?\b(?:come|comes|came|coming) on\b",
    ("come on", 3): r"\b(?:rain|snow|sleet|hail|storm|wind|night|darkness|winter)\b[^.?!]{0,25}?\b(?:come|comes|came|coming) on\b",
    ("come on", 4): r"\bhow\b[^.?!]{0,20}?\b(?:come|comes|came|coming) on\b|\b(?:come|comes|came|coming) on\b[^.?!]{0,12}?\b(?:well|nicely|better|fast|slowly)\b",
    ("go away", 1): r"^(?!.*\b(?:pain|ache|fever|cough|sorrow|grief|trouble|care)\w*\b).*\b(?:go|goes|going|went|gone) away\b",
    ("go away", 2): r"\b(?:pain|ache|fever|cough|sorrow|grief|trouble|care)\w*\b[^.?!]{0,25}?\b(?:go|goes|going|went|gone) away\b|\b(?:go|goes|going|went|gone) away\b[^.?!]{0,15}?\b(?:for ever|forever|altogether|at last)\b",
    ("look out", 1): r"\blook out\b(?!\s+for\b)[^.?!]{0,20}?[!]|\blook(?:s|ed|ing)? out\b(?!\s+for\b)\s*[,.]|\b(?:mind|careful|danger|beware)\b",
    ("look out", 2): r"\blook(?:s|ed|ing)? out for\b",
    ("make up", 1): r"\b(?:make|makes|making|made) up\b[^.?!]{0,25}?\b(?:stor(?:y|ies)|tales?|lies?|excuses?|nonsense|a (?:story|tale|lie|excuse))\b|\b(?:stor(?:y|ies)|tales?|lies?|excuses?)\b[^.?!]{0,25}?\b(?:make|makes|making|made) up\b",
    ("make up", 2): r"\b(?:make|makes|making|made) up\b[^.?!]{0,25}?\b(?:the (?:whole(?!\s+(?:day|night|morning|afternoon|evening|week|month|year|time)\b)|greater part|majority|bulk|rest|volume|collection|total|sum)|half|part of|most of)\b|\b(?:the (?:whole(?!\s+(?:day|night|morning|afternoon|evening|week|month|year|time)\b)|greater part|majority|bulk|rest|volume|collection|total|sum)|half|most of)\b[^.?!]{0,20}?\b(?:make|makes|making|made) up\b",
    ("make up", 3): r"\b(?:make|makes|making|made) (?:it )?up\b[^.?!]{0,20}?\bwith (?:him|her|them|each other|one another)\b|\b(?:make|makes|making|made) up\b[^.?!]{0,15}?\bquarrel\b",
    ("make up", 4): r"\bmake(?:s|d|ing)? (?:her|him|your|my|them|our)?self up\b|\bmake up\b[^.?!]{0,20}?\b(?:face|cheeks|eyes|lips|powder|paint)\b",
    ("make up", 5): r"\bmake (?:it )?up for\b|\bmade up for\b",
    ("make up", 6): r"\b(?:make|makes|making|made) up (?:his|her|your|my|their|our) minds?\b",
    ("get out", 1): r"\b(?:get|gets|getting|got) out\b\s+of\b|\b(?:get|gets|getting|got) out\b\s*[.,!?]",
    ("get out", 2): r"\b(?:get|gets|getting|got) out\b(?!\s+of\b)[^.?!]{0,15}?\b(?:the|a|an|his|her|my|your|their|some)\b",
    ("get out", 3): r"\b(?:news|secret|truth|word|story|it)\b[^.?!]{0,25}?\b(?:get|gets|getting|got) out\b",
    ("take up", 1): r"\b(?:take|takes|taking|took|taken)\s+up\b(?!\s+with\b)\s+(?:the|a|an|his|her|my|your|their|our|its)?\s*(?:painting|music|drawing|writing|literature|medicine|law|teaching|farming|golf|tennis|photography|studies|study|pursuit|hobb\w*|the pen|arms|violin|piano|mathematics|science|nursing|trade|calling|work|duties|duty|office|post|career|task|leadership|command|religion|cross|profession|Latin|French|English|Spanish|German|Greek|Hebrew|Italian|Women['\u2019]?s Rights|regular exercise|fads?)\b|\b(?:take|takes|taking|took|taken)\s+up\b\s+all sorts of (?:new )?\w+\b|\b(?:take|takes|taking|took|taken)\s+up\b\s+(?:his|her|the|my|your|their)\s+cross\b|\bwhat line\b[^.?!]{0,20}?\b(?:take|takes|taking|took|taken)\s+up\b|\b(?:take|takes|taking|took|taken)\s+up\s+the\s+dignified\s+line\b",
    ("take up", 2): r"\b(?:take|takes|taking|took|taken)\s+up\b(?!\s+with\b)\s+(?:the|a|an|his|her|my|your|their|our|its)?\s*(?:time|space|room|hours?|days?|weeks?|months?|years?|minutes?|moments?|energy|attention|labour|labor|block)\b|\b(?:take|takes|taking|took|taken)\s+up\b\s+as (?:little|much)[\w'\u2019 ,]{0,25}?\b(?:time|space|room|length|hours?|years?)\b|\b(?:take|takes|taking|took|taken)\s+up\b\s+(?:so\s+much\s+of\s+|much\s+of\s+|much\s+|half\s+the\s+|the\s+whole\s+(?:end\s+of\s+)?|one\s+side\s+of\s+)(?:the|a|an|his|her|my|your|their|our|its)?\s*(?:time|space|room|hours?|days?|weeks?|months?|years?|minutes?|moments?|energy|attention|labou?r|block)\b|\b(?:days?|nights?|hours?|weeks?|months?|years?|minutes?|moments?|time|thoughts?|attention)\b[^.?!;,]{0,30}?\b(?:is|are|was|were|be|been|being|get|got|seem(?:s|ed)?|had)\s+(?:been\s+)?(?:taken|took|take|takes|taking)\s+up\b",
    ("take up", 3): r"\b(?:take|takes|taking|took|taken)\s+up\b(?!\s+with\b)\s+(?:the|a|an|his|her|my|your|their|our|its)?\s*(?:(?:curtailed|old|wild|interrupted|dignified|new|ancient|long-forgotten|pathetic|poor|good|same|own)\s+)?(?:[A-Za-z][\w'\u2019-]*['\u2019]s\s+)?(?:story|tale|thread|subject|matter|theme|song|melody|tune|air|call|refrain|strain|argument|quarrel|conversation|discussion|organ theme|journey|lyric\w*|burdens?|appendix|question\w*|shouts?|cr(?:y|ies)|chorus\w*|acclaim|poets?|names?|accounts?|threats?)\b|\b(?:take|takes|taking|took|taken)\s+up\s+where (?:he|she|they|I|we) (?:left|broke) off\b|\b(?:take|takes|taking|took|taken)\s+up\s+(?:her|his|my|your|their|our)\s+own\s+line\s+of\s+the\s+(?:subject|argument|story|tale|conversation|discussion)\b|\b(?:take|takes|taking|took|taken)\s+up\s+(?:my|his|her|our|their|your)\s+(?:[\w'\u2019-]+\s+){0,4}?\bwandering\b|\b(?:calls?|sounds?|songs?|story|tale|refrains?|strains?|themes?|melod\w*|subject|lyric\w*|burdens?|appendix|question\w*|shouts?|cr(?:y|ies)|chorus\w*|acclaim|poets?|names?|accounts?|threats?|conversation\w*|discussion\w*|cheering|cheers?|bugles?)\b[^.?!;,]{0,30}?\b(?:was|were|is|are|got|get)\s+(?:taken|took)\s+up\b",
    ("find out", 1): r"^(?!.*\b(?:find|finds|finding|found)\s+out\b(?:(?!\b(?:that|what)\b)[^.?!;,]){0,12}?\bthat\s*,?\s+(?!(?:thing|things|man|men|woman|women|boy|boys|girl|girls|fellow|sort|kind|part|way|speech|place|idea|days?|times?|moment|one|person|creature|chap)\b)\w).*\b(?:find|finds|finding|found)\s+out\b",
    ("find out", 2): r"\b(?:find|finds|finding|found)\s+out\b(?:(?!\b(?:that|what)\b)[^.?!;,]){0,12}?\bthat\s*,?\s+(?!(?:thing|things|man|men|woman|women|boy|boys|girl|girls|fellow|sort|kind|part|way|speech|place|idea|days?|times?|moment|one|person|creature|chap)\b)\w",
    ("put on", 1): r"^(?!.*\b(?:play|plays|performance|act|airs?|weight)\b).*\b(?:put|puts|putting) on\b[^.?!]{0,25}?\b(?:hat|coat|clothes|clothing|dress|boots?|shoes?|gloves?|uniform|bonnet|cloak|jacket|ring|spectacles?|glasses)\b|\b(?:put|puts|putting) on\b\s+(?:his|her|my|your|their|the)\b",
    ("put on", 2): r"\b(?:put|puts|putting) on\b[^.?!]{0,20}?\b(?:light|lights|lamp|gas|fire|electricity|music|heating)\b",
    ("put on", 3): r"\b(?:put|puts|putting) on\b[^.?!]{0,25}?\b(?:play|plays|performance|piece|show|exhibition|opera|drama|farce)\b",
    ("put on", 4): r"\b(?:put|puts|putting) on\b[^.?!]{0,15}?\b(?:airs?|an act|a front|a show)\b",
    ("get on", 1): r"\b(?:get|gets|getting|got) on\b\s+(?:to )?(?:the|a|his|her) (?:train|bus|car|boat|ship|tram|omnibus|horse|bicycle)\b|\b(?:get|gets|getting|got) on board\b",
    ("get on", 2): r"\b(?:get|gets|getting|got) on\b[^,.?!]{0,20}?\bwith (?:him|her|them|each other|one another|people|his|her|the)\b|\bget along\b",
    ("get on", 3): r"\bhow\b[^.?!]{0,20}?\b(?:get|gets|getting|got) on\b(?!\s+(?:board\b|with\b|(?:to\s+)?(?:the|a|his|her)\s+(?:train|bus|car|boat|ship|tram|omnibus|horse|bicycle)\b))|\b(?:get|gets|getting|got) on\b[^.?!]{0,12}?\b(?:well|nicely|better|badly|fast|slowly)\b(?!\s+with\b)",
    ("go through", 1): r"\b(?:what|all that|all (?:he|she|they|we|I|you|men|women|people)|everything|much)\b\s+(?:\w+\s+){0,2}?(?:had|has|have|must|would|will|am|is|was|were|are|did|does|do|should|could)\s+(?:\w+\s+){0,3}?(?:gone|went|go|goes|going)\s+through\b(?!\s+with\b)|\b(?:go|goes|going|went|gone)\s+through\b(?!\s+with\b)(?:(?!\bwithout\b)[^.?!;,]){0,40}?\b(?:ordeals?|hardships?|troubles?|difficult(?:y|ies)|trials?|tribulation\w*|misery|misfortun\w*|suffer\w*|agon\w*|torment\w*|affliction\w*|adversit\w*|calamit\w*|disaster\w*|catastroph\w*|hell|wear and tear|vicissitud\w*|anxiet\w*|humiliat\w*|indignit\w*|persecution|sorrow\w*|grief|experiences?|scenes?|this sort of thing|(?:(?:hard|bad|trying|dreadful|terrible|dark|sad|difficult) times)|it all|all (?:of )?(?:it|this|that|them))\b|\b(?:go|goes|going|went|gone)\s+through\b\s+(?:the|his|her|my|your|their|our|its|this|that|a)\s+(?:world|life|war|revolution|flames)\b|\b(?:go|goes|going|went|gone)\s+through\b(?!\s+with\b)[^.?!;,]{0,15}?\b(?:all that|everything)\b",
    ("go through", 2): r"\b(?:go|goes|going|went|gone)\s+through\b(?!\s+with\b)[^.?!;]{0,40}?\b(?:papers?|accounts?|books?|letters?|pockets?|drawers?|piles?|lists?|bags?|pages?|files?|documents?|records?|reports?|notes?|contents|boxes?|trunk|parcel|belongings|possessions|forms?|formalities?|the form|the whole (?:letter|book|story|thing|pile))\b|\b(?:go|goes|going|went|gone)\s+through\b(?!\s+with\b)[^.?!;]{0,40}?\b(?:a second time|once more|again and again|carefully|alphabetically|from (?:the )?(?:beginning|cover) to cover|item by item|one by one|thoroughly)\b",
    ("go through", 3): r"\b(?:bills?|measures?|proposals?|schemes?|deals?|matters?|applications?|requests?|acts?|resolutions?|petitions?|contracts?|bargains?|agreements?|arrangements?|votes?|amendments?)\b(?!\s+to\b)[^.?!;,]{0,25}?\b(?:go|goes|going|went|gone)\s+through\b|\b(?:go|goes|going|went|gone)\s+through\b[^.?!;,]{0,12}?\b(?:Parliament|Congress|committee|the House|the Lords|the Commons)\b",
    ("stand up", 1): r"^(?!.*\b(?:for|against|to)\b).*\b(?:stand|stands|standing|stood) up\b",
    ("stand up", 2): r"\b(?:charge|accusation|claim|story|theory|argument|excuse|case|evidence|objection)\b[^.?!]{0,25}?\b(?:stand|stands|standing|stood) up\b",
    ("stand up", 3): r"\b(?:stand|stands|standing|stood) up for\b",
    ("pick up", 1): r"^(?!.*(?:\b(?:pick|picks|picking|picked)\s+up\b\s+(?:(?:him|her|them|me|us|you)\b(?!\s+\w)|(?:mr|mrs|miss|sir)\b(?=[^.?!]{0,45}?\b(?:at|from|to|for|in|into|on)\s+(?:the\s+|a\s+|an\s+|his\s+|her\s+|my\s+|your\s+|their\s+|our\s+)?(?:\w+\s+){0,2}?(?:station|depot|wharf|pier|docks?|hotel|inn|airport|street|road|avenue|lane|house|door|gate|corner|club|school|church|town|village|shop|way|car|carriage|train|cab|boat|ship)\b)|(?:the|a|an|his|her|my|your|their|our|its|this|that|these|those|some|any|no|every|all the|[A-Za-z\u2019\x27]+[\u2019\x27]s)\s+(?:boy|boys|girl|girls|man|men|woman|women|lady|ladies|gentleman|gentlemen|fellow|friend|friends|passenger|passengers|servant|servants|guest|guests|party|stranger|strangers)\b(?=[^.?!]{0,45}?\b(?:at|from|to|for|in|into|on)\s+(?:the\s+|a\s+|an\s+|his\s+|her\s+|my\s+|your\s+|their\s+|our\s+)?(?:\w+\s+){0,2}?(?:station|depot|wharf|pier|docks?|hotel|inn|airport|street|road|avenue|lane|house|door|gate|corner|club|school|church|town|village|shop|way|car|carriage|train|cab|boat|ship)\b)|(?:people|persons|men|women|passengers|soldiers|sailors|recruits)\b(?!\s+\w)(?=[^.?!]{0,45}?\b(?:at|from|to|for|in|into|on)\s+(?:the\s+|a\s+|an\s+|his\s+|her\s+|my\s+|your\s+|their\s+|our\s+)?(?:\w+\s+){0,2}?(?:station|depot|wharf|pier|docks?|hotel|inn|airport|street|road|avenue|lane|house|door|gate|corner|club|school|church|town|village|shop|way|car|carriage|train|cab|boat|ship)\b)|(?:at|from)\s+(?:the\s+|a\s+)?(?:station|depot|wharf|pier|docks?|hotel|inn|airport)\b)|\b(?:pick|picks|picking|picked)\s+up\b[^.?!;,]{0,20}?\b(?:French|English|German|Spanish|Italian|Latin|Greek|a language|languages|the language|the habit|habits|knowledge|a smattering|the use of|the rudiments|the knack|the trick|the art of|the news|information|a few words|the local|points?)\b|\b(?:pick|picks|picking|picked)\s+up\b[^.?!;,]{0,15}?\b(?:the (?:room|rooms|house|things|toys|mess)|everything)\b|\b(?:pick|picks|picking|picked)\s+up\b\s+after\s+(?:him|her|them|me|us|you|the (?:party|guests|others))\b)).*\b(?:pick|picks|picking|picked)\s+up\b",
    ("pick up", 2): r"\b(?:pick|picks|picking|picked)\s+up\b\s+(?:(?:him|her|them|me|us|you)\b(?!\s+\w)|(?:mr|mrs|miss|sir)\b(?=[^.?!]{0,45}?\b(?:at|from|to|for|in|into|on)\s+(?:the\s+|a\s+|an\s+|his\s+|her\s+|my\s+|your\s+|their\s+|our\s+)?(?:\w+\s+){0,2}?(?:station|depot|wharf|pier|docks?|hotel|inn|airport|street|road|avenue|lane|house|door|gate|corner|club|school|church|town|village|shop|way|car|carriage|train|cab|boat|ship)\b)|(?:the|a|an|his|her|my|your|their|our|its|this|that|these|those|some|any|no|every|all the|[A-Za-z\u2019\x27]+[\u2019\x27]s)\s+(?:boy|boys|girl|girls|man|men|woman|women|lady|ladies|gentleman|gentlemen|fellow|friend|friends|passenger|passengers|servant|servants|guest|guests|party|stranger|strangers)\b(?=[^.?!]{0,45}?\b(?:at|from|to|for|in|into|on)\s+(?:the\s+|a\s+|an\s+|his\s+|her\s+|my\s+|your\s+|their\s+|our\s+)?(?:\w+\s+){0,2}?(?:station|depot|wharf|pier|docks?|hotel|inn|airport|street|road|avenue|lane|house|door|gate|corner|club|school|church|town|village|shop|way|car|carriage|train|cab|boat|ship)\b)|(?:people|persons|men|women|passengers|soldiers|sailors|recruits)\b(?!\s+\w)(?=[^.?!]{0,45}?\b(?:at|from|to|for|in|into|on)\s+(?:the\s+|a\s+|an\s+|his\s+|her\s+|my\s+|your\s+|their\s+|our\s+)?(?:\w+\s+){0,2}?(?:station|depot|wharf|pier|docks?|hotel|inn|airport|street|road|avenue|lane|house|door|gate|corner|club|school|church|town|village|shop|way|car|carriage|train|cab|boat|ship)\b)|(?:at|from)\s+(?:the\s+|a\s+)?(?:station|depot|wharf|pier|docks?|hotel|inn|airport)\b)",
    ("pick up", 3): r"\b(?:pick|picks|picking|picked)\s+up\b[^.?!;,]{0,20}?\b(?:French|English|German|Spanish|Italian|Latin|Greek|a language|languages|the language|the habit|habits|knowledge|a smattering|the use of|the rudiments|the knack|the trick|the art of|the news|information|a few words|the local|points?)\b",
    ("pick up", 4): r"\b(?:pick|picks|picking|picked)\s+up\b[^.?!;,]{0,15}?\b(?:the (?:room|rooms|house|things|toys|mess)|everything)\b|\b(?:pick|picks|picking|picked)\s+up\b\s+after\s+(?:him|her|them|me|us|you|the (?:party|guests|others))\b",
    ("lie down", 1): r"\b(?:lie|lies|lying|lay|lain) down\b",
    ("come over", 1): r"\b(?:come|comes|came|coming) over\b[^.?!]{0,20}?\b(?:to (?:my|his|her|our|the|your) (?:house|place|room|flat)|here|and see|to see|this evening|tonight|to-morrow|tomorrow|to dinner|to tea)\b",
    ("come over", 2): r"\b(?:feeling|sense|wave|emotion|fear|faintness|dizziness|despair|sadness|memories?|a change)\b[^.?!]{0,25}?\b(?:come|comes|came|coming) over\b|\b(?:come|comes|came|coming) over\b[^.?!]{0,15}?\b(?:him|her|me|us|them)\b",
    ("go off", 1): r"\b(?:bomb|shell|gun|pistol|rifle|cartridge|explosive)\b[^.?!]{0,25}?\b(?:go|goes|going|went|gone) off\b|\b(?:go|goes|going|went|gone) off\b[^.?!]{0,15}?\b(?:with a bang|with a crash)\b",
    ("go off", 2): r"\b(?:alarm|bell|clock|whistle|signal|bugle)\b[^.?!]{0,25}?\b(?:go|goes|going|went|gone) off\b",
    ("go off", 3): r"\b(?:go|goes|going|went|gone) off\b[^.?!]{0,20}?\b(?:to (?:the|his|her|a|town)|by himself|by herself|alone|without|early|at once|together)\b|\b(?:go|goes|going|went|gone) off\b\s*[.,!?]",
    ("run away", 1): r"\b(?:run|runs|running|ran) away\b[^.?!]{0,20}?\b(?:from|with|to)\b|\b(?:run|runs|running|ran) away\b\s*[.,!?]",
    ("run away", 2): r"\b(?:run|runs|running|ran) away from home\b|\b(?:run|runs|running|ran) away\b[^.?!]{0,15}?\bhome\b",
    ("take out", 1): r"^(?!.*\b(?:take|takes|taking|took|taken)\s+(?:her|him|them|me|us|you|the girl|the boy)\s+out\b)(?!.*\b(?:take|takes|taking|took|taken) out\b[^.?!]{0,20}?\b(?:licen[cs]e|licenses?|patent|insurance|policy|a policy|permit|summons|warrant|a warrant)\b).*\b(?:take|takes|taking|took|taken) out\b",
    ("take out", 2): r"\b(?:take|takes|taking|took|taken) (?:her|him|them|me|us|you|the girl|the boy) out\b",
    ("take out", 3): r"\b(?:take|takes|taking|took|taken) out\b[^.?!]{0,20}?\b(?:licen[cs]e|licenses?|patent|insurance|policy|a policy|permit|summons|warrant|a warrant)\b",
    ("go over", 1): r"\b(?:go|goes|going|went|gone)\s+over\b(?!\s+to\b)[^.?!;,]{0,40}?\b(?:lessons?|notes?|accounts?|papers?|letters?|story|scenes?|old ground|same ground|familiar ground|the ground|whole|matter|plans?|subject|details?|things|items?|points?|list|each|every|collection|syllables?|events?|adventures?|facts?|figures|numbers|outside)\b|\b(?:go|goes|going|went|gone)\s+over\b[^.?!;,]{0,40}?\b(?:again|once more|a second time|carefully|in detail|one by one|aloud|by heart|over and over)\b",
    ("go over", 2): r"\b(?:go|goes|going|went|gone) over\b[^.?!]{0,15}?\b(?:well|badly|big|with a bang|with the audience|with the crowd)\b",
    ("get away", 1): r"\b(?:get|gets|getting|got) away\b[^.?!]{0,20}?\bfrom\b|\b(?:get|gets|getting|got) away\b\s*[.,!?]",
    ("get away", 2): r"\b(?:get|gets|getting|got) away\b[^.?!]{0,20}?\b(?:for (?:a|the) (?:holiday|rest|week|week-end|weekend|while)|for a bit|for a time|to the country|to the sea)\b",
    ("get away", 3): r"\b(?:get|gets|getting|got) away with\b",
    ("sit up", 1): r"\b(?:sit|sits|sitting|sat) up\b[^.?!]{0,20}?\b(?:in (?:bed|his bed|her bed|the bed)|on (?:the|his|her) (?:bed|chair|sofa|couch)|straight|suddenly|and (?:look|listen|rub|stare))\b",
    ("sit up", 2): r"\b(?:sit|sits|sitting|sat) up\b[^.?!]{0,20}?\b(?:late|all night|half the night|for (?:him|her|them|you)|with (?:him|her|them))\b",
    ("go by", 1): r"\b(?:time|days?|hours?|weeks?|months?|years?|minutes?|the (?:time|hours|days|years))\b[^.?!]{0,25}?\b(?:go|goes|going|went|gone) by\b|\b(?:go|goes|going|went|gone) by\b[^.?!]{0,15}?\b(?:quickly|fast|slowly|unnoticed)\b",
    ("go by", 2): r"\b(?:go|goes|going|went|gone) by\s+(?:along\b|(?:the|a|an|his|her|my|your|their|our|its)?\s*(?:house|houses?|door|doors?|window|windows?|church|shop|gate|corner|road|street|village|town)\b)",
    ("go by", 3): r"\b(?:go|goes|going|went|gone|to go) by\s+(?:what|the (?:rules?|book|look|appearance|evidence|reports?)|his (?:word|look|face)|her (?:word|look|face)|appearances?|instinct|experience)\b",
    ("go by", 4): r"\b(?:go|goes|going|went|gone) by the name of\b|\b(?:went|goes|go) by the name\b",
    ("get in", 1): r"\b(?:get|gets|getting|got) in\b\s*to\b|\b(?:get|gets|getting|got) in\b\s*[.,!?]",
    ("get in", 2): r"\b(?:train|boat|ship|tram)\b[^.?!]{0,25}?\b(?:get|gets|getting|got) in\b|\b(?:get|gets|getting|got) in\b[^.?!]{0,15}?\b(?:at (?:six|seven|eight|nine|ten|five|dawn|dark)|on time|late)\b",
    ("get in", 3): r"\b(?:get|gets|getting|got) in\b[^.?!]{0,20}?\b(?:college|university|school|academy|the team|the club)\b|\b(?:get|gets|getting|got) (?:him|her|them|me) in\b",
    ("get back", 1): r"^(?!.*\b(?:get|gets|getting|got|gotten) back\b[^.?!]{0,30}?\b(?:the (?:money|letter|book|watch|ring|papers?|property|gems?)|his (?:money|letter|book|watch|ring|property|gems?)|her (?:money|letter|book|watch|ring|property|gems?)|gems?|youth|life|health|right note|colour|color|light heart|mimic life|feeling|a place|a dollar more)\b)(?!.*\b(?:get|gets|getting|got|gotten) back (?:at|on) (?:him|her|them|me|you|us)\b).*\b(?:get|gets|getting|got|gotten) back\b",
    ("get back", 2): r"\b(?:get|gets|getting|got|gotten) back\b[^.?!]{0,30}?\b(?:the (?:money|letter|book|watch|ring|papers?|property|gems?)|his (?:money|letter|book|watch|ring|property|gems?)|her (?:money|letter|book|watch|ring|property|gems?)|gems?|youth|life|health|right note|colour|color|light heart|mimic life|feeling|a place|a dollar more)\b",
    ("get back", 3): r"\b(?:get|gets|getting|got|gotten) back (?:at|on) (?:him|her|them|me|you|us)\b",
    ("look into", 1): r"\blook(?:s|ed|ing)? into\b[^.?!]{0,25}?\b(?:(?:the|our|my|your|his|her|their|any|some|no)\s+(?:(?:little|small|serious|important)\s+)?(?:matter|matters|question|questions|case|cases|affair|affairs|business|subject|subjects|facts?|things?|details?|possibilit(?:y|ies)|problem|problems|mystery|mysteries|character|circumstances?)\b|it\b|this\b|that\b|what\b|how\b|whether\b|them\s*(?:[.!?]|\u2026|$))|\b(?:matter|matters|question|questions|case|cases|affair|affairs|problem|problems|mystery|mysteries|business|subject|subjects|facts?|things?|details?|possibilit(?:y|ies)|character|circumstances?)\b[^.?!]{0,25}?\bto\s+look(?:s|ed|ing)? into\b|\b(?:be|been|is|are|was|were)\s+looked\s+into\b",
    ("make out", 1): r"\b(?:make|makes|making|made) out\b(?!\s+of\b)(?:\s+(?:the|a|an)\s+(?:[\w'\u2019-]+\s+){0,2}?\b(?:shape|form|figure|house|ship|shore|figures|letters|words|sounds|bird|canoe|expression|features?)\b|\s+(?:anything|nothing|something)\b|\s+(?:him|her|them)\b(?!\s+[A-Za-z]))|\b(?:anything|nothing|something)\b[^.?!,;:]{0,20}?\b(?:make|makes|making|made) out\b(?!\s+of\b)|\b(?:the|a|an)\s+(?:[\w'\u2019-]+\s+){0,2}?\b(?:shape|form|figure|house|ship|shore|figures|letters|words|sounds|bird|canoe|expression|features?)\b[^.?!,;:]{0,20}?\b(?:make|makes|making|made) out\b(?!\s+of\b)",
    ("make out", 2): r"\b(?:make|makes|making|made) out\b[^.?!,;:]{0,25}?\b(?:what|why|how|whether|who|which|where|when|the meaning|the sense|the reason|the proper way|meaning|sense)\b",
    ("make out", 3): r"\b(?:make|makes|making|made) out\b[^.?!,;:]{0,20}?\b(?:a (?:cheque|check|bill|list|receipt|will|draft|application|form)|application blanks?|forms?|cheque|the cheque|the bill|the list|the receipt|an account)\b",
    ("look back", 1): r"\blook(?:s|ed|ing)? back\b[^.?!]{0,20}?\b(?:at|over (?:his|her|your)|to (?:see|wave|smile)|upon)\b",
    ("look back", 2): r"\blook(?:s|ed|ing)? back\b[^.]{0,15}?\bupon\b|\blook(?:s|ed|ing)? back\b[^.]{0,15}?\bon (?:it|this|that|those|these|the|his|her|my|your|what)\b",
    ("hold out", 1): r"\b(?:hold|holds|holding|held) out\b[^.?!]{0,20}?\b(?:his|her|my|your|the|a|both) (?:hand|hands|arm|arms|palm|glass|cup|plate|letter|money|cheque|check)\b",
    ("hold out", 2): r"\b(?:hold|holds|holding|held) out\b[^.?!]{0,25}?\b(?:against|for (?:a|the) (?:long|while|time)|till|until|no longer|to the last)\b",
    ("hold out", 3): r"\b(?:supplies?|food|water|money|provisions?|patience|courage|hopes?|strength)\b[^.?!]{0,25}?\b(?:hold|holds|holding|held) out\b|\b(?:hold|holds|holding|held) out\b[^.?!]{0,15}?\b(?:till|until|for (?:a|two|three|many) (?:days|weeks|months))\b",
    ("come along", 1): r"\b(?:come|comes|came|coming) along\b[^.?!]{0,20}?\b(?:with (?:me|us|him|her|them)|too|and see|to (?:the|his|her))\b|\bcome along\b\s*[.,!?]",
    ("come along", 2): r"\b(?:opportunity|chance|work|job|something|a chance|an opportunity)\b[^.?!]{0,25}?\b(?:come|comes|came|coming) along\b",
    ("come along", 3): r"\b(?:how|nicely|well|slowly)\b[^.?!]{0,20}?\b(?:come|comes|came|coming) along\b|\b(?:come|comes|came|coming) along\b[^.?!]{0,12}?\b(?:well|nicely|slowly|fast)\b",
    ("look after", 1): r"\blook(?:s|ed|ing)? after\b[^.?!]{0,25}?\b(?:the (?:children|child|baby|house|garden|shop|business|sick|poor|old)|his (?:mother|father|wife|children|sister|brother)|her (?:mother|father|husband|children|sister|brother)|him|her|them|it|me|us)\b",
    ("turn away", 1): r"\bturn(?:s|ed|ing)? away\b[^.?!]{0,20}?\b(?:from (?:him|her|them|me|the|his|her)|his (?:face|head|eyes)|her (?:face|head|eyes)|to hide)\b",
    ("turn away", 2): r"\bturn(?:s|ed|ing)? away\b[^.?!]{0,20}?\b(?:from the door|away from the door|crowds?|people|applicants?|customers?|visitors?|beggars?|the poor)\b",
    # ===== 块 B″ 第三批（2026-10-10 十三续 · 30 词）=====
    # break out
    ("break out", 1): r"\b(?:break|breaks|breaking|broke|broken) out\b[^.?!]{0,25}?\b(?:war|fighting|fire|flames|plague|cholera|fever|epidemic|revolution|riots?|storm|violence|explosion|outbreak|hostilities)\b|\b(?:war|fire|plague|cholera|epidemic|riots?|violence|hostilities)\b[^.?!]{0,25}?\b(?:break|breaks|breaking|broke|broken) out\b",
    ("break out", 2): r"\b(?:break|breaks|breaking|broke|broken) out\b[^.?!]{0,25}?\b(?:laugh|laughing|laughter|tears|crying|oath|cursing|singing|into (?:laughter|a|an)|with (?:a|an|the)|afresh|impulsively|impatiently|angrily|good-naturedly|fiercely)\b",
    ("break out", 3): r"\b(?:break|breaks|breaking|broke|broken) out\b[^.?!]{0,20}?\b(?:of (?:prison|jail|gaol|the prison|his cell|the camp|all bounds)|escape|free|the enemy)\b",
    ("break out", 4): r"\b(?:break|breaks|breaking|broke|broken) out\b[^.?!]{0,20}?\b(?:in (?:a |an )?(?:rash|spots|blisters|sweat)|all over)\b",
    # call on
    ("call on", 1): r"^(?!.*\bcall(?:s|ed|ing)? on\b[^.?!]{0,45}?\b(?:to|for)\b).*\bcall(?:s|ed|ing)? on\b",
    ("call on", 2): r"\bcall(?:s|ed|ing)? on\b[^.?!]{0,45}?\b(?:to\b|for (?:help|assistance|aid|advice|compassion))\b",
    # run down
    ("run down", 1): r"\b(?:run|runs|running|ran)\s+down\b[^.?!]{0,20}?\b(?:by (?:a |the )?(?:car|motor|motor-car|train|engine|vehicle|tram|omnibus|hansom|cab|cart|driver)|in the street|crossing)\b",
    ("run down", 2): r"\b(?:run|runs|running|ran)\s+down\b[^.?!]{0,15}?\b(?:thief|thieves|criminal|criminals|fugitive|murderer|black dog|fox|deer|quarry|prey|wire|wires|trail|clue|this man|the man)\b",
    ("run down", 3): r"\b(?:run|runs|running|ran)\s+down\b[^.?!]{0,20}?\b(?:planless|idle|empty|exhausted?|health|strength|nervous|system|constitution)\b|\b(?:been|be|feel|feeling|looking|very|rather|quite|so)\s+(?:run|runs|running|ran)\s+down\b",
    ("run down", 4): r"\b(?:run|runs|running|ran)\s+down\b[^.?!]{0,25}?\b(?:reputation|character|abilities|efforts|work|plans|scheme|ideas)\b",
    # stand by
    ("stand by", 1): r"\bstand(?:s|ing)? by\b[^.?!]{0,20}?\b(?:his|her|their|your|my|our|the) (?:duty|word|promise|friend|friends|principles|colou?rs|side|established)\b|\bstood by\b[^.?!]{0,20}?\b(?:duty|word|promise|friend|him|her|them|us|me|you)\b",
    ("stand by", 2): r"\bstand(?:s|ing)? by\b[^.?!]{0,25}?\b(?:and (?:watch|let|see)|while|without (?:a word|moving|acting)|idly|helplessly|in silence)\b",
    ("stand by", 3): r"\bstand(?:s|ing)? by\b[^.?!]{0,25}?\b(?:to (?:go|trim|fire|sail|weigh|launch|anchor)|ready|for orders|orders|aloof)\b",
    # go about
    ("go about", 1): r"\b(?:go|goes|going|went) about\b(?!\s*(?:\d|two|three|four|five|six|seven|eight|nine|ten|twenty|thirty|forty|fifty|sixty|hundred|a few|some))[^.?!]{0,25}?\b(?:it|that|this|business|work|task|errand|errands|mending|making|preparations|his|her|their|the)\b",
    ("go about", 2): r"\b(?:go|goes|going|went) about\b[^.?!]{0,25}?\b(?:carrying|with (?:posters|flags)|the (?:streets|town|country|city)|among|from (?:door|house)|everywhere|singing|begging)\b",
    ("go about", 3): r"\b(?:stand by|ready) to go about\b|\b(?:go|goes|going|went) about\b[^.?!]{0,20}?\b(?:ship|tack|wind|shore|sail|helm|bow|hove)\b|\bwent about ship\b",
    # put up
    ("put up", 1): r"\bput(?:s|ting)? up\b[^.?!]{0,20}?\b(?:hand|hands|arms?|poles?|sails?|umbrella|flag|head|stick|finger|his (?:hand|hands|arms?|head))\b",
    ("put up", 2): r"\bput(?:s|ting)? up\b[^.?!]{0,20}?\b(?:building|house|shed|hut|wall|fence|monument|statue|tent|stage|scaffold|barracks|factory|frame)\b",
    ("put up", 3): r"\bput(?:s|ting)? up\b[^.?!]{0,20}?\b(?:at (?:the|a|an|his|her|their|my)|for (?:the )?night|lodging|board|for (?:him|her|them|us|me))\b",
    ("put up", 4): r"\bput(?:s|ting)? up\b[^.?!]{0,20}?\b(?:notice|notices|poster|posters|bill|bills|placard|advertisement|sign|announcement)\b",
    ("put up", 5): r"\bput(?:s|ting)? up\b[^.?!]{0,20}?\b(?:a (?:fight|struggle|resistance|brave|game|good)|fight|resistance|defence|defense|spectacle)\b",
    # bring up
    ("bring up", 1): r"\b(?:been|be|was|were|is|are) (?:well |badly |carefully |properly )?brought up\b(?!\s+(?:against|at|just|once|short|dead|alongside))\b|\b(?:bring|brings|bringing|brought) up\b[^.?!]{0,20}?\b(?:child|children|family|son|daughter|boy|girl|to be|as a)\b",
    ("bring up", 2): r"\b(?:bring|brings|bringing|brought) up\b[^.?!]{0,20}?\b(?:question|subject|matter|point|topic|name|affair|business|the (?:fact|case))\b",
    ("bring up", 3): r"\b(?:bring|brings|bringing|brought) up\b[^.?!]{0,15}?\b(?:against|at (?:the|a|least)|just (?:where|as)|short|dead|alongside|with a (?:bang|resounding))\b",
    ("bring up", 4): r"\b(?:bring|brings|bringing|brought) up the rear\b",
    # hold up
    ("hold up", 1): r"\b(?:hold|holds|holding|held) up\b[^.?!]{0,25}?\b(?:his|her|their|my|your|its|the|a|an|one|two|both|that|this|our|yer|thy|[A-Z][\w'\u2019-]*(?:\u2019|')s)\b[^.?!]{0,20}?\b(?:hand|hands|finger|fingers|forefinger|forefingers|paw|paws|forepaw|forepaws|chin|head|heads|arm|arms|lamp|light|glass|candle|letter|paper|book|volume|bunch|manuscript|sheet|slip|cardboard|lantern|piece|coin|rupee|cup|glove|whistle|crucifix|curtain|chain|fire-pot|toffee|picture|blossom|specimen|carbuncle|skirt|skirts|fragment|fragments|string|chunk|hoop|body|shirt|corset-cover|corset cover|Burgundy)\b|\b(?:hand|hands|finger|fingers|forefinger|forefingers|paw|paws|forepaw|forepaws|chin|head|heads|arm|arms|lamp|light|glass|candle|letter|paper|book|volume|bunch|manuscript|sheet|slip|cardboard|lantern|piece|coin|rupee|cup|glove|whistle|crucifix|curtain|chain|fire-pot|toffee|picture|blossom|specimen|carbuncle|skirt|skirts|fragment|fragments|string|chunk|hoop|body|shirt|straw|foot|feet)\b[^.?!]{0,35}?\b(?:hold|holds|holding|held) up\b",
    ("hold up", 2): r"\bhold(?:s|ing)? up\b[^.?!]{0,20}?\b(?:traffic|the traffic|delay|delayed|by (?:the|a)|for hours|all day)\b|\b(?:was|were|been|be|being) (?:almost|nearly|quite|rather|very|so|much|still|soon)? ?held up\b[^.?!]{0,20}?\b(?:by curiosity|for free tickets|for hours|all day)\b|\b(?:was|were|been|be|being)\s+[\u201c\x22]?held up[\u201d\x22]?\s*(?:[,;]|--|[\u2014\u2013])",
    ("hold up", 3): r"\bhold(?:s|ing)? up\b[^.?!]{0,20}?\b(?:bank|stage|coach|train|payroll|gunpoint|robbers?|bandits?|highwaymen)\b|\bheld up\b[^.?!]{0,20}?\b(?:by (?:armed men|robbers?|bandits?|highwaymen)|at (?:the )?(?:point of (?:a )?(?:gun|pistol)|gunpoint)|the (?:bank|coach|stage))\b",
    ("hold up", 4): r"\bhold(?:s|ing)? up\b[^.?!;,]{0,30}?\b(?:as (?:an? )?(?:example|model|instance|pattern)|for admiration|to admiration)\b|\bheld up\b[^.?!;,]{0,30}?\b(?:as (?:an? )?(?:example|model|instance|pattern)|as a colossal liar|to be seen|(?:daily )?in warning)\b",
    ("hold up", 5): r"\b(?<!to )hold up\b\s*(?:[!,.]|--|[\u2014\u2013\u201c\u201d])|\bheld up\b(?!\s+(?:his|her|their|my|your|its|the|a|an)\b)[^.?!]{0,20}?\b(?:well|under|badly|and (?:looked|smiled|waited))\b",
    # turn up
    ("turn up", 1): r"\b(?:turn|turns|turning|turned) up\b[^.?!]{0,25}?\b(?:unexpectedly|at (?:the|last)|sooner|later|by the end|in my mind|again|here|there|somewhere|among|amongst)\b|\b(?:if|unless) (?:we|they|he|she|you) (?:don't|do not) turn up\b",
    ("turn up", 2): r"\b(?:turn|turns|turning|turned) up\b[^.?!]{0,20}?\b(?:volume|music|radio|lamp|light|gas|fire|heat|steam)\b",
    ("turn up", 3): r"\b(?:turn|turns|turning|turned) up\b[^.?!]{0,20}?\b(?:cuffs?|sleeves?|trousers|trouser|skirt|hem|collar|nose|hair)\b",
    ("turn up", 4): r"\b(?:turn|turns|turning|turned) up\b[^.?!]{0,20}?\b(?:a card|cards|trumps?|a (?:coin|penny|sixpence)|evidence|a (?:letter|paper|body))\b",
    # keep up
    ("keep up", 1): r"^(?!.*\b(?:keep|keeps|keeping|kept) up with\b)(?!.*(?:\b(?:keep|keeps|keeping|kept) up\b(?!\s+with\b)[^.?!]{0,20}?\b(?:conversation|song(?:s)?|correspondence|appearances?|connection|relations?|appearance|music|class(?:es)?|commentary|fire(?:s)?|flames?|deception)\b)).*\b(?:keep|keeps|keeping|kept) up\b",
    ("keep up", 2): r"\b(?:keep|keeps|keeping|kept) up with\b",
    ("keep up", 3): r"\b(?:keep|keeps|keeping|kept) up\b(?!\s+with\b)[^.?!]{0,20}?\b(?:conversation|song(?:s)?|correspondence|appearances?|connection|relations?|appearance|music|class(?:es)?|commentary|fire(?:s)?|flames?|deception)\b",
    # take in
    ("take in", 1): r"\b(?:take|takes|taking|took|taken)\s+in\b[^.?!]{0,20}?\b(?:lodgers?|boarders?|a (?:lodger|boarder|guest|tenant)|the (?:poor|orphan|child)|into (?:his|her|their) (?:house|home)|washing)\b",
    ("take in", 2): r"\b(?:take|takes|taking|took|taken)\s+(?:him|her|them|me|us|you|the \w+)\s+in\b|\b(?:take|takes|taking|took|taken)\s+in\b(?!\s+(?:charge|care)\b)[^.?!,;]{0,15}?\b(?:by (?:his|her|their|a)|a (?:fool|dupe|trick)|completely|easily)\b|\b(?:easily|completely|quite)\s+(?:take|takes|taking|took|taken)\s+in\b",
    ("take in", 3): r"\b(?:take|takes|taking|took|taken)\s+in\b[^.?!,;]{0,20}?\b(?:what|(?:this|that)\b(?!\s+[A-Za-z])|it\b|the (?:meaning|sense|situation|words|story|news)|at (?:a|one) glance|all of it)\b",
    ("take in", 4): r"\b(?:take|takes|taking|took|taken)\s+in\b[^.?!]{0,20}?\b(?:coal|water|air|food|nourishment|supply|a reef|the reef|sail)\b",
    ("take in", 5): r"\b(?:eye|eyes|glance|gaze)\b[^.?!]{0,25}?\b(?:take|takes|taking|took|taken) in\b|\b(?:take|takes|taking|took|taken)\s+in\b[^.?!]{0,20}?\b(?:the (?:clothes|dress|room|scene|figure)|everything|immediately)\b",
    # hold on
    ("hold on", 1): r"\b(?:hold|holds|holding|held) on to\b|\b(?:hold|holds|holding|held) on\b[^.?!]{0,20}?\b(?:the (?:bar|rail|rope|wall|door)|his (?:arm|hand|belt)|her (?:arm|hand))\b",
    ("hold on", 2): r"\bhold on\b\s*[!,.]|\b(?:hold|holds|holding|held) on\b[^.?!]{0,15}?\b(?:a (?:minute|moment|second|bit)|till|until|wait)\b",
    ("hold on", 3): r"\b(?:hold|holds|holding|held) on\b[^.?!]{0,20}?\b(?:its (?:course|way)|his (?:course|way|ground)|her (?:course|way)|bravely|firmly|despite)\b",
    # call out
    ("call out", 1): r"^(?!.*\b(?:names?|roll|list)\b[^.?!]{0,20}?\b(?:call|calls|calling|called) out\b)(?!.*\b(?:call|calls|calling|called) out\b[^.?!]{0,20}?\b(?:the (?:names?|numbers?|roll|list)|names?|numbers?)\b)(?!.*\b(?:call|calls|calling|called) out\b[^.?!]{0,25}?\b(?:the (?:guard|guards|troops?|soldiers?|militia|police|fire(?:men)?|reserves?|doctor|men|guns|artillery)|to arms|on strike|on all the lines|out of the ranks|(?:eight|ten|twenty|fifty|a hundred|a thousand|thousands? of) (?:men|troops|soldiers)|such guns)\b)(?!.*\b(?:police(?:men)?|militia|troops|fire(?:men)?|guard)\b[^.?!]{0,30}?\b(?:call|calls|calling|called) out\b)(?!.*\bcalled out of (?:the room|the first sleep|my own soul)\b)(?!.*\bcall out May's radiance\b).*\b(?:call|calls|calling|called) out\b",
    ("call out", 2): r"\b(?:names?|roll|list)\b[^.?!]{0,20}?\b(?:call|calls|calling|called) out\b|\b(?:call|calls|calling|called) out\b[^.?!]{0,20}?\b(?:the (?:names?|numbers?|roll|list)|names?|numbers?)\b",
    ("call out", 3): r"\b(?:call|calls|calling|called) out\b[^.?!]{0,25}?\b(?:the (?:guard|guards|troops?|soldiers?|militia|police|fire(?:men)?|reserves?|doctor|men|guns|artillery)|to arms|on strike|on all the lines|out of the ranks|(?:eight|ten|twenty|fifty|a hundred|a thousand|thousands? of) (?:men|troops|soldiers)|such guns)\b|\b(?:police(?:men)?|militia|troops|fire(?:men)?|guard)\b[^.?!]{0,30}?\b(?:call|calls|calling|called) out\b",
    # look over
    ("look over", 1): r"\b(?:look|looks|looking|looked)\s+over\b\s+(?:(?:all\s+)?(?:the|a|an|some|his|her|my|your|their|our|its|[\w'\u2019-]+(?:\u2019|')s)\s+){0,2}(?:[\w'\u2019-]+\s+){0,2}\b(?:magazines?|slates?|drawers?|regulations?|toilettes?|entries?|letters?|accounts?|papers?|log[- ]?books?|books?|bags?|furnaces?|water[- ]?pipes?|bills?|clothes|maps?|horses?|hounds?|dogs?|teams?|retinues?|houses?|plans?|notes?|manuscripts?|reports?|lists?|forms?|checks?|proofs?|views?)\b",
    ("look over", 2): r"\blook(?:s|ed|ing)? over\b[^.?!]{0,20}?\b(?:a (?:fault|faults|sin|offence|offense|mistake)|the (?:fault|faults)|their (?:faults|sins))\b",
    # settle down
    ("settle down", 1): r"\bsettl(?:e|es|ed|ing) down\b[^.?!]{0,20}?\b(?:to (?:some )?(?:position|business|life|work)|in (?:the|a) (?:country|town|village|city|house)|and marry|like an ordinary|for life)\b",
    ("settle down", 2): r"\bsettl(?:e|es|ed|ing) down\b[^.?!]{0,20}?\b(?:to (?:his|her|their|the|sleep|slumber|work|supper|meal|reading)|again|quietly|into a|state of mind)\b",
    ("settle down", 3): r"\b(?:bird|pigeon|hen|fowl|butterflies|snow|dust|darkness|night|silence)\b[^.?!]{0,25}?\bsettl(?:e|es|ed|ing) down\b|\bsettl(?:e|es|ed|ing) down\b[^.?!]{0,15}?\b(?:into (?:its|the) nest|on (?:the|his|her) (?:perch|nest|roost))\b",
    # cut off
    ("cut off", 1): r"\bcut(?:s|ting)? off\b[^.?!]{0,20}?\b(?:his (?:hair|head|leg|hand|ear|beard)|her (?:hair|head)|the (?:hair|head|leg|hand|ear|branch)|a (?:piece|slice|end)|the (?:end|top|bits))\b",
    ("cut off", 2): r"\bcut(?:s|ting)? off\b[^.?!]{0,20}?\b(?:the (?:supply|gas|water|electricity|telephone|light|communication)|his (?:words|speech)|her (?:words|speech)|our (?:supplies|retreat)|all (?:communication|supplies))\b|\b(?:was|were|been) cut off\b[^.?!]{0,20}?\b(?:in the middle|mid-sentence|by)\b",
    ("cut off", 3): r"\bcut(?:s|ting)? off\b[^.?!]{0,20}?\b(?:from (?:the|his|her|all|everyone|the rest)|upon both sides|on (?:all|every) sides|entirely|completely|by (?:the|a) (?:flood|snow|storm|tide))\b|\b(?:was|were|been) cut off\b\s*[.,;]",
    # live on
    ("live on", 1): r"\bliv(?:e|es|ed|ing) on\b[^.?!]{0,20}?\b(?:rum|goats?|berries|oysters|bread|treacle|rice|fish|milk|fruit|charity|the (?:climate|land|country)|nothing|what|it|his|her|their)\b",
    ("live on", 2): r"\bliv(?:e|es|ed|ing) on\b[^.?!]{0,20}?\b(?:for ever|forever|a thousand|in (?:the )?(?:memory|hearts|minds)|after (?:his|her|their) death)\b",
    # turn back
    ("turn back", 1): r"\bturn(?:s|ed|ing)? back\b[^.?!]{0,20}?\b(?:and (?:ask|walk|look|go|enter|say)|to (?:the|his|her|their|my|our)|into (?:the|his|her)|for (?:his|her|the|a)|home|towards|toward|upon (?:his|her) (?:steps|way))\b",
    ("turn back", 2): r"\bturn(?:s|ed|ing)? back\b[^.?!]{0,20}?\b(?:the (?:enemy|tide|flood|attack|army|invaders|troops|wave)|them|him|her|the (?:crowd|mob))\b",
    ("turn back", 3): r"\bturn(?:s|ed|ing)? back\b[^.?!]{0,20}?\b(?:to (?:a |the |his |her )?(?:previous|former|old|earlier)|the (?:clock|hands of)|into (?:a |the )?(?:child|boy|girl))\b",
    # turn over
    ("turn over", 1): r"\bturn(?:s|ed|ing)? over\b[^.?!]{0,20}?\b(?:on (?:his|her|its|the|their) (?:side|face|back)|and (?:went|go|lay|look|swim)|upon (?:its|his|her) side|in the (?:air|water)|upside)\b",
    ("turn over", 2): r"\bturn(?:s|ed|ing)? over\b[^.?!]{0,25}?\b(?:the (?:money|papers|business|estate|property|account|keys|man|thief)|to (?:his|her|their|the) (?:son|heir|partner|police|authorities))\b|\bturn(?:s|ed|ing)? over\b[^.?!]{0,15}?\bto (?:him|her|them|me|us|you)\b",
    ("turn over", 3): r"\bturn(?:s|ed|ing)? over\b[^.?!]{0,15}?\b(?:the (?:pages?|leaves|leaf|book|volume)|his (?:pages?|book))\b",
    ("turn over", 4): r"\bturn(?:s|ed|ing)? (?:it |the matter |this |that )?over\b[^.?!]{0,20}?\b(?:in (?:his|her|my|your|their) mind|and (?:consider|think)|carefully)\b",
    # put out
    ("put out", 1): r"\bput(?:s|ting)? out\b[^.?!]{0,20}?\b(?:his (?:hand|hands|head|arm|arms|tongue|foot)|her (?:hand|hands|head|arm|arms|tongue|foot)|my (?:hand|hands|head)|the (?:hand|head|tongue))\b",
    ("put out", 2): r"\bput(?:s|ting)? out\b[^.?!]{0,20}?\b(?:the (?:lamp|light|lights|candle|fire|gas|flame)|a (?:light|candle|fire)|the (?:flames?))\b|\b(?:being )?put out\b[^.?!]{0,15}?\b(?:of the (?:lamp|candle)|by the (?:wind|servants|firemen))\b",
    ("put out", 3): r"\bput(?:s|ting)? out\b[^.?!]{0,20}?\b(?:of countenance|about it|very much|by (?:his|her|the|such)|with (?:his|her|the))\b|\b(?:look|looked|seem|seemed|feel|felt)\b[^.?!]{0,15}?\bput out\b",
    ("put out", 4): r"\bput(?:s|ting)? out\b[^.?!]{0,20}?\b(?:a (?:book|novel|volume|pamphlet|report|statement|edition)|books|pamphlets|a new)\b",
    # set out
    ("set out", 1): r"\bset(?:s|ting)? out\b[^.?!]{0,20}?\b(?:for\b|at (?:dawn|once|daybreak|sunrise)|on (?:a|his|her|the) (?:journey|voyage|trip|way)|together|early\b|from\b)",
    ("set out", 2): r"\bset(?:s|ting)? out\b[^.?!]{0,20}?\b(?:to (?:do|make|find|get|prove|show|write|build|seek)|with the (?:intention|purpose|idea))\b",
    ("set out", 3): r"\bset(?:s|ting)? out\b[^.?!]{0,20}?\b(?:the (?:facts|terms|reasons|arguments|grounds|rules|conditions|plans?|goods|wares|table)|in (?:the|a) (?:order|array|line)|clearly|in full)\b",
    # turn in
    ("turn in", 1): r"\bturn(?:s|ed|ing)? in\b\s+(?:his|her|their|my|your|our|the|a|an)\s+(?:report|reports|papers|keys|badge|gun|essay|homework|work|man|thief|criminal)\b|\bturn(?:s|ed|ing)? in\b\s+(?:himself|themselves)\b|\bturn(?:s|ed|ing)? in\b\s+to the (?:police|authorities)\b",
    ("turn in", 2): r"\b(?:I[\u2019']?ll|I will|let[\u2019']?s|let us)\s+turn(?:s|ed|ing)? in\b|\b(?:about time to|glad to|previous to|before|thinking (?:about|of))\s+turn(?:s|ed|ing)? in\b|\b(?:take my advice\s+)?and\s+turn(?:s|ed|ing)? in\b\s*(?:[,.!?]|--|\u2014)|\bturn(?:s|ed|ing)? in\b\s+(?:for (?:the )?night|with (?:him|her|them|me|us|you)|early|late|without delay)\b|\bturn(?:s|ed|ing)? in\b\s*,?\s*and\s+(?:never slept|go to sleep|went to bed|slept)\b|\b(?:whenever\s+\w+\s+|already\s+)\s*turn(?:s|ed|ing)? in\b|\bturn(?:s|ed|ing)? in\b\s+to\s+(?:their|his|her|our|my|your)\s+(?:little\s+)?bunks?\b",
    ("turn in", 3): r"\bturn(?:s|ed|ing)? in\b[^.?!]{0,25}?\b(?:at (?:the|a|his|her|their|my|our)\s+(?:gate|gates|drive|entrance|road|corner|lane|lodge|lodge gates|house)|into (?:the|a|his|her|their|my|our)\s+(?:gate|drive|road|lane|yard)|through (?:the|a|his|her|their|my|our)\s+(?:park gate|college gates|broken-down gate|gate|gates)|among(?:st)?\s+(?:the\s+)?larches|between\s+the\s+[^.?!]{0,20}\s+gate[- ]?posts?)\b",
    # hand over
    ("hand over", 1): r"\bhand(?:s|ed|ing)?\b[^.?!]{0,20}?\bover\b(?!\s+(?:the|his|her|their|its|my|your|a|an)\b)",
    # break off
    ("break off", 1): r"\b(?:break|breaks|breaking|broke|broken) off\b[^.?!]{0,20}?\b(?:in (?:the )?(?:middle|midst)|short|suddenly|abruptly|his (?:sentence|speech|story)|her (?:sentence|speech)|the (?:conversation|talk|story|discussion|sentence))\b",
    ("break off", 2): r"\b(?:break|breaks|breaking|broke|broken) off\b[^.?!]{0,20}?\b(?:a (?:piece|bit|branch|twig|corner|end)|the (?:branch|twig|corner|end|top|tip)|from (?:the|his|her|a))\b",
    ("break off", 3): r"\b(?:break|breaks|breaking|broke|broken) off\b[^.?!]{0,20}?\b(?:relations?|negotiations?|the (?:engagement|match|deal|alliance|friendship)|with (?:him|her|them))\b",
    # turn into
    ("turn into", 1): r"\bturn(?:s|ed|ing)? into\b",
    # grow up
    ("grow up", 1): r"^(?!.*\b(?:neighborhood|town|city|village|settlement|trade|industry|habit|custom|friendship|generation)\b).*\b(?:grew|grown|grow|grows|growing) up\b",
    ("grow up", 2): r"\b(?:neighborhood|town|city|village|settlement|trade|industry|habit|custom|friendship|generation)\b[^.?!]{0,25}?\b(?:grew|grown|grow|grows|growing) up\b",
    # wake up
    ("wake up", 1): r"\b(?:wake|wakes|waking|woke|woken) up\b[^.?!]{0,20}?\b(?:early|late|at (?:dawn|once|five|six|seven)|in the morning|to find|and (?:found|saw|looked|lay))\b|\b(?:woke|wakened|waked) up\b\s*[.,]",
    ("wake up", 2): r"\b(?:wake|wakes|waking|woke|woken) (?:him|her|them|me|us|you|the \w+) up\b",
    ("wake up", 3): r"\b(?:wake|wakes|waking|woke|woken) up to\b|\b(?:wake|woke) up\b[^.?!]{0,15}?\b(?:reality|the truth|fact|danger)\b",
    # look around
    ("look around", 1): r"\blook(?:s|ed|ing)? around\b[^.?!]{0,20}?\b(?:him|her|them|me|us|you|about|the (?:room|hall|house|place|street)|and (?:see|saw|found|took))\b",
    ("look around", 2): r"\blook(?:s|ed|ing)? around\b[^.?!]{0,20}?\bfor\b",
    # run out
    ("run out", 1): r"\b(?:run|runs|running|ran) out of\b[^.?!]{0,20}?\b(?:money|time|patience|supplies|food|fuel|breath|stock|coal|provisions|funds|cash|ideas|things)\b|\b(?:money|time|supplies|food|patience|fuel|provisions|funds)\b[^.?!]{0,20}?\b(?:run|runs|running|ran) out\b",
    ("run out", 2): r"\b(?:run|runs|running|ran) out\b[^.?!]{0,20}?\b(?:lease|policy|term|contract|passport|licence|license|ticket|time (?:is|was))\b",
    # get over
    ("get over", 1): r"\b(?:get|gets|getting|got) over\b[^.?!]{0,20}?\b(?:difficulty|difficulties|trouble|obstacle|objection|objections|disappointment|that|this)\b",
    ("get over", 2): r"\b(?:get|gets|getting|got) over\b[^.?!]{0,20}?\b(?:illness|fever|sickness|cold|grief|loss|shock|it)\b",
    ("get over", 3): r"\b(?:get|gets|getting|got) over\b[^.?!]{0,15}?\b(?:the (?:wall|fence|creek|river|hedge|stile|gate|stream)|that creek)\b|\ba way to get over\b",
    ("get over", 4): r"\bget(?:s|ting)? (?:it|this|that|the (?:whole|surgery|wedding|dinner)) over\b|\bgot it over\b",
    # keep on
    ("keep on", 1): r"\b(?:keep|keeps|keeping|kept) on\b[^.?!]{0,20}?\b(?:doing|working|talking|walking|trying|going|reading|writing|thinking|drinking|singing|crying|smiling|for|till|until)\b|\b(?:keep|keeps|kept) on\b\s*[,.;]",
    ("keep on", 2): r"\b(?:keep|keeps|keeping|kept) on at\b",
    # pass away
    ("pass away", 1): r"\b(?:pass|passes|passed|passing) away\b[^.?!]{0,25}?\b(?:peacefully|quietly|suddenly|yesterday|last (?:night|week|year)|at (?:his|her|the) (?:home|house)|in (?:his|her) sleep|and (?:was|were) buried|from (?:this|the) life)\b|\b(?:he|she|they|his (?:father|mother|wife|uncle)|her (?:father|mother|husband|sister))\b[^.?!]{0,20}?\b(?:pass|passed|passes|passing) away\b",
    ("pass away", 2): r"\b(?:customs?|days?|glory|beauty|colours?|colors?|things?|fashion|youth|hopes?|dreams?|sorrow|grief|world|summer)\b[^.?!]{0,25}?\b(?:pass|passed|passes|passing) away\b|\b(?:pass|passed|passes|passing) away\b[^.?!]{0,20}?\b(?:for ever|forever|like (?:a|the))\b",
    # turn on
    ("turn on", 1): r"\b(?:turn|turns|turned|turning) on\b[^.?!]{0,25}?\b(?:light|lights|lamp|gas|water|tap|radio|electric|fire|engine|power|steam)\b|\b(?:light|lights|lamp|gas|water|tap|radio|electric|power)\b[^.?!]{0,25}?\b(?:turn|turns|turned|turning) on\b",
    ("turn on", 2): r"\b(?:turn|turns|turned|turning) on\b\s+(?:whether|what|which|that|this|everything|the (?:answer|question|result|outcome|issue|whole|success|fate))\b|\b(?:turn|turns|turned|turning) on\b[^.?!]{0,20}?\b(?:whether|what|which)\b",
    ("turn on", 3): r"\b(?:turn|turns|turned|turning) on\b\s+(?:him|her|them|me|us|you)\b|\b(?:turn|turns|turned|turning) on\b[^.?!]{0,15}?\b(?:savagely|fiercely|like a|with a snarl|in a fury|tooth and nail)\b",
    ("turn on", 4): r"\b(?:turn|turns|turned|turning)\s+(?:him|her|them|me|you)\s+on\b",
    # break in
    ("break in", 1): r"\b(?:break|breaks|breaking|broke|broken) in\b[^.?!]{0,25}?\b(?:house|door|window|room|shop|office|premises|through (?:the|a)|thieves?|burglar|and (?:stole|robbed))\b",
    ("break in", 2): r"\b(?:break|breaks|breaking|broke|broken) in\b(?!\s+(?:the|a|an)\b)[^.?!]{0,20}?\b(?:on (?:him|her|them|us|the)|upon|with (?:a|the|his|her)|to (?:say|ask|remark|observe)|and (?:said|asked|cried|remarked))\b",
    ("break in", 3): r"\b(?:break|breaks|breaking|broke|broken) in\b[^.?!]{0,20}?\b(?:shoes?|boots?|horse|pony|colt|new (?:boy|man|hand|servant|assistant|recruit))\b",
    # put down
    ("put down", 1): r"\b(?:put|puts|putting) down\b[^.?!]{0,25}?\b(?:on (?:the|a|his|her) (?:table|desk|floor|ground|bed|chair|bench)|and (?:went|left|rose|turned|took|walked)|slowly|gently|carefully|the (?:book|paper|pen|glass|cup|box|bag|basket|parcel|letter|tray|knife|fork|spoon|dish|plate))\b",
    ("put down", 2): r"\b(?:put|puts|putting) down\b[^.?!]{0,20}?\b(?:in writing|on paper|in (?:his|her|the) (?:note-?book|diary|journal|book)|the (?:words|name|names|address|figure|figures|number|numbers|facts?|particulars?|account|detail|details|sum))\b|\b(?:name|names|address|figures?|particulars?|number|numbers)\b[^.?!]{0,20}?\b(?:put|puts|putting) down\b",
    ("put down", 3): r"\b(?:put|puts|putting) (?:him|her|them|me|you)\s+down\b|\b(?:put|puts|putting) down\b[^.?!]{0,20}?\bas (?:a|an)\b",
    ("put down", 4): r"\b(?:put|puts|putting) down\b[^.?!]{0,25}?\b(?:rebellion|revolt|rising|insurrection|mutiny|riots?|disturbance|revolution|disorder|uprising)\b",
    # get off
    ("get off", 1): r"\b(?:get|gets|getting|got|gotten) off\b[^.?!]{0,25}?\b(?:the (?:train|bus|car|boat|ship|horse|tram|cab|coach)|at (?:the|a) (?:station|stop|corner|next)|and (?:walked|went|ran|hurried))\b|\b(?:get|gets|getting|got|gotten) off\b\s*[,.;]",
    ("get off", 2): r"\b(?:get|gets|getting|got|gotten) off\b[^.?!]{0,25}?\b(?:work|duty|duties|early|at (?:noon|three|four|five|six)|from (?:work|duty)|to-?night)\b",
    ("get off", 3): r"\b(?:get|gets|getting|got|gotten) off\b[^.?!]{0,25}?\b(?:lightly|cheaply|easy|easily|with a (?:fine|caution)|without|this time|scot-?free)\b|\b(?:got|get) (?:him|her|them) off\b",
    ("get off", 4): r"\b(?:get|got) off\b[^.?!]{0,15}?\b(?:a|the|my|his|her|this|that) (?:letter|note|reply|answer|message|telegram)\b|\b(?:get|got) (?:the|a|his|her|this|that) \w+\b[^.?!]{0,10}?\boff\b",
    # pass on
    ("pass on", 1): r"\b(?:pass|passes|passed|passing) on\b[^.?!]{0,25}?\bto (?:him|her|them|me|you|us|another|the (?:girl|boy|man|woman|others|other|next))\b",
    ("pass on", 2): r"\b(?:pass|passes|passed|passing) on\b[^.?!]{0,25}?\b(?:knowledge|learning|wisdom|skill|skills|tradition|traditions|news|message|word|information|experience|teaching|teachings|secret|story|stories)\b",
    ("pass on", 3): r"\b(?:pass|passes|passed|passing) on\b[^.?!]{0,25}?\b(?:down the|along the|up the|through the|into the|and (?:went|continued|walked|rode|marched)|to (?:the|another) (?:subject|question|topic|matter|point|next))\b",
    ("pass on", 4): r"\b(?:pass|passes|passed|passing) on\b[^.?!]{0,25}?\b(?:peacefully|quietly|suddenly|yesterday|last (?:night|week|year)|and (?:was|were) buried|in (?:his|her) sleep|from (?:this|the) life)\b",
    # take away
    ("take away", 1): r"\b(?:take|takes|taking|took|taken) away\b[^.?!]{0,25}?\b(?:the (?:book|paper|cup|plate|letter|money|box|things?|lamp|dish|tray|basket|parcel)|and (?:carried|bore|put|hid))\b",
    ("take away", 2): r"\b(?:take|takes|taking|took|taken) away\b[^.?!]{0,20}?\bfrom (?:him|her|them|me|us|you)\b|\b(?:took|take|taken|takes) (?:it|this|that|\w+) away from\b",
    ("take away", 3): r"\b(?:take|takes|taking|took|taken) away from\b[^.?!]{0,25}?\b(?:the (?:effect|impression|pleasure|beauty|charm|value|merit|interest|credit)|its)\b",
    ("take away", 4): r"\b(?:take|took|taken|takes) away (?:food|meals?|dinner|supper|lunch)\b",
    # come through
    ("come through", 1): r"\b(?:come|comes|came|coming) through\b[^.?!]{0,25}?\b(?:the (?:war|battle|illness|fever|danger|storm|crisis|trial|trouble|ordeal|operation|fire|accident)|it all|safely|unharmed|alive|all right|with (?:his|her) life)\b",
    ("come through", 2): r"\b(?:come|comes|came|coming) through\b[^.?!]{0,15}?\bwith\b",
    ("come through", 3): r"\b(?:come|comes|came|coming) through\b[^.?!]{0,25}?\b(?:the (?:window|door|wall|roof|keyhole|curtain|gate|barrier)|glass|mist|fog|darkness)\b",
    ("come through", 4): r"\b(?:come|comes|came|coming) through\b[^.?!]{0,25}?\b(?:the (?:post|mail|wire)|by (?:post|mail|wire)|from (?:the|head) (?:office|quarters)|at (?:last|length)|this (?:morning|evening))\b",
    # carry on
    ("carry on", 1): r"\b(?:carry|carries|carried|carrying) on\b[^.?!]{0,20}?\b(?:with (?:his|her|their) (?:work|duties|talk|business)|as (?:if|though)|and (?:finished|completed)|the (?:work|business|war|conversation|discussion|study|practice|habit)|doing)\b",
    ("carry on", 2): r"\b(?:carry|carries|carried|carrying) on\b[^.?!]{0,20}?\b(?:saying|speaking|his (?:speech|talk|story|sentence)|her (?:speech|talk|story)|to (?:say|tell|remark|explain)|the (?:story|tale))\b",
    ("carry on", 3): r"\b(?:carry|carries|carried|carrying) on\b[^.?!]{0,20}?\b(?:business|trade|bank|farm|shop|establishment|manufactory|works|the (?:business|trade|farm|shop))\b",
    ("carry on", 4): r"\b(?:carry|carries|carried|carrying) on\b[^.?!]{0,30}?\b(?:an? (?:flirtation|intrigue|liaison)|with (?:a|the|his|her|their|some)(?: \w+){0,2} (?:boys?|girls?|men|women|man|woman|foreigner|ladies|lady|gentleman|wife|husband))\b",
    # shut up
    ("shut up", 1): r"\bshut up\b\s*[!]|\b(?:shut|shuts|shutting) up\b[^.?!]{0,15}?\b(?:and (?:listened|be quiet|go to sleep)|for (?:goodness|heaven|pity)|will you|now)\b",
    ("shut up", 2): r"\b(?:shut|shuts|shutting) (?:him|her|them|me|you|the \w+) up\b(?!\s*(?:in|into|within)\b)",
    ("shut up", 3): r"\b(?:be|is|are|was|were|being|been)\s+shut up\b|\b(?:shut|shuts|shutting) (?:him|her|them|me|you|it|the \w+) up\b[^.?!]{0,15}?\b(?:in|into|within)\b|\b(?:shut|shuts|shutting) up\b[^.?!]{0,20}?\b(?:the (?:house|shop|room|door|office|school|church)|for the (?:night|winter|summer)|and (?:left|went|abandoned|deserted))\b",
    # break down
    ("break down", 1): r"\b(?:break|breaks|breaking|broke|broken) down\b[^.?!]{0,25}?\b(?:bridge|machine|machinery|engine|motor|car|cart|wagon|train|apparatus|telephone|instrument|works|and (?:could not|would not)|under the (?:strain|weight))\b|\b(?:the|a) (?:bridge|machine|machinery|engine|car|cart|wagon)\b[^.?!]{0,20}?\b(?:break|breaks|breaking|broke|broken) down\b",
    ("break down", 2): r"\b(?:break|breaks|breaking|broke|broken) down\b[^.?!]{0,25}?\b(?:and (?:wept|cried|sobbed)|in tears|into tears|with grief|with sorrow|completely|utterly|when (?:he|she) heard)\b",
    ("break down", 3): r"\b(?:break|breaks|breaking|broke|broken) down\b[^.?!]{0,25}?\b(?:into (?:its|their|component|parts|elements)|the (?:argument|problem|subject|matter|question|cost|figures|numbers)|analysis|and (?:analyzed|analysed|examined))\b",
    ("break down", 4): r"\b(?:break|breaks|breaking|broke|broken) down\b[^.?!]{0,25}?\b(?:from (?:overwork|fatigue|exhaustion|want of sleep)|under the strain|with fatigue|from the strain|in (?:health|body)|quite broken down|physically (?:weak|ill)|broken down (?:by|with) (?:age|illness|grief|work|sorrow))\b|\b(?:quite|completely|utterly) broken down\b|\bphysically (?:weak|ill)\b[^.?!]{0,10}?\bbroken down\b",
    ("break down", 5): r"\b(?:break|breaks|breaking|broke|broken) down\b[^.?!]{0,25}?\b(?:food|substance|matter|cells?|tissue|flesh|body|into (?:its|their) (?:elements|constituents)|by (?:bacteria|action|the (?:juices|secretions)))\b|\b(?:cells?|tissue|substance|food|matter)\b[^.?!]{0,70}?\b(?:break|breaks|breaking|broke|broken) down\b",
    # bring in
    ("bring in", 1): r"^(?!.*\b(?:bring|brings|bringing|brought) in\b[^.?!]{0,25}?\b(?:money|profit|profits|income|rent|revenue|returns|gains?|fortune|thousands|hundreds|pounds|dollars|cents?|pence|shillings?|guineas?|francs?|marks?|gold|a (?:good|fine|large) (?:sum|profit))\b)(?!.*\b(?:bring|brings|bringing|brought) in\b[^.?!]{0,25}?\b(?:a (?:good|fine|high|fair) price|at (?:auction|sale)|when sold)\b)(?!.*\b(?:bring|brings|bringing|brought) in\b[^.?!]{0,20}?\b(?:a verdict|the verdict|a true bill|an indictment)\b).*\b(?:bring|brings|bringing|brought) in\b",
    ("bring in", 2): r"\b(?:bring|brings|bringing|brought) in\b[^.?!]{0,25}?\b(?:money|profit|profits|income|rent|revenue|returns|gains?|fortune|thousands|hundreds|pounds|dollars|cents?|pence|shillings?|guineas?|francs?|marks?|gold|a (?:good|fine|large) (?:sum|profit))\b",
    ("bring in", 3): r"\b(?:bring|brings|bringing|brought) in\b[^.?!]{0,25}?\b(?:a (?:good|fine|high|fair) price|at (?:auction|sale)|when sold)\b",
    ("bring in", 4): r"\b(?:bring|brings|bringing|brought) in\b[^.?!]{0,20}?\b(?:a verdict|the verdict|a true bill|an indictment)\b",
    # come across
    ("come across", 1): r"\b(?:come|comes|came|coming) across\b[^.?!]{0,25}?\b(?:a (?:book|letter|paper|photograph|picture|word|name|friend|man|woman|house|village|case|story|passage)|an old|the (?:name|word|book|letter|papers))\b",
    ("come across", 2): r"\b(?:come|comes|came|coming) across\b[^.?!]{0,15}?\bas\b",
    ("come across", 3): r"\b(?:come|comes|came|coming) across\b\s+(?:well|badly|clearly|strongly)\b|\b(?:come|comes|came|coming) across\b[^.?!]{0,20}?\bto the (?:reader|audience|public)\b",
    # go along
    ("go along", 1): r"\b(?:go|goes|going|went|gone) along with\b[^.?!]{0,10}?\b(?:him|her|me|us|you|them|the (?:party|others))\b",
    ("go along", 2): r"\b(?:go|goes|going|went|gone) along with\b[^.?!]{0,25}?\b(?:the (?:plan|proposal|scheme|idea|arrangement|suggestion|notion|fashion|times|crowd)|his (?:plan|proposal|idea)|her (?:plan|proposal|idea))\b",
    ("go along", 3): r"\b(?:go|goes|going|went|gone) along\b[^.?!]{0,25}?\b(?:nicely|well|smoothly|as (?:usual|before)|the (?:road|street|river|path|passage|shore|bank)|and (?:sang|whistled|talked))\b",
    # run through
    ("run through", 1): r"\b(?:run|runs|running|ran) through\b[^.?!]{0,25}?\b(?:the (?:list|names?|accounts?|figures|items?|letter|pages?|book|report|details?)|quickly|rapidly|hastily)\b",
    ("run through", 2): r"\b(?:run|runs|running|ran) through\b[^.?!]{0,25}?\b(?:his (?:body|heart|arm|shoulder|leg)|her (?:body|heart)|the (?:body|heart)|with (?:a|his|her) (?:sword|sabre|blade|spear|knife|bayonet)|clean through)\b",
    ("run through", 3): r"\b(?:run|runs|running|ran) through\b[^.?!]{0,25}?\b(?:his (?:fortune|money|property|patrimony|estate|income)|her (?:fortune|money|property)|a (?:fortune|large sum)|the (?:money|estate|whole))\b",
    ("run through", 4): r"\b(?:run|runs|running|ran) through\b[^.?!]{0,25}?\b(?:the (?:argument|plan|scheme|matter|question|story|scene)|in (?:his|her) mind|again|once more|over (?:again|in))\b",
    # get down
    ("get down", 1): r"\b(?:get|gets|getting|got|gotten) down\b[^.?!]{0,25}?\b(?:from (?:the|his|her|a)|the (?:ladder|tree|horse|stairs|steps|wall)|on (?:his|her|the) (?:knees|hands)|and (?:crept|crawled|ran|walked)|to (?:the|his|her|a) (?:river|village|town|shore|sea|station|inn|state-room|bank|garden|beach|stream|water))\b",
    ("get down", 2): r"\b(?:get|got|gets|getting) down\b[^.?!]{0,20}?\b(?:the (?:pill|medicine|dose|food|dinner|breakfast|supper|milk|bread)|and (?:swallowed|eaten|eat))\b",
    ("get down", 3): r"\b(?:get|gets|getting|got|gotten) down\b[^.?!]{0,25}?\b(?:his (?:name|address|words|number)|her (?:name|address)|the (?:name|address|words|figures|facts?|particulars?|statement)|in writing|on paper)\b",
    ("get down", 4): r"\b(?:get|gets|getting|got|gotten) (?:him|her|them|me|you) down\b|\b(?:it|this|that|the (?:weather|news|business))\b[^.?!]{0,15}?\b(?:gets|got|getting|get)\b[^.?!]{0,10}?\b(?:him|her|them|me|you|one) down\b",
    ("get down", 5): r"\b(?:get|gets|getting|got|gotten) down to\b[^.?!]{0,20}?\b(?:work|business|brass tacks|the (?:work|business|task|job)|hard work|serious|it)\b",
    # stand out
    ("stand out", 1): r"\b(?:stand|stands|standing|stood) out\b[^.?!]{0,25}?\b(?:against (?:the|a) (?:sky|background|dark|snow|wall|fog)|in (?:the|a) (?:relief|distance)|clearly|sharply|plainly|like a)\b",
    ("stand out", 2): r"\b(?:stand|stands|standing|stood) out\b[^.?!]{0,25}?\b(?:from (?:the|his|her|all)|among|above (?:all|the|his|her)|as (?:a|the)|in (?:the|his|her) (?:class|profession|age|generation))\b",
    ("stand out", 3): r"\b(?:stand|stands|standing|stood) out\b[^.?!]{0,25}?\b(?:for (?:his|her|their|the|what)|against (?:him|her|them|us|the (?:crowd|world|majority|authority|government|current)))\b",
    # pull out
    ("pull out", 1): r"\b(?:pull|pulls|pulling|pulled) out\b[^.?!]{0,25}?\b(?:his (?:handkerchief|watch|knife|purse|pistol|revolver|pipe|pencil|note-?book|sword)|her (?:handkerchief|purse|knife)|the (?:stopper|cork|drawer|nail|tooth|key|letter|paper)|of (?:his|her|the) (?:pocket|bag|drawer|coat))\b",
    ("pull out", 2): r"\b(?:pull|pulls|pulling|pulled) out\b[^.?!]{0,25}?\b(?:the (?:train|boat|carriage|car|ship)|of (?:the|a) (?:station|harbour|harbor|port|river|bay)|from (?:the|a) (?:station|shore|harbour|harbor|port))\b",
    ("pull out", 3): r"\b(?:pull|pulls|pulling|pulled) out\b[^.?!]{0,20}?\bof (?:the|a) (?:business|firm|concern|scheme|project|company|society|party|contract|arrangement|enterprise|war)\b",
    ("pull out", 4): r"\b(?:pull|pulls|pulling|pulled) out\b[^.?!]{0,20}?\b(?:the (?:information|facts?|points?|meaning|sense|figures)|of (?:him|her|the) (?:information|story))\b",
    # pass out
    ("pass out", 1): r"\b(?:pass|passes|passed|passing) out\b[^.?!]{0,25}?\b(?:from (?:loss|want|the heat|weakness)|with (?:pain|the heat)|in (?:the|a) (?:street|church|crowd)|and (?:fell|fainted)|on (?:the|a) (?:floor|ground|spot))\b",
    ("pass out", 2): r"\b(?:pass|passes|passed|passing) out\b[^.?!]{0,25}?\b(?:the (?:books|papers|copies|leaflets|bills|cards|tracts|bread|portions|supplies|rations|ammunition)|by (?:the|his|her) (?:hands))\b",
    ("pass out", 3): r"\b(?:pass|passes|passed|passing) out\b[^.?!]{0,25}?\b(?:of (?:the|a) (?:college|academy|school|university)|with (?:honours|honors|honour|honor|distinction|first class))\b",
    # bring back
    ("bring back", 1): r"\b(?:bring|brings|bringing|brought) back\b[^.?!]{0,25}?\b(?:the (?:book|paper|money|letter|parcel|thing|things|horse|carriage)|from (?:the|his|her|a)|to (?:me|him|her|them|the)|and (?:gave|handed|put))\b",
    ("bring back", 2): r"\b(?:bring|brings|bringing|brought) (?:him|her|them|me|you|the \w+) back\b[^.?!]{0,15}?\b(?:to life|to consciousness|to (?:his|her) senses|with brandy|with water)\b|\bbrought (?:him|her|them) back to life\b",
    ("bring back", 3): r"\b(?:bring|brings|bringing|brought) back\b[^.?!]{0,25}?\b(?:memories?|the memory|recollections?|the (?:past|old days|old times|days)|to (?:my|his|her) (?:mind|memory)|and (?:reminded|recalled))\b",
    # come forward
    ("come forward", 1): r"\b(?:come|comes|came|coming) forward\b[^.?!]{0,25}?\b(?:to (?:help|say|state|declare|explain|give|testify|assert|swear)|and (?:declared|stated|explained|told))\b",
    ("come forward", 2): r"\b(?:come|comes|came|coming) forward\b[^.?!]{0,25}?\b(?:with (?:information|evidence|proof|help|a (?:statement|proposal)|the (?:facts?|truth))|and (?:volunteered|offered))\b",
    # move in
    ("move in", 1): r"\b(?:move|moves|moving|moved) in\b[^.?!]{0,25}?\b(?:to (?:the|a|his|her|their)|into (?:the|a|his|her|their)|next (?:week|month|door)|with (?:us|them|his|her)|and (?:settled|lived))\b",
    ("move in", 2): r"\b(?:move|moves|moving|moved) in\b[^.?!]{0,25}?\b(?:on (?:him|her|them|us)|upon|and (?:occupied|took) (?:the|his|her)|troops|police|army|soldiers)\b",
    # move on
    ("move on", 1): r"\b(?:move|moves|moving|moved) on\b[^.?!]{0,20}?\b(?:and (?:reached|arrived|left|went|marched|rode|walked)|along|down|up|through|in (?:the|a) (?:direction|silence)|behind|again|slowly|presently|silently|painfully|at last|to (?:his|her|their) (?:home|house|village|destination)|on (?:the|his|her) (?:hinges|journey|way))\b|\b(?:move|moves|moving|moved) on\b\s*[,.;!]",
    ("move on", 2): r"\b(?:move|moves|moving|moved) on\b[^.?!]{0,25}?\b(?:to (?:another|the next) (?:subject|question|topic|matter|stage|chapter|item)|from (?:the|this|that) (?:subject|question|topic|matter))\b",
    # pass by
    ("pass by", 1): r"\b(?:pass|passes|passed|passing) by\b[^.?!]{0,25}?\b(?:the (?:house|door|window|shop|church|gate|garden|road|street)|his (?:house|door|window)|her (?:house|door|window)|on the (?:other|far) side)\b",
    ("pass by", 2): r"\b(?:pass|passes|passed|passing) (?:him|her|them|me|us|you) by\b|\b(?:life|fortune|fame|happiness|glory|opportunity|chance|luck|world)\b[^.?!]{0,20}?\b(?:pass|passed|passes|passing) (?:him|her|them|me|us|you)\b",
    # set down
    ("set down", 1): r"\b(?:set|sets|setting) down\b[^.?!]{0,25}?\b(?:the (?:basket|box|bag|parcel|cup|glass|book|paper|lamp|tray|pitcher|jar|can)|his (?:burden|load|pack)|on (?:the|a) (?:table|floor|ground|step|doorstep))\b",
    ("set down", 2): r"\b(?:set|sets|setting) down\b[^.?!]{0,25}?\b(?:the (?:facts?|words|name|names|particulars?|figures|account|story|details?|reasons?|terms)|in writing|on paper|in (?:his|her|the) (?:note-?book|diary|book))\b",
    ("set down", 3): r"\b(?:set|sets|setting) (?:him|her|them|me|you|the \w+) down\b[^.?!]{0,20}?\b(?:at (?:the|his|her)|near|before (?:the|his|her)|in (?:the|a) (?:road|street|square|village))\b",
    # accompany by
    ("accompany by", 1): r"\baccompan(?:y|ies|ied|ying)\s+by\b(?!\s+(?:the\s+)?(?:piano|orchestra|music|violin|guitar|flute|organ|band|harp|choir)\b)",
    ("accompany by", 2): r"\baccompan(?:y|ies|ied|ying)\s+by\s+(?:the\s+)?(?:piano|orchestra|music|violin|guitar|flute|organ|band|harp|choir)\b",
    # hang on
    ("hang on", 1): r"\b(?:hang|hangs|hanging|hung) on\b[^.?!]{0,20}?\b(?:to (?:the|his|her|a)|by (?:his|her|the) (?:hands|teeth)|tight|desperately|for (?:his|her|dear) life)\b",
    ("hang on", 2): r"\bhang on\b\s*[!,]|\b(?:hang|hangs|hanging|hung) on\b[^.?!]{0,15}?\b(?:a (?:minute|moment|second)|till (?:I|we)|while (?:I|we))\b",
    ("hang on", 3): r"\b(?:hang|hangs|hanging|hung) on\b[^.?!]{0,20}?\b(?:till|until|to the (?:end|last)|and (?:won|survived|endured)|bravely|patiently)\b",
    ("hang on", 4): r"\b(?:hang|hangs|hanging|hung) on\b[^.?!]{0,20}?\b(?:whether|what|how|his (?:life|fate|future)|her (?:life|fate)|the (?:answer|whole|result|question|issue))\b",
    # take on
    ("take on", 1): r"\b(?:take|takes|taking|took|taken) on\b[^.?!]{0,25}?\b(?:the (?:work|duty|duties|task|job|responsibility|responsibilities|office|charge|burden|cares|care|management|business)|his (?:duties|duty|share|part)|her (?:duties|duty|share|part)|a (?:new|fresh) (?:task|duty|job))\b",
    ("take on", 2): r"\b(?:take|takes|taking|took|taken) on\b[^.?!]{0,25}?\b(?:a (?:new|different|strange|sombre|sober|grave|darker|brighter) (?:form|aspect|look|air|meaning|character|colour|color|complexion)|the (?:aspect|appearance|form|colour|color|complexion|likeness) of|an (?:aspect|air))\b",
    ("take on", 3): r"\b(?:take|takes|taking|took|taken) on\b[^.?!]{0,25}?\b(?:men|hands|workmen|clerks|servants|employees|staff|labourers|laborers|a (?:new|young) (?:man|clerk|assistant|servant))\b",
    ("take on", 4): r"\b(?:take|takes|taking|took|taken) on\b[^.?!]{0,25}?\b(?:a (?:stronger|younger|bigger|tougher)|the (?:champion|best|whole)|an opponent)\b",
    # absorb in
    ("absorb in", 1): r"\babsorb(?:s|ed|ing)?\b[^.?!]{0,10}?\bin\b[^.?!]{0,20}?\b(?:his (?:book|work|study|thoughts|meditations)|her (?:book|work|study|thoughts)|the (?:book|work|game|conversation|subject)|thought|reading|what)\b|\bbe(?:ing|s|en)?\s+absorb(?:s|ed)?\b[^.?!]{0,10}?\bin\b",
    # ===== 块 B″ 第五批（2026-10-10 十六续 · 30 词）=====
    # get through
    ("get through", 1): r"\b(?:get|gets|getting|got|gotten) through\b[^.?!]{0,25}?\b(?:the work|his work|her work|their work|my work|a vast amount of work|the business|the job|the task|the letter|the letters|the correspondence|his lesson|the lessons|the meal|the breakfast|things?)\b|\b(?:work|business|job|task|letters?|lessons?|things?)\b[^.?!]{0,20}?\b(?:get|gets|getting|got|gotten) through\b",
    ("get through", 2): r"\b(?:get|gets|getting|got|gotten) through\b[^.?!]{0,25}?\b(?:the exam|an exam|exams|the test|the examination|the interview|the scrutiny|the ordeal)\b|\b(?:exam|exams|examination|test)\b[^.?!]{0,25}?\b(?:get|gets|getting|got|gotten) through\b",
    ("get through", 3): r"\b(?:get|gets|getting|got|gotten) through\b[^.?!]{0,12}?\b(?:the door|the doorway|the window|the wall|the gate|the opening|the hole|the bars|the belt of trees|the crowd|the passage)\b",
    ("get through", 4): r"\b(?:get|gets|getting|got|gotten) through\b[^.?!]{0,25}?\b(?:the (?:summer|winter|day|days|night|week|month|year|evening|meal|afternoon|desolation|rest of|whole)|three more minutes)\b",
    ("get through", 5): r"\b(?:telephone|phone|wire|exchange|operator|the line)\b[^.?!]{0,25}?\b(?:get|gets|getting|got|gotten) through\b|\b(?:get|gets|getting|got|gotten) through\b[^.?!]{0,20}?\b(?:telephone|phone|wire|exchange|operator)\b",
    # run over
    ("run over", 1): r"\b(?:get|got|gets|gotten|been|being|be|was|were|is|are)\s+run over\b|\b(?:run|runs|running|ran) over\b[^.?!]{0,25}?\b(?:his|her|my|your|their|a|the) (?:hand|foot|legs?|dog|child|children|man|woman|boy|girl|people|pedestrian|wife|husband|horse)\b|\bstreet car\b[^.?!]{0,25}?\brun over\b",
    ("run over", 2): r"\b(?:run|runs|running|ran) over\b[^.?!]{0,12}?\b(?:the brim|the edge|the sides?|the top|the pot|its banks|the banks)\b",
    ("run over", 3): r"\b(?:run|runs|running|ran) over\b[^.?!]{0,20}?\b(?:the (?:pages?|leaves|list|course of events|vocabulary|details?|catalogue|facts?|points?|story|scene|speech|account|possibilities|picture|names)|in (?:his|her|my|their) mind|again|once more)\b|\b(?:mind|memory)\b[^.?!]{0,20}?\bran over\b",
    # look through
    ("look through", 1): r"\b(?:look|looks|looking|looked) through\b[^.?!]{0,20}?\b(?:papers?|files?|desk|drawers?|letters?|books?|pages?|accounts?|documents?|magazines?|chest|prospectus|the (?:papers|files|desk|drawers|letters|books|pages|accounts|documents))\b",
    ("look through", 2): r"\b(?:look|looks|looking|looked) through\b[^.?!]{0,12}?\b(?:her|him|me|his (?:soul|disguise)|her (?:soul|disguise)|the (?:disguise|pretence)|with (?:a )?contempt)\b",
    ("look through", 3): r"\b(?:look|looks|looking|looked) through\b[^.?!]{0,12}?\b(?:the (?:windows?|glass|panes?|keyhole|key-hole|telescope|bars|grating|perforations|observation-trap|opening)|into the)\b",
    # come off
    ("come off", 1): r"\b(?:come|comes|came|coming) off\b[^.?!]{0,20}?\b(?:his|her|my|your|its|their|the) (?:hats?|caps?|coats?|cloaks?|shoes?|boots?|beards?|wigs?|hair|buttons?|pieces?|covers?|lids?|labels?|handles?|knobs?|wheels?|papers?|paint|varnish|plaster|roof|tiles?|hinges?|verdigris|spectacles)\b|\b(?:hats?|caps?|shoes?|boots?|coats?|cloaks?|pieces?|covers?|lids?|buttons?|wheels?|handles?|beards?|wigs?|stockings?|pedals?|verdigris|chemicals?)\b[^.?!]{0,20}?\b(?:come|comes|came|coming) off\b|\b(?:coming|came|come|comes) off\b[^.?!]{0,8}?\b(?:the (?:ground|fire)|in (?:patches|flakes|powder|powdery flakes))\b|\b(?:have|has|had) to come off\b|\bgot to come off\b|\bwon[\u2019\x27]t come off\b",
    ("come off", 2): r"\b(?:come|comes|came|coming) off\b[^.?!]{0,15}?\b(?:well|badly|best|worst|unscathed|victorious|victory|triumph|discreditably|with (?:honours?|credit|such)|none the worse|second best|warm and nervous)\b|\bcame off not altogether discreditably\b",
    ("come off", 3): r"\b(?:come|comes|came|coming) off\b[^.?!]{0,25}?\b(?:soon|to-?night|to-?morrow|next (?:week|month)|when convenient|that (?:day|night))\b|\b(?:marriage|wedding|drive|match|fight|race|ceremony|event|party|things?|miracle)\b[^.?!]{0,30}?\b(?:come|comes|came|coming) off\b|\bit (?:came|comes|will) off\b",
    # get along
    ("get along", 1): r"\b(?:get|gets|getting|got|gotten) along\b[^.?!]{0,15}?\b(?:with (?:my|his|her|their|your|the|one|him|her|them|us|people|me|Grey|each other)|together)\b",
    ("get along", 2): r"\b(?:get|gets|getting|got|gotten) along\b[^.?!]{0,12}?\b(?:all right|well|fine|nicely|better|splendidly|pretty|enough|without)\b|\bhow\b[^.?!]{0,20}?\b(?:get|gets|getting|got) along\b",
    ("get along", 3): r"\bget along (?:to bed|to|home|now|with you|with ye)\b|\bget along\b\s*!",
    # see through
    ("see through", 1): r"\b(?:see|sees|seeing|saw|seen) through\b[^.?!]{0,12}?\b(?:me|him|her|them|us|you|it|his (?:disguise|hollowness)|the (?:disguise|hollowness|sham|trick|plot|scheme|pretence|manouevre|maneuver)|such (?:thick-headed )?nonsense)\b",
    ("see through", 2): r"\bsee (?:him|her|me|them|us|you) through\b[^.?!]{0,25}?\b(?:the|this|it)\b",
    ("see through", 3): r"\bsee (?:it|the (?:business|matter|thing|job|affair|work)) through\b",
    # throw out
    ("throw out", 1): r"\b(?:throw|throws|throwing|threw|thrown) out\b[^.?!]{0,12}?\b(?:to be eaten|a bag|the bag|an empty|the rubbish|ballast|bottles?|bones|ashes|rubbish|refuse|to sea|overboard)\b",
    ("throw out", 2): r"\b(?:throw|throws|throwing|threw|thrown) out\b[^.?!]{0,10}?\b(?:of (?:work|his (?:cabin|job|place|position)|the (?:cabin|house|room|office|club|job))|of doors)\b",
    ("throw out", 3): r"\b(?:throw|throws|throwing|threw|thrown) out\b[^.?!]{0,12}?\b(?:hints?|a hint|suggestions?|a suggestion|an idea|the casual formula|oblique|some (?:hints|suggestions)|a proposal|a challenge)\b|\bhints?\b[^.?!]{0,15}?\b(?:thrown|threw|throw|throwing) out\b",
    ("throw out", 4): r"\b(?:throw|throws|throwing|threw|thrown) out\b[^.?!]{0,12}?\b(?:the (?:case|suit|claim|indictment|bill))\b",
    ("throw out", 5): r"\b(?:throw|throws|throwing|threw|thrown) out\b[^.?!]{0,12}?\b(?:of (?:office|the office|power))\b",
    # throw up
    ("throw up", 1): r"\b(?:throw|throws|throwing|threw|thrown) up\b[^.?!]{0,12}?\b(?:his (?:dinner|breakfast|supper|lunch|food)|violently|the contents|everything he had eaten)\b|\bsea-?sick\b",
    ("throw up", 2): r"\b(?:throw|throws|throwing|threw|thrown) up\b[^.?!]{0,12}?\b(?:hands?|arms?|head|brow|eyes?|veil|sash|shoulders?)\b|\b(?:hands?|arms?)\b[^.?!]{0,10}?\b(?:threw|thrown|throw) up\b",
    ("throw up", 3): r"\b(?:throw|throws|throwing|threw|thrown) up\b[^.?!]{0,12}?\b(?:the (?:sponge|case|business|College|job|position|place|situation|practice)|his (?:chances|position|job|place|practice|profession|reporting)|everything|it all)\b|\bthrow up the sponge\b",
    # affected by
    ("affected by", 1): r"^(?!.*\b(?:deeply|much|profoundly|greatly|strongly|sensibly|honestly|terribly|so|visibly)\s+(?:affected|touched|moved) by\b).*\b(?:affected|affects?|affecting) by\b",
    ("affected by", 2): r"\b(?:deeply|much|profoundly|greatly|strongly|sensibly|honestly|terribly|so|visibly)\s+(?:affected|touched|moved) by\b|\baffected by\b[^.?!]{0,20}?\b(?:feeling|emotion|grief|sorrow|tears|kindness|forgiveness)\b",
    # take down
    ("take down", 1): r"\b(?:take|takes|taking|took|taken) down\b[^.?!]{0,15}?\b(?:a (?:heavy |square |new )?(?:volume|book|jar|bottle|roll|life-preserver)|his (?:hat|coat|overcoat|rifles?|drink|wig)|the (?:Blue Book|wig|packet|box)|from (?:his|the|one of the) (?:shelves|wall|rack|cupboard))\b",
    ("take down", 2): r"\b(?:take|takes|taking|took|taken) down\b[^.?!]{0,18}?\b(?:his (?:speech|words|narrative)|verbatim|note-?book|names?|the (?:names?|words|account|evidence|statement|particulars|addresses)|what he wants)\b|\b(?:words|speech|account|names?|evidence)\b[^.?!]{0,20}?\b(?:taken|took|take) down\b",
    ("take down", 3): r"\b(?:take|takes|taking|took|taken) down\b[^.?!]{0,12}?\b(?:the (?:tent|house|building|wall|fence|gate|board|scaffolding))\b",
    ("take down", 4): r"\b(?:take|takes|taking|took|taken) (?:him|her|them|me|us|you) down\b|\bdown a peg\b|\ba peg\b",
    # wear out
    ("wear out", 1): r"\b(?:wear|wears|wearing|wore|worn) out\b[^.?!]{0,15}?\b(?:clothes|clothing|coat|dress|boots?|shoes?|gloves|soles|knees|elbows|stockings|linen|foot-gear|things)\b|\b(?:clothes|boots?|shoes?|coat|dress|garment|things)\b[^.?!]{0,12}?\b(?:worn|wore|wear) out\b",
    ("wear out", 2): r"\b(?:am|is|are|was|were|be|been|being|feel|look|seem)\b[^.?!]{0,12}?\b(?:quite |nearly |utterly |sore |fairly )?worn out\b|\bworn out (?:with|by)\b|\b(?:fully |quite |nearly )worn out\b",
    ("wear out", 3): r"\b(?:wear|wears|wearing|wore|worn) out\b[^.?!]{0,15}?\b(?:every one|furniture|his (?:civilities|information)|its (?:use|usefulness)|their (?:use|usefulness))\b|\bworn out of\b",
    # catch up
    ("catch up", 1): r"\b(?:catch|catches|catching|caught) up\b[^.?!]{0,15}?\b(?:with (?:him|her|me|them|us|you|the|one)|to (?:the|him|her|them|us))\b",
    ("catch up", 2): r"\b(?:catch|catches|catching|caught) up\b[^.?!]{0,15}?\b(?:that additional|the (?:news|work|reading|studies|lessons|sleep|arrears)|his (?:work|reading|studies)|her (?:work|reading|studies)|on the)\b",
    # throw away
    ("throw away", 1): r"\b(?:throw|throws|throwing|threw|thrown) away\b[^.?!]{0,15}?\b(?:the (?:paper|papers|newspaper|rubbish|refuse|ashes|bones|stones?|crumbs?|letters?|clothes|photographs)|rubbish|away)\b|\b(?:photographs?|refuse|rubbish|foot-gear|newspapers?|papers?|clothes|ashes|bones|letters?|things?)\b[^.?!]{0,25}?\b(?:throw|throws|throwing|threw|thrown) away\b",
    ("throw away", 2): r"\b(?:throw|throws|throwing|threw|thrown) away\b[^.?!]{0,15}?\b(?:money|fortune|chance|opportunit|life|lives?|health|happiness|youth|talent|time|trouble|everything|good|talents?)\b",
    # work on
    ("work on", 1): r"\b(?:work|works|working|worked|wrought) on\b[^.?!]{0,20}?\b(?:the (?:land|farm|addition|newspaper|book|subject|case|problem|firm|thing|knocker|line|lines)|his (?:book|work|play|novel|garden|land)|a (?:newspaper|book|farm|novel|play)|my (?:work|day's work)|fiction|it now)\b",
    ("work on", 2): r"\b(?:work|works|working|worked|wrought) on\b[^.?!]{0,15}?\b(?:muslin|canvas|metal|iron|stone|marble|wood|clay|gold|silver|material|the (?:metal|iron|stone|marble|wood|clay|gold|silver|material|ground|soil))\b",
    ("work on", 3): r"\b(?:work|works|working|worked|wrought) (?:on|upon)\b[^.?!]{0,12}?\b(?:him|her|me|them|us|you|his (?:mind|nerves|feelings|sympathy|heart)|her (?:mind|feelings|heart)|the (?:man|mind|mob|old))\b|\bworked (?:on|upon) (?:him|her|me|them)\b",
    # keep out
    ("keep out", 1): r"\b(?:keep|keeps|keeping|kept) out\b[^.?!]{0,12}?\b(?:the (?:pictures|curious|storm|frost|fumes|noise|cold|dust|wind|water|enemy|evil)|an evil|this frost|the tempestuous|photos)\b|\b(?:keep|keeps|keeping|kept) (?:the|them|him|her|it) out\b",
    ("keep out", 2): r"\b(?:keep|keeps|keeping|kept) out of\b",
    # run after
    ("run after", 1): r"\b(?:run|runs|running|ran) after\b[^.?!]{0,15}?\b(?:with the (?:rope|stick)|and frighten|to catch|and caught|for about a hundred yards|crying like a baby)\b|\bcame running after\b|\bran after him\b[^.?!]{0,10}?\b(?:with|for|and)\b",
    ("run after", 2): r"\b(?:run|runs|running|ran) after\b[^.?!]{0,20}?\b(?:satisfaction|happiness|pleasure|money|fashion|new|officers|neighbours|girls|women|men|fortune|success|something|a husband|a wife|another)\b",
    # pick out
    ("pick out", 1): r"\b(?:pick|picks|picking|picked) out\b[^.?!]{0,15}?\b(?:for (?:her|him|them|you)|what you want|your (?:clothes|way)|a (?:shady )?place|the (?:good|best|new|right|particular|silver|green|post|part)|any|one who|favourites)\b",
    ("pick out", 2): r"\b(?:pick|picks|picking|picked) out\b[^.?!]{0,15}?\b(?:stars?|in points of|the (?:path|figure|outline|shape)|at regular intervals|in the (?:dark|distance))\b",
    # step in
    ("step in", 1): r"\bstep(?:s|ped|ping)? in\b[^.?!]{0,20}?\b(?:to (?:take|save|prevent|stop|help|check|put)|legislature|government|Heaven|Providence|the law|court|authorities)\b",
    ("step in", 2): r"\bstep(?:s|ped|ping)? in\b[^.?!]{0,15}?\b(?:for (?:him|her|me|them|us|you)|as a substitute)\b",
    # work out
    ("work out", 1): r"\b(?:work|works|working|worked|wrought) out\b[^.?!]{0,15}?\b(?:problems?|sums?|calculations?|prices?|the (?:cost|amount|figures?|total|law)|demonstrations?)\b",
    ("work out", 2): r"\b(?:work|works|working|worked|wrought) out\b[^.?!]{0,20}?\b(?:scheme|plan|method|system|forms?|the (?:scheme|plan|method|system)|a (?:plan|scheme|method)|salvation)\b",
    ("work out", 3): r"\b(?:work|works|working|worked|wrought) out\b[^.?!]{0,20}?\b(?:problem|meaning|thoughts?|riddle|puzzle|mystery|for (?:myself|himself|herself|yourself)|just how|which)\b",
    ("work out", 4): r"\b(?:work|works|working|worked|wrought) out\b[^.?!]{0,15}?\b(?:right|well|badly|of themselves|all right|in the end|somehow|dangerously|to (?:its|the) end)\b|\bas it worked out\b|\bhow it will work out\b|\bthings work out\b",
    ("work out", 5): r"\bworked out\b[^.?!]{0,20}?\b(?:in (?:a|the) (?:gym|gymnasium)|for exercise|to keep fit)\b",
    # break through
    ("break through", 1): r"\b(?:break|breaks|breaking|broke|broken) through\b[^.?!]{0,15}?\b(?:the (?:wall|ice|crust|barrier|barriers|line|lines|bounds|defences|defenses|door|window|ribs|bulkhead|feud|reticence|sham|snow)|into the ring)\b",
    ("break through", 2): r"\b(?:break|breaks|breaking|broke|broken) through\b[^.?!]{0,20}?\b(?:manner|defences of|attitude|shyness|habit|habits)\b",
    ("break through", 3): r"\b(?:break|breaks|breaking|broke|broken) through\b[^.?!]{0,15}?\b(?:the (?:clouds|mist|fog|dawn)|sun|daylight|morning)\b|\b(?:sun|dawn|daylight|light)\b[^.?!]{0,15}?\b(?:break|breaks|breaking|broke) through\b",
    # add in
    ("add in", 1): r"\badd(?:s|ed|ing)? in\b[^.?!]{0,20}?\b(?:the (?:ingredients?|flour|sugar|butter|water|mixture|details)|this (?:place|remark)|further details|a (?:word|note|remark)|any way to the story|to the story)\b",
    # cut out
    ("cut out", 1): r"\bcut(?:s|ting)? out\b[^.?!]{0,15}?\b(?:of (?:the )?(?:paper|magazine|folded paper)|a (?:pane|pattern|dress|garment|coat)|make clothes|the (?:picture|figure))\b|\bcut out of (?:the )?(?:paper|magazine|cloth|card|cardboard|wood|tin)\b",
    ("cut out", 2): r"\bcut(?:s|ting)? out\b[^.?!]{0,15}?\b(?:phrases?|lines?|stanzas?|words?|passages?|the (?:part|soft music|accessories)|that ought)\b",
    ("cut out", 3): r"\bcut(?:s|ting)? out\b[^.?!]{0,15}?\b(?:jabbing|jollying|drinking|smoking|the (?:drink|habit)|such)\b",
    ("cut out", 4): r"\bcut(?:s|ting)? out\b[^.?!]{0,15}?\b(?:the (?:engine|motor|machine))\b",
    # fall out
    ("fall out", 1): r"\b(?:fall|falls|falling|fell|fallen) out of\b",
    ("fall out", 2): r"\b(?:fall|falls|falling|fell|fallen) out\b[^.?!]{0,15}?\b(?:with (?:him|her|them|each other)|as to|about|over|nor)\b",
    ("fall out", 3): r"\b(?:it|things?|all|that|matters?)\b[^.?!]{0,15}?\b(?:fell|fallen|fall|falls) out\b|\bas things fell out\b|\bit so fell out\b|\bit fell out\b|\bthere fell out\b",
    # mix up
    ("mix up", 1): r"\bmix(?:es|ed|ing)? up\b[^.?!]{0,20}?\b(?:two|sentiment and|and reason|the (?:four|two|accounts?|ideas?|months?)|not only)\b|\bmixes up\b",
    ("mix up", 2): r"\ball mixed up\b|\b(?:quite|thoroughly|completely|utterly) mixed up\b",
    # give out
    ("give out", 1): r"\b(?:give|gives|giving|gave|given) out\b[^.?!]{0,20}?\b(?:books?|money|prizes?|papers?|tracts?|food|bread|rations|numbers?|the (?:number|books?|papers?|money|prizes?|psalm)|to (?:the|each|her|his)|among)\b",
    ("give out", 2): r"\b(?:give|gives|giving|gave|given) out\b[^.?!]{0,15}?\b(?:light|heat|sound|melody|music|scent|perfume|smell|shimmer|rustle|creak|call|gleam|glow|rays?|cry|steam|odour|odor|murmur|whistle|burst)\b|\b(?:light|scent|perfume|smell|rustle|creak|melody|call|murmur|whistle|shimmer)\b[^.?!]{0,15}?\b(?:give|gives|gave|given|giving) out\b",
    ("give out", 3): r"\b(?:give|gives|giving|gave|given) out\b[^.?!]{0,15}?\b(?:supply|coal|food|money|strength|patience|breath|steam)\b|\b(?:supply|coal|money|food|strength|patience|steam|iron of his flesh)\b[^.?!]{0,20}?\b(?:give|gives|gave|given|giving) out\b",
    ("give out", 4): r"\bgave out\b\s*[.!?]|\bgive out or fail\b|\bI gave out\b",
    # clear up
    ("clear up", 1): r"\b(?:cleared|clear|clears|clearing) up\b[^.?!]{0,15}?\b(?:weather|sky|day|clouds?|face)\b|\b(?:weather|sky|face)\b[^.?!]{0,15}?\b(?:cleared|clear|clears) up\b",
    ("clear up", 2): r"\b(?:clear|cleared|clears|clearing) up\b[^.?!]{0,25}?\b(?:mystery|points?|case|matters?|mistake|bewilderment|puzzle|question|detail|business|misunderstanding|all that)\b",
    ("clear up", 3): r"\b(?:clear|cleared|clears|clearing) up\b[^.?!]{0,15}?\b(?:the (?:room|kitchen|house|table|things|place|drawing-room)|after (?:breakfast|dinner|supper)|stowing)\b",
    ("clear up", 4): r"\b(?:cleared|clear|clears|clearing) up\b[^.?!]{0,15}?\b(?:cold|rash|illness|symptoms?|headache|fever|spots)\b",
    # follow up
    ("follow up", 1): r"\b(?:follow|follows|following|followed) up\b[^.?!]{0,15}?\b(?:the (?:clue|clues|case|scent|idea|thought|article|matter|success|points)|his clue|my case|this clue|new-found clue)\b|\b(?:clue|clues|scent|case)\b[^.?!]{0,15}?\b(?:follow|follows|following|followed) up\b",
    ("follow up", 2): r"\b(?:follow|follows|following|followed) up\b[^.?!]{0,15}?\b(?:the (?:beginning|advantage|assurance|work)|by|with|to a conclusion|immediately)\b",
    # speak out
    ("speak out", 1): r"^(?!.*\b(?:speak|speaks|speaking|spoke|spoken) out of\b).*\b(?:speak|speaks|speaking|spoke|spoken) out\b",
    # think over
    ("think over", 1): r"\b(?:think|thinks|thinking|thought) over\b",
    # fill up
    ("fill up", 1): r"\b(?:fill|fills|filling|filled) up\b[^.?!]{0,15}?\b(?:the (?:glass|bottle|house|carriage|hiatus|gap|interval|intervals|certificate|cards?|sentence|jar|bag|box|hole|space|place|time|heart|measure)|his (?:glasses?|carriage|time|heart|certificate)|a (?:bottle|glass|sentence)|your (?:glass|pockets?)|its duration|each pause)\b|\bfill(?:s|ed|ing)? up his empty glass\b|\bfill(?:s|ed|ing)? up plain, simple invitation cards\b",
    ("fill up", 2): r"\b(?:fill|fills|filling|filled) up\b[^.?!]{0,15}?\b(?:with (?:after-dinner|guests|people)|slowly)\b|\b(?:were|was|are|is|began) (?:filling|filled) up\b|\b(?:fill|fills|filling|filled) up\s*,\s*(?:monsieurs|captains|gentlemen|friends|sir)\b|\b(?:fill|fills|filling|filled) up\s+again\b",
    ("fill up", 3): r"\b(?:fill|fills|filling|filled) up\b[^.?!]{0,12}?\b(?:with wood|morass|the (?:crack|chink)|a (?:crack|chink|morass))\b",
    ("fill up", 4): r"\bfill up on\b|\bfilled up with (?:food|meat|bread)\b",
    # ===== 块 B″ 第六批（2026-10-10 十七续 · 30 词）=====
    # hang up
    ("hang up", 1): r"\b(?:receiver|telephone|phone|wire|exchange|click)\b",
    ("hang up", 2): r"\b(?:hat|coat|clothes|cap|jacket|cloak|garments?|bonnet|shawl|dress|trophies|curtains?|picture|frame|peg|hook|nail|wall|shelves)\b",
    # look down on
    ("look down on", 1): r"^(?!.*\b(?:from above|from the|below|beneath)\b).*\blook(?:s|ed|ing)? down on\b",
    ("look down on", 2): r"\blook(?:s|ed|ing)? down on\b[^.?!]{0,25}?\b(?:from|below|beneath|above)\b|\b(?:from above|from the|below|beneath)\b[^.?!]{0,25}?\blook(?:s|ed|ing)? down on\b",
    # push on
    ("push on", 1): r"\b(?:push|pushes|pushing|pushed) on\b",
    # die out
    ("die out", 1): r"\b(?:die|dies|dying|died) out\b",
    # show off
    ("show off", 1): r"^(?!.*\bshow(?:s|ed|ing|n)? off\b[^.?!]{0,15}?\b(?:instep|figure|beauty|charms|shape|colour|color|advantages)\b).*\bshow(?:s|ed|ing|n)? off\b",
    ("show off", 2): r"\bshow(?:s|ed|ing|n)? off\b[^.?!]{0,15}?\b(?:instep|figure|beauty|charms|shape|colour|color|advantages)\b",
    # wrap up
    ("wrap up", 1): r"\b(?:wrap|wraps|wrapping|wrapped) up in\b(?![^.?!]{0,15}?\b(?:shawl|blanket|furs?|coat|cloak|flannels?|petticoat|travelling-blanket)\b)",
    ("wrap up", 2): r"\b(?:wrap|wraps|wrapping|wrapped) up\b[^.?!]{0,15}?\b(?:goods|paper|parcel|fragment|fish|pieces?)\b",
    ("wrap up", 3): r"\b(?:wrap|wraps|wrapping|wrapped) up\b[^.?!]{0,12}?\bwarmly\b|\bwell wrapped up\b|\bwrapped up in\b[^.?!]{0,15}?\b(?:shawl|blanket|furs?|coat|cloak|flannels?|petticoat|travelling-blanket)\b",
    ("wrap up", 4): r"\bwrap(?:s|ping|ped)? up\b[^.?!]{0,15}?\b(?:the (?:business|meeting|affair|evening|season|case|matter|deal))\b",
    # run across
    ("run across", 1): r"\b(?:ran|run|running) across\b[^.?!]{0,15}?\b(?:a (?:sample|book)|John|Cavendish|Mary|Duke|a friend|him|her|them|you|it)\b",
    ("run across", 2): r"\b(?:ran|run|running|runs) across\b[^.?!]{0,15}?\b(?:the (?:room|lawn|fields?|snow|country|space|hall|floor|earth|square|plain|street|sunlit)|country|in front of)\b",
    # count on
    ("count on", 1): r"\bcount(?:s|ed|ing)? on\b(?!\s+(?:his|her|their|my|your|one\u2019s|one's) fingers)",
    # leave out
    ("leave out", 1): r"^(?!.*\b(?:leave|leaves|leaving|left) out\b[^.?!]{0,15}?\b(?:words?|lines?|part|much|all that|that part)\b).*\bleft out\b",
    ("leave out", 2): r"\b(?:leave|leaves|leaving|left) out\b[^.?!]{0,15}?\b(?:words?|lines?|part|much|all that|that part)\b",
    # put away
    ("put away", 1): r"\bput(?:s|ting)? away\b[^.?!]{0,15}?\b(?:coin|papers?|tooth-pick|implements|revolver|picture|books?|things|dishes|tea-spoon|music|account-book|drawer|toys)\b",
    ("put away", 2): r"\bput(?:s|ting)? away\b[^.?!]{0,15}?\b(?:money|a (?:stake|sum|portion)|two thousand)\b",
    ("put away", 3): r"\bput(?:s|ting)? away\b[^.?!]{0,15}?\b(?:in (?:prison|an asylum|jail))\b",
    ("put away", 4): r"\bput(?:s|ting)? away\b[^.?!]{0,15}?\b(?:food|a (?:meal|breakfast|dinner))\b",
    # turn down
    ("turn down", 1): r"\bturn(?:s|ed|ing)? down\b[^.?!]{0,15}?\b(?:the (?:gas|lamp|lamps|light|lights|fire)|gas|lamp|light)\b|\b(?:gas|lamps?|lights?) (?:was |were |had been )?turned down\b",
    ("turn down", 2): r"\bturned down by\b|\bturn(?:s|ed|ing)? down\b[^.?!]{0,15}?\b(?:the (?:models|offer|invitation|proposal)|an? (?:offer|invitation|proposal))\b|\bturned down\b\s*[.!?]",
    ("turn down", 3): r"\bturn(?:s|ed|ing)? down\b[^.?!]{0,15}?\b(?:the (?:street|streets|passage|road|roadway|lane|Vigo Street|Old Beach Road)|a (?:narrow roadway|narrow lane|roadway|lane)|towards [A-Z][a-z]+|this street)\b",
    # hand out
    ("hand out", 1): r"\bhand(?:s|ed|ing)? out\b[^.?!]{0,15}?\b(?:tickets?|coin|perfectos|note|books?|money|copies|coronet|the (?:tickets|notes|books)|to (?:the|her|his|each|them|someone)|among)\b|\bhanded out\b",
    # bring down
    ("bring down", 1): r"\b(?:bring|brings|bringing|brought) down\b[^.?!]{0,15}?\b(?:the (?:level|price|prices|wages|rate)|level|prices|wages)\b",
    ("bring down", 2): r"\b(?:bring|brings|bringing|brought) down\b[^.?!]{0,15}?\b(?:bird|squirrel|guardsman|Chaplain|dimorphodon|warrior|whale|ducks|rocketing|on the wing)\b",
    ("bring down", 3): r"\b(?:bring|brings|bringing|brought) down\b[^.?!]{0,15}?\b(?:wrath|retribution|punishment|curse|jeremiads)\b",
    ("bring down", 4): r"\b(?:bring|brings|bringing|brought) down\b[^.?!]{0,20}?\b(?:luggage|mackintosh|travelling-cloak|mattress|tea-cloth|box|costume|garments|clothes|coat)\b",
    # cut in
    ("cut in", 1): r"^(?!.*\bcut(?:s|ting)? in\b[^.?!]{0,12}?\b(?:half|stone|letters|profile|rosettes|the (?:fish|forehead|head|tire|moor))\b).*\bcut in\b",
    ("cut in", 2): r"\bcut(?:s|ting)? in\b[^.?!]{0,15}?\b(?:traffic|vehicle|car|driving|behind|ahead)\b",
    ("cut in", 3): r"\bcut\b[^.?!]{0,12}?\bin on\b",
    # go after
    ("go after", 1): r"\b(?:go|goes|going|went|gone) after\b[^.?!]{0,15}?\b(?:him|his man|the (?:ducks|treasure)|that (?:young Bosinney|savage Queen)|it)\b",
    ("go after", 2): r"\b(?:go|goes|going|went|gone) after\b[^.?!]{0,15}?\b(?:things|opportunities|a living)\b|\bthings?\b[^.?!]{0,40}?\b(?:go|goes|going|went|gone) after\b",
    # show up
    ("show up", 1): r"\bshow(?:s|ed|ing)? up\b[^.?!]{0,15}?\b(?:at|with|to (?:pay|dinner)|and pay|yet|soon)\b|\bshowed up with\b|\bshow up\b\s*[.!?\u201d]|\b(?:didn\u2019t|didn't|failed to|not) show up\b",
    ("show up", 2): r"\bshow(?:s|ed|ing)? up\b[^.?!]{0,20}?\b(?:hard and bright|in certain lights|in a light|against the (?:sky line|grey rocks)|even more effectually|the nature|your suffering|absurdly clear|through the haze|the wit|clustered)\b",
    ("show up", 3): r"\bshown up\b[^.?!]{0,15}?\b(?:to (?:Lucy|Holmes|the chamber|his room)|together)\b",
    # keep away
    ("keep away", 1): r"\b(?:keep|keeps|keeping|kept) away\b",
    # let out
    ("let out", 1): r"\blet out\b[^.?!]{0,15}?\b(?:I didn\u2019t|I didn't|his doubts|enough|the other day)\b|\blet out\b[^.?!]{0,10}?\bthat\b",
    ("let out", 2): r"\blet(?:s|ting)? out\b[^.?!]{0,15}?\b(?:his suspended breath|the smoke|a whistle|a (?:cry|shout|sigh|groan|snort))\b",
    ("let out", 3): r"\blet(?:s|ting)? out\b[^.?!]{0,15}?\b(?:alone|the (?:life|first blow)|into the street|the dog|the gas|to be let out|the bird|the theatre)\b",
    ("let out", 4): r"\blet out\b[^.?!]{0,15}?\b(?:as offices|offices|apartments|floors)\b|\bbeing all let out\b",
    # put aside
    ("put aside", 1): r"^(?!.*\bput aside\b[^.?!]{0,12}?\b(?:thorns|branches|spray|foliage)\b)(?!.*\bput aside\b[^.?!]{0,15}?\b(?:a stake|two thousand|as much as)\b).*\bput(?:s|ting)? aside\b",
    ("put aside", 2): r"\bput(?:s|ting)? aside\b[^.?!]{0,15}?\b(?:a (?:stake|sum|portion)|two thousand|as much as I could|money)\b",
    ("put aside", 3): r"\bput(?:s|ting)? aside\b[^.?!]{0,12}?\b(?:thorns|branches|spray|foliage)\b",
    # take back
    ("take back", 1): r"\btak(?:e|es|en|ing) back\b[^.?!]{0,15}?\b(?:words?|the sound|what one)\b|\btaking back of words\b",
    ("take back", 2): r"\btak(?:e|es|en|ing) back\b[^.?!]{0,15}?\b(?:the (?:coat and watch|coat)|a sum of money|its owner)\b",
    ("take back", 3): r"\btak(?:e|es|en|ing) back\b[^.?!]{0,15}?\b(?:to the (?:world|cells|yacht|Hammersmith)|with (?:him|us|me)|home)\b",
    ("take back", 4): r"\btaken back (?:by|at)\b",
    # drop off
    ("drop off", 1): r"\bdrop(?:s|ped|ping)? off\b[^.?!]{0,15}?\b(?:to sleep|into (?:a profound )?sleep|at last)\b|\bdropping off\b|\bdropped off to sleep\b",
    ("drop off", 2): r"\b(?:toe|head|flakes|engines?|it|airship) drop(?:s|ped|ping)? off\b|\bdropping off in flakes\b|\bdrop(?:s|ped) off\b\s*[.!?;]",
    ("drop off", 3): r"\b(?:had )?dropped off\b[^.?!]{0,15}?\b(?:long ago)\b",
    ("drop off", 4): r"\bdrop(?:ped)? (?:sb|me|you|him|her|them|us) off\b|\bdrop(?:ped)? (?:the )?(?:children|kids|letters|parcel) off\b",
    # move out
    ("move out", 1): r"\bmove(?:s|d|ing)? out\b[^.?!]{0,15}?\b(?:of (?:your|their|his|her|the|one\u2019s|one's) (?:house|flat|home|rooms?|villa)|into that villa)\b",
    ("move out", 2): r"\b(?:train|Mongolia|ship|steamer) (?:slowly )?moved out\b|\bmoved out\b[^.?!]{0,15}?\b(?:of the (?:roadstead|station)|to the hall|into the hall)\b|\bmoved out\b\s*[.,]",
    # pass down
    ("pass down", 1): r"\bpassed down\b[^.?!]{0,20}?\b(?:through (?:all )?the generations|from (?:One Eye|generation)|to (?:his|her|the next|posterity))\b|\bpass down\b[^.?!]{0,15}?\bto\b",
    ("pass down", 2): r"\bpass(?:ed|ing)? down\b[^.?!]{0,15}?\b(?:(?:[A-Z][a-z]+ )?(?:Lane|Street|Road)|the (?:passage|stairs|porch|gallery|aisle|quay|steps|tunnels?|half-landing))\b",
    # sit back
    ("sit back", 1): r"^(?!.*\bsit(?:s|ting)? back\b[^.?!]{0,15}?\b(?:and let|all my life)\b).*\bsat(?:s|ting)? back\b",
    ("sit back", 2): r"\bsit(?:s|ting)? back\b[^.?!]{0,15}?\b(?:and let|all my life)\b|\bsitting back\b[^.?!]{0,15}?\b(?:persistent|observ)\b",
    # cut down
    ("cut down", 1): r"\bcut(?:s|ting)? down\b[^.?!]{0,15}?\b(?:a third|the (?:tip|orthodox ration|expenditure|expenses|price|margin)|to (?:five|nothing)|so closely)\b|\bbeen cut down to\b",
    ("cut down", 2): r"\bcut down\b[^.?!]{0,15}?\b(?:a (?:pine tree|tree)|the (?:tree|big boatswain)|Every tree|thorny bushes|sails)\b|\btree (?:had been|was) cut down\b",
    ("cut down", 3): r"\bcut down\b[^.?!]{0,15}?\b(?:the (?:boatswain|men)|him|them|like grass|all hands)\b|\bwas cut down\b",
    # go around
    ("go around", 1): r"\bgo(?:es|ing)? around\b[^.?!]{0,20}?\b(?:that|news|report|story|no more)\b",
    ("go around", 2): r"\bgo(?:es|ing)? around\b[^.?!]{0,15}?\b(?:wheels?|clock|hands|head|axis)\b|\bgo around\b[^.?!]{0,12}?\bwith terrible rapidity\b|\bwent around\b[^.?!]{0,12}?\b(?:my head|like)\b",
    ("go around", 3): r"\bgo(?:es|ing|ne|t)? around\b[^.?!]{0,15}?\b(?:it|her|him|them)\b|\bgoing around\b[^.?!]{0,15}?\b(?:as far as|it)\b",
    ("go around", 4): r"\bgo(?:es|ing|ne|t)? around\b[^.?!]{0,15}?\b(?:to (?:the|Fitzgerald|a place)|town|very much|looking at people)\b",
    ("go around", 5): r"\bgo(?:es|ing)? around\b[^.?!]{0,15}?\b(?:enough|sufficient)\b|\benough to go around\b",
    # hold back
    ("hold back", 1): r"\bheld back\b|\bhold(?:s|ing)? back\b[^.?!]{0,15}?\b(?:the (?:pony|cab horse|broom|steed|boughs|gathering)|by (?:the|some)|passengers|policemen|force)\b",
    ("hold back", 2): r"\bhold(?:s|ing)? back\b[^.?!]{0,15}?\b(?:the (?:urge|impulse)|speech|tears|anger)\b|\bheld back\b[^.?!]{0,12}?\bspeech\b",
    ("hold back", 3): r"\bhold(?:s|ing)? back\b[^.?!]{0,15}?\b(?:on my cousin|one of his own good cards|if your Cecil|a share|information|the truth)\b",
    ("hold back", 4): r"\bhold(?:s|ing)? back\b[^.?!]{0,15}?(?:$|[.,])|\bheld back\b[^.?!]{0,12}?\b(?:and let us men|and the latter said)\b|\bholding back\b",
    # pull off
    ("pull off", 1): r"\bpull(?:s|ed|ing)? off\b[^.?!]{0,15}?\b(?:his (?:shoes|coat|boots|gloves|hat|shirt|jacket|waistcoat|singlet|clothes)|her (?:rings|gloves|hat)|their (?:aprons|coats)|the (?:gloves|hat))\b|\bpulling off his\b",
    ("pull off", 2): r"\bpull(?:s|ed|ing)? off\b[^.?!]{0,15}?\b(?:a (?:trick|sale|deal|coup)|the (?:trick|deal|sale)|his trick)\b",
    ("pull off", 3): r"\bpull(?:s|ed|ing)? off\b[^.?!]{0,15}?\b(?:for the (?:stranger|shore)|to (?:one|the (?:shore|bank))|with a prodigious)\b|\bpulled off for\b",
    # go ahead
    ("go ahead", 1): r"^(?!.*\bgo(?:es|ing|ne|t)? ahead of\b).*\bgo(?:es|ing|ne|t)? ahead\b",
    ("go ahead", 2): r"\bgo(?:es|ing|ne|t)? ahead of\b",
    # put together
    ("put together", 1): r"^(?!.*\bput together\b[^.?!]{0,20}?\b(?:all the others|the whole|every one)\b)(?!.*\bput together\b[^.?!]{0,15}?\b(?:a phrase|this vision|view)\b).*\bput(?:s|ting)? together\b",
    ("put together", 2): r"\bput together\b[^.?!]{0,20}?\b(?:all the others|the whole|every one)\b|\b(?:all|whole) [^.?!]{0,20}?put together\b",
    ("put together", 3): r"\bput together\b[^.?!]{0,15}?\b(?:a phrase|this vision|view)\b",
# ===== 块 B″ 第七批（2026-10-10 十八续 · 30 词）=====
    # turn around
    ("turn around", 1): r"^(?!.*\bturn(?:s|ed|ing)? around\b[^.?!]{0,20}?\b(?:the (?:sides?|mountains?|corner|bend))\b).*\bturn(?:s|ed|ing)? around\b",
    ("turn around", 2): r"\bturn(?:s|ed|ing)? around\b[^.?!]{0,18}?\b(?:business|fortunes?|economy|company|things|luck|situation)\b",
    ("turn around", 3): r"\bturn(?:s|ed|ing)? around\b[^.?!]{0,18}?\b(?:the (?:sides?|mountains?|corner|bend)|a corner)\b",
    # back up
    ("back up", 1): r"\bback(?:s|ed|ing)? up\b[^.?!]{0,20}?\b(?:to|against|into|towards?)\b",
    ("back up", 2): r"\bback(?:s|ed|ing)?\s+up\b[^.?!;,]{0,25}?\b(?:arguments?|claims?|statements?|theory|opinions?|story|version|account|family|husband|wife|friends?|proposal|plan|motion|nomination|policy|candidate|professors?|parents?|brothers?|sisters?|son|daughter|mother|father)\b|\bback(?:s|ed|ing)?\s+(?:him|her|them|me|us|you|his|her|their|our|my|your)\s+(?:\w+\s+)?up\b",
    ("back up", 3): r"\bback(?:s|ed|ing)? up\b[^.?!]{0,18}?\b(?:files?|data|records?|disk|computer|documents?)\b",
    # cheer up
    ("cheer up", 1): r"\bcheer(?:s|ed|ing)? up (?:\w+ ){0,2}(?:heart|spirits?|aunt|uncle|mother|father|boy|man|woman|soul|face|him|her|them|us|me|you)\b",
    ("cheer up", 2): r"(?:^|[.?!;,\x22\u201c]\s*)(?:(?:but|and|then|so|now|come|why|oh|well)[,]?\s+){0,3}?cheer(?:s|ed|ing)?\s+up\b(?!\s+(?:\w+\s+){0,2}(?:heart|spirits?|him|her|them|us|me|you|aunt|uncle|mother|father|boy|man|woman|soul|face)\b)|\b(?:he|she|they|we|I|you)\b[^.?!;,]{0,30}?\bcheer(?:s|ed|ing)?\s+up\b(?!\s+(?:\w+\s+){0,2}(?:heart|spirits?|him|her|them|us|me|you|aunt|uncle|mother|father|boy|man|woman|soul|face)\b)|\b(?:declined|refused|tried|began|started|seemed|wanted)\s+to\s+cheer\s+up\b",
    # drop out
    ("drop out", 1): r"^(?!.*\bdrop(?:s|ped|ping)? out\b[^.?!]{0,15}?\b(?:bidding|list|race|contest|competition|match|game|team|market|scheme|deal|school|college|university|studies|course|society)\b).*\bdrop(?:s|ped|ping)? out\b",
    ("drop out", 2): r"\bdrop(?:s|ped|ping)? out\b[^.?!]{0,15}?\b(?:bidding|list|race|contest|competition|match|game|team|market|scheme|deal)\b",
    ("drop out", 3): r"\bdrop(?:s|ped|ping)? out\b[^.?!]{0,15}?\b(?:school|college|university|studies|course|classes)\b",
    ("drop out", 4): r"\bdrop(?:s|ped|ping)? out\b[^.?!]{0,15}?\b(?:of society|of the world|of the human race|of everything)\b",
    # write down
    ("write down", 1): r"^(?!.*\b(?:writ(?:e|es|ing|ten)|wrote) down\b[^.?!]{0,18}?\b(?:value|price|assets?|stock|goods|property|amount)\b).*\b(?:writ(?:e|es|ing|ten)|wrote) down\b",
    ("write down", 2): r"\b(?:writ(?:e|es|ing|ten)|wrote) down\b[^.?!]{0,18}?\b(?:value|price|assets?|stock|goods|property|amount)\b",
    # get together
    ("get together", 1): r"^(?!.*\bg(?:et|ets|etting|ot|otten) together\b[^.?!]{0,25}?\b(?:a (?:company|collection|crew|party|team|group|sum|few)|the (?:whole )?(?:crew|party|collection|money|sum)|them|his (?:collection|pictures))\b)(?!.*\b(?:collection|company|crew|party|team|group|money|sum)\b[^.?!]{0,40}?\bg(?:et|ets|etting|ot|otten) together\b)(?!.*\bg(?:et|ets|etting|ot|otten) together\b[^.?!]{0,18}?\b(?:on|over) (?:fundamentals|a (?:deal|plan|scheme)|the (?:matter|question))\b).*\bg(?:et|ets|etting|ot|otten) together\b",
    ("get together", 2): r"\bg(?:et|ets|etting|ot|otten) together\b[^.?!]{0,25}?\b(?:a (?:company|collection|crew|party|team|group|sum|few)|the (?:whole )?(?:crew|party|collection|money|sum)|them|his (?:collection|pictures))\b|\b(?:collection|company|crew|party|team|group|money|sum)\b[^.?!]{0,40}?\bg(?:et|ets|etting|ot|otten) together\b",
    ("get together", 3): r"\bg(?:et|ets|etting|ot|otten) together\b[^.?!]{0,18}?\b(?:on|over) (?:fundamentals|a (?:deal|plan|scheme)|the (?:matter|question))\b",
    # keep back
    ("keep back", 1): r"\bk(?:eep(?:s|ing)?|ept) back\b[^.?!]{0,18}?\b(?:facts?|truth|something|nothing|news|information|secrets?)\b",
    ("keep back", 2): r"\bk(?:eep(?:s|ing)?|ept) back\b[^.?!]{0,18}?\b(?:the (?:crowd|people|mob|throng|rush|flood|wolfish)|by the|alone)\b",
    ("keep back", 3): r"\bk(?:eep(?:s|ing)?|ept) back\b[^.?!]{0,18}?\b(?:part of|more than|the (?:proceeds|money|profits?|rest)|a (?:part|share|portion))\b",
    ("keep back", 4): r"\bkeep back\b\s*[!,.]",
    # wear off
    ("wear off", 1): r"^(?!.*\b(?:wear(?:s|ing)?|wore|worn) off\b[^.?!]{0,18}?\b(?:coat|paint|colour|color|gloss|varnish|surface|edge|lettering|letters?|gilding)\b).*\b(?:wear(?:s|ing)?|wore|worn) off\b",
    ("wear off", 2): r"\b(?:wear(?:s|ing)?|wore|worn) off\b[^.?!]{0,18}?\b(?:coat|paint|colour|color|gloss|varnish|surface|edge|lettering|letters?|gilding)\b",
    # base on
    ("base on", 1): r"\bbas(?:e|es|ed|ing) on\b",
    # die down
    ("die down", 1): r"\bd(?:ie|ies|ying|ied) down\b",
    # tear down
    ("tear down", 1): r"^(?!.*\b(?:tear|tears|tearing|tore|torn) down\b[^.?!]{0,15}?\b(?:the (?:street|road|lane|hill|path|corridor)|into)\b)(?!.*\b(?:tear|tears|tearing|tore|torn) down\b[^.?!]{0,18}?\b(?:from|off|out of)\b).*\b(?:tear|tears|tearing|tore|torn) down\b",
    ("tear down", 2): r"\b(?:tear|tears|tearing|tore|torn) down\b[^.?!]{0,18}?\b(?:from|off|out of)\b",
    ("tear down", 3): r"\b(?:tear|tears|tearing|tore|torn) down\b[^.?!]{0,15}?\b(?:the (?:street|road|lane|hill|path|corridor)|into)\b",
    # tear up
    ("tear up", 1): r"^(?!.*\b(?:tear|tears|tearing|tore|torn) up\b[^.?!]{0,18}?\b(?:trees?|plants?|roots?|stump|bushes|by the roots)\b)(?!.*\b(?:trees?|plants?|roots?)\b[^.?!]{0,18}?\b(?:tear|tore|torn|tearing|tears) up\b).*\b(?:tear|tears|tearing|tore|torn) up\b",
    ("tear up", 2): r"\b(?:tear|tears|tearing|tore|torn) up\b[^.?!]{0,18}?\b(?:trees?|plants?|roots?|stump|bushes|by the roots)\b|\b(?:trees?|plants?|roots?)\b[^.?!]{0,18}?\b(?:tear|tore|torn|tearing|tears) up\b",
    # wipe out
    ("wipe out", 1): r"\bwipe(?:s|d|ing)?\s+out\b[^.?!;,]{0,25}?\b(?:(?:the|a|an|his|her|my|your|their|our|its|this|that|these|those|some|any|no|every|all the|[A-Za-z\u2019\x27]+[\u2019\x27]s)\s+(?:\w+\s+){0,2})?(?:man|men|woman|women|people|folk|nations?|races?|tribes?|army|armies|enem(?:y|ies)|troops?|invaders?|brute|beasts?|monsters?|creatures?|animals?|towns?|cities|city|villages?|world|population|inhabitants|families|family|crowd|sparrows?|flies|rats?|mice|insects?|vermin|pests?|pretense|pretence|illusions?|confidence|faith|hopes?|existence|presence|influence|authority|identity|character|reputation|traces?|everything|everyone|everybody)\b|\b(?:man|men|women|race|nations?|army|enem(?:y|ies)|town|world|people|population|families|family|them all|every man|everybody)\b[^.?!;,]{0,35}?\b(?:wipe|wipes|wiped|wiping)\s+out\b|\b(?:he|she|they|we|I|you|it|the (?:men|people|army|town|race|world))\b[^.?!;,]{0,20}?\b(?:was|were|been|being|is|are|be)\s+(?:all\s+)?wiped\s+out\b|\b(?:murdered|killed|slain|destroyed)\b[^.]{0,15}?\bwiped\s+out\b",
    ("wipe out", 2): r"\bwipe(?:s|d|ing)?\s+out\b[^.?!;,]{0,25}?\b(?:all the past|the past|past (?:ill|evil|sins?|wrongs?|crimes?|life)|sins?|wickedness|disgrace|shame|possibility|memor(?:y|ies)|pride|record|debts?|impression|stain|blot|guilt|wrongs?|feeling|profits?|losses?|costs?|expenses?|deficits?|surpluses?|earnings|gains?|advantages?|benefits?|arrears|charges?|penalties|margins?)\b|\b(?:sins?|wickedness|disgrace|shame|pride|memor(?:y|ies)|debts?|record|past (?:ill|evil|sins?)|profits?|losses?|costs?|expenses?|deficits?|surpluses?|earnings|gains?|advantages?|benefits?|arrears|charges?|penalties|margins?)\b[^.?!;,]{0,60}?\b(?:wipe|wipes|wiped|wiping)\s+out\b|\b(?:it(?:'|\u2019)s|it is|it was)\s+(?:all\s+)?wiped\s+out\b",
    # advantage in
    ("advantage in", 1): r"^(?!.*\badvantage in\b[^.?!]{0,10}?\b(?:tennis|deuce|game|set|match)\b).*\badvantage(?:s)? in\b",
    ("advantage in", 2): r"\badvantage in\b[^.?!]{0,10}?\b(?:tennis|deuce|game|set|match)\b",
    # call back
    ("call back", 1): r"^(?!.*\bcall(?:s|ed|ing)? back\b[^.?!]{0,18}?\b(?:the (?:servant|man|boy|dog|messenger|coachman)|to the (?:farm|house|room|office)|to (?:him|her)self|home)\b).*\bcall(?:s|ed|ing)? back\b",
    ("call back", 2): r"\bcall(?:s|ed|ing)? back\b[^.?!]{0,18}?\b(?:the (?:servant|man|boy|dog|messenger|coachman)|to the (?:farm|house|room|office)|to (?:him|her)self|home)\b",
    ("call back", 3): r"\bcall(?:s|ed|ing)?\b[^.?!]{0,15}?\bback\b[^.?!]{0,15}?\b(?:by phone|by telephone|on the (?:phone|telephone)|when he (?:gets|got) in)\b",
    # fall through
    ("fall through", 1): r"\bf(?:all(?:s|ing)?|ell|allen) through\b[^.?!]{0,20}?\b(?:deal|plan|scheme|arrangement|negotiation|bargain|project|contract|business|proposal)\b|\b(?:deal|plan|scheme|negotiation|contract|bargain)\b[^.?!]{0,25}?\bf(?:all(?:s|ing)?|ell|allen) through\b",
    # give away
    ("give away", 1): r"^(?!.*\bg(?:iv(?:e|es|ing|en)|ave) away\b[^.?!]{0,18}?\b(?:secret|secrets|nothing|to the world|the (?:truth|game|show|whole thing))\b)(?!.*\bnothing\b[^.?!]{0,20}?\bg(?:iv(?:e|es|ing|en)|ave) away\b)(?!.*\bg(?:iv(?:e|es|ing|en)|ave) away\b[^.?!]{0,18}?\b(?:the bride|bride|daughter)\b).*\bg(?:iv(?:e|es|ing|en)|ave) away\b",
    ("give away", 2): r"\bg(?:iv(?:e|es|ing|en)|ave) away\b[^.?!]{0,18}?\b(?:secret|secrets|to the world|the (?:truth|game|show|whole thing))\b|\bnothing\b[^.?!]{0,20}?\bg(?:iv(?:e|es|ing|en)|ave) away\b",
    ("give away", 3): r"\bg(?:iv(?:e|es|ing|en)|ave) away\b[^.?!]{0,18}?\b(?:the bride|bride|daughter)\b",
    # hand down
    ("hand down", 1): r"^(?!.*\b(?:win|won|wins|get) hands down\b)(?!.*\b(?:laid|lay|put|run|ran|resting) (?:the |her |his |their )?hands? down\b)(?!.*\bhand(?:s|ed|ing)? down\b[^.?!]{0,18}?\b(?:to (?:him|her|them|me)|trunk|flag|whip|rug|from the (?:coach|carriage))\b).*\bhand(?:s|ed|ing)? down\b",
    ("hand down", 2): r"\bhand(?:s|ed|ing)? down\b[^.?!]{0,18}?\b(?:to (?:him|her|them|me)|trunk|flag|whip|rug|from the (?:coach|carriage))\b",
    # let in
    ("let in", 1): r"^(?!.*\blet(?:s|ting)? in\b[^.?!]{0,15}?\b(?:light|air|sunlight|sunshine|daylight|cold air|fresh air|prairie|warmth)\b)(?!.*\b(?:light|air|sunlight|sunshine|daylight)\b[^.?!]{0,20}?\blet(?:s|ting)? in\b).*\blet(?:s|ting)? in\b",
    ("let in", 2): r"\blet(?:s|ting)? in\b[^.?!]{0,15}?\b(?:light|air|sunlight|sunshine|daylight|cold air|fresh air|prairie|warmth)\b|\b(?:light|air|sunlight|sunshine|daylight)\b[^.?!]{0,20}?\blet(?:s|ting)? in\b",
    ("let in", 3): r"\blet(?:s|ting)?\b[^.?!]{0,12}?\bin on\b",
    # hang out
    ("hang out", 1): r"^(?!.*\b(?:hang|hangs|hanging|hung) out\b[^.?!]{0,18}?\b(?:with (?:friends|the (?:boys|guys|gang))|in the (?:park|street|mall))\b).*\b(?:hang|hangs|hanging|hung) out\b",
    ("hang out", 2): r"\b(?:hang|hangs|hanging|hung) out\b[^.?!]{0,18}?\b(?:with (?:friends|the (?:boys|guys|gang))|in the (?:park|street|mall))\b",
    # let down
    ("let down", 1): r"^(?!.*\blet(?:s|ting)? down\b[^.?!]{0,15}?\b(?:gown|dress|skirt|hem|petticoat)\b)(?!.*\blet(?:s|ting)? (?:sb|him|her|them|us|me|you) down\b[^.?!]{0,12}?\b(?:disappoint|failed|fail|never again)\b).*\blet(?:s|ting)? down\b",
    ("let down", 2): r"\blet(?:s|ting)? down\b[^.?!]{0,15}?\b(?:gown|dress|skirt|hem|petticoat)\b",
    ("let down", 3): r"\blet(?:s|ting)? (?:sb|him|her|them|us|me|you|the \w+) down\b[^.?!]{0,12}?\b(?:disappoint|failed|fail|never again)\b|\b(?:disappoint|failed|betrayed)\b[^.?!]{0,15}?\blet (?:him|her|them|us|me|you) down\b",
    # put forward
    ("put forward", 1): r"^(?!.*\bput(?:s|ting)? forward\b[^.?!]{0,15}?\b(?:her hand|his hand|a hand|her foot|his foot|a foot|their hands?|one'?s hand)\b)(?!.*\bput(?:s|ting)? forward\b[^.?!]{0,15}?\b(?:candidate|as (?:a )?(?:candidate|mayor|president|member)|for (?:the )?(?:election|office|position|seat))\b).*\bput(?:s|ting)? forward\b",
    ("put forward", 2): r"\bput(?:s|ting)? forward\b[^.?!]{0,15}?\b(?:her hand|his hand|a hand|her foot|his foot|a foot|their hands?|one'?s hand)\b",
    ("put forward", 3): r"\bput(?:s|ting)? forward\b[^.?!]{0,15}?\b(?:candidate|as (?:a )?(?:candidate|mayor|president|member)|for (?:the )?(?:election|office|position|seat))\b",
    # turn off
    ("turn off", 1): r"\bturn(?:s|ed|ing)? off\b[^.?!]{0,15}?\b(?:the (?:gas|light|lights|houselights|water|lamp|lamps|tap|drafts?|electricity|fire)|gas|light|water)\b|\b(?:gas|lights?|water)\b[^.?!]{0,15}?\bturn(?:s|ed|ing)? off\b",
    ("turn off", 2): r"\bturn(?:s|ed|ing)? off\b[^.?!]{0,15}?\b(?:into|on to|onto|to|towards?)\b|\bturn(?:s|ed|ing)? off\b[^.?!]{0,15}?\bon (?:a |the )?(?:side-street|street|road|lane)\b",
    ("turn off", 3): r"\bturn(?:s|ed|ing)?\b[^.?!]{0,12}?\boff\b[^.?!]{0,10}?\b(?:disgust|revolt|repel|repellent|unpleasant|against the idea)\b",
    # butt in
    ("butt in", 1): r"^(?!.*\bbut(?:t|ts|ting|ted) in\b[^.?!]{0,18}?\b(?:the dark|with (?:his|her|my|their) head|with my head|with (?:his|her|my|their) horns?)\b).*\bbut(?:t|ts|ting|ted) in\b",
    ("butt in", 2): r"\bbut(?:t|ts|ting|ted) in\b[^.?!]{0,18}?\b(?:the dark|with (?:his|her|my|their) head|with my head|with (?:his|her|my|their) horns?)\b",
    # slow down
    ("slow down", 1): r"^(?!.*\bslow(?:s|ed|ing)? down\b[^.?!]{0,15}?\b(?:production|output|the (?:process|rate of (?:work|progress)))\b)(?!.*\bslow(?:s|ed|ing)? down\b[^.?!]{0,12}?\b(?:you'?re working too hard|take it easy|and rest|and relax)\b).*\bslow(?:s|ed|ing)? down\b",
    ("slow down", 2): r"\bslow(?:s|ed|ing)? down\b[^.?!]{0,15}?\b(?:production|output|the (?:process|rate of (?:work|progress)))\b",
    ("slow down", 3): r"\bslow(?:s|ed|ing)? down\b[^.?!]{0,12}?\b(?:you'?re working too hard|take it easy|and rest|and relax)\b",
    # build up
    ("build up", 1): r"\bbuil(?:d(?:s|ing|ed)?|t)\s+up\b[^.?!;,]{0,25}?\b(?:(?:the|a|an|his|her|my|your|their|our|its|this|that|these|those|some|any|no|every|all the|[A-Za-z\u2019\x27]+[\u2019\x27]s)\s+(?:\w+\s+){0,2})?(?:business(?:es)?|trade|firm|concern|company|house|fortune|fortunes|reputation|fame|name|career|practice|clientele|following|party|society|league|organi[sz]ations?|institutions?|school|university|church|hospital|department|shop|store|town|city|country|nation|empire|kingdom|state|district|neighbourhood|neighborhood|street|security|power|resources?|reserves?|supplies|stock|funds?|capital|savings|wealth|millions|connections?|influence|friendship|relations?|forces?|collections?|library|estate|fortress|sanctuary|edifice|picture|feelings?|determination|cards?|world|network|structure|system|press|army)\b|\b(?:town|city|country|nation|business(?:es)?|trade|society|empire|security|power|district|street|neighbourhood|neighborhood|estate|department|firm|company|fortune|reputation|career|practice|institution|party|league|organi[sz]ation|edifice|system|structure|collection|press|army|forces?)\b[^.?!;,]{0,25}?\bbuil(?:d(?:s|ing|ed)?|t)\s+up\b",
    ("build up", 2): r"\bbuil(?:d(?:s|ing|ed)?|t) up\b[^.?!]{0,15}?\b(?:strength|stamina|muscles?|health|physique|body|confidence)\b",
    # come around
    ("come around", 1): r"^(?!.*\b(?:come(?:s|ing)?|came) around\b[^.?!]{0,15}?\b(?:Saturday|Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|night|Christmas|spring|summer|winter|birthday|autumn)\b)(?!.*\b(?:Saturday|Sunday|Monday|night|Christmas|spring|summer|winter|birthday)\b[^.?!]{0,20}?\b(?:come(?:s|ing)?|came) around\b).*\b(?:come(?:s|ing)?|came) around\b",
    ("come around", 2): r"\b(?:come(?:s|ing)?|came) around\b[^.?!]{0,15}?\b(?:Saturday|Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|night|Christmas|spring|summer|winter|birthday|autumn)\b|\b(?:Saturday|Sunday|Monday|night|Christmas|spring|summer|winter|birthday)\b[^.?!]{0,20}?\b(?:come(?:s|ing)?|came) around\b",
    ("come around", 3): r"\b(?:come(?:s|ing)?|came) around\b[^.?!]{0,20}?\b(?:to (?:my|our|his|her|their) (?:way of thinking|view|opinion)|to (?:my|our|his|her|their) senses|in the end|at last)\b",
    # fall back on
    ("fall back on", 1): r"^(?!.*\bf(?:all(?:s|ing)?|ell|allen) back on\b[^.?!]{0,15}?\b(?:the (?:pillow|cushion|plush|sofa|bed|grass|seat)|her pillow|his pillow|my pillow)\b).*\bf(?:all(?:s|ing)?|ell|allen) back on\b",
    ("fall back on", 2): r"\bf(?:all(?:s|ing)?|ell|allen) back on\b[^.?!]{0,15}?\b(?:the (?:pillow|cushion|plush|sofa|bed|grass|seat)|her pillow|his pillow|my pillow)\b",
    # shut down
    ("shut down", 1): r"^(?!.*(?:^|\s)(?:darkness|night|silence|shadow|winter|dusk|gloom)\b[^.?!]{0,20}?\bshut(?:s|ting)? down\b)(?!.*\bshut(?:s|ting)? down\b[^.?!]{0,20}?\b(?:over|on) (?:the (?:valley|land|world|city|everything|light|plain)|everything|him|us)\b)(?!.*\bshut(?:s|ting)? down\b[^.?!]{0,15}?\b(?:the (?:trap|lid|desk|window|door|hatch)|his desk)\b).*\bshut(?:s|ting)? down\b",
    ("shut down", 2): r"\bshut(?:s|ting)? down\b[^.?!]{0,15}?\b(?:the (?:trap|lid|desk|window|door|hatch)|his desk)\b",
    ("shut down", 3): r"(?:^|\s)(?:darkness|night|silence|shadow|winter|dusk|gloom)\b[^.?!]{0,20}?\bshut(?:s|ting)? down\b|\bshut(?:s|ting)? down\b[^.?!]{0,20}?\b(?:over|on) (?:the (?:valley|land|world|city|everything|light|plain)|everything|him|us)\b",
    # speak up
    ("speak up", 1): r"^(?!.*\bsp(?:eak(?:s|ing)?|oke|oken)? up\b[^.?!]{0,20}?\b(?:for (?:himself|herself|the (?:poor|downtrodden))|against|your mind|the truth)\b).*\bsp(?:eak(?:s|ing)?|oke|oken)? up\b",
    ("speak up", 2): r"\bsp(?:eak(?:s|ing)?|oke|oken)? up\b[^.?!]{0,20}?\b(?:for (?:himself|herself|the (?:poor|downtrodden))|against|your mind|the truth)\b",
    # ===== 块 B″ 第八批（2026-10-10 十九续 · 30 词）=====
    # bustle about
    ("bustle about", 1): r"\bbustl(?:e|es|ed|ing) about\b",
    # convert into
    ("convert into", 2): r"\bconvert(?:s|ed|ing)? into\b[^.?!]{0,15}?\b(?:a|an|the)\s+(?:studio|dwelling|dwellings|house|home|cottage|rooms?|flat|flats|apartments?|chapel|barn|stable|farmhouse|residence|library|school|hospital|factory|office|shop|store|garage|cellar|attic|hall|bedroom|lounge|parlour|parlor|study|kitchen|nursery|sitting-room|drawing-room|boarding-house|warehouse|mill|theatre|theater|convent|priory|inn|tavern|garret)\b",
    ("convert into", 1): r"^(?!.*(?:\bconvert(?:s|ed|ing)? into\b[^.?!]{0,15}?\b(?:a|an|the)\s+(?:studio|dwelling|dwellings|house|home|cottage|rooms?|flat|flats|apartments?|chapel|barn|stable|farmhouse|residence|library|school|hospital|factory|office|shop|store|garage|cellar|attic|hall|bedroom|lounge|parlour|parlor|study|kitchen|nursery|sitting-room|drawing-room|boarding-house|warehouse|mill|theatre|theater|convent|priory|inn|tavern|garret)\b)).*\bconvert(?:s|ed|ing)? into\b",
    # fill in
    ("fill in", 2): r"\bfill(?:s|ed|ing)? in\b[^.?!]{0,15}?\b(?:the (?:outline|outlines|details?|sketch|gaps?)|outline|details?|a pause|the (?:outline|whole))\b",
    ("fill in", 3): r"\bfill(?:s|ed|ing)? in\b[^.?!]{0,15}?\b(?:the time|time|an hour|the hours|the interval|the meantime|a (?:dull )?(?:hour|evening|day|afternoon|minute))\b",
    ("fill in", 4): r"\bfill(?:s|ed|ing)? in\b\s*for\b",
    ("fill in", 1): r"^(?!.*(?:\bfill(?:s|ed|ing)? in\b[^.?!]{0,15}?\b(?:the (?:outline|outlines|details?|sketch|gaps?)|outline|details?|a pause|the (?:outline|whole))\b))(?!.*(?:\bfill(?:s|ed|ing)? in\b[^.?!]{0,15}?\b(?:the time|time|an hour|the hours|the interval|the meantime|a (?:dull )?(?:hour|evening|day|afternoon|minute))\b))(?!.*(?:\bfill(?:s|ed|ing)? in\b\s*for\b)).*\bfill(?:s|ed|ing)? in\b",
    # fill out
    ("fill out", 2): r"\b(?:face|cheeks?|figure|body|physique|shape|flesh)\b[^.?!]{0,25}?\bfill(?:s|ed|ing)? out\b|\bfill(?:s|ed|ing)? out\b[^.?!]{0,15}?\b(?:a bit|considerably|since|nicely|until it was|admirably|plump|well-rounded|with flesh)\b",
    ("fill out", 3): r"\bfill(?:s|ed|ing)? out\b[^.?!]{0,15}?\b(?:vacanc(?:y|ies)|the (?:ranks?|number|list|compliment|scheme)|with (?:more|details?|particulars))\b",
    ("fill out", 4): r"\b(?:sails?|canvas)\b[^.?!]{0,20}?\bfill(?:s|ed|ing)? out\b|\bfill(?:s|ed|ing)? out\b[^.?!]{0,10}?\b(?:sails?|to the wind|with wind)\b",
    ("fill out", 1): r"^(?!.*(?:\b(?:face|cheeks?|figure|body|physique|shape|flesh)\b[^.?!]{0,25}?\bfill(?:s|ed|ing)? out\b|\bfill(?:s|ed|ing)? out\b[^.?!]{0,15}?\b(?:a bit|considerably|since|nicely|until it was|admirably|plump|well-rounded|with flesh)\b))(?!.*(?:\bfill(?:s|ed|ing)? out\b[^.?!]{0,15}?\b(?:vacanc(?:y|ies)|the (?:ranks?|number|list|compliment|scheme)|with (?:more|details?|particulars))\b))(?!.*(?:\b(?:sails?|canvas)\b[^.?!]{0,20}?\bfill(?:s|ed|ing)? out\b|\bfill(?:s|ed|ing)? out\b[^.?!]{0,10}?\b(?:sails?|to the wind|with wind)\b)).*\bfill(?:s|ed|ing)? out\b",
    # pay off
    ("pay off", 2): r"\b(?:pay|pays|paying|paid) off\b[^.?!]{0,15}?\b(?:the )?(?:cabmen|laundress|drivers?|workmen|servants|hands|crew|sailors|seamen|employees|men|waiters?|porters?|labourers?|laborers?)\b|\b(?:men|cabmen|laundress|drivers|workmen|servants|crew|sailors|seamen|labourers?|laborers?)\b[^.?!]{0,25}?\b(?:pay|pays|paying|paid) off\b",
    ("pay off", 3): r"\b(?:pay|pays|paying|paid) off\b[^.?!]{0,20}?\b(?:in the end|at last|richly|handsomely|splendidly|finally|well|itself)\b",
    ("pay off", 4): r"\b(?:pay|pays|paying|paid) (?:him|her|them|you|me|the (?:police|officials?|guards?|warder|judge|customs))\b[^.?!]{0,6}?\boff\b|\b(?:bribe|bribed|bribery|hush money|hush-money)\b",
    ("pay off", 5): r"\b(?:pay|pays|paying|paid) (?:him|her|them|you|me) off\b[^.?!]{0,20}?\b(?:for (?:this|that|it|what|everything)|revenge|settle (?:with|the score))\b",
    ("pay off", 1): r"^(?!.*(?:\b(?:pay|pays|paying|paid) off\b[^.?!]{0,15}?\b(?:the )?(?:cabmen|laundress|drivers?|workmen|servants|hands|crew|sailors|seamen|employees|men|waiters?|porters?|labourers?|laborers?)\b|\b(?:men|cabmen|laundress|drivers|workmen|servants|crew|sailors|seamen|labourers?|laborers?)\b[^.?!]{0,25}?\b(?:pay|pays|paying|paid) off\b))(?!.*(?:\b(?:pay|pays|paying|paid) off\b[^.?!]{0,20}?\b(?:in the end|at last|richly|handsomely|splendidly|finally|well|itself)\b))(?!.*(?:\b(?:pay|pays|paying|paid) (?:him|her|them|you|me|the (?:police|officials?|guards?|warder|judge|customs))\b[^.?!]{0,6}?\boff\b|\b(?:bribe|bribed|bribery|hush money|hush-money)\b))(?!.*(?:\b(?:pay|pays|paying|paid) (?:him|her|them|you|me) off\b[^.?!]{0,20}?\b(?:for (?:this|that|it|what|everything)|revenge|settle (?:with|the score))\b)).*\b(?:pay|pays|paying|paid) off\b",
    # pull in
    ("pull in", 2): r"\bpull(?:s|ed|ing)? in\b[^.?!]{0,15}?\b(?:money|a (?:fortune|salary|wage)|thousands?|hundreds?|pounds?|dollars?|a (?:good |fine )?(?:sum|income|profit))\b",
    ("pull in", 3): r"\b(?:train|boat|ship|vessel|steamer|ferry|sled|sleds|sledge|car|cab|carriage|tug)\b[^.?!]{0,20}?\bpull(?:s|ed|ing)? in\b|\bpull(?:s|ed|ing)? in\b[^.?!]{0,15}?\b(?:to|at|into|among|from)\b[^.?!]{0,18}?\b(?:bank|shore|wharf|harbour|harbor|pier|dock|reeds|station|camp|stop|sunshine|river|quay)\b",
    ("pull in", 4): r"\bpull(?:s|ed|ing)? in\b[^.?!]{0,15}?\b(?:all directions|two halves|hand over hand|his head|her head|legs?|arms?|oars?|the line|the rope|the cord|head and legs)\b|\b(?:head and legs|his head|her head|oars?)\b[^.?!]{0,15}?\bpull(?:s|ed|ing)? in\b",
    ("pull in", 5): r"\bpull(?:s|ed|ing)? in\b[^.?!]{0,15}?\b(?:the (?:harvest|crops?|fish|nets?|sails?|slack)|troops|forces|reinforcements)\b",
    ("pull in", 1): r"^(?!.*(?:\bpull(?:s|ed|ing)? in\b[^.?!]{0,15}?\b(?:money|a (?:fortune|salary|wage)|thousands?|hundreds?|pounds?|dollars?|a (?:good |fine )?(?:sum|income|profit))\b))(?!.*(?:\b(?:train|boat|ship|vessel|steamer|ferry|sled|sleds|sledge|car|cab|carriage|tug)\b[^.?!]{0,20}?\bpull(?:s|ed|ing)? in\b|\bpull(?:s|ed|ing)? in\b[^.?!]{0,15}?\b(?:to|at|into|among|from)\b[^.?!]{0,18}?\b(?:bank|shore|wharf|harbour|harbor|pier|dock|reeds|station|camp|stop|sunshine|river|quay)\b))(?!.*(?:\bpull(?:s|ed|ing)? in\b[^.?!]{0,15}?\b(?:all directions|two halves|hand over hand|his head|her head|legs?|arms?|oars?|the line|the rope|the cord|head and legs)\b|\b(?:head and legs|his head|her head|oars?)\b[^.?!]{0,15}?\bpull(?:s|ed|ing)? in\b))(?!.*(?:\bpull(?:s|ed|ing)? in\b[^.?!]{0,15}?\b(?:the (?:harvest|crops?|fish|nets?|sails?|slack)|troops|forces|reinforcements)\b)).*\bpull(?:s|ed|ing)? in\b",
    # send off
    ("send off", 2): r"\bs(?:end(?:s|ing)?|ent) off\b[^.?!]{0,15}?\b(?:sparks?|fire|flames?|light|rays?|smoke|dust|heat|fumes?|steam)\b|\b(?:sparks?|flames?|rays?|smoke)\b[^.?!]{0,15}?\bs(?:end(?:s|ing)?|ent) off\b",
    ("send off", 3): r"\bs(?:end(?:s|ing)?|ent) (?:him|her|them|you|me|us) off\b|\bs(?:end(?:s|ing)?|ent) off\b[^.?!]{0,15}?\b(?:with (?:cheers?|a (?:cheer|kiss|goodbye|flower))|to (?:the )?(?:station|war|front|battle|boat|train|school))\b",
    ("send off", 1): r"^(?!.*(?:\bs(?:end(?:s|ing)?|ent) off\b[^.?!]{0,15}?\b(?:sparks?|fire|flames?|light|rays?|smoke|dust|heat|fumes?|steam)\b|\b(?:sparks?|flames?|rays?|smoke)\b[^.?!]{0,15}?\bs(?:end(?:s|ing)?|ent) off\b))(?!.*(?:\bs(?:end(?:s|ing)?|ent) (?:him|her|them|you|me|us) off\b|\bs(?:end(?:s|ing)?|ent) off\b[^.?!]{0,15}?\b(?:with (?:cheers?|a (?:cheer|kiss|goodbye|flower))|to (?:the )?(?:station|war|front|battle|boat|train|school))\b)).*\bs(?:end(?:s|ing)?|ent) off\b",
    # take after
    ("take after", 2): r"\b(?:take|takes|taking|took|taken) after\b[^.?!]{0,20}?\b(?:in (?:a|the) chase|in pursuit|at (?:his|her|full|top) (?:heels|speed)|running|chasing|hot pursuit)\b",
    ("take after", 3): r"\b(?:take|takes|taking|took|taken) after\b[^.?!]{0,15}?\b(?:example|manner|fashion|ways|conduct|habits?|in everything|footsteps|virtues)\b",
    ("take after", 1): r"^(?!.*(?:\b(?:take|takes|taking|took|taken) after\b[^.?!]{0,20}?\b(?:in (?:a|the) chase|in pursuit|at (?:his|her|full|top) (?:heels|speed)|running|chasing|hot pursuit)\b))(?!.*(?:\b(?:take|takes|taking|took|taken) after\b[^.?!]{0,15}?\b(?:example|manner|fashion|ways|conduct|habits?|in everything|footsteps|virtues)\b)).*\b(?:take|takes|taking|took|taken) after\b",
    # wind up
    ("wind up", 2): r"\b(?:wind(?:s|ing)?|wound) up\b[^.?!]{0,25}?\b(?:watch|watches|clock|clocks|timepiece|spring)\b|\b(?:watch|watches|clock|clocks|timepiece)\b[^.?!]{0,40}?\b(?:wind(?:s|ing)?|wound) up\b",
    ("wind up", 3): r"\b(?:wind(?:s|ing)?|wound) up\b[^.?!]{0,12}?\bwith\b",
    ("wind up", 4): r"\b(?:wind(?:s|ing)?|wound) up\b[^.?!]{0,18}?\b(?:estate|business|concern|affairs?|company|partnership|accounts?|the firm)\b",
    ("wind up", 5): r"\b(?:wind(?:s|ing)?|wound) (?:him|her|them|you|me|us) up\b",
    ("wind up", 6): r"\b(?:wind(?:s|ing)?|wound) up\b[^.?!]{0,10}?\b(?:his|her|the) arm\b|\b(?:wind(?:s|ing)?|wound) up\b[^.?!]{0,10}?\b(?:to (?:pitch|throw)|the ball)\b",
    ("wind up", 1): r"^(?!.*(?:\b(?:wind(?:s|ing)?|wound) up\b[^.?!]{0,25}?\b(?:watch|watches|clock|clocks|timepiece|spring)\b|\b(?:watch|watches|clock|clocks|timepiece)\b[^.?!]{0,40}?\b(?:wind(?:s|ing)?|wound) up\b))(?!.*(?:\b(?:wind(?:s|ing)?|wound) up\b[^.?!]{0,12}?\bwith\b))(?!.*(?:\b(?:wind(?:s|ing)?|wound) up\b[^.?!]{0,18}?\b(?:estate|business|concern|affairs?|company|partnership|accounts?|the firm)\b))(?!.*(?:\b(?:wind(?:s|ing)?|wound) (?:him|her|them|you|me|us) up\b))(?!.*(?:\b(?:wind(?:s|ing)?|wound) up\b[^.?!]{0,10}?\b(?:his|her|the) arm\b|\b(?:wind(?:s|ing)?|wound) up\b[^.?!]{0,10}?\b(?:to (?:pitch|throw)|the ball)\b)).*\b(?:wind(?:s|ing)?|wound) up\b",
    # keep off
    ("keep off", 2): r"\bk(?:eep(?:s|ing)?|ept) off\b[^.?!]{0,15}?\b(?:the (?:drink|whisky|whiskey|wine|beer|spirits)|drink|whisky|whiskey|wine|beer|tobacco)\b",
    ("keep off", 3): r"\bk(?:eep(?:s|ing)?|ept) off\b[^.?!]{0,15}?\b(?:the (?:darkness|evil spirits?|shadow|cold|damp|sun|wind|moths?|premises)|evil spirits?|darkness|the (?:premises|wolves|dogs|birds|mosquitoes|insects?|lovers?))\b",
    ("keep off", 4): r"\b(?:rain|drizzle|shower)\b[^.?!]{0,20}?\bk(?:eep(?:s|ing)?|ept) off\b|\bk(?:eep(?:s|ing)?|ept) off\b[^.?!]{0,15}?\b(?:the rain|the wet|the shower)\b",
    ("keep off", 1): r"^(?!.*(?:\bk(?:eep(?:s|ing)?|ept) off\b[^.?!]{0,15}?\b(?:the (?:drink|whisky|whiskey|wine|beer|spirits)|drink|whisky|whiskey|wine|beer|tobacco)\b))(?!.*(?:\bk(?:eep(?:s|ing)?|ept) off\b[^.?!]{0,15}?\b(?:the (?:darkness|evil spirits?|shadow|cold|damp|sun|wind|moths?|premises)|evil spirits?|darkness|the (?:premises|wolves|dogs|birds|mosquitoes|insects?|lovers?))\b))(?!.*(?:\b(?:rain|drizzle|shower)\b[^.?!]{0,20}?\bk(?:eep(?:s|ing)?|ept) off\b|\bk(?:eep(?:s|ing)?|ept) off\b[^.?!]{0,15}?\b(?:the rain|the wet|the shower)\b)).*\bk(?:eep(?:s|ing)?|ept) off\b",
    # sell out
    ("sell out", 2): r"\b(?:sell|sells|selling|sold) out\b[^.?!]{0,15}?\b(?:of\s+)?(?:(?:the|his|her|their|my|your|its|a|an)\s+)?(?:business|shares?|stock|debentures?|interests?|concern|property|estate|investments?|practi[sc]e|rights)\b|\b(?:shares?|stock|debentures?|interests?|business|property|estate|practi[sc]e|rights)\b[^.?!]{0,20}?\b(?:sell|sells|selling|sold) out\b|\b(?:sell|sells|selling|sold) out\b\s+of\b",
    ("sell out", 3): r"\b(?:you|we|they|he|she|i|ye)\b[^.?!]{0,12}?(?:are|were|is|was|am|been|'re|'s|'ve)\b[^.?!]{0,6}?\bsold out\b|\bsold out\b[^.?!]{0,15}?\b(?:to the (?:enemy|whites?|police|government|indians?)|to (?:his|their) (?:enemies|friends|masters))\b",
    ("sell out", 1): r"^(?!.*(?:\b(?:sell|sells|selling|sold) out\b[^.?!]{0,15}?\b(?:of\s+)?(?:(?:the|his|her|their|my|your|its|a|an)\s+)?(?:business|shares?|stock|debentures?|interests?|concern|property|estate|investments?|practi[sc]e|rights)\b|\b(?:shares?|stock|debentures?|interests?|business|property|estate|practi[sc]e|rights)\b[^.?!]{0,20}?\b(?:sell|sells|selling|sold) out\b|\b(?:sell|sells|selling|sold) out\b\s+of\b))(?!.*(?:\b(?:you|we|they|he|she|i|ye)\b[^.?!]{0,12}?(?:are|were|is|was|am|been|'re|'s|'ve)\b[^.?!]{0,6}?\bsold out\b|\bsold out\b[^.?!]{0,15}?\b(?:to the (?:enemy|whites?|police|government|indians?)|to (?:his|their) (?:enemies|friends|masters))\b)).*\b(?:sell|sells|selling|sold) out\b",
    # bridge over
    ("bridge over", 2): r"\bbridg(?:e|es|ed|ing) (?:sb |him |her |them |us |me |it )?over\b|\bbridg(?:e|es|ed|ing) over\b[^.?!]{0,15}?\b(?:until|till|the (?:winter|night|interval))\b",
    ("bridge over", 1): r"^(?!.*(?:\bbridg(?:e|es|ed|ing) (?:sb |him |her |them |us |me |it )?over\b|\bbridg(?:e|es|ed|ing) over\b[^.?!]{0,15}?\b(?:until|till|the (?:winter|night|interval))\b)).*\bbridg(?:e|es|ed|ing) over\b",
    # clean up
    ("clean up", 2): r"\bclean(?:s|ed|ing)? up\b(?=\s*for\b)|\bclean(?:s|ed|ing)? up\b[^.?!]{0,10}?\b(?:himself|herself|myself|yourself|themselves|for (?:thee|you|me|him|her|us))\b",
    ("clean up", 3): r"\bclean(?:s|ed|ing)? up\b[^.?!]{0,15}?\b(?:garbage|rubbish|refuse|slops|mess|dirt|filth|corruption|the (?:city|town|streets?|slums?|yards?))\b",
    ("clean up", 4): r"\bclean(?:s|ed|ing)? up\b[^.?!]{0,15}?\b(?:a (?:fortune|million|packet|pile)|money|profit|on the (?:market|deal|stock|exchange))\b",
    ("clean up", 1): r"^(?!.*(?:\bclean(?:s|ed|ing)? up\b(?=\s*for\b)|\bclean(?:s|ed|ing)? up\b[^.?!]{0,10}?\b(?:himself|herself|myself|yourself|themselves|for (?:thee|you|me|him|her|us))\b))(?!.*(?:\bclean(?:s|ed|ing)? up\b[^.?!]{0,15}?\b(?:garbage|rubbish|refuse|slops|mess|dirt|filth|corruption|the (?:city|town|streets?|slums?|yards?))\b))(?!.*(?:\bclean(?:s|ed|ing)? up\b[^.?!]{0,15}?\b(?:a (?:fortune|million|packet|pile)|money|profit|on the (?:market|deal|stock|exchange))\b)).*\bclean(?:s|ed|ing)? up\b",
    # fit in
    ("fit in", 2): r"\bfit(?:s|ted|ting|ed|ing)? in\b[^.?!]{0,10}?\bwith\b[^.?!]{0,10}?\b(?:the (?:facts?|story|account|evidence|views?|theory|scheme|plan|idea|notion|arrangement|arrangements|rest|world)|that|this|it|everything)\b",
    ("fit in", 3): r"\bfit(?:s|ted|ting|ed|ing)? in\b[^.?!]{0,15}?\b(?:the (?:drawer|box|room|space|hole|slot|case|pocket|cupboard|niche|pattern)|drawer|box|space|hole|slot)\b|\bfit(?:s|ted|ting|ed|ing)? in\b\s*[.,]",
    ("fit in", 1): r"^(?!.*(?:\bfit(?:s|ted|ting|ed|ing)? in\b[^.?!]{0,10}?\bwith\b[^.?!]{0,10}?\b(?:the (?:facts?|story|account|evidence|views?|theory|scheme|plan|idea|notion|arrangement|arrangements|rest|world)|that|this|it|everything)\b))(?!.*(?:\bfit(?:s|ted|ting|ed|ing)? in\b[^.?!]{0,15}?\b(?:the (?:drawer|box|room|space|hole|slot|case|pocket|cupboard|niche|pattern)|drawer|box|space|hole|slot)\b|\bfit(?:s|ted|ting|ed|ing)? in\b\s*[.,])).*\bfit(?:s|ted|ting|ed|ing)? in\b",
    # hang around
    ("hang around", 2): r"\b(?:hang(?:s|ing)?|hung) around\b[^.?!]{0,15}?\b(?:his|her|my|your|their|its|the|a)\s+(?:neck|necks|shoulders?|arms?|waist|bough|branches|branch|pole|post|walls?|edge|rim)\b|\b(?:neck|necks|shoulders?|branches|walls?|edge|rim)\b[^.?!]{0,20}?\b(?:hang(?:s|ing)?|hung) around\b",
    ("hang around", 1): r"^(?!.*(?:\b(?:hang(?:s|ing)?|hung) around\b[^.?!]{0,15}?\b(?:his|her|my|your|their|its|the|a)\s+(?:neck|necks|shoulders?|arms?|waist|bough|branches|branch|pole|post|walls?|edge|rim)\b|\b(?:neck|necks|shoulders?|branches|walls?|edge|rim)\b[^.?!]{0,20}?\b(?:hang(?:s|ing)?|hung) around\b)).*\b(?:hang(?:s|ing)?|hung) around\b",
    # knock down
    ("knock down", 3): r"\bknock(?:s|ed|ing)? down\b[^.?!]{0,15}?\b(?:building|buildings|house|houses|wall|walls|chimney|chimneys|shed|barn|cottage|structure|factory|tree|trees|gate|gates)\b",
    ("knock down", 4): r"\bknock(?:s|ed|ing)? down\b[^.?!]{0,15}?\b(?:the (?:price|prices|cost|figure)|price|prices|at auction|to (?:a )?(?:low|less))\b",
    ("knock down", 1): r"^(?!.*(?:\bknock(?:s|ed|ing)? down\b[^.?!]{0,15}?\b(?:building|buildings|house|houses|wall|walls|chimney|chimneys|shed|barn|cottage|structure|factory|tree|trees|gate|gates)\b))(?!.*(?:\bknock(?:s|ed|ing)? down\b[^.?!]{0,15}?\b(?:the (?:price|prices|cost|figure)|price|prices|at auction|to (?:a )?(?:low|less))\b)).*\bknock(?:s|ed|ing)? down\b",
    # let off
    ("let off", 2): r"\blet(?:s|ting)? off\b[^.?!]{0,15}?\b(?:gun|guns|rifle|pistol|shot|shots|firework|fireworks|rocket|rockets|shell|bomb|musket|revolver|cannon|martini-henry|crackers?)\b",
    ("let off", 3): r"\blet(?:s|ting)? off\b[^.?!]{0,15}?\b(?:rage|anger|fury|steam|passion|temper|wrath|its chain)\b",
    ("let off", 4): r"\blet(?:s|ting)? off\b[^.?!]{0,15}?\b(?:the (?:two |three )?(?:top )?(?:floors?|rooms?|flat|house)|floors?|apartments?)\b",
    ("let off", 1): r"^(?!.*(?:\blet(?:s|ting)? off\b[^.?!]{0,15}?\b(?:gun|guns|rifle|pistol|shot|shots|firework|fireworks|rocket|rockets|shell|bomb|musket|revolver|cannon|martini-henry|crackers?)\b))(?!.*(?:\blet(?:s|ting)? off\b[^.?!]{0,15}?\b(?:rage|anger|fury|steam|passion|temper|wrath|its chain)\b))(?!.*(?:\blet(?:s|ting)? off\b[^.?!]{0,15}?\b(?:the (?:two |three )?(?:top )?(?:floors?|rooms?|flat|house)|floors?|apartments?)\b)).*\blet(?:s|ting)? off\b",
    # step up
    ("step up", 2): r"\bstep(?:s|ped|ping|ed|ing)? up\b[^.?!]{0,15}?\b(?:production|output|the (?:pace|rate|effort|efforts|pressure|action|work|attack|drive|campaign)|efforts?|activity|security|measures)\b",
    ("step up", 3): r"\bstep(?:s|ped|ping|ed|ing)? up\b[^.?!]{0,15}?\b(?:the (?:engine|motor|revs?|gas|throttle)|engine|revs?)\b",
    ("step up", 4): r"\bstep(?:s|ped|ping|ed|ing)? up\b[^.?!]{0,15}?\bto (?:do|take|help|defend|act|meet|save|speak|lead|assume|fill)\b",
    ("step up", 1): r"^(?!.*(?:\bstep(?:s|ped|ping|ed|ing)? up\b[^.?!]{0,15}?\b(?:production|output|the (?:pace|rate|effort|efforts|pressure|action|work|attack|drive|campaign)|efforts?|activity|security|measures)\b))(?!.*(?:\bstep(?:s|ped|ping|ed|ing)? up\b[^.?!]{0,15}?\b(?:the (?:engine|motor|revs?|gas|throttle)|engine|revs?)\b))(?!.*(?:\bstep(?:s|ped|ping|ed|ing)? up\b[^.?!]{0,15}?\bto (?:do|take|help|defend|act|meet|save|speak|lead|assume|fill)\b)).*\bstep(?:s|ped|ping|ed|ing)? up\b",
    # use up
    ("use up", 2): r"\bus(?:e|es|ed|ing) up\b[^.?!]{0,15}?\b(?:time|space|room|the (?:time|space|room|hours)|hours|days|air|the air)\b",
    ("use up", 1): r"^(?!.*(?:\bus(?:e|es|ed|ing) up\b[^.?!]{0,15}?\b(?:time|space|room|the (?:time|space|room|hours)|hours|days|air|the air)\b)).*\bus(?:e|es|ed|ing) up\b",
    # watch out
    ("watch out", 2): r"\bwatch out\b\s*[!]|\bwatch out\b\s*,|\b(?:then|but|and|now)\s+watch out\b|\bwatch(?:es|ed|ing)? out\b(?!\s+(?:for|of|to|or|that|the|a|an|his|her|their|my|your|its|our|him|her|them|it|us|me|you|what|how|when|why|who|these|those|this|all|and|but|if|as|which|there)\b)",
    ("watch out", 1): r"^(?!.*(?:\bwatch out\b\s*[!]|\bwatch out\b\s*,|\b(?:then|but|and|now)\s+watch out\b|\bwatch(?:es|ed|ing)? out\b(?!\s+(?:for|of|to|or|that|the|a|an|his|her|their|my|your|its|our|him|her|them|it|us|me|you|what|how|when|why|who|these|those|this|all|and|but|if|as|which|there)\b))).*\bwatch(?:es|ed|ing)? out\b",
    # acquiesce in
    ("acquiesce in", 1): r"\bacquiesc(?:e|es|ed|ing) in\b",
    # act up
    ("act up", 1): r"\bact(?:s|ed|ing)? up to\b",
    ("act up", 3): r"\bact(?:s|ed|ing)? up\b[^.?!]{0,15}?\b(?:illness|pain|leg|knee|heart|machine|engine|old (?:wound|injury)|again|stomach|tooth|rheumatism)\b",
    ("act up", 2): r"\b(?:boys?|girls?|children?|child|kids?|lubber|pupils?|scholars?)\b[^.?!;,]{0,20}?\bact(?:s|ed|ing)?\s+up\b(?!\s+to\b)|\b(?:he|she|they|we|I|you)\b[^.?!;,]{0,15}?\bact(?:s|ed|ing)?\s+up\b(?!\s+to\b)",
    # advantage over
    ("advantage over", 1): r"\badvantag(?:e|es|d|ing) over\b",
    # blow up
    ("blow up", 1): r"\b(?:blow(?:s|ing|n)?|blew|blowed)\s+up\b[^.?!;,]{0,20}?\b(?:(?:the|a|an|his|her|my|your|their|our|its|this|that|these|those|some|any|no|every|all the|[A-Za-z\u2019\x27]+[\u2019\x27]s)\s+(?:\w+\s+){0,2})?(?:bridges?|buildings?|houses?|ships?|towns?|walls?|gates?|trains?|factor(?:y|ies)|works|mines?|forts?|towers?|magazines?|gladstone|dynamite|invaders?|guns?|position|enemy|fleet|city|village|boats?|vessels?|rafts?|bank|dam|arch|church|palace|castle|hotel|station|road|railway|tunnel)\b|\b(?:bridges?|buildings?|houses?|walls?|gates?|trains?|factor(?:y|ies)|works|forts?|towers?|fleet|position|city|village)\b[^.?!;,]{0,25}?\b(?:blown|blow|blows|blowing|blew|blowed)\s+up\b",
    ("blow up", 3): r"\b(?:blow(?:s|ing|n)?|blew|blowed) up\b[^.?!]{0,12}?\b(?:grey|gray|cold|dark|stormy|from the (?:north|south|east|west)|winter|wind|weather|rain)\b|\b(?:it|the wind|wind|weather)\s+(?:(?:is|was|were|had|has|have|will|would|might|may|can|could|'s|'ll)\s+)?(?:blow(?:s|ing)?|blew) up\b(?:\s+(?:\w+\s+){0,3}\b(?:grey|gray|cold|dark|stormy|winter|wintry|wind|weather|rain|snow)\b|(?![ \t]*\w))",
    ("blow up", 4): r"\b(?:blow(?:s|ing|n)?|blew|blowed) up\b[^.?!]{0,15}?\b(?:in a rage|with anger|angrily|in fury|rage)\b",
    ("blow up", 5): r"\b(?:blow(?:s|ing|n)?|blew|blowed) up\b[^.?!]{0,15}?\b(?:the (?:matter|story|affair|thing|event|incident|whole)|out of (?:all )?proportion|too much|all proportion)\b",
    ("blow up", 6): r"\b(?:blow(?:s|ing|n)?|blew|blowed) up\b[^.?!]{0,15}?\b(?:balloon|balloons|bladder|bladders|tyre|tire|bag|bags|sausage|bubble)\b|\b(?:balloons?|bladders?|tyres?|tires?|bags?|bubbles?)\b[^.?!]{0,20}?\b(?:blow(?:s|ing|n)?|blew|blowed) up\b",
    ("blow up", 2): r"\b(?:was|were|been|being|is|are|be)\s+(?:blown|blowed)\s+up\b|\b(?:ammunition|explosives?|powder|magazine|craft|airship|ship|vessel|boat|boiler|engine|chambers?|guns?|mines?|things?)\b[^.?!;,]{0,20}?\b(?:blow(?:s|ing|n)?|blew|blowed)\s+up\b|\b(?:should|would|will|might|must|may|can|could)\s+(?:blow|blew)\s+up\b(?!\s+(?:the|a|an|his|her|their|our|my|your|it|them)\s)",
    # put back
    ("put back", 2): r"\bput(?:s|ting)? back\b[^.?!]{0,15}?\b(?:the (?:report|accounts?|motion|bill|matter|decision|meeting|question|plan|scheme|date|vote|proposal)|accounts?|till|until|for a (?:week|month|while|day))\b|\b(?:report|accounts?|motion|bill|matter|meeting|question|date|vote|proposal)\b[^.?!]{0,25}?\bput(?:s|ting)? back\b",
    ("put back", 3): r"\bput(?:s|ting)? back\b[^.?!]{0,15}?\b(?:into|to)\b[^.?!]{0,15}?\b(?:port|harbour|harbor|shore|the (?:port|harbour|harbor))\b|\b(?:ship|vessel|boat|boatload|steamer)\b[^.?!]{0,20}?\bput(?:s|ting)? back\b|\bput(?:s|ting)? back\s*[\u2014-]\s*put(?:s|ting)? back\b",
    ("put back", 4): r"\bput(?:s|ting)? back\b[^.?!]{0,15}?\b(?:the |her |his |my |their )?(?:hair|curtain|curtains|blind|clothes|cloak|veil)\b",
    ("put back", 5): r"\bset(?:s|ting)? (?:sb |him |her |them |us |me )?back\b[^.?!]{0,15}?\b(?:\u00a3|\$|\d+|a (?:hundred|thousand)|pounds?|dollars?)\b",
    ("put back", 1): r"^(?!.*(?:\bput(?:s|ting)? back\b[^.?!]{0,15}?\b(?:the (?:report|accounts?|motion|bill|matter|decision|meeting|question|plan|scheme|date|vote|proposal)|accounts?|till|until|for a (?:week|month|while|day))\b|\b(?:report|accounts?|motion|bill|matter|meeting|question|date|vote|proposal)\b[^.?!]{0,25}?\bput(?:s|ting)? back\b))(?!.*(?:\bput(?:s|ting)? back\b[^.?!]{0,15}?\b(?:into|to)\b[^.?!]{0,15}?\b(?:port|harbour|harbor|shore|the (?:port|harbour|harbor))\b|\b(?:ship|vessel|boat|boatload|steamer)\b[^.?!]{0,20}?\bput(?:s|ting)? back\b|\bput(?:s|ting)? back\s*[\u2014-]\s*put(?:s|ting)? back\b))(?!.*(?:\bput(?:s|ting)? back\b[^.?!]{0,15}?\b(?:the |her |his |my |their )?(?:hair|curtain|curtains|blind|clothes|cloak|veil)\b))(?!.*(?:\bset(?:s|ting)? (?:sb |him |her |them |us |me )?back\b[^.?!]{0,15}?\b(?:\u00a3|\$|\d+|a (?:hundred|thousand)|pounds?|dollars?)\b)).*\bput(?:s|ting)? back\b",
    # take over
    ("take over", 2): r"\b(?:take|takes|taking|took|taken) over\b[^.?!]{0,15}?\b(?:the (?:whole )?(?:flat|house|houses|rooms?|building|place|premises|land|country|city|town|territory|world|island))\b",
    ("take over", 3): r"\b(?:take|takes|taking|took|taken) over\b[^.?!]{0,4}?\b(?:him|her|them|you|me|us)\b",
    ("take over", 4): r"\b(?:take|takes|taking|took|taken) over\b[^.?!]{0,15}?\b(?:the (?:company|business|firm|concern|property|estate|works|trade|management)|a (?:company|business|firm|concern)|shares?|control of|ownership)\b",
    ("take over", 1): r"^(?!.*(?:\b(?:take|takes|taking|took|taken) over\b[^.?!]{0,15}?\b(?:the (?:whole )?(?:flat|house|houses|rooms?|building|place|premises|land|country|city|town|territory|world|island))\b))(?!.*(?:\b(?:take|takes|taking|took|taken) over\b[^.?!]{0,4}?\b(?:him|her|them|you|me|us)\b))(?!.*(?:\b(?:take|takes|taking|took|taken) over\b[^.?!]{0,15}?\b(?:the (?:company|business|firm|concern|property|estate|works|trade|management)|a (?:company|business|firm|concern)|shares?|control of|ownership)\b)).*\b(?:take|takes|taking|took|taken) over\b",
    # try out
    ("try out", 2): r"\btr(?:y|ies|ied|ying) out\b[^.?!]{0,20}?\b(?:blubber|oil|fat|scraps|crisp|fritters|whale|unctuous)\b|\b(?:blubber|fritters|scraps)\b[^.?!]{0,20}?\btr(?:y|ies|ied|ying) out\b",
    ("try out", 3): r"\btr(?:y|ies|ied|ying) out\b[^.?!]{0,15}?\bfor\b[^.?!]{0,15}?\b(?:a (?:part|role|place|position)|the (?:part|role|team|company|cast))\b",
    ("try out", 4): r"\btr(?:y|ies|ied|ying) out\b[^.?!]{0,15}?\b(?:a (?:new|different)|new (?:ideas?|methods?|things?|invention))\b",
    ("try out", 1): r"^(?!.*(?:\btr(?:y|ies|ied|ying) out\b[^.?!]{0,20}?\b(?:blubber|oil|fat|scraps|crisp|fritters|whale|unctuous)\b|\b(?:blubber|fritters|scraps)\b[^.?!]{0,20}?\btr(?:y|ies|ied|ying) out\b))(?!.*(?:\btr(?:y|ies|ied|ying) out\b[^.?!]{0,15}?\bfor\b[^.?!]{0,15}?\b(?:a (?:part|role|place|position)|the (?:part|role|team|company|cast))\b))(?!.*(?:\btr(?:y|ies|ied|ying) out\b[^.?!]{0,15}?\b(?:a (?:new|different)|new (?:ideas?|methods?|things?|invention))\b)).*\btr(?:y|ies|ied|ying) out\b",
    # beset by
    ("beset by", 2): r"\bbeset(?:s|ting|ed|ing)? by\b[^.?!]{0,20}?\b(?:huskies|dogs|wolves|enemies|indians|savages|men|soldiers|sharks|beasts|thieves|robbers|pirates|mobs?)\b",
    ("beset by", 1): r"^(?!.*(?:\bbeset(?:s|ting|ed|ing)? by\b[^.?!]{0,20}?\b(?:huskies|dogs|wolves|enemies|indians|savages|men|soldiers|sharks|beasts|thieves|robbers|pirates|mobs?)\b)).*\bbeset(?:s|ting|ed|ing)? by\b",
    # check in
    ("check in", 1): r"\bcheck(?:s|ed|ing)? in\b[^.?!]{0,15}?\b(?:at|to|into)\b[^.?!]{0,15}?\b(?:the |a )?(?:hotel|inn|motel|airport|desk|office|hospital|station|house)\b",
    ("check in", 2): r"\bcheck(?:s|ed|ing)?\s+in\s+(?:mid-\w+|mid\s+\w+|rapt|attention|(?:his|her|its)\s+(?:transports?|career|course|stride|flight|tracks?|run))\b",
    # give back
    ("give back", 2): r"\b(?:gleam|light|glare|shine|sound|echo|voice|breath|waves?|colour|color|image|reflection|music|ring|answer)\b[^.?!]{0,20}?\b(?:giv(?:e|es|ing)|gave|given) back\b|\b(?:giv(?:e|es|ing)|gave|given) back\b[^.?!]{0,15}?\b(?:the (?:gleam|light|glare|sound|echo|voice|breath|waves?|colour|color)|long and harsh|harsh)\b",
    ("give back", 1): r"^(?!.*(?:\b(?:gleam|light|glare|shine|sound|echo|voice|breath|waves?|colour|color|image|reflection|music|ring|answer)\b[^.?!]{0,20}?\b(?:giv(?:e|es|ing)|gave|given) back\b|\b(?:giv(?:e|es|ing)|gave|given) back\b[^.?!]{0,15}?\b(?:the (?:gleam|light|glare|sound|echo|voice|breath|waves?|colour|color)|long and harsh|harsh)\b)).*\b(?:giv(?:e|es|ing)|gave|given) back\b",
    # ===== 块 B″ 第九批（2026-10-10 二十一续 · 30 词）=====
    # knock out
    ("knock out", 2): r"\bknock(?:s|ed|ing)? out\b[^.?!]{0,18}?\b(?:contest|competition|tournament|championship|round|cup|match|fight|opponent)\b|\b(?:contest|competition|tournament|championship|round)\b[^.?!]{0,25}?\bknock(?:s|ed|ing)? out\b",
    ("knock out", 3): r"\bknock(?:s|ed|ing)? out\b[^.?!]{0,15}?\b(?:eye|eyes|teeth|tooth|bottom|brains|window|glass|panel|support|light)\b|\b(?:eye|eyes|teeth|bottom|brains|panel)\b[^.?!]{0,20}?\bknock(?:s|ed|ing)? out\b",
    ("knock out", 4): r"\bknock(?:s|ed|ing)? out\b[^.?!]{0,15}?\b(?:admiration|delight|beauty|charm|audience|performance|everyone)\b|\bknock (?:them|him|her|us|you) out\b",
    ("knock out", 5): r"\bknock(?:s|ed|ing)? out\b[^.?!]{0,12}?\b(?:pipe|pipes|ashes|ash|tobacco|bowl|ashes of)\b|\b(?:pipe|tobacco)\b[^.?!]{0,18}?\bknock(?:s|ed|ing)? out\b",
    ("knock out", 6): r"\b(?:seemed|looked|felt|utterly|quite|almost|fairly|completely|so|pretty well) (?:[a-z']+ ){0,3}?knocked out\b|\bknocked out\b[^.?!]{0,10}?\b(?:with fatigue|exhausted|tired|by the day)\b",
    ("knock out", 1): r"^(?!.*(?:\bknock(?:s|ed|ing)? out\b[^.?!]{0,18}?\b(?:contest|competition|tournament|championship|round|cup|match|fight|opponent)\b|\b(?:contest|competition|tournament|championship|round)\b[^.?!]{0,25}?\bknock(?:s|ed|ing)? out\b))(?!.*(?:\bknock(?:s|ed|ing)? out\b[^.?!]{0,15}?\b(?:eye|eyes|teeth|tooth|bottom|brains|window|glass|panel|support|light)\b|\b(?:eye|eyes|teeth|bottom|brains|panel)\b[^.?!]{0,20}?\bknock(?:s|ed|ing)? out\b))(?!.*(?:\bknock(?:s|ed|ing)? out\b[^.?!]{0,15}?\b(?:admiration|delight|beauty|charm|audience|performance|everyone)\b|\bknock (?:them|him|her|us|you) out\b))(?!.*(?:\bknock(?:s|ed|ing)? out\b[^.?!]{0,12}?\b(?:pipe|pipes|ashes|ash|tobacco|bowl|ashes of)\b|\b(?:pipe|tobacco)\b[^.?!]{0,18}?\bknock(?:s|ed|ing)? out\b))(?!.*(?:\b(?:seemed|looked|felt|utterly|quite|almost|fairly|completely|so|pretty well) (?:[a-z']+ ){0,3}?knocked out\b|\bknocked out\b[^.?!]{0,10}?\b(?:with fatigue|exhausted|tired|by the day)\b)).*\bknock(?:s|ed|ing)? out\b",
    # stay up
    ("stay up", 2): r"\bstay(?:s|ed|ing)? up\b[^.?!]{0,10}?\b(?:there|upstairs|above|in|at|on)\b",
    ("stay up", 1): r"^(?!.*(?:\bstay(?:s|ed|ing)? up\b[^.?!]{0,10}?\b(?:there|upstairs|above|in|at|on)\b)).*\bstay(?:s|ed|ing)? up\b",
    # step down
    ("step down", 2): r"\bstep(?:s|ped|ping)? down\b[^.?!]{0,15}?\b(?:office|position|place|throne|power|seat|post|chair|rank|crown)\b|\bfrom a high place\b",
    ("step down", 3): r"\bstep(?:s|ped|ping)? down\b[^.?!]{0,15}?\b(?:level|rate|scale|speed|pace|intensity|production|output)\b",
    ("step down", 1): r"^(?!.*(?:\bstep(?:s|ped|ping)? down\b[^.?!]{0,15}?\b(?:office|position|place|throne|power|seat|post|chair|rank|crown)\b|\bfrom a high place\b))(?!.*(?:\bstep(?:s|ped|ping)? down\b[^.?!]{0,15}?\b(?:level|rate|scale|speed|pace|intensity|production|output)\b)).*\bstep(?:s|ped|ping)? down\b",
    # try on
    ("try on", 2): r"\btr(?:y|ies|ying|ied) on\b[^.?!]{0,15}?\b(?:measure|measures|expedient|method|plan|scheme|experiment|policy|device)\b",
    ("try on", 3): r"\btry(?:ing)? it on\b|\btr(?:y|ies|ying|ied) on\b[^.?!]{0,12}?\b(?:trick|game|bluff|humbug|dodge)\b",
    ("try on", 1): r"^(?!.*(?:\btr(?:y|ies|ying|ied) on\b[^.?!]{0,15}?\b(?:measure|measures|expedient|method|plan|scheme|experiment|policy|device)\b))(?!.*(?:\btry(?:ing)? it on\b|\btr(?:y|ies|ying|ied) on\b[^.?!]{0,12}?\b(?:trick|game|bluff|humbug|dodge)\b)).*\btr(?:y|ies|ying|ied) on\b",
    # warm up
    ("warm up", 1): r"\bwarm(?:s|ed|ing)? up\b[^.?!]{0,12}?\b(?:exercise|exercise[s]?|stretch|stretching|muscles?|limber|practice|training|before the)\b",
    ("warm up", 3): r"\bwarm(?:s|ed|ing)? up\b[^.?!]{0,12}?\b(?:cookies|bread|dinner|supper|meal|food|dish|soup|coffee|tea|meat|potatoes|pie|rice|kettle)\b",
    ("warm up", 4): r"\bwarm(?:s|ed|ing)? up\b[^.?!]{0,12}?\b(?:weather|sun|day|air|room|house|spring|afterwards|gradually)\b",
    ("warm up", 5): r"\bwarm(?:s|ed|ing)? up\b[^.?!]{0,12}?\b(?:engine|motor|machine|cylinder|boiler|car|steam)\b",
    ("warm up", 2): r"\bwarm(?:s|ed|ing)?\s+up\s+(?:to|by|as)\b|\b(?:he|she|they|we|I|you)\b[^.?!;,]{0,20}?\bwarm(?:s|ed|ing)?\s+up\b|\bwarm(?:s|ed|ing)?\s+up\s+(?:his|her|their|our|my|your)\s+(?:sympathies|feelings|emotions|heart|interest|spirits?|mood)\b",
    # beam on
    ("beam on", 2): r"\b(?:sun|sunlight|light|rays?|moon|moonlight|lamp|lantern|glory|smile)\b[^.?!]{0,20}?\bbeam(?:s|ed|ing)? on\b",
    ("beam on", 3): r"\bbeam(?:s|ed|ing)? on\b[^.?!]{0,15}?\b(?:waves?|radio|station|signal|programme|program|broadcast)\b",
    ("beam on", 1): r"^(?!.*(?:\b(?:sun|sunlight|light|rays?|moon|moonlight|lamp|lantern|glory|smile)\b[^.?!]{0,20}?\bbeam(?:s|ed|ing)? on\b))(?!.*(?:\bbeam(?:s|ed|ing)? on\b[^.?!]{0,15}?\b(?:waves?|radio|station|signal|programme|program|broadcast)\b)).*\bbeam(?:s|ed|ing)? on\b",
    # branch off
    ("branch off", 2): r"\bbranch(?:es|ed|ing)? off\b[^.?!]{0,12}?\b(?:into|upon|on)\b[^.?!]{0,15}?\b(?:account|subject|topic|story|talk|tale|matter|matters|question|discussion|remark|remarks)\b",
    ("branch off", 1): r"^(?!.*(?:\bbranch(?:es|ed|ing)? off\b[^.?!]{0,12}?\b(?:into|upon|on)\b[^.?!]{0,15}?\b(?:account|subject|topic|story|talk|tale|matter|matters|question|discussion|remark|remarks)\b)).*\bbranch(?:es|ed|ing)? off\b",
    # call off
    ("call off", 2): r"\bcall(?:s|ed|ing)? off\b[^.?!]{0,15}?\b(?:dogs?|hounds?|crew|men|servants?|workmen|hands|boys?|sailors|seamen)\b|\b(?:dogs?|hounds?|crew|servants?|workmen)\b[^.?!]{0,25}?\bcall(?:s|ed|ing)? off\b",
    ("call off", 3): r"\bcall(?:s|ed|ing)? off\b[^.?!]{0,12}?\b(?:attention|thoughts?|mind|minds|eyes?)\b|\b(?:attention|thoughts?)\b[^.?!]{0,20}?\bcall(?:s|ed|ing)? off\b",
    ("call off", 4): r"\bcall(?:s|ed|ing)? off\b[^.?!]{0,12}?\b(?:dance|dancers|square dance|figure|figures|quadrille)\b",
    ("call off", 1): r"^(?!.*(?:\bcall(?:s|ed|ing)? off\b[^.?!]{0,15}?\b(?:dogs?|hounds?|crew|men|servants?|workmen|hands|boys?|sailors|seamen)\b|\b(?:dogs?|hounds?|crew|servants?|workmen)\b[^.?!]{0,25}?\bcall(?:s|ed|ing)? off\b))(?!.*(?:\bcall(?:s|ed|ing)? off\b[^.?!]{0,12}?\b(?:attention|thoughts?|mind|minds|eyes?)\b|\b(?:attention|thoughts?)\b[^.?!]{0,20}?\bcall(?:s|ed|ing)? off\b))(?!.*(?:\bcall(?:s|ed|ing)? off\b[^.?!]{0,12}?\b(?:dance|dancers|square dance|figure|figures|quadrille)\b)).*\bcall(?:s|ed|ing)? off\b",
    # catch on
    ("catch on", 2): r"\b(?:catch(?:es|ing)?|caught) on\b[^.?!]{0,15}?\b(?:popular|fashion|vogue|rapidly|quickly|everywhere)\b",
    ("catch on", 3): r"\b(?:catch(?:es|ing)?|caught) on\b[^.?!]{0,12}?\b(?:barb|nail|hook|wire|branch|thorn|post|rail|stump|splinter|tree|bramble)\b|\b(?:skirt|coat|dress|clothes|sleeve|shawl|cloak|velvet|lace)\b[^.?!]{0,18}?\b(?:catch(?:es|ing)?|caught) on\b",
    ("catch on", 1): r"^(?!.*(?:\b(?:catch(?:es|ing)?|caught) on\b[^.?!]{0,15}?\b(?:popular|fashion|vogue|rapidly|quickly|everywhere)\b))(?!.*(?:\b(?:catch(?:es|ing)?|caught) on\b[^.?!]{0,12}?\b(?:barb|nail|hook|wire|branch|thorn|post|rail|stump|splinter|tree|bramble)\b|\b(?:skirt|coat|dress|clothes|sleeve|shawl|cloak|velvet|lace)\b[^.?!]{0,18}?\b(?:catch(?:es|ing)?|caught) on\b)).*\b(?:catch(?:es|ing)?|caught) on\b",
    # get across
    ("get across", 1): r"\b(?:get(?:s|ting)?|got) across\b[^.?!]{0,12}?\b(?:to (?:her|him|them|me|us|you)|the (?:meaning|point|idea|sense)|his (?:meaning|point)|her (?:meaning|point))\b|\b(?:meaning|point|idea|sense|word|words|lesson)\b[^.?!]{0,20}?\b(?:get(?:s|ting)?|got) across\b",
    ("get across", 2): r"\b(?:get(?:s|ting)?|got) across\b[^.?!]{0,10}?\b(?:at last|clearly|somehow|in the end)\b",
    # get ahead
    ("get ahead", 2): r"\b(?:get(?:s|ting)?|got) ahead\b[^.?!]{0,15}?\b(?:in life|in the world|in business|in the city|bound to|if (?:he|she|you|they)|to (?:succeed|prosper))\b|\bbound to get ahead\b",
    ("get ahead", 1): r"^(?!.*(?:\b(?:get(?:s|ting)?|got) ahead\b[^.?!]{0,15}?\b(?:in life|in the world|in business|in the city|bound to|if (?:he|she|you|they)|to (?:succeed|prosper))\b|\bbound to get ahead\b)).*\b(?:get(?:s|ting)?|got) ahead\b",
    # look ahead
    ("look ahead", 2): r"\blook(?:s|ed|ing)? ahead\b[^.?!]{0,20}?\b(?:future|prospect|years|life|time to come|plans?)\b| \b(?:future|prospect|plans?)\b[^.?!]{0,25}?\blook(?:s|ed|ing)? ahead\b| \bnever seems? to look ahead\b",
    ("look ahead", 1): r"^(?!.*(?:\blook(?:s|ed|ing)? ahead\b[^.?!]{0,20}?\b(?:future|prospect|years|life|time to come|plans?)\b| \b(?:future|prospect|plans?)\b[^.?!]{0,25}?\blook(?:s|ed|ing)? ahead\b| \bnever seems? to look ahead\b)).*\blook(?:s|ed|ing)? ahead\b",
    # calm down
    ("calm down", 2): r"\b(?:calm|calmed|calming) (?:him|her|them|me|us|you|the (?:crowd|mob|child|children|man|men|woman|horse|dog|dogs|animal|people|others|party|company|invalid|patient))\b[^.?!]{0,8}?\bdown\b|\b(?:be|been|being|was|were|is|are)\b[^.?!]{0,25}?\bcalmed down\b",
    ("calm down", 3): r"\bcalm(?:s|ed|ing)? down\b[^.?!]{0,12}?\b(?:weather|wind|storm|sea|waves?|troubles?|affairs?|matters?|things?|excitement|everything|city|country|world|market|panic)\b| \b(?:weather|wind|storm|sea|waves?|troubles?|affairs?|matters?|things?|excitement|everything|city|country|world|market|panic)\b[^.?!]{0,25}?\bcalm(?:s|ed|ing)? down\b",
    ("calm down", 1): r"^(?!.*(?:\b(?:calm|calmed|calming) (?:him|her|them|me|us|you|the (?:crowd|mob|child|children|man|men|woman|horse|dog|dogs|animal|people|others|party|company|invalid|patient))\b[^.?!]{0,8}?\bdown\b|\b(?:be|been|being|was|were|is|are)\b[^.?!]{0,25}?\bcalmed down\b))(?!.*(?:\bcalm(?:s|ed|ing)? down\b[^.?!]{0,12}?\b(?:weather|wind|storm|sea|waves?|troubles?|affairs?|matters?|things?|excitement|everything|city|country|world|market|panic)\b| \b(?:weather|wind|storm|sea|waves?|troubles?|affairs?|matters?|things?|excitement|everything|city|country|world|market|panic)\b[^.?!]{0,25}?\bcalm(?:s|ed|ing)? down\b)).*\bcalm(?:s|ed|ing)? down\b",
    # get by
    ("get by", 2): r"\b(?:get(?:s|ting)?|got) by (?:him|her|them|me|us|you|the \w+)\b|\b(?:get(?:s|ting)?|got) by\b[^.?!]{0,10}?\b(?:unnoticed|without being seen|the sentry|the guard)\b",
    ("get by", 3): r"\b(?:get(?:s|ting)?|got) by\b[^.?!]{0,10}?\b(?:with (?:this|that|it|murder|theft|the crime)|unpunished|scot-free)\b",
    ("get by", 1): r"^(?!.*(?:\b(?:get(?:s|ting)?|got) by (?:him|her|them|me|us|you|the \w+)\b|\b(?:get(?:s|ting)?|got) by\b[^.?!]{0,10}?\b(?:unnoticed|without being seen|the sentry|the guard)\b))(?!.*(?:\b(?:get(?:s|ting)?|got) by\b[^.?!]{0,10}?\b(?:with (?:this|that|it|murder|theft|the crime)|unpunished|scot-free)\b)).*\b(?:get(?:s|ting)?|got) by\b",
    # condense into
    ("condense into", 2): r"\bcondens(?:e|es|ed|ing) into\b[^.?!]{0,12}?\b(?:drops?|dew|water|liquid|vapour|vapor|clouds?|mist|rain)\b|\b(?:vapour|vapor|steam|gas|moisture)\b[^.?!]{0,20}?\bcondens(?:e|es|ed|ing) into\b",
    ("condense into", 1): r"^(?!.*(?:\bcondens(?:e|es|ed|ing) into\b[^.?!]{0,12}?\b(?:drops?|dew|water|liquid|vapour|vapor|clouds?|mist|rain)\b|\b(?:vapour|vapor|steam|gas|moisture)\b[^.?!]{0,20}?\bcondens(?:e|es|ed|ing) into\b)).*\bcondens(?:e|es|ed|ing) into\b",
    # lay off
    ("lay off", 1): r"\b(?:be|been|being|was|were|is|are)\b[^.?!]{0,10}?\blaid off\b|\b(?:lay(?:s|ing)?|laid) off (?:the )?(?:men|hands|workmen|hands|employees|workers|hands)\b|\b(?:men|hands|workmen|employees|workers)\b[^.?!]{0,20}?\blaid off\b",
    ("lay off", 2): r"\b(?:lay(?:s|ing)?|laid) off\b[^.?!]{0,10}?\b(?:drink|smoking|the habit|habits)\b",
    ("lay off", 3): r"\b(?:lay(?:s|ing)?|laid) off\b[^.?!]{0,12}?\b(?:shore|coast|harbour|harbor|port|Blackwater|bay|island|rocks?|land|banks?|tide)\b",
    # pull over
    ("pull over", 1): r"\bpull(?:s|ed|ing)? over\b[^.?!]{0,15}?\b(?:road|kerb|curb|side of the road|highway|traffic|policeman|police|car|motor)\b",
    ("pull over", 2): r"\bpull(?:s|ed|ing)? over\b[^.?!]{0,45}?\b(?:chart|bank|shore|oars?|boat|ship|tug|alongside|pier|harbour|harbor)\b",
    # put through
    ("put through", 2): r"\bput(?:s|ting)? through\b[^.?!]{0,12}?\b(?:work|washing|ironing|linen|task|business|job|duties|order|orders|parcel)\b",
    ("put through", 3): r"\bput(?:s|ting)? through\b[^.?!]{0,12}?\b(?:telephone|phone|wire|exchange|call)\b|\bput (?:me|him|her|them|us) through\b",
    ("put through", 1): r"^(?!.*(?:\bput(?:s|ting)? through\b[^.?!]{0,12}?\b(?:work|washing|ironing|linen|task|business|job|duties|order|orders|parcel)\b))(?!.*(?:\bput(?:s|ting)? through\b[^.?!]{0,12}?\b(?:telephone|phone|wire|exchange|call)\b|\bput (?:me|him|her|them|us) through\b)).*\bput(?:s|ting)? through\b",
    # think through
    ("think through", 2): r"\b(?:think(?:s|ing)?|thought) through\b[^.?!]{0,10}?\b(?:mind|minds|thoughts?|brain|eyes?|motive|motives)\b",
    ("think through", 1): r"^(?!.*(?:\b(?:think(?:s|ing)?|thought) through\b[^.?!]{0,10}?\b(?:mind|minds|thoughts?|brain|eyes?|motive|motives)\b)).*\b(?:think(?:s|ing)?|thought) through\b",
    # think up
    ("think up", 2): r"\b(?:think(?:s|ing)?|thought) up\b[^.?!]{0,12}?\b(?:excuse|excuses|lie|lies|story|stories|pretext|tale|tales|reason)\b",
    ("think up", 1): r"^(?!.*(?:\b(?:think(?:s|ing)?|thought) up\b[^.?!]{0,12}?\b(?:excuse|excuses|lie|lies|story|stories|pretext|tale|tales|reason)\b)).*\b(?:think(?:s|ing)?|thought) up\b",
    # back down
    ("back down", 2): r"\bback(?:s|ed|ing)? down\b[^.?!]{0,10}?\b(?:the|a|that|his|her|its|this)\b|\b(?:hill|road|street|ditch|stairs|steps|path|lane|slope|hill-side|valley)\b",
    ("back down", 1): r"^(?!.*(?:\bback(?:s|ed|ing)? down\b[^.?!]{0,10}?\b(?:the|a|that|his|her|its|this)\b|\b(?:hill|road|street|ditch|stairs|steps|path|lane|slope|hill-side|valley)\b)).*\bback(?:s|ed|ing)? down\b",
    # brush up
    ("brush up", 2): r"\bbrush(?:es|ed|ing)? up\b[^.?!]{0,12}?\b(?:style|work|appearance|manners|knowledge|memory|self)\b",
    ("brush up", 3): r"\bbrush(?:es|ed|ing)? up\b[^.?!]{0,10}?\b(?:moustache|mustache|beard|hair|coat|hat|clothes|jacket|boots?|shoes?|frock|dress)\b|\b(?:moustache|beard|hair)\b[^.?!]{0,20}?\bbrush(?:es|ed|ing)? up\b",
    ("brush up", 1): r"^(?!.*(?:\bbrush(?:es|ed|ing)? up\b[^.?!]{0,12}?\b(?:style|work|appearance|manners|knowledge|memory|self)\b))(?!.*(?:\bbrush(?:es|ed|ing)? up\b[^.?!]{0,10}?\b(?:moustache|mustache|beard|hair|coat|hat|clothes|jacket|boots?|shoes?|frock|dress)\b|\b(?:moustache|beard|hair)\b[^.?!]{0,20}?\bbrush(?:es|ed|ing)? up\b)).*\bbrush(?:es|ed|ing)? up\b",
    # circle around
    ("circle around", 2): r"\bcircl(?:e|es|ed|ing) around\b\s+(?:the|a|his|her|its|their) \w+",
    ("circle around", 1): r"^(?!.*(?:\bcircl(?:e|es|ed|ing) around\b\s+(?:the|a|his|her|its|their) \w+)).*\bcircl(?:e|es|ed|ing) around\b",
    # drop by
    ("drop by", 1): r"\bdrop(?:s|ped|ping)? by\b",
    # end up
    ("end up", 2): r"\bend(?:s|ed|ing)? up\b[^.?!]{0,12}?\b(?:by|with)\b",
    ("end up", 1): r"^(?!.*(?:\bend(?:s|ed|ing)? up\b[^.?!]{0,12}?\b(?:by|with)\b)).*\bend(?:s|ed|ing)? up\b",
    # pull through
    ("pull through", 2): r"\bpull(?:s|ed|ing)? through\b[^.?!]{0,12}?\b(?:diphtheria|fever|illness|illnesses|pneumonia|typhoid|consumption|disease|danger|crisis|trouble)\b|\bpull (?:him|her|them|me|us|you) through\b|\bpulled (?:a|the|one) (?:farmer|man|patient|child|boy|girl|invalid)\b",
    ("pull through", 1): r"^(?!.*(?:\bpull(?:s|ed|ing)? through\b[^.?!]{0,12}?\b(?:diphtheria|fever|illness|illnesses|pneumonia|typhoid|consumption|disease|danger|crisis|trouble)\b|\bpull (?:him|her|them|me|us|you) through\b|\bpulled (?:a|the|one) (?:farmer|man|patient|child|boy|girl|invalid)\b)).*\bpull(?:s|ed|ing)? through\b",
    # set back
    ("set back", 2): r"\bset(?:s|ting)? back\b[^.?!]{0,12}?\b(?:progress|development|work|plans?|efforts?|advance|movement|course)\b",
    ("set back", 3): r"\bset (?:him|her|them|me|us|you) back\b|\b(?:pounds?|dollars?|shillings?|guineas?)\b[^.?!]{0,15}?\bset(?:s|ting)? back\b|\bset\b[^.?!]{0,12}?\b(?:back|by)\b[^.?!]{0,6}?\b(?:pounds?|dollars?|a (?:lot|good deal|fortune))\b",
    ("set back", 4): r"\bset(?:s|ting)? back\b[^.?!]{0,15}?\b(?:from the (?:sidewalk|street|road)|in a corner|against the wall|houses?|frame|screen|chair|building|shoulders?|hedge|garden)\b| \b(?:houses?|frame|screen|chair|building|shoulders?|wall)\b[^.?!]{0,25}?\bset(?:s|ting)? back\b",
    ("set back", 1): r"^(?!.*(?:\bset(?:s|ting)? back\b[^.?!]{0,12}?\b(?:progress|development|work|plans?|efforts?|advance|movement|course)\b))(?!.*(?:\bset (?:him|her|them|me|us|you) back\b|\b(?:pounds?|dollars?|shillings?|guineas?)\b[^.?!]{0,15}?\bset(?:s|ting)? back\b|\bset\b[^.?!]{0,12}?\b(?:back|by)\b[^.?!]{0,6}?\b(?:pounds?|dollars?|a (?:lot|good deal|fortune))\b))(?!.*(?:\bset(?:s|ting)? back\b[^.?!]{0,15}?\b(?:from the (?:sidewalk|street|road)|in a corner|against the wall|houses?|frame|screen|chair|building|shoulders?|hedge|garden)\b| \b(?:houses?|frame|screen|chair|building|shoulders?|wall)\b[^.?!]{0,25}?\bset(?:s|ting)? back\b)).*\bset(?:s|ting)? back\b",
    # sort out
    ("sort out", 2): r"\b(?:be|been|being|was|were|is|are|all|soon|now)\b[^.?!]{0,10}?\bsorted out\b|\bsort(?:s|ed|ing)? out\b[^.?!]{0,12}?\b(?:affairs?|matters?|business|troubles?|difficulties|difficulty|problem|problems|dispute|misunderstanding|question)\b",
    ("sort out", 3): r"\bsort (?:him|her|them|me|you|us) out\b",
    ("sort out", 1): r"^(?!.*(?:\b(?:be|been|being|was|were|is|are|all|soon|now)\b[^.?!]{0,10}?\bsorted out\b|\bsort(?:s|ed|ing)? out\b[^.?!]{0,12}?\b(?:affairs?|matters?|business|troubles?|difficulties|difficulty|problem|problems|dispute|misunderstanding|question)\b))(?!.*(?:\bsort (?:him|her|them|me|you|us) out\b)).*\bsort(?:s|ed|ing)? out\b",
    # coil in
    ("coil in", 1): r"\bcoil(?:s|ed|ing)? in\b",
    # contract in
    ("contract in", 1): r"\bcontract(?:s|ed|ing)? in\b",
    # ===== 块 B″ 第十批（2026-10-10 二十二续 · 30 词）=====
    # figure out
    ("figure out", 2): r"\bfigur(?:e|es|ed|ing) out\b[^.?!]{0,14}?\b(?:plan|plans|way|ways|method|methods|scheme|schemes|course|route|means|expedient|expedients|arrangement|arrangements)\b",
    ("figure out", 3): r"\bfigur(?:e|es|ed|ing) out\b[^.?!]{0,16}?\b(?:sum|sums|amount|amounts|cost|costs|expense|expenses|figures|number|numbers|profit|profits|total|totals|tax|taxes|price|prices|accounts?|whether|how much)\b",
    ("figure out", 1): r"^(?!.*(?:\bfigur(?:e|es|ed|ing) out\b[^.?!]{0,14}?\b(?:plan|plans|way|ways|method|methods|scheme|schemes|course|route|means|expedient|expedients|arrangement|arrangements)\b))(?!.*(?:\bfigur(?:e|es|ed|ing) out\b[^.?!]{0,16}?\b(?:sum|sums|amount|amounts|cost|costs|expense|expenses|figures|number|numbers|profit|profits|total|totals|tax|taxes|price|prices|accounts?|whether|how much)\b)).*\bfigur(?:e|es|ed|ing) out\b",
    # get around
    ("get around", 2): r"\b(?:get(?:s|ting)?|got|gotten) around\b[^.?!]{0,14}?\b(?:difficulty|difficulties|problem|problems|law|laws|rule|rules|regulation|regulations|obstacle|obstacles|tax|taxes|question|questions)\b",
    ("get around", 3): r"\b(?:news|report|reports|story|stories|rumou?r|rumours|word|fact|tidings|it|that)\b[^.?!]{0,12}?\b(?:get(?:s|ting)?|got|gotten) around\b|\b(?:get(?:s|ting)?|got|gotten) around\b[^.?!]{0,10}?\b(?:that|about|abroad|everywhere|at last|in the end|soon)\b",
    ("get around", 4): r"\b(?:get(?:s|ting)?|got|gotten) around\b[^.?!]{0,12}?\b(?:society|societ|world|people|company|parties|friends|crowd|set)\b",
    ("get around", 1): r"^(?!.*(?:\b(?:get(?:s|ting)?|got|gotten) around\b[^.?!]{0,14}?\b(?:difficulty|difficulties|problem|problems|law|laws|rule|rules|regulation|regulations|obstacle|obstacles|tax|taxes|question|questions)\b))(?!.*(?:\b(?:news|report|reports|story|stories|rumou?r|rumours|word|fact|tidings|it|that)\b[^.?!]{0,12}?\b(?:get(?:s|ting)?|got|gotten) around\b|\b(?:get(?:s|ting)?|got|gotten) around\b[^.?!]{0,10}?\b(?:that|about|abroad|everywhere|at last|in the end|soon)\b))(?!.*(?:\b(?:get(?:s|ting)?|got|gotten) around\b[^.?!]{0,12}?\b(?:society|societ|world|people|company|parties|friends|crowd|set)\b)).*\b(?:get(?:s|ting)?|got|gotten) around\b",
    # give off
    ("give off", 2): r"\b(?:give(?:s)?|gave|given|giving) off\b[^.?!]{0,14}?\b(?:by-?product|as a result|in the process|unconsciously|unintentionally|merely|only)\b",
    ("give off", 1): r"^(?!.*(?:\b(?:give(?:s)?|gave|given|giving) off\b[^.?!]{0,14}?\b(?:by-?product|as a result|in the process|unconsciously|unintentionally|merely|only)\b)).*\b(?:give(?:s)?|gave|given|giving) off\b",
    # add on
    ("add on", 2): r"\badd(?:s|ed|ing)? on\b[^.?!]{0,12}?\b(?:room|rooms|wing|house|building|porch|storey|story|extension|annex|floor)\b",
    ("add on", 1): r"^(?!.*(?:\badd(?:s|ed|ing)? on\b[^.?!]{0,12}?\b(?:room|rooms|wing|house|building|porch|storey|story|extension|annex|floor)\b)).*\badd(?:s|ed|ing)? on\b",
    # add up
    ("add up", 2): r"\badd(?:s|ed|ing)? up\b[^.?!]{0,6}?\bto\b[^.?!]{0,6}?\b(?:pounds?|dollars?|shillings?|pence|hundreds?|thousands?|millions?|a (?:great|good) deal|something|nothing|more)\b",
    ("add up", 3): r"\badd(?:s|ed|ing)? up\b[^.?!]{0,12}?\b(?:to nothing|after all|all right|somehow|perfectly|does not|doesn't|did not|didn't|won't|would not)\b|\b(?:does not|doesn't|did not|didn't|won't|would not|seems? to|hardly)\b[^.?!]{0,20}?\badd(?:s|ed|ing)? up\b",
    ("add up", 4): r"\badd(?:s|ed|ing)? up\b[^.?!]{0,4}?\bto\b[^.?!]{0,25}?\b(?:conclusion|result|facts?|truth|the fact|murder|crime|a (?:great|good) deal|that|this|nothing|something|everything)\b",
    ("add up", 1): r"^(?!.*(?:\badd(?:s|ed|ing)? up\b[^.?!]{0,6}?\bto\b[^.?!]{0,6}?\b(?:pounds?|dollars?|shillings?|pence|hundreds?|thousands?|millions?|a (?:great|good) deal|something|nothing|more)\b))(?!.*(?:\badd(?:s|ed|ing)? up\b[^.?!]{0,12}?\b(?:to nothing|after all|all right|somehow|perfectly|does not|doesn't|did not|didn't|won't|would not)\b|\b(?:does not|doesn't|did not|didn't|won't|would not|seems? to|hardly)\b[^.?!]{0,20}?\badd(?:s|ed|ing)? up\b))(?!.*(?:\badd(?:s|ed|ing)? up\b[^.?!]{0,4}?\bto\b[^.?!]{0,25}?\b(?:conclusion|result|facts?|truth|the fact|murder|crime|a (?:great|good) deal|that|this|nothing|something|everything)\b)).*\badd(?:s|ed|ing)? up\b",
    # back off
    ("back off", 2): r"\bback(?:s|ed|ing)? off\b[^.?!]{0,12}?\b(?:claim|claims|demand|demands|threat|threats|from|position|word|promise)\b|\b(?:refused?|would not|will not|won't|forced?)\b[^.?!]{0,20}?\bback(?:s|ed|ing)? off\b",
    ("back off", 1): r"^(?!.*(?:\bback(?:s|ed|ing)? off\b[^.?!]{0,12}?\b(?:claim|claims|demand|demands|threat|threats|from|position|word|promise)\b|\b(?:refused?|would not|will not|won't|forced?)\b[^.?!]{0,20}?\bback(?:s|ed|ing)? off\b)).*\bback(?:s|ed|ing)? off\b",
    # base in
    ("base in", 1): r"\bbas(?:e|es|ed|ing) in\b",
    # branch out
    ("branch out", 2): r"\bbranch(?:es|ed|ing)? out\b[^.?!]{0,10}?\b(?:of|from|here|there)\b|\b(?:road|street|lane|river|stream|line|railway|path|way|track|corridor|passage)\b[^.?!]{0,18}?\bbranch(?:es|ed|ing)? out\b",
    ("branch out", 1): r"^(?!.*(?:\bbranch(?:es|ed|ing)? out\b[^.?!]{0,10}?\b(?:of|from|here|there)\b|\b(?:road|street|lane|river|stream|line|railway|path|way|track|corridor|passage)\b[^.?!]{0,18}?\bbranch(?:es|ed|ing)? out\b)).*\bbranch(?:es|ed|ing)? out\b",
    # bridge across
    ("bridge across", 1): r"\bbridg(?:e|es|ed|ing) across\b",
    # center on
    ("center on", 2): r"\bcenter(?:ed|ing|s)?\b\s+(?:the|his|her|its|their|a|all)\b[^.?!]{0,12}?\bon\b",
    ("center on", 1): r"^(?!.*(?:\bcenter(?:ed|ing|s)?\b\s+(?:the|his|her|its|their|a|all)\b[^.?!]{0,12}?\bon\b)).*\bcenter(?:s|ed|ing)? on\b",
    # cut back
    ("cut back", 2): r"\bcut(?:s|ting)? back\b[^.?!]{0,12}?\b(?:to|over|across|along|through)\b|\b(?:went on|turned|retraced)\b[^.?!]{0,15}?\bcut(?:s|ting)? back\b",
    ("cut back", 3): r"\bcut(?:s|ting)? back\b[^.?!]{0,12}?\b(?:tree|trees|branches?|hedge|hedges|shrub|shrubs|bush|bushes|growth|vine|wood|rose|roses)\b",
    ("cut back", 4): r"\bcut(?:s|ting)? back\b[^.?!]{0,6}?\bto\b[^.?!]{0,20}?\b(?:childhood|early|youth|days?|years? ago|memory)\b",
    ("cut back", 1): r"^(?!.*(?:\bcut(?:s|ting)? back\b[^.?!]{0,12}?\b(?:to|over|across|along|through)\b|\b(?:went on|turned|retraced)\b[^.?!]{0,15}?\bcut(?:s|ting)? back\b))(?!.*(?:\bcut(?:s|ting)? back\b[^.?!]{0,12}?\b(?:tree|trees|branches?|hedge|hedges|shrub|shrubs|bush|bushes|growth|vine|wood|rose|roses)\b))(?!.*(?:\bcut(?:s|ting)? back\b[^.?!]{0,6}?\bto\b[^.?!]{0,20}?\b(?:childhood|early|youth|days?|years? ago|memory)\b)).*\bcut(?:s|ting)? back\b",
    # kick off
    ("kick off", 2): r"\bkick(?:s|ed|ing)? off\b[^.?!]{0,14}?\b(?:meeting|game|match|season|career|concert|festivities|celebrations?|proceedings?|speech|ceremony)\b",
    ("kick off", 3): r"\bkick(?:s|ed|ing)? off\b[^.?!]{0,10}?\b(?:football|ball|half|ground|goal|players?)\b",
    ("kick off", 1): r"^(?!.*(?:\bkick(?:s|ed|ing)? off\b[^.?!]{0,14}?\b(?:meeting|game|match|season|career|concert|festivities|celebrations?|proceedings?|speech|ceremony)\b))(?!.*(?:\bkick(?:s|ed|ing)? off\b[^.?!]{0,10}?\b(?:football|ball|half|ground|goal|players?)\b)).*\bkick(?:s|ed|ing)? off\b",
    # pay back
    ("pay back", 2): r"\bpay(?:s|ing)?\b[^.?!]{0,10}?\b(?:him|her|them|me|us|you)\b[^.?!]{0,6}?\bback\b|\b(?:pay(?:s|ing)?|paid) back\b[^.?!]{0,12}?\b(?:revenge|for (?:that|this|it|what)|in his own coin|with interest)\b",
    ("pay back", 3): r"\b(?:pay(?:s|ing)?|paid) back\b[^.?!]{0,12}?\b(?:kindness|goodness|good turn|love|affection|service|courtesy|favou?r)\b",
    ("pay back", 1): r"^(?!.*(?:\bpay(?:s|ing)?\b[^.?!]{0,10}?\b(?:him|her|them|me|us|you)\b[^.?!]{0,6}?\bback\b|\b(?:pay(?:s|ing)?|paid) back\b[^.?!]{0,12}?\b(?:revenge|for (?:that|this|it|what)|in his own coin|with interest)\b))(?!.*(?:\b(?:pay(?:s|ing)?|paid) back\b[^.?!]{0,12}?\b(?:kindness|goodness|good turn|love|affection|service|courtesy|favou?r)\b)).*\b(?:pay(?:s|ing)?|paid) back\b",
    # pick on
    ("pick on", 2): r"\bpick(?:s|ed|ing)? on\b[^.?!]{0,12}?\b(?:again|always|smaller|weaker|poor|little|younger|fault|quarrel|fight|tease|bull)\b|\b(?:always|again|continually|kept)\b[^.?!]{0,15}?\bpick(?:s|ed|ing)? on\b",
    ("pick on", 1): r"^(?!.*(?:\bpick(?:s|ed|ing)? on\b[^.?!]{0,12}?\b(?:again|always|smaller|weaker|poor|little|younger|fault|quarrel|fight|tease|bull)\b|\b(?:always|again|continually|kept)\b[^.?!]{0,15}?\bpick(?:s|ed|ing)? on\b)).*\bpick(?:s|ed|ing)? on\b",
    # speed up
    ("speed up", 2): r"\b(?:he|she|it|they|we|I|you|the (?:cab|car|train|horse|boat|ship|engine|machine))\b[^.?!]{0,10}?\b(?:speed(?:s|ed|ing)?|sped) up\b",
    ("speed up", 1): r"^(?!.*(?:\b(?:he|she|it|they|we|I|you|the (?:cab|car|train|horse|boat|ship|engine|machine))\b[^.?!]{0,10}?\b(?:speed(?:s|ed|ing)?|sped) up\b)).*\b(?:speed(?:s|ed|ing)?|sped) up\b",
    # bounce off
    ("bounce off", 2): r"\bbounc(?:e|es|ed|ing)\b[^.?!]{0,12}?\b(?:idea|ideas|plan|plans|proposal|scheme|suggestion|notion)\b[^.?!]{0,10}?\boff\b",
    ("bounce off", 1): r"^(?!.*(?:\bbounc(?:e|es|ed|ing)\b[^.?!]{0,12}?\b(?:idea|ideas|plan|plans|proposal|scheme|suggestion|notion)\b[^.?!]{0,10}?\boff\b)).*\bbounc(?:e|es|ed|ing) off\b",
    # brag about
    ("brag about", 1): r"\bbrag(?:s|ged|ging)? about\b",
    # burn out
    ("burn out", 2): r"\b(?:burn(?:s|ed|ing)?|burnt) out\b[^.?!]{0,12}?\b(?:lamp|lamps|bulb|bulbs|coil|coils|fuse|fuses|wire|wires|dynamo|motor|engine|element|bearing|bearings)\b|\b(?:lamp|lamp|bulb|coil|fuse|dynamo|motor)\b[^.?!]{0,18}?\b(?:burn(?:s|ed|ing)?|burnt) out\b",
    ("burn out", 3): r"\b(?:utterly|quite|completely|nearly|almost|fairly|pretty well|so)\b[^.?!]{0,10}?\b(?:burnt|burned|burning|burn) out\b|\b(?:burn(?:s|ed|ing)?|burnt) out\b[^.?!]{0,10}?\b(?:with|from) (?:work|overwork|toil|study|exertion|fatigue)\b",
    ("burn out", 1): r"^(?!.*(?:\b(?:burn(?:s|ed|ing)?|burnt) out\b[^.?!]{0,12}?\b(?:lamp|lamps|bulb|bulbs|coil|coils|fuse|fuses|wire|wires|dynamo|motor|engine|element|bearing|bearings)\b|\b(?:lamp|lamp|bulb|coil|fuse|dynamo|motor)\b[^.?!]{0,18}?\b(?:burn(?:s|ed|ing)?|burnt) out\b))(?!.*(?:\b(?:utterly|quite|completely|nearly|almost|fairly|pretty well|so)\b[^.?!]{0,10}?\b(?:burnt|burned|burning|burn) out\b|\b(?:burn(?:s|ed|ing)?|burnt) out\b[^.?!]{0,10}?\b(?:with|from) (?:work|overwork|toil|study|exertion|fatigue)\b)).*\b(?:burn(?:s|ed|ing)?|burnt) out\b",
    # chip in
    ("chip in", 2): r"\bchip(?:ped|ping|s)? in\b\s*[:;,]|\b(?:cove|man|woman|voice|somebody|someone|one)\b[^.?!]{0,20}?\bchip(?:ped|ping|s)? in\b|\bchip(?:ped|ping|s)? in\b[^.?!]{0,12}?\b(?:with|saying|remarking|remarked|to say|the remark)\b",
    ("chip in", 1): r"^(?!.*(?:\bchip(?:ped|ping|s)? in\b\s*[:;,]|\b(?:cove|man|woman|voice|somebody|someone|one)\b[^.?!]{0,20}?\bchip(?:ped|ping|s)? in\b|\bchip(?:ped|ping|s)? in\b[^.?!]{0,12}?\b(?:with|saying|remarking|remarked|to say|the remark)\b)).*\bchip(?:s|ped|ping)? in\b",
    # clutter up
    ("clutter up", 1): r"\bclutter(?:s|ed|ing)? up\b",
    # decrease by
    ("decrease by", 1): r"\bdecreas(?:e|es|ed|ing) by\b",
    # fall apart
    ("fall apart", 2): r"\b(?:scheme|schemes|plan|plans|plot|plots|marriage|family|wor?ld|empire|system|society|business|organisation|organization|arrangement|arrangements|party|parties)\b[^.?!]{0,18}?\b(?:fall(?:s|ing)?|fell|fallen) apart\b",
    ("fall apart", 3): r"\b(?:she|he|I|they|we|you)\b[^.?!]{0,20}?\b(?:nearly|almost|quite|just|simply|about to)\b[^.?!]{0,10}?\b(?:fall(?:s|ing)?|fell|fallen) apart\b|\b(?:fall(?:s|ing)?|fell|fallen) apart\b[^.?!]{0,8}?\b(?:when|if|under|with the strain|nerves?)\b",
    ("fall apart", 1): r"^(?!.*(?:\b(?:scheme|schemes|plan|plans|plot|plots|marriage|family|wor?ld|empire|system|society|business|organisation|organization|arrangement|arrangements|party|parties)\b[^.?!]{0,18}?\b(?:fall(?:s|ing)?|fell|fallen) apart\b))(?!.*(?:\b(?:she|he|I|they|we|you)\b[^.?!]{0,20}?\b(?:nearly|almost|quite|just|simply|about to)\b[^.?!]{0,10}?\b(?:fall(?:s|ing)?|fell|fallen) apart\b|\b(?:fall(?:s|ing)?|fell|fallen) apart\b[^.?!]{0,8}?\b(?:when|if|under|with the strain|nerves?)\b)).*\b(?:fall(?:s|ing)?|fell|fallen) apart\b",
    # write off
    ("write off", 2): r"\b(?:write|writes|writing|wrote|written) off\b[^.?!]{0,14}?\b(?:as (?:a |an )?(?:failure|bad|useless|worthless|hopeless|dead)|useless|worthless|failure|hopeless)\b|\b(?:he|she|they|we|I|you|one)\b[^.?!]{0,8}?\b(?:write|writes|writing|wrote|written) off\b",
    ("write off", 3): r"\b(?:write|writes|writing|wrote|written) off\b[^.?!]{0,20}?\b(?:depreciation|assets?|value|debt|debts|loss|losses|capital|stock|machinery|plant|goodwill)\b|\b(?:depreciation|assets?|value)\b[^.?!]{0,20}?\b(?:write|writes|writing|wrote|written) off\b",
    ("write off", 4): r"\b(?:write|writes|writing|wrote|written) off\b[^.?!]{0,10}?\b(?:at a sitting|in an hour|fluently|rapidly|at once|easily)\b",
    ("write off", 1): r"^(?!.*(?:\b(?:write|writes|writing|wrote|written) off\b[^.?!]{0,14}?\b(?:as (?:a |an )?(?:failure|bad|useless|worthless|hopeless|dead)|useless|worthless|failure|hopeless)\b|\b(?:he|she|they|we|I|you|one)\b[^.?!]{0,8}?\b(?:write|writes|writing|wrote|written) off\b))(?!.*(?:\b(?:write|writes|writing|wrote|written) off\b[^.?!]{0,20}?\b(?:depreciation|assets?|value|debt|debts|loss|losses|capital|stock|machinery|plant|goodwill)\b|\b(?:depreciation|assets?|value)\b[^.?!]{0,20}?\b(?:write|writes|writing|wrote|written) off\b))(?!.*(?:\b(?:write|writes|writing|wrote|written) off\b[^.?!]{0,10}?\b(?:at a sitting|in an hour|fluently|rapidly|at once|easily)\b)).*\b(?:write|writes|writing|wrote|written) off\b",
    # angle on
    ("angle on", 2): r"\bangl(?:e|es|ed|ing) on\b[^.?!]{0,10}?\b(?:at|towards?|toward|upon|the (?:sun|light|wall|door|window))\b",
    ("angle on", 1): r"^(?!.*(?:\bangl(?:e|es|ed|ing) on\b[^.?!]{0,10}?\b(?:at|towards?|toward|upon|the (?:sun|light|wall|door|window))\b)).*\bangl(?:e|es|ed|ing) on\b",
    # ask around
    ("ask around", 1): r"\bask(?:s|ed|ing)? around\b",
    # aspire after
    ("aspire after", 1): r"\baspir(?:e|es|ed|ing) after\b",
    # blunder away
    ("blunder away", 2): r"\bblunder(?:s|ed|ing)? away\b[^.?!]{0,8}?\b(?:the|a|his|her|its|their|my|your)\b",
    ("blunder away", 1): r"^(?!.*(?:\bblunder(?:s|ed|ing)? away\b[^.?!]{0,8}?\b(?:the|a|his|her|its|their|my|your)\b)).*\bblunder(?:s|ed|ing)? away\b",
    # bolster up
    ("bolster up", 1): r"\bbolster(?:s|ed|ing)? up\b",
    # bounce back
    ("bounce back", 1): r"\bbounc(?:e|es|ed|ing) back\b",
    # bulk up
    ("bulk up", 2): r"\b(?:sail|sails|canvas|cheek|cheeks|vein|veins|muscle|muscles)\b[^.?!]{0,14}?\bbulk(?:s|ed|ing)? up\b",
    ("bulk up", 1): r"^(?!.*(?:\b(?:sail|sails|canvas|cheek|cheeks|vein|veins|muscle|muscles)\b[^.?!]{0,14}?\bbulk(?:s|ed|ing)? up\b)).*\bbulk(?:s|ed|ing)? up\b",
    # ===== 块 B″ 第十一批（2026-10-10 二十三续 · 7 词）=====
    # check out
    ("check out", 2): r"\bcheck(?:s|ed|ing)? out\b[^.?!]{0,14}?\b(?:hotel|inn|public house|tavern|room|bill|landlord|baggage|luggage|noon|eleven|twelve)\b",
    ("check out", 3): r"\bcheck(?:s|ed|ing)? out\b[^.?!]{0,10}?\b(?:all right|right|well|true|correct|satisfactorily|perfectly|would not|does not|did not|doesn't|didn't)\b|\b(?:would not|does not|did not|doesn't|didn't)\b[^.?!]{0,12}?\bcheck(?:s|ed|ing)? out\b",
    ("check out", 4): r"\bcheck(?:s|ed|ing)? out\b[^.?!]{0,12}?\b(?:library|book|books|volume|shop|store|goods|clerk|desk|receipt|ledger)\b",
    ("check out", 5): r"\bcheck(?:s|ed|ing)? out\b[^.?!]{0,6}?\b(?:the (?:girl|woman|man|fellow|chap|lady)|a (?:girl|woman|man))\b",
    ("check out", 1): r"^(?!.*(?:\bcheck(?:s|ed|ing)? out\b[^.?!]{0,14}?\b(?:hotel|inn|public house|tavern|room|bill|landlord|baggage|luggage|noon|eleven|twelve)\b))(?!.*(?:\bcheck(?:s|ed|ing)? out\b[^.?!]{0,10}?\b(?:all right|right|well|true|correct|satisfactorily|perfectly|would not|does not|did not|doesn't|didn't)\b|\b(?:would not|does not|did not|doesn't|didn't)\b[^.?!]{0,12}?\bcheck(?:s|ed|ing)? out\b))(?!.*(?:\bcheck(?:s|ed|ing)? out\b[^.?!]{0,12}?\b(?:library|book|books|volume|shop|store|goods|clerk|desk|receipt|ledger)\b))(?!.*(?:\bcheck(?:s|ed|ing)? out\b[^.?!]{0,6}?\b(?:the (?:girl|woman|man|fellow|chap|lady)|a (?:girl|woman|man))\b)).*\bcheck(?:s|ed|ing)? out\b",
    # cipher out
    ("cipher out", 2): r"\bcipher(?:s|ed|ing)? out\b[^.?!]{0,12}?\b(?:meaning|sense|reason|plan|way|riddle|mystery)\b",
    ("cipher out", 1): r"^(?!.*(?:\bcipher(?:s|ed|ing)? out\b[^.?!]{0,12}?\b(?:meaning|sense|reason|plan|way|riddle|mystery)\b)).*\bcipher(?:s|ed|ing)? out\b",
    # cue in
    ("cue in", 2): r"\bcu(?:e|es|ed|ing) in\b[^.?!]{0,12}?\b(?:news|facts|position|situation|plan|arrangement|plot)\b",
    ("cue in", 1): r"^(?!.*(?:\bcu(?:e|es|ed|ing) in\b[^.?!]{0,12}?\b(?:news|facts|position|situation|plan|arrangement|plot)\b)).*\bcu(?:e|es|ed|ing) in\b",
    # see off
    ("see off", 2): r"\b(?:see(?:s|ing)?|saw|seen) off\b[^.?!]{0,12}?\b(?:enemy|enemies|attack|invaders?|intruders?|pursuers?|dogs?|crowd|beggars?)\b",
    ("see off", 1): r"^(?!.*(?:\b(?:see(?:s|ing)?|saw|seen) off\b[^.?!]{0,12}?\b(?:enemy|enemies|attack|invaders?|intruders?|pursuers?|dogs?|crowd|beggars?)\b)).*\b(?:see(?:s|ing)?|saw|seen) off\b",
    # sign up
    ("sign up", 2): r"\bsign(?:s|ed|ing)? up\b[^.?!]{0,10}?\b(?:men|recruits?|soldiers?|players?|sailors?|hands|crew|team|staff|workmen)\b",
    ("sign up", 1): r"^(?!.*(?:\bsign(?:s|ed|ing)? up\b[^.?!]{0,10}?\b(?:men|recruits?|soldiers?|players?|sailors?|hands|crew|team|staff|workmen)\b)).*\bsign(?:s|ed|ing)? up\b",
    # stick around
    ("stick around", 2): r"\b(?:stick(?:s|ing)?|stuck) around\b[^.?!]{0,10}?\b(?:for|till|until|in case|orders?|ready|available)\b",
    ("stick around", 1): r"^(?!.*(?:\b(?:stick(?:s|ing)?|stuck) around\b[^.?!]{0,10}?\b(?:for|till|until|in case|orders?|ready|available)\b)).*\b(?:stick(?:s|ing)?|stuck) around\b",
    # take apart
    ("take apart", 2): r"\b(?:take|takes|taking|took|taken) apart\b[^.?!]{0,10}?\b(?:body|limbs?|corpse|flesh|prey|kill|carcass)\b",
    ("take apart", 3): r"\b(?:take|takes|taking|took|taken) apart\b[^.?!]{0,10}?\b(?:argument|statement|theory|reasoning|speech|book|case|evidence|work|play|story)\b",
    ("take apart", 1): r"^(?!.*(?:\b(?:take|takes|taking|took|taken) apart\b[^.?!]{0,10}?\b(?:body|limbs?|corpse|flesh|prey|kill|carcass)\b))(?!.*(?:\b(?:take|takes|taking|took|taken) apart\b[^.?!]{0,10}?\b(?:argument|statement|theory|reasoning|speech|book|case|evidence|work|play|story)\b)).*\b(?:take|takes|taking|took|taken) apart\b",
    # ===== 块 B″ 收尾轮 ②（2026-10-10 二十四续 · 3 词）=====
    # burn off
    ("burn off", 2): r"\b(?:calories?|fat|fats|energy|weight|excess|sweat|exercise|exercising|training|run|running|walk|walking|gym)\b[^.?!]{0,24}?\b(?:burn|burns|burned|burnt|burning) off\b|\b(?:burn|burns|burned|burnt|burning) off\b[^.?!]{0,24}?\b(?:calories?|fat|fats|energy|weight|excess|sweat|exercise|exercising|training|run|running|walk|walking|gym)\b",
    ("burn off", 1): r"^(?!.*(?:\b(?:calories?|fat|fats|energy|weight|excess|sweat|exercise|exercising|training|run|running|walk|walking|gym)\b[^.?!]{0,24}?\b(?:burn|burns|burned|burnt|burning) off\b|\b(?:burn|burns|burned|burnt|burning) off\b[^.?!]{0,24}?\b(?:calories?|fat|fats|energy|weight|excess|sweat|exercise|exercising|training|run|running|walk|walking|gym)\b)).*\b(?:burn|burns|burned|burnt|burning) off\b",
    # burn through
    ("burn through", 2): r"\b(?:wall|walls|roof|roofs|floor|floors|door|doors|rope|ropes|board|boards|timber|plank|planks|iron|steel|plate|plates|curtain|curtains|cloth|coat|coats|flesh|skin|ice|net|nets|line|lines|ceiling|canvas|sack|bag|bags|dress|paper|beam|beams|leather)\b[^.?!]{0,24}?\b(?:burn|burns|burned|burnt|burning) through\b|\b(?:burn|burns|burned|burnt|burning) through\b[^.?!]{0,24}?\b(?:wall|walls|roof|roofs|floor|floors|door|doors|rope|ropes|board|boards|timber|plank|planks|iron|steel|plate|plates|curtain|curtains|cloth|coat|coats|flesh|skin|ice|net|nets|line|lines|ceiling|canvas|sack|bag|bags|dress|paper|beam|beams|leather)\b",
    ("burn through", 3): r"\b(?:money|cash|fortune|fortunes|savings|funds?|pounds?|dollars?|capital|income|wages?|salary|estate|inheritance|budget|reserves?|coal|fuel|oil|gas|stores?)\b[^.?!]{0,24}?\b(?:burn|burns|burned|burnt|burning) through\b|\b(?:burn|burns|burned|burnt|burning) through\b[^.?!]{0,24}?\b(?:money|cash|fortune|fortunes|savings|funds?|pounds?|dollars?|capital|income|wages?|salary|estate|inheritance|budget|reserves?|coal|fuel|oil|gas|stores?)\b",
    ("burn through", 1): r"^(?!.*(?:\b(?:wall|walls|roof|roofs|floor|floors|door|doors|rope|ropes|board|boards|timber|plank|planks|iron|steel|plate|plates|curtain|curtains|cloth|coat|coats|flesh|skin|ice|net|nets|line|lines|ceiling|canvas|sack|bag|bags|dress|paper|beam|beams|leather)\b[^.?!]{0,24}?\b(?:burn|burns|burned|burnt|burning) through\b|\b(?:burn|burns|burned|burnt|burning) through\b[^.?!]{0,24}?\b(?:wall|walls|roof|roofs|floor|floors|door|doors|rope|ropes|board|boards|timber|plank|planks|iron|steel|plate|plates|curtain|curtains|cloth|coat|coats|flesh|skin|ice|net|nets|line|lines|ceiling|canvas|sack|bag|bags|dress|paper|beam|beams|leather)\b))(?!.*(?:\b(?:money|cash|fortune|fortunes|savings|funds?|pounds?|dollars?|capital|income|wages?|salary|estate|inheritance|budget|reserves?|coal|fuel|oil|gas|stores?)\b[^.?!]{0,24}?\b(?:burn|burns|burned|burnt|burning) through\b|\b(?:burn|burns|burned|burnt|burning) through\b[^.?!]{0,24}?\b(?:money|cash|fortune|fortunes|savings|funds?|pounds?|dollars?|capital|income|wages?|salary|estate|inheritance|budget|reserves?|coal|fuel|oil|gas|stores?)\b)).*\b(?:burn|burns|burned|burnt|burning) through\b",
    # cool down
    ("cool down", 2): r"\b(?:water|air|weather|night|evening|room|house|engine|motor|metal|iron|steel|stone|food|soup|tea|drink|earth|ground|body|sun|heat|temperature|degrees?|thermometer|climate|season|surface|plate|dish)\b[^.?!]{0,24}?\b(?:cool|cools|cooled|cooling) down\b|\b(?:cool|cools|cooled|cooling) down\b[^.?!]{0,24}?\b(?:water|air|weather|night|evening|room|house|engine|motor|metal|iron|steel|stone|food|soup|tea|drink|earth|ground|body|sun|heat|temperature|degrees?|thermometer|climate|season|surface|plate|dish)\b",
    ("cool down", 3): r"\b(?:cool|cools|cooled|cooling) down\s+(?:the|his|her|its|their|your|my|our|a|an)\b|\b(?:cool|cools|cooled|cooling)\s+(?:it|them|him|her|me|us|you|the\s+[a-z'\u2019]+)\s+down\b",
    ("cool down", 1): r"^(?!.*(?:\b(?:water|air|weather|night|evening|room|house|engine|motor|metal|iron|steel|stone|food|soup|tea|drink|earth|ground|body|sun|heat|temperature|degrees?|thermometer|climate|season|surface|plate|dish)\b[^.?!]{0,24}?\b(?:cool|cools|cooled|cooling) down\b|\b(?:cool|cools|cooled|cooling) down\b[^.?!]{0,24}?\b(?:water|air|weather|night|evening|room|house|engine|motor|metal|iron|steel|stone|food|soup|tea|drink|earth|ground|body|sun|heat|temperature|degrees?|thermometer|climate|season|surface|plate|dish)\b))(?!.*(?:\b(?:cool|cools|cooled|cooling) down\s+(?:the|his|her|its|their|your|my|our|a|an)\b|\b(?:cool|cools|cooled|cooling)\s+(?:it|them|him|her|me|us|you|the\s+[a-z'\u2019]+)\s+down\b)).*\b(?:cool|cools|cooled|cooling) down\b",
    # ---- 批 4 补 cue（2026-10-10 收尾轮 ③）—— 只写「逐句审过、precision ≥95%」的线索；
    #      多义词默认义（account for#1 / put off#1 / give up#1）不写兜底：审计误判 11%／14%／3.5%，
    #      宁可留 zero，也不把错义项标成 unique。
    ("account for", 2): r"\b(?:account|accounts|accounted|accounting) for\b[^.?!]{0,22}?\b(?:per cent|percent|percentage|proportion|fraction|two-thirds|a third|a quarter|a half|the majority|the bulk|the greater part|most of|part of|share of)\b|\b(?:per cent|percent|percentage|proportion|fraction|two-thirds|a third|a quarter|a half|the majority|the bulk|the greater part|most of|part of|share of)\b[^.?!]{0,22}?\b(?:account|accounts|accounted|accounting) for\b",
    ("bring about", 1): r"\b(?:bring|brings|bringing|brought) about\b",
    ("put off", 3): r"\bput(?:s|ting)? off\b[^.?!]{0,14}?\bwith\b[^.?!]{0,25}?\b(?:excuses?|reasons?|words|phrases?|promises|evasions?|pretexts?|answers?|apologies?)\b",
    ("give up", 2): r"\b(?:give|gives|giving|gave|given) up\b[^.?!]{0,22}?\b(?:smoking|drinking|cigarettes?|tobacco|liquor|drink|wine|whisky|whiskey|brandy|beer|cigars?|coffee|opium|walking in my sleep)\b|\b(?:smoking|drinking|cigarettes?|tobacco|liquor|drink|wine|whisky|whiskey|brandy|beer|cigars?|coffee|opium|walking in my sleep)\b[^.?!]{0,22}?\b(?:give|gives|giving|gave|given) up\b",
    ("give up", 3): r"\b(?:give|gives|giving|gave|given) up\b[^.?!]{0,22}?\b(?:seat|seats|place|places|throne|crown|claim|room|berth|quarters|ground|advantage)\b|\b(?:seat|seats|place|places|throne|crown|claim|room|berth|quarters|ground|advantage)\b[^.?!]{0,22}?\b(?:give|gives|giving|gave|given) up\b",
    ("set up", 1): r"\b(?:set|sets|setting) up\b[^.?!]{0,22}?\b(?:establishment|business|shop|store|school|house|home|firm|college|church|hospital|colony|kingdom|bank|office|practice)\b|\b(?:establishment|business|shop|store|school|house|home|firm|college|church|hospital|colony|kingdom|bank|office|practice)\b[^.?!]{0,22}?\b(?:set|sets|setting) up\b",
    ("set up", 2): r"\b(?:set|sets|setting) up\b[^.?!]{0,22}?\b(?:bench|apparatus|machine|engine|printing-press|press|telegraph|wires?|transformer|poles?|stove|tent|bed|monument|stone|table|frame|lamp)\b|\b(?:bench|apparatus|machine|engine|printing-press|press|telegraph|wires?|transformer|poles?|stove|tent|bed|monument|stone|table|frame|lamp)\b[^.?!]{0,22}?\b(?:set|sets|setting) up\b",
    ("set up", 3): r"\b(?:set|sets|setting) up\b[^.?!]{0,22}?\b(?:game|experiment|committee|inquiry|trial|system|rules|arrangement)\b|\b(?:game|experiment|committee|inquiry|trial|system|rules|arrangement)\b[^.?!]{0,22}?\b(?:set|sets|setting) up\b",
    ("take off", 1): r"\b(?:take|takes|taking|took|taken) off\b[^.?!]{0,22}?\b(?:aeroplane|airplane|plane|flight|runway|aerial|airship|balloon)\b|\b(?:aeroplane|airplane|plane|flight|runway|aerial|airship|balloon)\b[^.?!]{0,22}?\b(?:take|takes|taking|took|taken) off\b",
    ("take off", 2): r"\b(?:take|takes|taking|took|taken) off\b[^.?!]{0,22}?\b(?:coat|coats|waistcoat|hat|hats|cap|bonnet|shoes|boots|clothes|dress|dresses|surplice|bandages?|cover|lid|gloves?|cloak|jacket|shirt|veil|apron|trousers|stockings?|wig|muffler|shawl|scarf|vest|blouse|kimono|slippers?|socks?|uniform|overcoat)\b|\b(?:coat|coats|waistcoat|hat|hats|cap|bonnet|shoes|boots|clothes|dress|dresses|surplice|bandages?|cover|lid|gloves?|cloak|jacket|shirt|veil|apron|trousers|stockings?|wig|muffler|shawl|scarf|vest|blouse|kimono|slippers?|socks?|uniform|overcoat)\b[^.?!]{0,22}?\b(?:take|takes|taking|took|taken) off\b",
    ("take off", 3): r"\b(?:take|takes|taking|took|taken) off\b[^.?!]{0,22}?\b(?:play|plays|novel|book|career|fashion|style|fad|success|popular)\b|\b(?:play|plays|novel|book|career|fashion|style|fad|success|popular)\b[^.?!]{0,22}?\b(?:take|takes|taking|took|taken) off\b",
    ("break up", 1): r"\b(?:break|breaks|breaking|broke|broken) up\b[^.?!]{0,22}?\b(?:relations?|engagement|marriage|friendship|connection|with (?:him|her|them|me|you|us|each other|one another))\b|\b(?:relations?|engagement|marriage|friendship|connection|with (?:him|her|them|me|you|us|each other|one another))\b[^.?!]{0,22}?\b(?:break|breaks|breaking|broke|broken) up\b",
    ("break up", 2): r"\b(?:break|breaks|breaking|broke|broken) up\b[^.?!]{0,22}?\b(?:party|parties|meeting|company|assembly|crowd|gathering|whist|class|school|society|congregation|household|camp)\b|\b(?:party|parties|meeting|company|assembly|crowd|gathering|whist|class|school|society|congregation|household|camp)\b[^.?!]{0,22}?\b(?:break|breaks|breaking|broke|broken) up\b",
    ("break up", 3): r"\b(?:break|breaks|breaking|broke|broken) up\b[^.?!]{0,22}?\b(?:stone|stones|rock|earth|ground|ice|wood|box|chair|furniture|family|estate|empire)\b|\b(?:stone|stones|rock|earth|ground|ice|wood|box|chair|furniture|family|estate|empire)\b[^.?!]{0,22}?\b(?:break|breaks|breaking|broke|broken) up\b",
    ("carry out", 1): r"\b(?:carry|carries|carrying|carried) out\b[^.?!]{0,60}?\b(?:wishes|intent|intentions?|commission|commissions?|orders?|instructions|plans?|principles|threats?|insults|craving|purpose|scheme|programme|promise|policy|dut(?:y|ies)|ideas?|projects?|missions?|resolutions?|business|work|changes?|preparations?|obligations?|movements?|everything|aspirations?|impulses?|traditions?|truisms?|crimes?|deaths?|parts?|roles?|rebuildings?|tasks?|undertakings?|operations?|experiments?|designs?|arrangements?|measures?|reforms?|deeds?|murders?|killings?|matters?|suggestions?|points?)\b|\b(?:wishes|intent|intentions?|commission|commissions?|orders?|instructions|plans?|principles|threats?|insults|craving|purpose|scheme|programme|promise|policy|dut(?:y|ies)|ideas?|projects?|missions?|resolutions?|business|work|changes?|preparations?|obligations?|movements?|everything|aspirations?|impulses?|traditions?|truisms?|crimes?|deaths?|parts?|roles?|rebuildings?|tasks?|undertakings?|operations?|experiments?|designs?|arrangements?|measures?|reforms?|deeds?|murders?|killings?|matters?|suggestions?|points?)\b[^.?!]{0,60}?\b(?:carry|carries|carrying|carried) out\b",
    ("come up with", 1): r"\b(?:come|comes|coming|came) up with\b[^.?!]{0,22}?\b(?:idea|ideas|plan|plans|scheme|answer|proposal|suggestion|notion|explanation|theory|excuse|remedy|method|name|title|reason|solution)\b|\b(?:idea|ideas|plan|plans|scheme|answer|proposal|suggestion|notion|explanation|theory|excuse|remedy|method|name|title|reason|solution)\b[^.?!]{0,22}?\b(?:come|comes|coming|came) up with\b",
    ("look forward to", 1): r"\b(?:look|looks|looking|looked) forward to\b",
    ("put up with", 1): r"\b(?:put|puts|putting) up with\b",

}



def cue_gate(entries):
    """cue 形状闸：非空 cue 必须能编译成合法正则。返回错误清单（空 = 过）。"""
    errs = []
    for phrase, e in entries.items():
        for s in e["senses"]:
            c = s.get("cue", "")
            if not isinstance(c, str):
                errs.append("%s#%s: cue 须为字符串" % (phrase, s["rank"]))
                continue
            if c:
                try:
                    re.compile(c)
                except re.error as ex:
                    errs.append("%s#%s: cue 不是合法正则（%s）" % (phrase, s["rank"], ex))
    return errs


def cue_selftest():
    """自咬闸：故意注入坏正则必须被抓；正常 cue 不许报红。返回被抓住的故障数。"""
    bad = {"x": {"senses": [{"rank": 1, "cue": "(unclosed"}]}}
    assert cue_gate(bad), "cue 闸咬不住自己（坏正则竟不报）"
    good = {"x": {"senses": [{"rank": 1, "cue": r"\bturn(?:s|ed)? out\b"}]}}
    assert cue_gate(good) == [], cue_gate(good)
    return 2
