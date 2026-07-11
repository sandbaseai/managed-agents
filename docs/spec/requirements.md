# Requirements Document

## Introduction

### 项目定位

**项目名待定（见下方候选）**

**一句话定位**：Open-source Claude Managed Agents runtime — run multi-agent systems locally with any model, beautiful dashboard, and scenario templates.

**副标题**：The self-hosted CMA-compatible agent platform for enterprise teams. One command. Any model. Production templates.

### 巨头格局与差异化分析

2026 年 AI Agent 领域的巨头格局：

| 产品 | 厂商 | 定位 | 本质 |
|------|------|------|------|
| **Claude Managed Agents** | Anthropic | 云端托管 Agent 运行时 | 闭源 SaaS，按量收费，只能用 Claude |
| **Codex** | OpenAI | 云端 coding agent | 闭源，绑定 ChatGPT 生态，擅长 code 场景 |
| **ChatGPT (Workspace Agents)** | OpenAI | 企业聊天 + agent | 闭源 SaaS，面向非技术用户 |
| **WorkBuddy** | Tencent | 桌面 AI 工作台 | 闭源，100+ 场景专家，面向办公自动化 |
| **Gemini Code Assist** | Google | IDE 内 coding agent | 闭源，绑定 Google 生态 |
| **Claude Code** | Anthropic | 终端原生 coding agent | 本地运行但绑 Claude 模型 |

**巨头的共同特征**：
1. ❌ 闭源（不能 fork/定制）
2. ❌ 锁定模型供应商
3. ❌ 数据离开本地（企业合规风险）
4. ❌ 按量收费（成本不可控）
5. ❌ 不能自定义场景方案（你只能用他们给的能力）

### 我们的差异化缝隙

**巨头做的是"产品"——给终端用户用的完整体验。**
**我们做的是"平台 runtime"——给企业 FDE 用的 agent 运行基础设施。**

类比：
- 巨头 = iPhone（你用它，不能改它）
- 我们 = Android（开源，你拿来定制、预装方案、自己运营）

**具体差异矩阵：**

| | 巨头产品 | **本项目** |
|---|---|---|
| 谁用 | 终端用户/开发者个人 | **企业 FDE 团队** |
| 做什么 | 一个 Agent 做一个任务 | **多 Agent 系统 + 场景方案** |
| 模型 | 绑定自家模型 | **Any model（含本地私有部署）** |
| 数据 | 上传到厂商云端 | **完全本地，不出公司网络** |
| 定制 | 只能改 prompt | **YAML 定义一切 + MCP + Skills** |
| 场景方案 | 通用能力，自己摸索 | **模板仓库，选场景一键安装** |
| 费用 | 按 token/月付费 | **开源免费 + 本地模型零成本** |
| 集成 | 用他们的 API | **你自己暴露 CMA 兼容 API** |
| Dashboard | 他们的界面 | **你自己的品牌化 Dashboard** |

### 核心 narrative（能火的逻辑）

> **"巨头给了你 AI Agent 的想象力，我们给你落地的工具。"**

用户路径：
1. 用户在 Claude/ChatGPT/Codex 上体验了 agent 能力 → 想在自己企业里也搞
2. 但不能把数据给 Anthropic/OpenAI → 需要本地跑
3. 不只是一个 agent，要多个 agent 协作 → 需要编排
4. 不想从零搭建 → 需要现成方案模板
5. 要给同事/老板展示 → 需要好看的 Dashboard
6. 要对接现有系统 → 需要标准 API

**我们就是 1→6 的一站式解决方案。**

### 项目名候选（融合 CMA 热度）

| 名字 | 优点 | 缺点 |
|------|------|------|
| **CMABox** | 直接蹭 CMA 热词，一看就懂 | 可能被 Anthropic 投诉商标 |
| **AgentForge** | agent + 锻造，暗示定制化 | 和 CMA 关联弱 |
| **ManagedAgents** | 直接占词 | 太长，太 generic |
| **LocalAgents** | 直接说明本地 | 不够酷 |
| **AgentBox** | 简洁有力，工具箱意象 | 和 CMA 关联需要靠 tagline |
| **OpenCMA** | 直接 "Open" + "CMA" | 简短有力，但可能商标风险 |
| **AgentStation** | 工作站意象 | 偏重，不够轻量感 |
| **RunAgents** | 动词开头，暗示"跑起来" | 太 generic |
| **agentd** | 类 Docker daemon 风格 | 技术气息重 |
| **hive** | 多 agent 蜂巢意象 | 已被占太多 |

**推荐策略**：名字不直接包含 CMA/Claude 词（避免商标），但 GitHub description + README 第一段 + Topics 全部蹭满。

**推荐名字**：**AgentBox** 或 **AgentForge**

Description 这样写：
> `Open-source local runtime for Claude Managed Agents (CMA). Multi-agent orchestration, MCP tools, scenario templates, beautiful dashboard. Any model — run Ollama/vLLM/Claude/GPT locally. CMA-compatible API.`

### 核心卖点（GitHub README 第一屏）

```
🚀 1 分钟启动 — npx agentbox start，零配置运行多 Agent 系统
📦 场景模板 — 客服、编程、研究、运维...选模板即有完整方案
🧠 Any Model — Ollama/vLLM/Claude/GPT，本地或云端自由切换
🔌 MCP + Skills — 标准协议扩展，对接任何外部工具
🎨 Dashboard — 精美管理界面，对话/监控/配置一站式
🔗 CMA 兼容 API — @anthropic-ai/sdk 直接连，随时切换到云端
📁 Git-friendly — YAML 声明式定义，可 diff/review/CI
```

### 目标用户画像

| 用户类型 | 场景 | 使用方式 |
|----------|------|---------|
| **FDE** | 接到"做一个 AI 客服"的需求 | `template install customer-support` → 改提示词 → 交付 |
| **独立开发者** | 想在自己项目里嵌入 Agent | 启动 AgentBox → 用 API 对接 → 本地 Ollama 省钱 |
| **技术经理** | 评估 AI Agent 方案 | 打开 Dashboard 演示 → 看到效果 → 决定落地 |
| **DevOps** | 部署到生产 | 同一套 YAML → docker compose up → 或推云端 |

### 项目名候选

- **AgentBox** — 简洁有力 + "Run Claude Managed Agents locally" tagline 蹭热度
- 备选：CMA-Local / LocalCMA / AgentBox-CMA
- npm 包名：`@agentbox/cli` 或 `agentbox`
- GitHub 仓库名：`agentbox` (org: agentbox-ai)

### 产品边界声明：我们不做可视化工作流引擎

**核心判断**：本项目是 **Agent 执行层**，不是**工作流编排层**。这是一条不可逾越的产品红线，写在这里防止未来 scope creep。

"工作流"这个词容易被泛化误解，我们把它拆成三个层次，只做其中两个：

| 层次 | 定义 | 谁在做（竞品） | 我们做吗 |
|------|------|---------------|---------|
| **层次 1：可视化 DAG 编排** | 预先画好的节点图，条件分支/循环遍历/数据转换全部提前定义，需要专门的画布 UI 和 DAG 执行器 | Dify、n8n、Sim (SimStudio) | ❌ **永远不做** |
| **层次 2：声明式多 Agent 协作** | 只声明"这些 Agent 互相认识、谁可以委派给谁"，具体委派与否、委派几次、委派顺序完全由模型在对话中自主决策 | CMA 官方（`callable_agents`）、OMA | ✅ **我们的范畴**（需求 3） |
| **层次 3：触发/调度机制** | "定时创建 Session" / "webhook 触发创建 Session"，只决定"什么时候开始"，不涉及任务内部的分支逻辑 | LiteLLM Control Plane (Routines) | ⏸ v2 规划（不是工作流引擎，是触发器） |

**为什么层次 1 划红线**：如果客户提出"加个条件分支"（看似无害）→ "加个数据转换节点"（为了对接系统）→ "加个可视化画布"（为了非技术人员用），三步之后我们就变成了阉割版 Dify，既做不过其成熟度，又丢了自己"CMA 兼容 + 1 分钟启动 + 本地优先"的差异化定位。

**判断标准**：如果一个能力需要"预先定义执行路径的分支/循环/数据流转"，就是层次 1，拒绝。如果只是"声明协作关系，让模型自主决策"，是层次 2，可以做。

**FDE 实际场景下"工作流"的决策权归属**：

| 场景 | 谁负责流程决策 | 我们要做什么 |
|------|--------------|-------------|
| "分析工单并生成回复" | 单次调用，无编排 | ✅ 已支持 |
| "调研→撰写→审核"多专业 Agent 配合 | 模型自主决策委派（层次 2） | ✅ 需求 3（动态委派）+ 需求 14（模板预置协作拓扑） |
| "对 CSV 每一行跑一次分类" | 调用方系统循环调用我们的 API | ✅ 我们只需保证批量创建 Session 的 API 人体工学 |
| "情感分析为负→转人工，否则自动回复" | 调用方系统根据返回结果做分支（层次 1，但在客户系统里，不在我们这） | ✅ 我们只需返回结构化结果 |
| "每天 9 点自动跑一次研究 Agent" | 触发机制（层次 3） | ⏸ v2 Routines |

**CMA 协议对委派的原生支持（印证层次 2 的设计方向）**：

CMA 协议本身提供两种委派机制，均是模型自主决策，没有预定义执行路径：

1. **显式 Roster（`callable_agents`）** — Agent 配置声明一份"可调用 Agent 名单"（`[{type: "agent", id: "agent_xxx", version}]`），模型对话中可以委派给名单里的具体 Agent
2. **内置通用子代理（`enable_general_subagent`）** — 开启后 harness 自动暴露 `general_subagent(task)` 工具，模型可以直接派生一个继承当前 model/sandbox 配置的临时子任务线程，不需要提前注册具体 Agent；子代理不能再往下委派（防止无限递归链）

我们需求 3 的 `delegations` 字段设计对应方式一（显式 Roster）；`enable_general_subagent` 风格的通用子代理可作为 v1.x 的增量能力。

### 协议与技术选型决策

#### 三大协议的关系与选择

```
┌──────────────────────────────────────────────────────────────┐
│  CMA (Claude Managed Agents Protocol)                        │
│  = 我们对外暴露的 API 协议规范                                │
│  = 完整的 Session 管理生命周期（create/event/stream/stop）    │
│  → v1 核心：用户用 @anthropic-ai/sdk 改 base_url 即可对接    │
├──────────────────────────────────────────────────────────────┤
│  MCP (Model Context Protocol)                                │
│  = Agent 向外获取工具的标准（Agent → Tool Server）            │
│  = "USB 接口"：一次实现，所有 Agent 都能用                    │
│  → v1 核心：Agent 通过 MCP 连接外部工具服务器                 │
├──────────────────────────────────────────────────────────────┤
│  ACP (Agent Client Protocol)                                 │
│  = 外部系统调度 Agent 的通信协议（Client → Agent Runtime）    │
│  = 轻量消息传递，不含 Session 管理和 Sandbox 生命周期        │
│  → v2 可选：若需委派任务给外部 runtime（Claude Code/Hermes）  │
└──────────────────────────────────────────────────────────────┘
```

**选择 CMA 而非 ACP 作为对外 API 的原因**：
- CMA 是"全托管服务接口"，覆盖 Session 全生命周期 + Sandbox + Event Log，比 ACP 更完整
- CMA 有现成的官方 SDK（@anthropic-ai/sdk），用户零学习成本
- CMA 搜索热度高，有利于项目发现和传播

#### Agent Loop Engine 选型

**决策：v1 使用 Vercel AI SDK `streamText` + `maxSteps`**

| 可选方案 | 类型 | 特点 | 我们的决策 |
|----------|------|------|-----------|
| **Vercel AI SDK** | 库（可嵌入） | 75+ providers、内置 maxSteps 循环、streaming 原生 | ✅ v1 采用 |
| Claude Code / OpenClaw / Hermes | 完整产品（黑盒） | 自己跑 loop，只能通过 ACP 委派 | ❌ 不适合当 engine |
| LangChain.js | 库 | 功能多但重，过度抽象 | ❌ |
| 直接用 OpenAI/Anthropic SDK | 库 | 需要手写 loop，单 provider | ❌ 太底层 |

**选 Vercel AI SDK 的核心理由**：
- 它是唯一能在 TypeScript 进程内同时提供"多 provider + 自动 tool loop + streaming"的成熟库
- OMA（最成功的 CMA 开源实现）也用它——验证过的路径
- loop 在我们进程内跑 → 每个 tool call、每个 token、每个 thinking block 都完全可见可控可记录

**"委派给外部 runtime"的代价（为什么不用 Hermes/Claude Code 当 engine）**：
- 失去对话历史的完整可见性（tool 调用细节可能拿不到）
- 失去 Session/Sandbox 分离（外部 runtime 把两者合一了）
- 失去模型自由切换能力（绑定外部 runtime 的模型选择）
- 退化为 UI 壳子，不再是自主 runtime

#### Web Dashboard 设计参考

**参考项目**：OMA Console (`references/open-managed-agents/apps/console/`)

**技术栈**：React 19 + Vite + Tailwind v4 + shadcn/ui + TanStack Query + React Router

**页面结构参考**（从 OMA 提炼适合我们的）：

| OMA 页面 | 我们是否需要 | 对应需求 |
|----------|------------|---------|
| Dashboard | ✅ | 首页概览 |
| AgentsList / AgentDetail | ✅ | 需求 10 (Web UI) |
| SessionsList / SessionDetail | ✅ | 需求 10 |
| Session Trajectory（事件时间线） | ✅ | 核心：对话 + tool call 可视化 |
| ModelCardsList | ✅ | 模型配置页 |
| SkillsList | ✅ | Skills 管理 |
| EnvironmentsList | ⚠️ v2 | 环境管理 |
| VaultsList | ❌ | 凭据隔离（我们 v1 不做 vault） |
| IntegrationsLinear/GitHub/Slack | ❌ | 我们 v1 不做集成 |
| EvalRunsList | ❌ | 我们 v1 不做评估 |

**UI 设计风格**：
- 深色/浅色主题切换
- 开发者工具感（monospace 字体用于代码/事件）
- 左侧导航栏 + 右侧内容区
- Session 详情页核心是"事件时间线"——实时展示 tool call 流程
- 使用 shadcn/ui 组件库（和 OMA 一致）

```
┌─────────────────────────────────────────────────────┐
│  AgentBox Dashboard                                  │
│                                                     │
│  ┌──────┐  ┌────────────────────────────────────┐   │
│  │ Nav  │  │  内容区                              │   │
│  │      │  │                                    │   │
│  │ 📊   │  │  页面路由：                          │   │
│  │ 🤖   │  │  /           → Dashboard 概览       │   │
│  │ 💬   │  │  /agents     → Agent 列表/详情      │   │
│  │ 🧠   │  │  /sessions   → Session 列表/对话    │   │
│  │ ⚙️   │  │  /models     → 模型配置             │   │
│  │ 📦   │  │  /templates  → 模板浏览/安装        │   │
│  │      │  │  /skills     → Skills 管理          │   │
│  │      │  │  /settings   → 系统设置             │   │
│  └──────┘  └────────────────────────────────────┘   │
└─────────────────────────────────────────────────────┘
```

### 系统架构图

```
┌─────────────────────────────────────────────────────┐
│                  AgentBox (单进程)                     │
│                                                     │
│  ┌─────────────┐  ┌──────────────┐  ┌───────────┐  │
│  │  Dashboard  │  │  REST API    │  │  CLI      │  │
│  │  (React)    │  │  (CMA 兼容)  │  │           │  │
│  └──────┬──────┘  └──────┬───────┘  └─────┬─────┘  │
│         └────────────────┼─────────────────┘        │
│                          ▼                          │
│  ┌──────────────────────────────────────────────┐   │
│  │           Agent Runtime Engine               │   │
│  │                                              │   │
│  │  ┌─────────┐  ┌─────────┐  ┌────────────┐   │   │
│  │  │ Agent A │←→│ Agent B │←→│ Agent C    │   │   │
│  │  └────┬────┘  └────┬────┘  └─────┬──────┘   │   │
│  │       │             │              │          │   │
│  │  ┌────┴─────────────┴──────────────┴────┐    │   │
│  │  │  Tools · MCP · Skills · Sandbox      │    │   │
│  │  └─────────────────────────────────────-┘    │   │
│  └──────────────────────────────────────────────┘   │
│                          │                          │
│  ┌──────────┐  ┌────────┴────────┐  ┌──────────┐   │
│  │  SQLite  │  │  Model Adapter  │  │ Template │   │
│  │  (状态)  │  │  (Any Model)    │  │ Registry │   │
│  └──────────┘  └─────────────────┘  └──────────┘   │
└─────────────────────────────────────────────────────┘
```

### 与竞品的本质区别（README 对比表）

| | Claude Managed Agents | OMA | Dify | **AgentBox** |
|---|---|---|---|---|
| 部署 | Anthropic 云端 | CF Workers / Docker | Docker + Redis + PG | **`npx agentbox start`** |
| 数据位置 | Anthropic 服务器 | CF / 你的服务器 | 你的服务器 | **你的笔记本** |
| 模型 | Claude only | Claude + OpenAI 兼容 | 多模型 | **Any（含 Ollama 本地）** |
| 费用 | 按 token 收费 | 自负模型费 | 自负模型费 | **本地模型 = 免费** |
| 上手时间 | 10 分钟 | 30 分钟+ | 1 小时+ | **1 分钟** |
| 场景模板 | ✗ | ✗ | 有（workflow 导入） | **✓ 一键安装** |
| CMA 兼容 | 原版 | 完全兼容 | ✗ | **完全兼容** |
| Dashboard | ✗（API only） | 有 Console | 有 | **✓ 精美内置** |

### 竞品分析

#### 第一类：CMA 协议兼容/替代项目

| 项目 | Stars | 定位 | 语言 | 部署模式 | 企业友好度 |
|------|-------|------|------|----------|-----------|
| **OMA (open-ma)** | — | CMA API 开源替代 | TypeScript | CF Workers + Docker | 中（偏云端） |
| **OpenClaw Managed Agents (stainlu)** | — | CMA + ChatGPT Workspace 替代 | Python | any cloud | 低（缺企业治理） |
| **Vercel claude-managed-agents-starter** | — | CMA 快速起步 demo | Next.js | Vercel | 低（demo 级） |

#### 第二类：多 Agent 编排框架

| 项目 | Stars | 定位 | 语言 | 部署模式 | 企业友好度 |
|------|-------|------|------|----------|-----------|
| **LangGraph** | — | 生产级状态机 agent | Python | 自部署/LangSmith | 高（审计、断点、可观测） |
| **CrewAI** | — | 角色化 agent 团队 | Python | 自部署/Cloud | 中（快速原型，治理弱） |
| **AG2 (原 AutoGen)** | 50K+ | 多 agent 对话编排 | Python | 库 | 中（框架级，需自建） |
| **OpenAI Agents SDK** | — | OpenAI 官方 agent 框架 | Python/JS | 任意 | 低（绑定 OpenAI） |
| **Microsoft Agent Framework** | — | .NET + Python agent 框架 | .NET/Python | Azure | 高（深度 Azure 集成） |

#### 第三类：可视化 Agent/Workflow 平台

| 项目 | Stars | 定位 | 语言 | 部署模式 | 企业友好度 |
|------|-------|------|------|----------|-----------|
| **Dify** | 134K+ | 可视化 LLM 应用开发平台 | Python | 自托管/Cloud | 高（RAG、模型管理、多租户） |
| **n8n** | — | Workflow 自动化 + AI Agent | TypeScript | 自托管/Cloud | 高（审计、RBAC、SSO） |
| **Coze (字节)** | — | Agent 开发平台 | — | SaaS | 中（闭源、数据出境） |
| **FastGPT** | — | RAG + 对话流平台 | TypeScript | 自托管 | 中 |

#### 第四类：Agent 管理/项目管理

| 项目 | Stars | 定位 | 语言 | 部署模式 | 企业友好度 |
|------|-------|------|------|----------|-----------|
| **Multica** | 22K+ | Agent 团队项目管理 | Go + TS | 自托管 | 中（面向 PM，非 FDE） |
| **Vercel open-agents** | — | 云端 coding agents | TypeScript | Vercel | 低 |

#### 第五类：Agent Skill 注册/共享

| 项目 | Stars | 定位 | 语言 | 部署模式 | 企业友好度 |
|------|-------|------|------|----------|-----------|
| **iFlytek SkillHub** | — | 企业 agent skill 注册中心 | — | Docker/K8s 自托管 | 高（RBAC、审计日志） |
| **agent-skills-hub** | — | 跨平台 skill 共享库 | — | GitHub 静态仓库 | 低（社区级） |

### 差异化竞争策略

根据市场全景分析，本项目的差异化定位：

**核心叙事：FDE 的 Agent 工具箱 — 面向企业落地，5 分钟从模板到生产**

与现有竞品相比的 5 个独特卖点：

1. **Local-first + 企业落地**：LangGraph/CrewAI/AG2 是库（你要写代码），Dify/n8n 是平台（要部署运维），本项目是**工具**（一条命令跑起来，文件系统即配置）
2. **方案模板系统（唯一）**：没有现有项目把"预置的场景方案一键安装"作为核心概念。Dify 有模板但是可视化 workflow 导入，LangGraph/CrewAI 没有
3. **CMA 协议兼容 + 模型无关**：OMA 走 CMA 但绑 Anthropic，我们走 CMA 但支持 Ollama/vLLM 本地模型，企业不被供应商锁定
4. **声明式 YAML（Git-native）**：Dify 是 DB 存储 workflow，LangGraph 是 Python 代码，我们是 YAML 文件——可 diff、可 code review、可 CI/CD
5. **面向 FDE 而非平台运营者**：OMA/Dify/n8n 面向的是"部署一个平台给组织用"，我们面向的是"FDE 拿到需求，5 分钟选模板跑通 PoC，然后上线"

**企业落地关键差异点：**

| 企业诉求 | Dify | LangGraph | CrewAI | **本项目** |
|----------|------|-----------|--------|-----------|
| 数据不出境 | ✓ 自托管 | ✓ 但需自建 | ✓ 但需自建 | ✓ 本地 SQLite 一切自包含 |
| 审批上线快 | 需部署 Docker | 需写代码 | 需写代码 | **一条命令，零基础设施** |
| 团队复用方案 | 导出 DSL | 共享代码库 | 共享代码库 | **模板仓库 + template install** |
| 对接本地模型 | 支持 | 支持 | 支持 | **一等公民（Ollama 自动发现）** |
| 渐进式上云 | SaaS 版 | LangSmith | CrewAI Cloud | **同一套 YAML 直接推云端** |
| FDE 上手时间 | 1-2 天 | 3-5 天 | 1-2 天 | **5 分钟（选模板 + start）** |

## Glossary

- **Platform**：本 local-first agent 开发平台的整体系统
- **Agent_Runtime**：Agent 运行时引擎，负责加载 Agent 定义、执行对话循环、管理 Agent 生命周期
- **Agent_Definition**：Agent 的声明式配置文件（YAML/JSON 格式），包含模型选择、Skills 引用、MCP 服务器配置、系统提示词等
- **Multi_Agent_Orchestrator**：多 Agent 编排器，负责 Agent 之间的委派调用和消息路由
- **Skill**：可复用的能力单元，兼容 Claude Code SKILL.md 格式，描述 Agent 可执行的特定任务逻辑
- **MCP_Client**：Model Context Protocol 客户端，连接外部 MCP 服务器以获取 Tools 和 Resources
- **MCP_Server_Config**：MCP 服务器连接配置，支持 stdio 和 HTTP(SSE) 两种传输方式
- **Model_Adapter**：模型适配层，统一本地模型（Ollama、vLLM、llama.cpp）和远程 API（Anthropic、OpenAI 等）的调用接口
- **CMA_Protocol**：Claude Managed Agents 协议，Anthropic 定义的 Agent 管理和交互 REST API 规范
- **Session**：**控制平面的状态机对象**，与 Sandbox 是两个独立的资源，但生命周期 1:1 绑定。Session 归属 Agent_Runtime 管理，负责：维护 status 状态机（queued → running → paused/requires_action → completed/failed）、持久化 Event_Log（对话历史、工具调用记录）、持有当前关联的 Sandbox 引用。Session 是有状态的（stateful）——支持暂停后干净恢复（resume），这是与无状态 Messages API 调用的核心区别。Session 创建遵循两步生命周期：先 create（此时 provision 对应的 Sandbox），再发第一个 user 事件才真正开始执行任务
- **Environment**：**可复用的 Sandbox 配置模板**，不是运行实例。定义 Sandbox 的规格（类型 `local`/`docker`/`e2b`/`daytona`、预装依赖、网络策略、资源限制）。多个 Session 可以引用同一个 Environment，但每个 Session 各自 provision 一个全新、独立的 Sandbox 实例——Environment 本身不消耗资源，只在 Session 创建时被实例化
- **Sandbox_Provider**：**执行层的可插拔后端**，负责实际执行工具调用（bash/read/write 等），提供统一接口（`execute`/`writeFile`/`readFile`/`cleanup`）。与 Session 的关系是 1:1 绑定且生命周期从属：Session 创建时 provision 一个 Sandbox 实例，Session 销毁时对应 Sandbox 一并销毁；但 Sandbox 不能脱离 Session 单独存在或被多个 Session 共享（这点与可复用的 Environment 不同）。Sandbox 之间互不共享文件系统状态和进程空间，即使引用同一个 Environment
- **Event_Log**：事件日志，Session 状态机中所有交互的 append-only 持久化记录（用户消息、Agent 回复、工具调用、工具结果、状态变更）。Event_Log 恢复对话上下文和模型上下文，但**不能**恢复 Sandbox 文件系统的实际字节内容（见 Workspace_Snapshot）
- **Workspace_Snapshot**：工作区快照，Sandbox 文件系统的周期性备份（如 tar 包），用于 Session 恢复时还原文件系统实际内容。Event_Log 记录"发生了什么"，Workspace_Snapshot 记录"文件系统变成了什么样"——两者配合才能做到接近完整的 crash recovery
- **Web_UI**：内嵌的 Web 管理界面，提供对话、Agent 管理、Session 历史、模型配置等功能
- **CLI**：命令行界面工具，提供 init、start、chat、deploy 等开发者日常操作命令
- **Config_Store**：基于 SQLite 的本地配置和状态存储
- **SSE_Stream**：Server-Sent Events 流式事件推送，用于实时传递 Agent 执行过程中的 token 流和状态变更
- **FDE**：Front-line Development Engineer，前线开发工程师，本平台的目标用户
- **Solution_Template**：方案模板，一套预置的场景化 Agent 套件，包含完整的 agents + skills + mcp_servers 配置，用户可一键安装到项目中
- **Template_Repository**：模板仓库，一个 GitHub 代码仓库，根目录下每个子目录就是一个模板，遵循约定的目录结构即可
- **Context_Compaction**：上下文压缩，Session 内对话历史过长时的自动摘要/裁剪机制，用于在不丢失关键信息的前提下控制模型上下文窗口占用
- **Memory_Provider**：长期记忆提供者，跨 Session 的持久化记忆层，负责从对话中抽取、存储和检索结构化知识。本项目不自造记忆层，而是集成开源方案（如 mem0、memU）作为可选 Plugin
- **Context_ID**：上下文标识符，用户在创建 Session 时可选传入的字符串，标识一组逻辑上相关的 Session。Memory_Provider 以 context_id 为作用域存取记忆——同一 context_id 下的 Session 可共享长期记忆，不传则完全隔离
- **Agent_Strategy**：Agent 循环策略，定义 Session 的 engine loop 执行逻辑（上下文构建 → LLM 调用 → 响应解析 → 工具执行 → 循环）。可插拔接口，v1 内置 DefaultStrategy（基于 Vercel AI SDK streamText + maxSteps），后续可扩展 PlannerStrategy、RAGStrategy 等

## Requirements

---

### 需求 1：单进程本地启动

**用户故事：** 作为 FDE，我希望通过一条命令即可在本地启动完整的 Agent 平台（含 API 服务器和 Web UI），以便零基础设施依赖地开始 Agent 开发。

#### 验收标准

1. THE Platform SHALL 支持通过 `npx agentbox start` 命令以单进程方式启动全部服务（HTTP API 服务器、Web UI 静态资源服务、Agent 运行时）
2. THE Platform SHALL 在启动时自动初始化本地 SQLite 数据库文件（默认路径为项目目录下的 `.agentbox/data.db`），无需用户手动配置数据库
3. THE Platform SHALL 在启动完成后在终端输出可访问的本地地址（包含 API 地址和 Web UI 地址）
4. THE Platform SHALL 支持通过环境变量或命令行参数配置监听端口（默认 3000）和数据目录路径
5. IF 指定端口已被占用，THEN THE Platform SHALL 输出明确的错误提示并退出，不尝试自动切换端口
6. THE Platform SHALL 在接收到 SIGINT 或 SIGTERM 信号时优雅关闭所有服务（关闭数据库连接、停止运行中的 Agent、释放 MCP 连接）

---

### 需求 2：声明式 Agent 定义

**用户故事：** 作为 FDE，我希望用 YAML 文件声明式地定义 Agent 的配置（模型、Skills、MCP 工具、系统提示词等），以便将 Agent 定义纳入 Git 版本控制并团队协作。

#### 验收标准

1. THE Agent_Runtime SHALL 从项目目录下的 `agents/` 文件夹加载所有 Agent 定义文件（支持 `.yaml` 和 `.json` 格式）
2. THE Agent_Runtime SHALL 要求每个 Agent_Definition 包含以下必填字段：`name`（唯一标识符）、`model`（模型引用）、`system_prompt`（系统提示词）
3. THE Agent_Runtime SHALL 支持 Agent_Definition 中的以下可选字段：`description`（描述）、`skills`（Skills 引用列表）、`mcp_servers`（MCP 服务器配置列表）、`tools`（内置工具配置）、`max_turns`（最大对话轮次）、`temperature`（温度参数）、`delegations`（可委派的目标 Agent 列表）
4. WHEN Agent_Definition 文件中包含语法错误或缺失必填字段时，THE Agent_Runtime SHALL 在启动时输出具体的错误位置和原因，并跳过该 Agent 的加载（不影响其他 Agent 的正常启动）
5. WHEN 项目目录下的 Agent_Definition 文件发生变更时，THE Agent_Runtime SHALL 支持通过 CLI 命令（`agent reload`）热重载 Agent 定义，无需重启整个服务
6. THE Agent_Runtime SHALL 对 Agent_Definition 文件内容执行 JSON Schema 校验，确保字段类型和取值范围的合法性

---

### 需求 3：多 Agent 编排与委派

**用户故事：** 作为 FDE，我希望定义多个 Agent 并让它们之间可以相互委派任务，以便构建复杂的多 Agent 协作场景。

**边界说明**：本需求属于「产品边界声明」中的**层次 2：声明式多 Agent 协作**——我们只声明"谁可以委派给谁"，具体是否委派、委派几次、委派顺序完全由模型在对话中自主决策，不提供预定义执行路径（分支/循环/数据流转）的可视化编排能力。这与 CMA 协议原生的 `callable_agents` 委派机制一致。

#### 验收标准

1. THE Multi_Agent_Orchestrator SHALL 支持在 Agent_Definition 的 `delegations` 字段中声明当前 Agent 可委派调用的目标 Agent 名称列表（对应 CMA 协议的 `callable_agents` roster 机制）
2. WHEN Agent A 在对话过程中需要委派任务给 Agent B 时，THE Multi_Agent_Orchestrator SHALL 创建子 Session 将任务上下文传递给 Agent B，并将 Agent B 的执行结果返回给 Agent A
3. THE Multi_Agent_Orchestrator SHALL 检测循环委派（A 委派 B，B 又委派 A）并在检测到循环时终止执行链，返回错误信息
4. THE Multi_Agent_Orchestrator SHALL 支持配置最大委派深度（默认 5 层），超过深度限制时终止执行链并返回错误信息
5. WHEN 被委派的目标 Agent 名称在已加载的 Agent 列表中不存在时，THE Multi_Agent_Orchestrator SHALL 返回明确的错误信息指明目标 Agent 未找到
6. THE Multi_Agent_Orchestrator SHALL 在委派执行过程中通过 SSE_Stream 实时推送委派链的执行状态（哪个 Agent 正在执行、委派层级等）
7. THE Agent_Runtime SHALL 支持在 Agent_Definition 中配置 `enable_general_subagent` 布尔字段（对应 CMA 协议的内置通用子代理机制），开启后模型可调用 `general_subagent(task)` 工具派生一个继承当前 model/sandbox 配置的临时子任务线程，无需提前在 `delegations` 中注册；该子代理不可再向下委派（防止无限递归链）

---

### 需求 4：Skills 系统

**用户故事：** 作为 FDE，我希望为 Agent 定义和加载 Skills（兼容 Claude Code SKILL.md 格式），以便复用已有的 Skill 资源并规范 Agent 的能力描述。

#### 验收标准

1. THE Agent_Runtime SHALL 从项目目录下的 `skills/` 文件夹加载 Skill 定义文件（Markdown 格式，兼容 Claude Code SKILL.md 规范）
2. THE Agent_Runtime SHALL 解析 Skill 文件中的名称、描述、输入参数、输出格式和执行指令等结构化信息
3. WHEN Agent_Definition 中引用的 Skill 名称在已加载的 Skills 列表中不存在时，THE Agent_Runtime SHALL 在启动时输出警告信息并继续加载该 Agent（Skill 引用标记为不可用）
4. THE Agent_Runtime SHALL 在 Agent 执行对话时将已加载的 Skills 信息注入到模型的系统上下文中，使模型了解可用的能力
5. THE Agent_Runtime SHALL 支持通过 Agent_Definition 中的 `skills` 字段选择性地为每个 Agent 分配不同的 Skill 子集
6. FOR ALL 合法的 Skill 文件，解析后再序列化回 Markdown 格式 SHALL 保留原始文件的语义内容（round-trip 属性）

---

### 需求 5：MCP 集成

**用户故事：** 作为 FDE，我希望在 Agent 定义中配置 MCP 服务器连接，以便 Agent 可以通过 MCP 协议调用外部工具和访问外部资源。

#### 验收标准

1. THE Agent_Runtime SHALL 支持在 Agent_Definition 的 `mcp_servers` 字段中配置 MCP 服务器连接，每个配置包含：`name`（标识名）、`transport`（传输方式：stdio 或 http）、连接参数
2. WHEN MCP_Server_Config 的 transport 为 stdio 时，THE Agent_Runtime SHALL 启动指定的子进程命令并通过标准输入/输出进行 MCP 通信
3. WHEN MCP_Server_Config 的 transport 为 http 时，THE Agent_Runtime SHALL 通过 HTTP/SSE 连接到指定的 URL 端点进行 MCP 通信
4. THE Agent_Runtime SHALL 在 Agent 启动时建立与配置的 MCP 服务器的连接，获取可用的 Tools 和 Resources 列表，并将其注册为 Agent 可调用的工具
5. IF MCP 服务器连接失败或超时（默认 30 秒），THEN THE Agent_Runtime SHALL 记录错误日志，将该 MCP 服务器标记为不可用，并继续 Agent 的正常运行（降级模式）
6. WHEN MCP 服务器连接中断时，THE Agent_Runtime SHALL 自动尝试重连（指数退避策略，最大间隔 60 秒，最多重试 5 次）
7. THE Agent_Runtime SHALL 支持在 Agent_Definition 中为 MCP 服务器配置环境变量（用于传递 API Key 等敏感信息），环境变量值支持从系统环境变量中引用（`${ENV_VAR_NAME}` 语法）

---

### 需求 6：模型适配层

**用户故事：** 作为 FDE，我希望在 Agent 定义中灵活选择使用本地模型（Ollama、vLLM）或远程 API（Anthropic、OpenAI），以便根据开发阶段和场景选择最合适的模型。

#### 验收标准

1. THE Model_Adapter SHALL 提供统一的模型调用接口，屏蔽不同模型提供者的 API 差异
2. THE Model_Adapter SHALL 支持以下模型提供者类型：`ollama`（本地 Ollama 服务）、`openai`（OpenAI 兼容 API，包括 vLLM、llama.cpp 等本地推理服务）、`anthropic`（Anthropic API）
3. THE Agent_Runtime SHALL 支持在项目级配置文件（`agentbox.config.yaml`）中定义模型注册表，每个模型条目包含：`name`（引用名）、`provider`（提供者类型）、`model`（模型标识）、`base_url`（API 端点，可选）、`api_key`（认证密钥，支持环境变量引用）
4. WHEN Agent_Definition 的 `model` 字段引用的模型名称在注册表中不存在时，THE Agent_Runtime SHALL 在启动时输出错误信息并拒绝加载该 Agent
5. THE Model_Adapter SHALL 支持流式响应（streaming），通过 SSE_Stream 实时推送模型生成的 token
6. IF 模型调用返回错误（网络超时、认证失败、速率限制等），THEN THE Model_Adapter SHALL 根据错误类型决定是否重试（网络超时重试最多 3 次，认证失败不重试，速率限制按 Retry-After 头等待后重试）

---

### 需求 7：CMA 协议兼容 API

**用户故事：** 作为 FDE，我希望本地平台暴露兼容 Claude Managed Agents 协议的 REST API，以便我的项目可以直接使用 `@anthropic-ai/sdk` 对接本地 Agent 运行时，也可以将本地 Agent 作为远端 CMA 服务的替代品。

#### 验收标准

1. THE Platform SHALL 暴露兼容 CMA 协议的 REST API 端点，包括：创建 Agent Session、发送消息、获取 Session 历史、列出可用 Agent
2. THE Platform SHALL 支持用户项目通过标准 `@anthropic-ai/sdk` 客户端库（配置 base_url 指向本地地址）与本地 Agent 进行交互
3. THE Platform SHALL 在 CMA 兼容端点的响应中遵循 CMA 协议定义的数据结构和字段命名规范
4. THE Platform SHALL 在 CMA 兼容端点之外提供扩展端点（以 `/x/` 路径前缀区分），支持平台特有的功能（如 Agent 热重载、MCP 服务器状态查询、系统健康检查）
5. THE Platform SHALL 支持 SSE 流式响应模式，在 Agent 执行对话时通过 SSE 实时推送 token 流、工具调用事件和状态变更事件
6. WHEN 请求中包含不支持的 CMA 协议字段时，THE Platform SHALL 忽略该字段并正常处理请求（向前兼容）

---

### 需求 8：本地存储

**用户故事：** 作为 FDE，我希望所有的会话历史、Agent 状态和配置数据都存储在本地 SQLite 中，以便数据完全可控、无隐私顾虑且便于调试。

#### 验收标准

1. THE Config_Store SHALL 使用 SQLite 作为唯一的持久化存储引擎，所有数据保存在单一数据库文件中
2. THE Config_Store SHALL 存储以下数据类型：Session 历史（包含完整的消息列表和元数据）、Agent 运行时状态、模型配置和用户自定义配置
3. THE Config_Store SHALL 在首次启动时自动执行数据库 schema 初始化（创建表结构和索引）
4. WHEN 平台版本升级导致 schema 变更时，THE Config_Store SHALL 自动执行增量迁移（migration），保留已有数据不丢失
5. THE Config_Store SHALL 支持 Session 数据的分页查询（按时间倒序，默认每页 20 条）
6. THE Config_Store SHALL 为 Session 消息表建立基于 session_id 和 created_at 的复合索引，确保查询性能

---

### 需求 9：Session 与 Sandbox 生命周期

**用户故事：** 作为 FDE，我希望清楚理解 Session（控制平面状态机）和 Sandbox（执行层后端）是两个独立但生命周期绑定的资源，以便正确实现 crash recovery、多租户隔离和 sandbox 后端可插拔。

#### 验收标准

1. THE Agent_Runtime SHALL 遵循 CMA 协议的四层概念模型：Agent（持久配置，可复用）→ Environment（可复用的 Sandbox 配置模板，不消耗资源）→ Session（控制平面状态机，管理 Event_Log 和状态）→ Sandbox（执行层实例，1:1 绑定到某个 Session）
2. THE Agent_Runtime SHALL 将 Session 创建拆分为两步：第一步 `create session` 立即 provision 对应的 Sandbox 实例（Sandbox 配置取自关联的 Environment），此时任务尚未开始执行；第二步收到首个 user 事件后才驱动 Session 状态机开始执行任务
3. THE Agent_Runtime SHALL 确保 Sandbox 是 Session 的从属资源而非独立可复用资源：Sandbox 不能脱离 Session 单独存在，也不能被多个 Session 共享；即使多个 Session 引用同一个 Environment，各自获得的仍是全新、互相隔离的 Sandbox 实例（文件系统和进程空间互不共享）
4. THE Agent_Runtime SHALL 将 Session 状态机维护为显式状态：`queued`（等待 Sandbox provision 完成）→ `running`（正在处理事件）→ `paused` / `requires_action`（等待用户确认或补充输入）→ `completed` / `failed`
5. THE Agent_Runtime SHALL 支持通过 session_id 随时 resume 一个已暂停或已闲置的 Session：重新 provision 一个 Sandbox 实例（可以是全新的、甚至是不同类型的第三方 Sandbox），从持久化的 Event_Log 重建模型上下文，用户发送新事件后 Session 继续执行。此过程对用户透明——用户只需 `POST /v1/sessions/:id/events` 即可唤醒任何未 completed/failed 的 Session
6. THE Agent_Runtime SHALL 将 Session 中所有交互记录为 append-only 的 Event_Log（用户消息、Agent 回复、工具调用及结果、状态变更），Event_Log 归属 Session（控制平面），独立于 Sandbox 生命周期持久化到 SQLite。Session 的全部状态（对话历史 + 元数据 + 状态机 status）通过 session_id 唯一索引，支持 API 和 Dashboard 快速检索
7. THE Agent_Runtime SHALL 允许 Session resume 时绑定与创建时不同的 Sandbox_Provider——例如 Session 创建时用了 local subprocess，暂停后 resume 时可切换为 Docker 或第三方云端沙箱，只要新 Sandbox 实现了统一的 Sandbox_Provider 接口即可。Session 的对话上下文从 Event_Log 恢复，不依赖原 Sandbox 的存活
8. WHEN Session 状态变为 `completed`、`failed` 或被删除时，THE Agent_Runtime SHALL 销毁对应的 Sandbox 实例（释放工作目录/容器），但 Session 元数据和 Event_Log 保留可查
9. THE Agent_Runtime SHALL 明确 Event_Log 恢复能力的边界：Event_Log 重放可以恢复对话历史和模型上下文，但**不能**恢复 Sandbox 文件系统的实际字节内容（不通过重放历史命令来重建文件系统，因为部分命令如网络请求、随机数生成不可安全重放）
10. WHEN 服务进程 crash 后重启，THE Agent_Runtime SHALL 检测所有 status='running' 的 Session 并执行孤儿状态清理（orphan reconciliation）：对于已发出但未收到结果的工具调用，注入占位结果（标记为 interrupted）以保证下一轮模型调用的消息序列完整；对于被截断的流式回复，将已缓冲内容落盘为部分消息
11. THE Agent_Runtime SHALL 支持为 Environment 配置 Workspace_Snapshot 策略（周期性快照 Sandbox 工作目录，默认关闭；启用后可配置快照间隔），Session 恢复时先重放 Event_Log 恢复对话上下文，再从最近快照恢复文件系统内容
12. THE Agent_Runtime SHALL 支持 Environment 的声明式定义（在项目配置文件中），包含：`name`（标识）、`sandbox_provider`（类型：`local`/`docker`/`e2b`/`daytona`/`self_hosted`）、`timeout`（超时）、`resources`（资源限制）。本地开发时默认使用内置的 `local` Environment
13. THE Platform SHALL 支持一个 Agent 关联多个 Environment（如 `dev` 使用 local subprocess，`prod` 使用 Docker），创建 Session 时通过参数指定使用哪个 Environment，也支持 `agent_with_overrides` 语义——临时覆盖单个 Session 的 model/tools/mcp_servers 配置，不影响 Agent 定义本身或其他 Session
14. WHEN Sandbox_Provider 类型为 `self_hosted` 时，THE Agent_Runtime SHALL 支持工作队列模式：Session 创建后进入队列，由用户自行运行的 Worker 进程认领并在自有基础设施上执行工具调用，执行结果通过约定协议回传给 Session 状态机；Worker 与 Session 状态机之间只通过标准化的工作项协议通信，互不假设对方的具体实现
15. THE Agent_Runtime SHALL 内置简单的 Context_Compaction 策略：当 Event_Log 投影成模型上下文后 token 数超过模型窗口的 80% 时，自动触发摘要压缩（用同一模型生成 summary），在 Event_Log 中写入一条 boundary 事件，后续 turn 的上下文构建只取 boundary 之后的 events + summary。此策略为内置默认行为，不依赖外部服务
16. THE Platform SHALL 定义 Memory_Provider 接口（`add`/`search`/`update`/`delete`），支持将跨 Session 的长期记忆能力作为可选 Plugin 集成。默认不启用长期记忆；启用后可对接开源记忆方案（如 mem0、memU 等），通过项目配置文件中的 `memory` 字段配置 Provider 类型和连接参数
17. THE Platform SHALL 支持在创建 Session 时传入可选的 `context_id` 参数，用于标识一组逻辑上相关的 Session（如同一用户的连续对话、同一任务的多次尝试）。Memory_Provider 以 `context_id` 为作用域进行记忆的存取——同一 `context_id` 下的 Session 可以互相读取长期记忆；不传 `context_id` 的 Session 完全独立，不触发任何跨 Session 记忆检索
18. WHEN 启用 Memory_Provider 且 Session 关联了 `context_id` 时，THE Agent_Runtime SHALL 在新 Session 开始（收到首个 user 事件前）通过 `Memory_Provider.search(context_id)` 检索相关历史知识，将结果注入模型系统上下文；Session 执行过程中产生的关键事实由 Memory_Provider 异步提取并持久化到对应 `context_id` 的记忆池中
19. THE Agent_Runtime SHALL 定义可插拔的 Agent_Strategy 接口，负责控制 Session 的 engine loop（即"收到用户消息 → 构建上下文 → 调 LLM → 解析响应 → 执行工具 → 循环"的逻辑）。v1 提供 DefaultStrategy（基于 Vercel AI SDK `streamText` + `maxSteps` 自动循环）；后续版本可扩展为 PlannerStrategy（先规划再执行）、RAGStrategy（每步先检索再调模型）等。Agent_Strategy 通过 Agent_Definition 的 `strategy` 字段指定，默认为 `default`

---

### 需求 10：Web UI

**用户故事：** 作为 FDE 或非技术团队成员，我希望通过内嵌的 Web 界面与 Agent 对话、管理 Agent 配置、查看 Session 历史，以便无需命令行即可使用平台。

#### 验收标准

1. THE Web_UI SHALL 作为静态资源内嵌在 Platform 服务进程中，通过同一端口的根路径（`/`）访问，无需独立部署
2. THE Web_UI SHALL 提供对话界面，支持用户选择目标 Agent 并发送消息进行对话，实时展示 Agent 的流式响应（逐 token 渲染）
3. THE Web_UI SHALL 提供 Agent 管理页面，展示所有已加载的 Agent 列表及其状态（在线/离线/错误）、关联的 Skills 和 MCP 服务器连接状态
4. THE Web_UI SHALL 提供 Session 历史页面，展示所有对话记录列表，支持查看历史 Session 的完整消息内容
5. THE Web_UI SHALL 提供模型配置页面，展示当前模型注册表内容，支持在线添加和修改模型配置（修改后持久化到配置文件）
6. WHILE Agent 执行工具调用时，THE Web_UI SHALL 在对话界面实时展示工具调用的名称、参数和返回结果
7. THE Web_UI SHALL 使用 React 和 Vite 构建，生产模式下打包为静态文件由 Hono 服务器托管

---

### 需求 11：CLI 工具

**用户故事：** 作为 FDE，我希望有一套 CLI 工具覆盖日常的 Agent 开发操作（初始化项目、启动服务、命令行对话、部署），以便高效地进行 Agent 开发和调试。

#### 验收标准

1. THE CLI SHALL 提供 `init` 命令，在当前目录生成项目脚手架（包含 `agents/` 目录、`skills/` 目录、`agentbox.config.yaml` 配置文件模板和示例 Agent 定义文件）
2. THE CLI SHALL 提供 `start` 命令，启动 Platform 服务进程（等同于需求 1 中描述的启动行为）
3. THE CLI SHALL 提供 `chat` 命令，在终端中与指定的 Agent 进行交互式对话（支持指定 Agent 名称参数，默认使用第一个加载的 Agent）
4. THE CLI SHALL 提供 `reload` 命令，触发 Agent_Runtime 热重载所有 Agent 定义文件
5. THE CLI SHALL 提供 `list` 命令，列出当前项目中所有已加载的 Agent 名称、状态和关联的模型信息
6. THE CLI SHALL 提供 `deploy` 命令占位（v1 仅输出部署指引文档链接，实际云端部署功能作为后续版本规划）
7. IF CLI 命令执行过程中发生错误，THEN THE CLI SHALL 输出人类可读的错误信息（包含错误类型、原因和建议的修复操作），退出码为非零值

---

### 需求 12：可插拔 Sandbox

**用户故事：** 作为 FDE，我希望 Agent 的代码执行环境是可插拔的，默认使用本地子进程（零隔离，开发模式），也可以切换到 Docker 等隔离沙箱，以便根据安全需求选择合适的执行环境。Sandbox 后端的切换不应影响 Session 的状态管理逻辑（两者职责分离，详见需求 9）。

#### 验收标准

1. THE Agent_Runtime SHALL 定义统一的 Sandbox_Provider 接口，包含方法：`execute(command, options)` 执行命令、`writeFile(path, content)` 写入文件、`readFile(path)` 读取文件、`cleanup()` 清理资源。该接口是 Session 状态机与具体执行后端之间的唯一契约，Session 层不感知 Sandbox 的具体实现
2. THE Agent_Runtime SHALL 提供默认的 `local` Sandbox_Provider 实现，使用本地子进程（child_process）执行命令，工作目录为项目目录下的 `.agentbox/sandbox/<session_id>/`
3. THE Agent_Runtime SHALL 支持在 Environment 定义中指定 Sandbox_Provider 类型（`local`、`docker`、`e2b`、`daytona`、`self_hosted`），同一 Agent 可通过不同 Environment 在不同 Sandbox_Provider 之间切换而不修改 Agent_Definition
4. WHEN 配置中指定的 Sandbox_Provider 类型对应的实现未安装时，THE Agent_Runtime SHALL 输出错误信息指明需要安装的依赖包名称
5. THE Agent_Runtime SHALL 支持为 Sandbox_Provider 配置资源限制（执行超时时间，默认 300 秒；对于支持的提供者类型还可配置内存限制和 CPU 限制）
6. THE Agent_Runtime SHALL 确保所有 Sandbox_Provider 实现遵循需求 9 定义的生命周期约束：一个 Sandbox 实例仅服务于一个 Session，不做跨 Session 复用

---

### 需求 13：渐进式上云

**用户故事：** 作为 FDE，我希望本地开发调试完成的 Agent 定义可以直接推送到云端运行，无需修改 Agent 配置文件，以便实现开发到生产的平滑过渡。

#### 验收标准

1. THE Platform SHALL 确保 Agent_Definition 文件格式在本地运行和云端运行时完全一致，无需任何修改即可在两种环境中使用
2. THE CLI SHALL 通过 `deploy` 命令支持将本地 `agents/` 和 `skills/` 目录内容打包推送到云端服务（v1 版本仅输出部署指引，实际推送功能列为后续规划）
3. THE Platform SHALL 支持在项目配置文件中定义环境级别的变量覆盖（`environments` 字段），区分 `local` 和 `cloud` 环境的模型、API Key 等差异化配置
4. WHEN 本地运行时，THE Platform SHALL 使用 `environments.local` 下的配置覆盖默认值；当部署到云端时使用 `environments.cloud` 下的配置
5. THE Platform SHALL 确保本地平台的 CMA 兼容 API 与云端服务的 API 行为一致，用户项目切换到云端仅需修改 base_url 配置

---

### 需求 14：方案模板系统

**用户故事：** 作为 FDE，我希望平台提供针对不同场景（如编程助手、研究分析、客服问答等）的预置方案模板，每套模板包含完整的 agents + skills + mcp 配置组合，以便我可以一键安装整套方案快速启动，无需从零开始配置。

#### 验收标准

1. THE Platform SHALL 约定 Solution_Template 的目录结构：每个模板是一个文件夹，包含 `manifest.yaml`（名称、描述）、`agents/`（Agent 定义文件）、`skills/`（Skill 文件，可选）、`mcp/`（MCP 配置，可选）
2. THE Platform SHALL 维护一个官方 GitHub 模板仓库，仓库根目录下每个子文件夹就是一个模板（如 `coding-assistant/`、`research-analyst/`）
3. THE CLI SHALL 提供 `template list` 命令，读取模板仓库目录列表并展示可用模板（名称、描述）
4. THE CLI SHALL 提供 `template install <template-name>` 命令，将模板文件夹中的内容复制到当前项目对应目录（agents/ → agents/，skills/ → skills/）
5. WHEN 模板安装时目标目录下已存在同名文件，THEN THE CLI SHALL 提示用户选择覆盖或跳过，或通过 `--force` 参数强制覆盖
6. THE Web_UI SHALL 提供模板浏览页面，展示可用模板列表和内容预览，支持一键安装
7. THE Platform SHALL 支持在配置文件中设置自定义模板仓库地址（`template_repo` 字段），默认指向官方仓库
8. THE CLI SHALL 提供 `template create` 命令，将当前项目中指定的 agents 和 skills 导出为符合约定的模板目录结构

