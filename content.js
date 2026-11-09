const portfolio = {
  name: "夏才艺",
  shortName: "夏才艺",
  initials: "夏",
  title: "跨境贸易 × 数据分析",
  summary: "工业互联网应用专业在读。用数据选品，用代码提效，方向是外贸 B2B 与跨境成本核算。",
  status: "学习中",
  location: "中国 · 山东济宁",
  email: "1705539133@qq.com",
  github: "https://github.com/summer111create",
  csdn: "https://blog.csdn.net/2601_96425433",
  gitee: "",
  resumeUrl: "",
  studyHours: "137",
  skillCount: "05",
  about:
    "大专在读（2026–2029），方向是外贸与跨境数据分析。自己写工具解决真实问题——用 Python 算清楚一个产品出口到底赚不赚钱，而不是拍脑袋。",
  skills: ["Python", "Excel", "HTML/CSS/JS", "Git", "跨境成本核算"],
  projects: [
    {
      category: "crawler",
      number: "01",
      title: "跨境选品工具链",
      description:
        "采集 → 清洗 → 成本核算 → 评分，四段可复现流水线。从阿里国际站采到 137 条真实报价，清洗出 95 条可计价数据，算出 FOB 净利与出口退税。",
      tags: ["Python", "DrissionPage", "成本核算"],
      link: "https://github.com/summer111create/cross-border-sourcing",
      accent: "blue",
      thumb: "assets/thumb-sourcing.svg"
    },
    {
      category: "analysis",
      number: "02",
      title: "跨境选品评分模型",
      description:
        "把「这个品能不能做」变成可打分的数字。净利率 45 / 海外需求 30 / 竞争 25 三维加权，Python 与 Excel 双版本互相验证。",
      tags: ["Python", "Excel", "评分模型"],
      link: "https://github.com/summer111create/cross-scoring-tool",
      accent: "cyan",
      thumb: "assets/thumb-scoring.svg"
    },
    {
      category: "creative",
      number: "03",
      title: "生活管理 Web 应用",
      description:
        "独立开发的个人管理工具，任务记录、提醒、预算与精力分配四合一，以圆饼图串联全部分类，并同步搭建微信小程序版。",
      tags: ["HTML/CSS/JS", "微信小程序", "Data Viz"],
      link: "",
      accent: "mint",
      thumb: "assets/thumb-life.svg"
    }
  ]
};
