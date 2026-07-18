"""
build_phrases.py — 构建 public/data/phrases.json 短语词典。

数据源：
  1. 内嵌核心短语动词表（~230 条高频，含中文释义）
  2. generator/output/sat_phrases_staging.json（build_sat_bank.py 产出的 13,000+ 词组搭配）

输出格式（阅读页高亮 + 词组测验共用）：
  {
    "give up": { "defs": ["放弃；认输"], "pos": "phrv", "verb": "give", "particle": "up",
                 "forms": ["gives up", "gave up", "given up", "giving up"] },
    "plastic bag": { "defs": ["塑料袋"], "pos": "colloc", "verb": null, "particle": null, "forms": [] }
  }

用法：
  D:\\PythonEnv\\abogen-venv\\Scripts\\python.exe build_phrases.py
"""

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "reader" / "public" / "data" / "phrases.json"
STAGING = Path(__file__).resolve().parent / "output" / "sat_phrases_staging.json"

# ── 不规则动词变形表：base → (past, past_participle) ──
IRREGULAR = {
    "be": ("was", "been"), "break": ("broke", "broken"), "bring": ("brought", "brought"),
    "catch": ("caught", "caught"), "come": ("came", "come"), "cut": ("cut", "cut"),
    "do": ("did", "done"), "draw": ("drew", "drawn"), "drive": ("drove", "driven"),
    "eat": ("ate", "eaten"), "fall": ("fell", "fallen"), "feel": ("felt", "felt"),
    "fight": ("fought", "fought"), "find": ("found", "found"), "get": ("got", "gotten"),
    "give": ("gave", "given"), "go": ("went", "gone"), "grow": ("grew", "grown"),
    "hang": ("hung", "hung"), "hear": ("heard", "heard"), "hold": ("held", "held"),
    "keep": ("kept", "kept"), "lay": ("laid", "laid"), "lead": ("led", "led"),
    "leave": ("left", "left"), "let": ("let", "let"), "lie": ("lay", "lain"),
    "make": ("made", "made"), "pay": ("paid", "paid"), "put": ("put", "put"),
    "read": ("read", "read"), "ride": ("rode", "ridden"), "run": ("ran", "run"),
    "say": ("said", "said"), "see": ("saw", "seen"), "sell": ("sold", "sold"),
    "send": ("sent", "sent"), "set": ("set", "set"), "shake": ("shook", "shaken"),
    "show": ("showed", "shown"), "shut": ("shut", "shut"), "sit": ("sat", "sat"),
    "speak": ("spoke", "spoken"), "stand": ("stood", "stood"), "stick": ("stuck", "stuck"),
    "take": ("took", "taken"), "teach": ("taught", "taught"), "tear": ("tore", "torn"),
    "tell": ("told", "told"), "think": ("thought", "thought"), "throw": ("threw", "thrown"),
    "wake": ("woke", "woken"), "wear": ("wore", "worn"), "win": ("won", "won"),
    "write": ("wrote", "written"),
}

# CVC 双写的常见动词（避免通用规则误伤）
DOUBLE_FINAL = {"put", "set", "get", "let", "cut", "shut", "sit", "run", "drop", "stop",
                "plan", "slip", "wrap", "chop", "grab", "trim", "pin", "sum", "nod", "pat"}

PARTICLES = {
    "up", "down", "off", "on", "in", "out", "away", "over", "back", "through",
    "along", "around", "about", "forward", "after", "for", "with", "to", "into",
    "by", "at", "across", "aside", "ahead", "apart", "behind", "together",
}

# ── 核心短语动词表：phrase|中文释义 ──
CORE_PHRASAL_VERBS = """
account for|解释；说明；占比
act up|捣乱；出毛病
add up|加起来；说得通
ask around|四处打听
back down|让步；退缩
back off|退后；放弃
back up|支持；备份；倒退
blow up|爆炸；发怒；放大
break down|抛锚；崩溃；分解
break in|闯入；插话；磨合
break off|中断；断绝
break out|爆发；逃脱
break through|突破
break up|分手；解散；打碎
bring about|导致；引起
bring back|带回；使回忆起
bring down|降低；使垮台
bring in|引进；赚得
bring out|出版；使显现
bring up|抚养；提出
brush up|温习；刷新
build up|积累；增强
burn out|烧尽；精疲力竭
call back|回电话
call off|取消
call on|拜访；号召
call out|大声喊；点名
calm down|冷静下来
carry on|继续
carry out|执行；实施
catch on|流行起来；理解
catch up|赶上
check in|登记入住
check out|结账离开；查看
cheer up|振作起来
chip in|凑钱；插话
clean up|打扫干净
clear up|澄清；放晴
come about|发生
come across|偶然遇见；给人印象
come along|一起来；进展
come around|恢复知觉；改变主意
come back|回来
come down|下来；降价
come forward|挺身而出
come in|进来
come off|脱落；成功
come on|快点；得了吧
come out|出来；出版；结果是
come over|过来
come through|经历；兑现
come up|走近；被提及；出现
come up with|想出；提出
count on|依靠；指望
cut back|削减
cut down|砍倒；减少
cut in|插嘴；超车抢道
cut off|切断；中断
cut out|剪下；戒除
die down|平息；减弱
die out|灭绝
drop by|顺便拜访
drop off|下降；睡着；放下
drop out|退学；退出
end up|最终成为；结果是
face up to|勇敢面对
fall apart|崩溃；破碎
fall back on|求助于；依靠
fall behind|落后
fall out|争吵；脱落
fall through|落空；失败
figure out|弄明白；解决
fill in|填写；代替
fill out|填写；变胖
fill up|装满
find out|发现；查明
fit in|适应；融入
follow up|跟进
get across|使被理解
get ahead|取得进展
get along|相处；进展
get around|四处走动；回避
get away|逃脱；离开
get back|回来；取回
get by|勉强过活
get down|下来；使沮丧
get in|进入；到达
get off|下车；下班
get on|上车；相处
get out|出去；泄露
get over|克服；恢复
get through|通过；接通；熬过
get together|聚会
get up|起床
give away|赠送；泄露
give back|归还
give in|屈服；让步
give off|发出（气味、光）
give out|分发；耗尽
give up|放弃；认输
go about|着手做
go after|追求
go ahead|开始；进行
go along|赞同；进展
go around|流传；足够分配
go away|走开；消失
go back|回去
go by|经过；依照
go down|下降；下沉
go for|争取；选择
go into|进入；从事；详细讨论
go off|爆炸；响起；变质
go on|继续；发生
go out|出去；熄灭
go over|检查；复习
go through|经历；仔细检查
go up|上升
grow up|长大
hand down|传下来
hand in|上交
hand out|分发
hand over|移交
hang around|闲逛
hang on|坚持；稍等
hang out|闲逛；晾晒
hang up|挂断电话
hold back|阻止；隐瞒；犹豫
hold on|坚持；稍等
hold out|坚持；伸出
hold up|举起；耽搁；抢劫
keep away|远离
keep back|隐瞒；阻止
keep off|远离；避开
keep on|继续
keep out|不让进入
keep up|保持；跟上
kick off|开始
knock down|撞倒；拆除
knock out|击倒；使昏迷
lay off|解雇
lay out|布置；陈述
leave behind|留下；超过
leave out|遗漏；省略
let down|使失望
let go|放手
let in|让进来
let off|放过；排放
let out|释放；发出
lie down|躺下
light up|点亮；容光焕发
live on|以…为生
live up to|不辜负
look after|照顾
look ahead|向前看；为将来打算
look around|四处看看
look back|回顾
look down on|轻视
look for|寻找
look forward to|期待
look into|调查
look on|旁观
look out|当心
look over|查看；检查
look through|浏览；翻阅
look up|查阅；好转
look up to|尊敬
make out|辨认出；理解
make up|编造；化妆；和好；组成
make up for|弥补
mix up|混淆；搅拌
move in|搬进来
move on|继续前进
move out|搬出去
pass away|去世
pass by|经过
pass down|传下来
pass on|传递；去世
pass out|昏倒；分发
pay back|偿还；报复
pay off|还清；取得成功
pick on|挑剔；欺负
pick out|挑选；辨认出
pick up|捡起；接人；学会
point out|指出
pull in|进站；吸引
pull off|成功完成；驶离
pull out|退出；驶出
pull over|靠边停车
pull through|渡过难关
push on|推进；继续
put aside|放在一边；储存
put away|收起来
put back|放回；推迟
put down|放下；镇压；写下
put forward|提出
put in|投入；安装
put off|推迟
put on|穿上；上演；增加
put out|扑灭；出版
put through|接通电话；使经历
put together|组装；拼凑
put up|张贴；搭建；提供住宿
put up with|忍受
run across|偶然遇见
run after|追赶
run away|逃跑
run down|撞倒；耗尽；贬低
run into|偶然遇见；撞上
run out|用完；到期
run over|碾过；溢出
run through|贯穿；浏览
see off|送行
see through|看穿；坚持到底
sell out|卖完；背叛
send for|派人去请
send off|寄出；送行
set aside|留出；搁置
set back|推迟；使花费
set down|放下；记下
set off|出发；引发
set out|出发；着手
set up|建立；设置
settle down|定居；安定下来
show off|炫耀
show up|出现；露面
shut down|关闭；停业
shut up|闭嘴
sign up|报名；注册
sit back|袖手旁观；放松
sit down|坐下
sit up|坐直；熬夜
slow down|减速
sort out|整理；解决
speak out|大胆说出
speak up|大声说
speed up|加速
stand by|支持；袖手旁观；待命
stand for|代表；容忍
stand out|突出；显眼
stand up|站起来
stand up for|捍卫
stay up|熬夜
step down|辞职；下台
step in|介入
step up|加强；增加
stick around|逗留
stick out|伸出；坚持
stick to|坚持；遵守
take after|与…相像
take apart|拆开
take away|拿走；带走
take back|收回；退回
take down|记下；拆除
take in|吸收；理解；欺骗；收留
take off|起飞；脱下；成功
take on|承担；呈现；雇用
take out|取出；带出去
take over|接管；接任
take up|占用；开始从事
tear down|拆除
tear up|撕碎
think over|仔细考虑
think through|想清楚
think up|想出
throw away|扔掉
throw out|扔掉；驱逐
throw up|呕吐
try on|试穿
try out|试用；试验
turn around|转身；好转
turn away|拒绝；转过脸去
turn back|折回；翻回
turn down|拒绝；调低
turn in|上交；上床睡觉
turn into|变成
turn off|关闭
turn on|打开
turn out|结果是；出席；生产
turn over|翻转；移交
turn to|求助于；转向
turn up|出现；调高
use up|用完
wake up|醒来
warm up|热身；变暖
watch out|当心
wear off|逐渐消失
wear out|穿破；使精疲力竭
wind up|结束；最终落得
wipe out|消灭；擦掉
work on|致力于
work out|锻炼；解决；结果
wrap up|包好；结束
write down|写下
write off|勾销；报废
""".strip()


def past_forms(verb):
    """返回 (过去式, 过去分词)。"""
    if verb in IRREGULAR:
        return IRREGULAR[verb]
    if verb.endswith("e"):
        p = verb + "d"
    elif verb.endswith("y") and len(verb) > 2 and verb[-2] not in "aeiou":
        p = verb[:-1] + "ied"
    elif verb in DOUBLE_FINAL:
        p = verb + verb[-1] + "ed"
    else:
        p = verb + "ed"
    return p, p


def third_person(verb):
    if verb.endswith(("ch", "sh", "s", "x", "z", "o")):
        return verb + "es"
    if verb.endswith("y") and len(verb) > 2 and verb[-2] not in "aeiou":
        return verb[:-1] + "ies"
    return verb + "s"


def ing_form(verb):
    if verb == "be":
        return "being"
    if verb.endswith("ie"):
        return verb[:-2] + "ying"
    if verb.endswith("e") and verb != "see" and not verb.endswith("ee"):
        return verb[:-1] + "ing"
    if verb in DOUBLE_FINAL:
        return verb + verb[-1] + "ing"
    return verb + "ing"


def make_forms(phrase, verb):
    """短语动词：变位动词部分，尾部小品词不变。"""
    rest = phrase[len(verb):]
    past, pp = past_forms(verb)
    forms = {third_person(verb) + rest, past + rest, pp + rest, ing_form(verb) + rest}
    forms.discard(phrase)
    return sorted(forms)


def build():
    phrases = {}

    # ── 1. 核心短语动词 ──
    for line in CORE_PHRASAL_VERBS.splitlines():
        if "|" not in line:
            continue
        phrase, defs = line.split("|", 1)
        phrase = phrase.strip().lower()
        words = phrase.split()
        verb = words[0]
        particle = words[1] if len(words) > 1 and words[1] in PARTICLES else None
        phrases[phrase] = {
            "defs": [d.strip() for d in defs.split("；") if d.strip()] or [defs.strip()],
            "pos": "phrv",
            "verb": verb,
            "particle": particle,
            "forms": make_forms(phrase, verb),
        }

    core_count = len(phrases)

    # ── 2. staging 词组搭配（SAT 数据）──
    added_colloc = 0
    if STAGING.exists():
        staging = json.loads(STAGING.read_bytes().decode('utf-8-sig'))
        seen = set()
        for item in staging:
            p = (item.get("phrase") or "").strip().lower()
            t = (item.get("translation") or "").strip()
            # 只收 2-3 词、纯字母、有翻译、不与核心表重复
            if not p or not t or p in phrases or p in seen:
                continue
            words = p.split()
            if not (2 <= len(words) <= 3):
                continue
            if not all(re.fullmatch(r"[a-z][a-z'-]*", w) for w in words):
                continue
            # 过滤专业术语类翻译（含 [] 标记的领域缩写保留基本义）
            t_clean = re.sub(r"\[[^\]]*\]", "", t).strip()
            if not t_clean:
                continue
            seen.add(p)
            # 判断是否短语动词模式
            is_phrv = words[0] in IRREGULAR or (len(words) == 2 and words[1] in PARTICLES)
            verb = words[0] if is_phrv and words[-1] in PARTICLES else None
            phrases[p] = {
                "defs": [d.strip() for d in t_clean.split("；") if d.strip()][:3] or [t_clean],
                "pos": "phrv" if verb else "colloc",
                "verb": verb,
                "particle": words[-1] if verb else None,
                "forms": make_forms(p, verb) if verb else [],
            }
            added_colloc += 1
            if added_colloc >= 3000:  # 控制文件大小
                break

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(phrases, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

    size_kb = OUT.stat().st_size / 1024
    print(f"完成: 核心短语动词 {core_count} 条 + 搭配 {added_colloc} 条 = {len(phrases)} 条")
    print(f"输出: {OUT} ({size_kb:.0f} KB)")


if __name__ == "__main__":
    build()
