# 夏才艺 · Portfolio
 
> **跨境贸易 × 数据分析**
> 用数据选品，用代码提效。

工业互联网应用专业在读（2026–2029，山东济宁）。
方向：**外贸 B2B × 跨境成本核算 × 数据分析**。

会一点 Python，会一点前端，喜欢把重复的事自动化。

- 📫 邮箱：1705539133@qq.com
- 💼 求职方向：外贸业务员 / 跨境运营 / 数据分析
- 🌱 正在学：Python 爬虫、商务英语、外贸函电
- 🔗 GitHub：[github.com/summer111create](https://github.com/summer111create)
- 📝 CSDN：[blog.csdn.net/2601_96425433](https://blog.csdn.net/2601_96425433)

在线访问：[https://summer111create.github.io](https://summer111create.github.io)

---

## ⭐ 项目

### 1. 跨境选品工具链（Python）

🔗 **[cross-border-sourcing](https://github.com/summer111create/cross-border-sourcing)** · MIT

采集 → 清洗 → 成本核算 → 评分，四段可复现的流水线。不是 demo，是能跑出数字的链条：

```
spider.py   采集   阿里国际站真实商品页（真实浏览器驱动，剔除广告位，随机延时）
    ↓       137 条
clean.py    清洗   区间报价解析 / 千分位 / 计价单位换算 / 去重
    ↓       121 条（其中 95 条可计价）
cost.py     成本   出口退税 rebate() + FOB 净利 fob_profit()
    ↓
score.py    评分   利润 45 / 需求 30 / 竞争 25（反向），A/B/C 分级
```

**它解决什么问题**：外贸业务员报价时最容易犯的错，是把 EXW / FOB / CIF 当成并列项去相减——同一笔钱被扣三遍。这个工具把它们还原成**单向累加**的关系，并把「出口退税」作为收入项计回（这一项常被整个漏掉，而它往往占采购价的 13%）。

```
FOB 净利 = FOB 收入 + 出口退税 − 采购含税价 − 内陆拖车 − 报关港杂 − 银行手续费
出口退税 = 采购含税价 ÷ 1.13 × 退税率
```

**实测**：100 件利润率 4.9% → 500 件 24.6%，验证规模对净利的杠杆效应。

**参数口径**：FOB 主口径 · 中东市场（阿联酋，关税 5% + VAT 5%）· 品类聚焦工程机械易损件

---

### 2. 跨境选品评分模型（Python + Excel）

🔗 **[cross-scoring-tool](https://github.com/summer111create/cross-scoring-tool)** · MIT

把「这个品能不能做」变成可打分的数字。**净利率 45 / 海外需求 30 / 竞争 25（反向）** 三维加权，Python 与 Excel 双版本互相验证——Excel 版给不懂代码的人用。

**实测**：蓝牙耳机 T09 63.0 / 工业 LED 工作灯 59.8 / 毛绒幼儿书包 42.5。跑出来的两个结论比分数本身有用：

- **低 MOQ 有迷惑性**——看似门槛低，实则同款泛滥
- **儿童用品认证成本吃掉利润**——CE/3C 摊到单件后净利率被压

---

### 3. 生活管理 Web 应用

独立开发的个人管理工具，集成任务记录、提醒、预算管理与精力分配，含圆饼图可视化（16 色板、分段着色），并同步搭建了微信小程序版。

🔗 暂未公开部署（含个人数据）

**技术栈**：HTML / CSS / JavaScript · 微信小程序

---

## 🖼 项目卡片缩略图

卡片上的三张数据图**不是素材图，是脚本按真实数据画的**：

```bash
python tools/make-thumbs.py
```

- `thumb-sourcing.svg` ← 读 `阿里清洗.csv`，75 条按件报价的实际分布（中位 US$9.93）
- `thumb-scoring.svg` ← 三个商品的实测得分
- `thumb-life.svg` ← 生活应用的界面结构示意（**非真实数据，图内已标注**）

数据源不在本仓库时，脚本会退回内置的实测快照并在图内注明口径。

---

## 🛠 技术栈

**语言与工具**：Python · HTML/CSS/JavaScript · Excel · Git
**方向相关**：跨境成本核算 · 出口退税 · 阿里国际站 · FOB/CIF 报价
**在学**：Python 爬虫 · SQL · 商务英语

---

## 📌 关于这个仓库

这是我的个人作品集。里面的每一个项目都是我自己写、并且能讲清实现细节的。

> 原则：**1 个能用的工具 > 20 个教程 demo**。宁可少，不挂自己做不出来的东西。

按这条原则，仓库里**不放课程 / 培训机构的模板代码**——哪怕它们看起来更"炫"。展示别人的东西而不说明来源，比没有作品更糟。

📅 最后更新：2026-11-09

---

## 维护说明

### 内容

网站内容由 `content.js` 驱动：修改其中的 `portfolio` 对象（姓名、简介、技能、`projects` 数组），保存后刷新网页即可生效，无需改动 HTML。

`projects` 各项字段说明：

| 字段 | 说明 |
|---|---|
| `category` | 分类筛选：`analysis` / `crawler` / `creative` / `automation` |
| `number` | 卡片序号 |
| `title` / `description` | 标题与描述 |
| `tags` | 技术标签数组 |
| `link` | 点击后跳转的地址；**留空则显示「内部工具」且不可点** |
| `accent` | 卡片配色：`blue` / `cyan` / `coral` / `yellow` / `pink` / `mint` |
| `thumb` | 缩略图路径（推荐用 `tools/make-thumbs.py` 生成）；留空则退回 `accent` 纯色背景 |
| `bgImage` | 自定义背景图路径（优先级低于 `thumb`） |

### 结构

```
index.html            页面骨架（静态文案已填真实信息，JS 失效也不会露出模板内容）
content.js            所有可改内容都在这里
script.js             渲染 / 交互 / 滚动动画
style.css             样式（含移动端断点 900px / 760px）
effects.js            背景粒子与主题切换
assets/               项目卡片数据图（由 tools/make-thumbs.py 生成）
tools/make-thumbs.py  缩略图生成器
```
