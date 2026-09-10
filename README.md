# 夏才艺 · Portfolio

> **Cross-border trade × Data × Web**
> 用数据选品，用代码提效。

工业互联网应用专业在读（2026–2029）。
方向：**外贸 / 跨境电商 × 数据分析**。

会一点 Python，会一点前端，喜欢把重复的事自动化。

- 📫 邮箱：`[待填：你的邮箱]`
- 💼 求职方向：外贸运营 / 跨境选品 / 数据分析
- 🌱 正在学：Python 爬虫、商务英语
- 🔗 GitHub：[github.com/summer111create](https://github.com/summer111create)

---

## ⭐ 主打项目

### 1. 跨境选品数据分析工具（Python）



把"这个品能不能做"从拍脑袋变成算数字。

- 自建评分模型：`净利 = 售价 − 采购 − 物流 − 平台佣金 − 关税 − 认证摊分`，叠加竞品密度评估（基准 50 家）
- Python 算法 + Excel 模板双版本，两套结果一致
- 实测：蓝牙耳机 63.0 / 工业 LED 灯 59.8 / 定制毛绒书包 42.5
- 识别出「低 MOQ 与外观迷惑性」「儿童用品认证成本压制利润」等选品陷阱

<img width="2083" height="799" alt="屏幕截图 2026-09-10 222507" src="https://github.com/user-attachments/assets/1560f857-57b8-446a-b7f0-4b85cbeabce0" />


**技术栈**：Python、Excel 函数与自动化

---

### 2. CSV 自动化数据大屏

读取 CSV 数据自动生成可视化大屏，无需手工做图。

`[待填：补一段说明——数据来源是什么？自动更新吗？用了什么图表库（ECharts/Chart.js）？]`

**技术栈**：HTML / CSS / JavaScript、`[待填：图表库]`

---

### 3. 价格趋势可视化

`[待填：这个页面展示什么价格？数据哪来的？能自动抓取吗？]`

**技术栈**：HTML / CSS / JavaScript

---

## 🗂 其他作品

| 作品 | 说明 |
|---|---|
| 照片回忆墙 | 前端动效展示 |
| 炫酷项目展示 | 前端动效与布局 |
| 开阳云音乐网站 | 音乐站 UI 仿写练习 |
| 模拟小红书笔记 | 社交平台 UI 仿写练习 |
| 我的网页 | 个人主页练习 |
| 个人文章搭建模板 | 可复用文章页模板 |
| 今日星座运势罗盘 | 趣味小工具 |
| 生活管理 Web 应用 | 任务 / 提醒 / 预算 / 精力管理，含圆饼图可视化（`[待填：如果你开源了，填地址]`） |

---

## 🛠 技术栈

**语言与工具**：Python · HTML/CSS/JavaScript · Excel · Git
**方向相关**：跨境选品分析 · 阿里国际站 · 净利与成本核算
**在学**：Python 爬虫 · SQL · 商务英语

---

## 📌 关于这个仓库

这是我的个人作品集，会持续更新。
大部分是跟着教程做的小练习，但从 2026 年起开始做**真正能用的工具**——尤其是外贸和数据分析方向的。

📅 最后更新：`[待填日期]`

---

<!--
========== 使用说明（贴到 GitHub 前请删掉这一段）==========

1. 所有 `[待填：xxx]` 都要替换掉，尤其是「运行截图」——没有截图的项目，点击率掉一半
2. 「主打项目」只留 3 个，宁缺毋滥。1 个能用的工具 > 20 个教程 demo
3. 截图怎么放：把图片上传到仓库（比如建个 assets/ 文件夹），
   然后写 ![](assets/截图.png)
4. 建议加 topics 标签（仓库页面右侧齿轮图标）：
   portfolio · cross-border-ecommerce · python · data-analysis · frontend
5. License 建议选 MIT（仓库根目录加 LICENSE 文件），不填别人不敢用你的代码
-->
[README-作品集仓库-草稿.md](https://github.com/user-attachments/files/32062665/README-.-.md)
# OpenClaw Web Bridge

本地 Web 模型桥接服务：复用已经登录的调试 Chrome，通过 CDP 调用 Web 模型站点，并对 OpenClaw 暴露 OpenAI-compatible API 和服务端 agent 接口。

当前已落地核心骨架和三个浏览器站点适配器：

- `kimi`
- `qwen`
- `deepseek`
- `deepseek-r1`
- `doubao`
- `glm`
- `glm-think`





## 启动

```bash
cd openclaw-web-bridge

npm install
npm start
```

服务会按 `config.json` 里的 `browser` 配置自动启动调试 Chrome 

```json
{
  "browser": {
    "cdpUrl": "http://127.0.0.1:9222",
    "autoLaunch": true,
    "executablePath": "",
    "userDataDir": ".chrome-profile",
    "launchTimeoutMs": 15000,
    "extraArgs": []
  }
}
```

`userDataDir` 就是 Chrome 登录态保存目录；需要设置

