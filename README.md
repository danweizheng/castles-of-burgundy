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
```

## 规则保真度

二手规则资料存在错漏（已发现至少两处冲突），因此 `rules/规则规格.md` 中每条规则都标注了
把握度，并逐条列出需要对照官方规则书确认的问题。**规则书是唯一权威。**
