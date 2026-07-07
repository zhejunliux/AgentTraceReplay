<div align="center">

<img src="./public/favicon.svg" width="72" height="72" alt="AgentTraceReplay logo" />

# AgentTraceReplay

**像看视频一样回放 Agent 运行过程。**

拖入一份 OpenTelemetry `gen_ai` trace,在可拖动的时间轴上逐步观看
Agent 如何思考、调用工具、失败、再恢复。

<br />

![AgentTraceReplay 回放示意 —— playhead 扫过时间轴,推理、工具调用、失败与子 Agent 依次点亮](./docs/demo.gif)

<br />

[![License](https://img.shields.io/github/license/zhejunliux/AgentTraceReplay?color=4ade80&style=flat-square)](./LICENSE)
[![在线体验](https://img.shields.io/badge/demo-在线体验-4ade80?style=flat-square)](https://zhejunliux.github.io/AgentTraceReplay/)
[![纯浏览器运行](https://img.shields.io/badge/运行-100%25%20浏览器本地-38bdf8?style=flat-square)](#隐私)
[![无上传](https://img.shields.io/badge/数据-永不离开页面-c084fc?style=flat-square)](#隐私)

<samp>[在线体验](https://zhejunliux.github.io/AgentTraceReplay/) · [快速开始](#快速开始) · [支持格式](#支持的输入格式) · [转换数据](#转换你的运行数据) · [扩展](#新增一种格式) · [Skills](#claude-code-skills) · [隐私](#隐私)</samp>

[English](./README.md) · **中文**

</div>

---

其他 trace 工具展示的都是**静态**的 span 树,而 AgentTraceReplay 让你*回放*整个运行过程 ——
推理在主干线上,工具调用向下分叉,子 Agent 独占一条泳道,失败与重试在发生的那一刻
精准地亮红。

## 快速开始

```bash
npm install
npm run dev      # → http://localhost:5173(自动加载内置示例)
```

然后把你自己的 trace(`.json`)**拖到页面上**即可。要发布成静态站点:

```bash
npm run build    # → dist/,可部署到 GitHub Pages / Vercel / 任意静态托管
```

<table>
<tr><td><kbd>空格</kbd></td><td>播放 / 暂停</td><td><kbd>←</kbd> <kbd>→</kbd></td><td>逐步前进 / 后退</td></tr>
<tr><td><kbd>Esc</kbd></td><td>关闭详情面板</td><td><kbd>点击</kbd></td><td>跳转到该时刻</td></tr>
</table>

## 支持的输入格式

拖入以下任一格式即可 —— 自动识别,无需配置:

| 格式 | 识别依据 | 时间轴 |
| :--- | :------- | :----- |
| **OpenTelemetry `gen_ai`** | `resourceSpans[]` | 真实时间戳 |
| **对话消息** —— OpenAI / Anthropic | 带 `role` 的 `messages[]` | 步骤轴 |
| **Agent 轨迹** —— ReAct / DAComp | `{ thought, action, observation }` 的 `trajectory[]` | 步骤轴 |

> 其他格式会尽力(best-effort)解析,并在界面上标注为*启发式*识别。没有真实时间戳的
> 格式按「步骤轴」布局,回放与结构完全一致,只是横轴显示「step N」而非秒数。

## 转换你的运行数据

在用 Claude Code、Codex、goose 或其他工具?把运行数据转换成受支持的格式:

```bash
node scripts/atif-to-otlp.mjs <run.json>          # ATIF → OTLP(带真实时间戳与 token)
node scripts/trajectory-to-otlp.mjs <traj.json>   # ReAct / DAComp → OTLP
```

或者直接**让 Claude Code 帮你转** —— 仓库内置的 [`/tracereplay`](./.claude/skills/tracereplay/SKILL.md)
skill 会自动完成格式转换。

## 新增一种格式

每个 adapter 本质上就是一个纯函数:`(json) => ReplayModel`。

在 [`src/model/`](./src/model/) 里写一个返回 `ReplayModel`([`types.ts`](./src/model/types.ts))
的函数,并在 [`detect.ts`](./src/model/detect.ts) 里注册即可。UI 只依赖这个统一模型,
完全不关心输入的原始结构。想让 Claude Code 帮你搭脚手架,运行
[`/add-adapter`](./.claude/skills/add-adapter/SKILL.md) skill。

## Claude Code Skills

内置于 [`.claude/skills/`](./.claude/skills/) —— 在本仓库里 Claude Code 会自动识别:

| Skill | 用途 | 面向 |
| :---- | :--- | :--- |
| [`/tracereplay`](./.claude/skills/tracereplay/SKILL.md) | 把一次运行转成可拖入的 trace | 终端用户 |
| [`/add-adapter`](./.claude/skills/add-adapter/SKILL.md) | 为新格式搭建原生支持 | 贡献者 |

## 隐私

所有解析与渲染都在浏览器本地完成。生产构建注入了 Content-Security-Policy
(`connect-src 'self'`),在浏览器层面阻止一切对外网络请求 —— 因此 trace 数据
**不可能**被上传,哪怕是意外。

## 状态

早期 MVP —— 时间轴、回放、span 详情查看已端到端可用。基于(实验阶段的)
OpenTelemetry GenAI 规范构建。欢迎贡献。

<div align="center"><sub>Apache-2.0</sub></div>
