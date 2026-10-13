# 勃艮第城堡 · 单人版（PWA）

手机上单人离线可玩的《勃艮第城堡》（The Castles of Burgundy，Stefan Feld），含 AI 对手。
只在 iPhone Safari 上自用，目标是"添加到主屏幕后像原生 App 一样玩"。

## 已确认的产品决策

| 决策点 | 结论 |
|---|---|
| 目标平台 | iPhone Safari（iOS PWA，standalone 模式） |
| 规则范围 | 基础版 2 人局；更多对手与扩展列为远期里程碑 |
| 单人模式 | Automa 拟人对手（占真领地、真骰子、真板块），另附"纯分数挑战" |
| 界面 | 中文，自绘 SVG 极简符号（不使用原版美术素材） |

## 目录结构

```
docs/      开发方案（可行性评估、阶段计划、工作量）
rules/     规则规格与核对记录（阶段 0 的权威依据，先于代码）
tools/     一次性脚本（图标生成等）
public/    PWA 静态资源
src/engine 纯逻辑引擎：禁止 import react / DOM / window
src/ai     AI 对手：只通过引擎公开接口行动
src/ui     React 界面
src/store  对局状态、撤销栈、自动存档
```

## 三条架构红线

1. **`src/engine` 不认识 React，不碰 DOM，不读 `Date.now()`。** 所有随机来自传入的 seed。
2. **`GameState` 必须 100% JSON 可序列化**（不存 Map/Set/类实例/函数）。撤销 = 快照栈，存档 = `JSON.stringify`，AI = `structuredClone`。
3. **`applyMove(state, action)` 返回 `{ state, events }`。** UI 不自己推算规则，只渲染 `events`。

## 开发命令

```bash
pnpm install
pnpm test        # 规则单元测试
pnpm dev         # 本地开发
pnpm build       # 类型检查 + 构建
pnpm preview     # 预览构建产物（PWA 需要在 HTTPS 或 localhost 下才生效）

# 布局量测（需要先 pnpm build）：在真实浏览器里量元素几何与"有多少元素超出视口"
pwsh tools/measure-narrow.ps1 -Width 390 -Height 844   # 精确 CSS 视口（用 iframe 绕开窗口最小宽度）
pwsh tools/measure-layout.ps1 -Width 844 -Height 390   # 直接开窗口，适合宽视口

# 部署后自检：把线上产物的资源图整条走一遍（含 sw.js 的每一条预缓存）
node tools/check-deploy.mjs
```

## AI 对手

单人模式的对手是自研 AI（`src/ai/heuristic.ts`），不需要任何额外组件。

**关键洞察**：一回合的两颗骰子在回合开始时就已经掷出、双方都看得见，所以"这一回合该怎么打"
是一个**信息完备**的搜索问题——不需要对骰子求期望，只要把两个行动（以及连锁出来的额外行动
与待处理选择）连起来看。困难档因此对**整个回合**做束搜索。

早先的做法是"走一步看一步"的贪心，它有个典型的短视：用骰子 A 取板块、用骰子 B 把它放下，
这两步单独看都不如"取工人"划算，连起来看才是最优。束搜索正好修掉这一点。

难度只靠搜索深度与决策噪声，**不作弊**（不偷看骰子、不改板块顺序）：

| 难度 | 做法 |
|---|---|
| 轻松 | 一层贪心 + 较大噪声，22% 概率随便走 |
| 普通 | 一层贪心 |
| 困难（默认） | 回合开始时整回合束搜索（束宽 16、评估预算 9000） |
| 随机 | 纯随机，最弱的一档 |

实测（`pnpm test` 会打印这两行）：

- 困难 vs 普通：**12 胜 0 负**，平均 154.4 分 vs 94.9 分
- 普通 vs 随机：**20 胜 0 负**，平均 100.5 分 vs 24.2 分
- 困难档单次回合搜索耗时约 **30ms**（界面上给的思考延迟是 420ms，富余很多）

调强度只需要改 `HARD_BEAM_WIDTH` 与 `HARD_EVALUATION_BUDGET`，然后跑 `pnpm test` 看上面两行输出。

## 规则保真度

引擎规则已按**官方规则书**（`rules/CoB_Rulebook_285x210mm [28 pages].pdf`，Special Edition）
逐条核实，核实结果与发现的四处实现错误记在 [`rules/规则规格.md`](rules/规则规格.md) §14。
规则书文本已抽出为 [`rules/rulebook-text.txt`](rules/rulebook-text.txt)，脚本见 `tools/extract-rulebook.py`。

仍为占位数据（需要实物照片）：
- 1 号领地版图的格位颜色 / 数字 / 区域边界
- 2 人局棋盘（翻转面）的仓库格位颜色与数量
- 每种动物的 5 枚绿背板块分别画几只动物；26 张知识板块里哪 6 张是黑背面

## 部署（GitHub Pages）

线上地址：**https://danweizheng.github.io/castles-of-burgundy/**

- 托管在 GitHub Pages（强制 HTTPS），所以 iPhone Safari 里「共享 → 添加到主屏幕」即可装成独立 App
- `main` 分支是源码；`gh-pages` 分支**只有构建产物**（构建产物不进主分支历史）
- 重新发布：

```bash
pnpm build
node tools/deploy-pages.mjs
```

为什么不用 GitHub Actions：当前 `gh` token 没有 `workflow` 作用域，推送 `.github/workflows/`
会被 GitHub 拒绝。需要改成"推 main 自动部署"时：先 `gh auth refresh -s workflow`，
再把 [`docs/github-actions-deploy.yml.example`](docs/github-actions-deploy.yml.example)
复制回 `.github/workflows/deploy.yml`。

⚠️ 仓库是**公开**的：GitHub Pages 在免费账户下只支持公开仓库（私有仓库会返回 422）。
