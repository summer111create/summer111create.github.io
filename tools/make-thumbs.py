"""作品集项目卡片缩略图生成器

三张缩略图全部由真实数据算出，不手绘、不用素材图：
  1. thumb-sourcing.svg  ← cross-border-sourcing 仓库的 阿里清洗.csv（75 条按件报价的真实分布）
  2. thumb-scoring.svg   ← cross-scoring-tool 仓库 README 记录的实测得分（63.0 / 59.8 / 42.5）
  3. thumb-life.svg      ← 生活管理应用的界面结构示意（非真实数据，图内已标注）

用法：python tools/make-thumbs.py
数据源缺失时第 1 张会退回内置的实测快照，并在图内注明快照口径。
"""

import csv
import os
import statistics as st

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "assets")
CSV_CANDIDATES = [
    os.path.join(HERE, "..", "..", "cross-border-sourcing", "阿里清洗.csv"),
    os.path.join(HERE, "..", "阿里清洗.csv"),
]

INK = "#141d26"
DIM = "#5a6d7e"
MUTE = "#889eae"
LINE = "#e2e8ee"
CYAN = "#00809a"
CYAN_L = "#4bb8cc"
MONO = "'DM Mono','Fira Code',Consolas,monospace"
SANS = "'Noto Sans SC',system-ui,-apple-system,sans-serif"

W, H = 480, 270


def head(title, sub):
    """统一卡片头部：左上角小标题 + 右上角数据口径"""
    return (
        f'<rect width="{W}" height="{H}" fill="#f7fafc"/>'
        f'<text x="26" y="34" font-family="{MONO}" font-size="11" fill="{CYAN}" '
        f'letter-spacing="1.4">{title}</text>'
        f'<text x="{W - 26}" y="34" font-family="{MONO}" font-size="11" fill="{MUTE}" '
        f'text-anchor="end" letter-spacing="0.6">{sub}</text>'
        f'<line x1="26" y1="44" x2="{W - 26}" y2="44" stroke="{LINE}" stroke-width="1"/>'
    )


def load_piece():
    """返回按件报价的最低价列表；找不到数据源时返回 None"""
    for path in CSV_CANDIDATES:
        if os.path.exists(path):
            rows = list(csv.DictReader(open(path, encoding="utf-8-sig")))
            return [float(r["最低价USD"]) for r in rows
                    if r["计价单位"].lower().rstrip("s") == "piece"]
    return None


# ---------- 图 1：件价分布直方图 ----------
def thumb_sourcing():
    prices = load_piece()
    if prices:
        bins = [(0, 5), (5, 10), (10, 20), (20, 40), (40, 80), (80, 10 ** 9)]
        hist, labels = [], []
        for a, b in bins:
            hist.append(sum(1 for x in prices if a <= x < b))
            labels.append(f"{a}-{b}" if b < 10 ** 9 else f"{a}+")
        med, n = st.median(prices), len(prices)
        sub = f"n={n} pieces"
    else:
        # 内置实测快照（2026-10 采集）
        hist = [4, 34, 28, 3, 1, 5]
        labels = ["0-5", "5-10", "10-20", "20-40", "40-80", "80+"]
        med, n = 9.93, 75
        sub = f"n={n} (snapshot)"

    pad_l, pad_b, pad_t = 34, 52, 66
    mx = max(hist) or 1
    bw = (W - pad_l - 26) / len(hist)
    s = [head("PRICE DISTRIBUTION", sub)]

    # 基线
    s.append(f'<line x1="{pad_l}" y1="{H - pad_b}" x2="{W - 26}" y2="{H - pad_b}" '
             f'stroke="{LINE}" stroke-width="1"/>')
    for i, (c, lab) in enumerate(zip(hist, labels)):
        bh = (H - pad_b - pad_t) * c / mx
        x = pad_l + bw * i + 5
        y = H - pad_b - bh
        color = CYAN if i in (1, 2) else CYAN_L
        s.append(f'<rect x="{x:.1f}" y="{y:.1f}" width="{bw - 12:.1f}" '
                 f'height="{bh:.1f}" fill="{color}" rx="2"/>')
        s.append(f'<text x="{x + (bw - 12) / 2:.1f}" y="{y - 6:.1f}" '
                 f'font-family="{MONO}" font-size="11" fill="{DIM}" '
                 f'text-anchor="middle">{c}</text>')
        s.append(f'<text x="{x + (bw - 12) / 2:.1f}" y="{H - pad_b + 18}" '
                 f'font-family="{MONO}" font-size="10" fill="{MUTE}" '
                 f'text-anchor="middle">{lab}</text>')
    # 中位线
    s.append(f'<text x="{pad_l}" y="{H - 14}" font-family="{SANS}" font-size="12" '
             f'fill="{DIM}">按件报价 <tspan font-family="{MONO}" fill="{CYAN}" '
             f'font-weight="600">{n}</tspan> 条 · 中位 '
             f'<tspan font-family="{MONO}" fill="{INK}" font-weight="600">'
             f"US${med:.2f}</tspan> · 单位：美元/件</text>")
    return "".join(s)


# ---------- 图 2：三商品得分条形图 ----------
def thumb_scoring():
    items = [("工业 LED 工作灯", 59.8, "B"), ("蓝牙耳机 T09", 63.0, "B"), ("毛绒幼儿书包", 42.5, "C")]
    items.sort(key=lambda x: -x[1])
    s = [head("SCORE MODEL", "45/30/25 weighted")]
    x0, y = 150, 76
    bar_max = W - x0 - 74
    for name, score, grade in items:
        wpx = bar_max * score / 100
        s.append(f'<text x="26" y="{y + 13}" font-family="{SANS}" font-size="12" '
                 f'fill="{DIM}">{name}</text>')
        s.append(f'<rect x="{x0}" y="{y}" width="{bar_max}" height="17" '
                 f'fill="#eef2f6" rx="3"/>')
        color = CYAN if grade == "B" else "#b06a2c"
        s.append(f'<rect x="{x0}" y="{y}" width="{wpx:.1f}" height="17" '
                 f'fill="{color}" rx="3"/>')
        s.append(f'<text x="{x0 + bar_max + 9}" y="{y + 13}" font-family="{MONO}" '
                 f'font-size="12" fill="{INK}" font-weight="600">{score:.1f}</text>')
        y += 34
    s.append(f'<text x="26" y="{H - 30}" font-family="{SANS}" font-size="11" '
             f'fill="{MUTE}">三维加权：净利率 45 · 海外需求 30 · 竞争 25（反向）</text>')
    s.append(f'<text x="26" y="{H - 14}" font-family="{MONO}" font-size="11" '
             f'fill="{MUTE}">threshold: profit 25% / 90d 50 orders / rivals 40</text>')
    return "".join(s)


# ---------- 图 3：生活管理应用界面示意 ----------
def thumb_life():
    s = [head("UI SCHEMATIC", "not real data")]
    cx, cy, r = 132, 152, 56
    segs = [(0, 128, "任务", CYAN), (128, 218, "预算", CYAN_L), (218, 360, "精力", "#8fc6d4")]
    import math
    for a0, a1, _, color in segs:
        x0 = cx + r * math.cos(math.radians(a0))
        y0 = cy + r * math.sin(math.radians(a0))
        x1 = cx + r * math.cos(math.radians(a1))
        y1 = cy + r * math.sin(math.radians(a1))
        large = 1 if (a1 - a0) > 180 else 0
        s.append(f'<path d="M {x0:.1f} {y0:.1f} A {r} {r} 0 {large} 1 {x1:.1f} {y1:.1f}" '
                 f'stroke="{color}" stroke-width="22" fill="none"/>')
    s.append(f'<circle cx="{cx}" cy="{cy}" r="34" fill="#f7fafc"/>')
    s.append(f'<text x="{cx}" y="{cy - 2}" font-family="{MONO}" font-size="16" '
             f'fill="{INK}" text-anchor="middle" font-weight="600">16</text>')
    s.append(f'<text x="{cx}" y="{cy + 14}" font-family="{MONO}" font-size="9" '
             f'fill="{MUTE}" text-anchor="middle">CATEGORIES</text>')

    lx = 232
    for i, (label, color) in enumerate([("任务记录", CYAN), ("预算管理", CYAN_L), ("精力分配", "#8fc6d4")]):
        ly = 108 + i * 30
        s.append(f'<rect x="{lx}" y="{ly - 9}" width="10" height="10" fill="{color}" rx="2"/>')
        s.append(f'<text x="{lx + 18}" y="{ly}" font-family="{SANS}" font-size="12" '
                 f'fill="{DIM}">{label}</text>')
    s.append(f'<text x="26" y="{H - 22}" font-family="{SANS}" font-size="11" '
             f'fill="{MUTE}">任务 / 提醒 / 预算 / 精力 四合一 · 圆饼图为中心</text>')
    return "".join(s)


def wrap(body, name):
    svg = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" '
           f'width="{W}" height="{H}">{body}</svg>')
    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, name)
    open(path, "w", encoding="utf-8").write(svg)
    return path


if __name__ == "__main__":
    for fn, name in [(thumb_sourcing, "thumb-sourcing.svg"),
                     (thumb_scoring, "thumb-scoring.svg"),
                     (thumb_life, "thumb-life.svg")]:
        print("written:", wrap(fn(), name))
