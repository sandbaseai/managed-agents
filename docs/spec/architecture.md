# managed-agents 完整架构图

## 1. 系统总体架构

```mermaid
graph TB
    %% 外部用户
    User((FDE / 用户))
    SDK[外部系统<br/>@anthropic-ai/sdk]
    
    %% 入口层
    subgraph Entry["入口层"]
        CLI[CLI<br/>Commander.js]
        API[REST API<br/>Hono · CMA 兼容]
        Dashboard[Minimal Web Dashboard<br/>embedded HTML]
    end
    
    User --> CLI
    User --> Dashboard
    SDK --> API
    Dashboard --> API
    CLI --> API
    
    %% 核心运行时
    subgraph Core["Core Runtime（控制平面）"]
        SM[Session Manager<br/>状态机 · 生命周期]
        AO[Agent Orchestrator<br/>多 Agent 委派]
        AL[Agent Loader<br/>YAML → Schema 校验]
        EL[Event Logger<br/>append-only · SQLite]
        CC[Context Compactor<br/>80% 阈值摘要]
        EM[Event Mapper<br/>eventsToMessages 双射]
    end
    
    API --> SM
    SM --> AO
    SM --> EL
    SM --> CC
    SM --> EM
    AL --> SM
    
    %% Plugin 扩展层
    subgraph Plugins["Plugin 扩展层（四大接口）"]
        direction TB
        subgraph MP["Model Provider"]
            Ollama[Ollama]
            OpenAI[OpenAI-compat<br/>vLLM / llama.cpp]
            Anthropic[Anthropic]
        end
        subgraph SP["Sandbox Provider"]
            Local[Local Subprocess]
            Docker[Docker]
            E2B[E2B / Daytona]
            SelfHosted[Self-Hosted Worker]
        end
        subgraph TP["Tool Plugin"]
            Builtin[bash · read · write<br/>edit · glob · grep]
            MCP[MCP Tools<br/>stdio / http]
            Custom[Custom Tools]
        end
        subgraph AS["Agent Strategy"]
            Default[DefaultStrategy<br/>streamText + maxSteps]
            Planner[PlannerStrategy<br/>v2]
            RAG[RAGStrategy<br/>v2]
        end
    end
    
    SM --> AS
    AS --> MP
    AS --> SP
    AS --> TP
    
    %% 存储层
    subgraph Storage["存储层"]
        SQLite[(SQLite<br/>data.db)]
        FS[文件系统<br/>agents/ · skills/]
        Sandbox[Sandbox 工作目录<br/>.managed-agents/sandbox/]
    end
    
    EL --> SQLite
    AL --> FS
    SP --> Sandbox
    
    %% 可选扩展
    subgraph Optional["可选扩展"]
        Memory[Memory Provider<br/>mem0 / memU]
        Templates[Template Repository<br/>GitHub 仓库]
    end
    
    SM -.-> Memory
    CLI -.-> Templates
```

## 2. 四层概念模型（CMA 对齐）

```mermaid
graph TD
    subgraph "持久层（配置）"
        Agent["🤖 Agent<br/>YAML 声明式定义<br/>model · system_prompt · tools · skills · delegations"]
        Env["🌍 Environment<br/>Sandbox 配置模板<br/>provider · timeout · resources"]
    end
    
    subgraph "控制层（状态）"
        Session["📋 Session<br/>控制平面状态机<br/>Event_Log · status · context_id"]
    end
    
    subgraph "执行层（临时）"
        Sandbox["📦 Sandbox<br/>执行平面实例<br/>文件系统 · 进程 · 网络"]
    end
    
    Agent -->|"引用"| Env
    Agent -->|"创建实例"| Session
    Env -->|"配置模板"| Session
    Session -->|"1:1 provision<br/>生命周期从属"| Sandbox
    
    style Agent fill:#e3f2fd,stroke:#1565c0
    style Env fill:#f3e5f5,stroke:#7b1fa2
    style Session fill:#e8f5e9,stroke:#2e7d32
    style Sandbox fill:#fff3e0,stroke:#e65100
```

## 3. Session 状态机

```mermaid
stateDiagram-v2
    [*] --> queued: POST /v1/sessions<br/>(provision sandbox)
    
    queued --> running: 首个 user.message 事件
    
    running --> paused: 空闲超时 / 主动暂停
    running --> requires_action: 需要用户确认<br/>(custom_tool / tool_confirmation)
    running --> completed: Agent 完成任务<br/>(stop_reason: end_turn)
    running --> failed: 不可恢复错误
    
    paused --> running: resume<br/>(新 user.message 事件)
    requires_action --> running: user.custom_tool_result<br/>/ user.tool_confirmation
    
    completed --> [*]
    failed --> [*]
    
    note right of paused
        resume 时可切换 Sandbox Provider
        Event_Log 恢复对话上下文
    end note
    
    note right of running
        可被 user.interrupt 中断
        → 注入占位结果 → paused
    end note
```

## 4. Session Engine Loop（核心执行流）

```mermaid
sequenceDiagram
    participant U as 用户 / SDK
    participant API as REST API
    participant SM as Session Manager
    participant EM as Event Mapper
    participant CC as Context Compactor
    participant AS as Agent Strategy
    participant MP as Model Provider
    participant SP as Sandbox Provider
    participant EL as Event Logger
    participant SSE as SSE Hub

    U->>API: POST /v1/sessions/:id/events<br/>{type: "user.message", content: [...]}
    API->>SM: dispatch(sessionId, event)
    SM->>EL: append(user.message)
    SM->>SSE: broadcast(user.message)
    SM->>SM: status → running
    
    SM->>EM: eventsToMessages(eventLog)
    EM-->>SM: CoreMessage[]
    SM->>CC: shouldCompact(messages, windowSize)?
    
    alt 需要压缩
        CC->>MP: generateText(压缩 prompt)
        MP-->>CC: summary
        CC->>EL: append(agent.thread_context_compacted)
        CC->>EM: 重新投影(boundary 之后)
        EM-->>SM: 压缩后的 CoreMessage[]
    end
    
    SM->>AS: execute(context)
    
    loop streamText + maxSteps 自动循环
        AS->>AS: beforeTurn hook<br/>(注入 Memory)
        AS->>MP: streamText(messages, tools)
        MP-->>AS: streaming chunks
        AS->>SSE: broadcast(agent.message chunks)
        
        alt 模型返回 Tool Call
            AS->>EL: append(agent.tool_use)
            AS->>SSE: broadcast(agent.tool_use)
            AS->>SP: execute(command)
            SP-->>AS: ExecResult
            AS->>EL: append(agent.tool_result)
            AS->>SSE: broadcast(agent.tool_result)
            AS->>AS: afterStep hook
        else 模型返回 Text（无 tool call）
            AS->>EL: append(agent.message)
            AS->>SSE: broadcast(agent.message)
            Note over AS: Loop 结束
        end
    end
    
    AS->>SM: onComplete hook
    SM->>SM: status → idle / completed
    SM->>EL: append(session.status_idle)
    SM->>SSE: broadcast(session.status_idle)
    
    Note over U,SSE: 用户通过 GET /events/stream (SSE) 实时接收所有 broadcast 事件
```

## 5. 多 Agent 委派流程

```mermaid
sequenceDiagram
    participant U as 用户
    participant A as Agent A (orchestrator)
    participant O as Agent Orchestrator
    participant B as Agent B (specialist)
    participant SSE as SSE Hub

    U->>A: "帮我研究一下 xxx"
    A->>A: LLM 决定委派给 Agent B
    A->>O: delegate(toAgent: "B", context: "...")
    O->>O: 检查循环 + 深度限制
    O->>B: 创建子 Session + 发送上下文
    
    loop Agent B 执行
        B->>B: streamText + tool calls
        B->>SSE: broadcast(events, depth=1)
    end
    
    B-->>O: 执行结果
    O-->>A: 返回 Agent B 的输出
    A->>A: 继续处理（可能再委派或回复用户）
    A->>SSE: broadcast(agent.message, depth=0)
```

## 6. Session Resume 流程

```mermaid
sequenceDiagram
    participant U as 用户
    participant SM as Session Manager
    participant EL as Event Logger
    participant SP as Sandbox Provider
    participant EM as Event Mapper

    Note over U,EM: Session 之前处于 paused 状态，Sandbox 已销毁

    U->>SM: POST /v1/sessions/:id/events<br/>{type: "user.message", ...}
    SM->>SM: 查询 Session 状态 = paused
    SM->>SP: provision(sessionId, environmentConfig)<br/>（可以是全新的/不同类型的 Sandbox）
    SP-->>SM: 新 SandboxInstance
    SM->>EL: 读取历史 Event_Log
    EL-->>SM: SessionEvent[]
    SM->>EM: eventsToMessages(events)
    EM-->>SM: 恢复的 CoreMessage[]
    SM->>SM: status → running
    SM->>SM: 继续 Engine Loop（用新 Sandbox + 恢复的上下文）
    
    Note over SM: Event_Log 保证上下文完整<br/>Sandbox 可以换（解耦）
```

## 7. Memory Provider 集成流程

```mermaid
sequenceDiagram
    participant SM as Session Manager
    participant Mem as Memory Provider<br/>(mem0 / memU)
    participant AS as Agent Strategy
    participant EL as Event Logger

    Note over SM,EL: Session 创建时带 context_id="user-123"

    SM->>Mem: search(context_id="user-123", query=userMessage)
    Mem-->>SM: MemoryEntry[] (相关历史知识)
    SM->>AS: execute(context + memories)
    
    Note over AS: Agent 执行中...产生关键事实
    
    AS->>EL: append events (正常流程)
    AS->>SM: onComplete
    SM->>Mem: add(context_id="user-123", content="学到的新事实")
    
    Note over Mem: 异步提取 + 持久化<br/>下次同 context_id 的 Session 可检索
```

## 8. 项目文件结构与数据流

```mermaid
graph LR
    subgraph "用户项目（Git 管理）"
        A[agents/*.yaml]
        S[skills/*.md]
        C[managed-agents.config.yaml]
    end
    
    subgraph "运行时数据（.gitignore）"
        DB[(.managed-agents/data.db)]
        SB[.managed-agents/sandbox/<br/>session-id/]
    end
    
    subgraph "外部"
        GH[GitHub 模板仓库]
        OL[Ollama / vLLM]
        MCP_S[MCP Servers]
        Mem[Memory Provider]
    end
    
    A -->|"加载"| Core[Core Runtime]
    S -->|"加载"| Core
    C -->|"加载"| Core
    
    Core -->|"读写"| DB
    Core -->|"执行"| SB
    Core -->|"调用"| OL
    Core -->|"连接"| MCP_S
    Core -->|"检索/存储"| Mem
    
    GH -->|"template install"| A
    GH -->|"template install"| S
```

## 9. Plugin 接口与依赖关系

```mermaid
classDiagram
    class AgentStrategy {
        <<interface>>
        +name: string
        +execute(ctx: StrategyContext): AsyncIterable~SessionEvent~
    }
    
    class ModelProvider {
        <<interface>>
        +name: string
        +type: string
        +createModel(config): LanguageModelV1
        +healthCheck(): Promise~boolean~
    }
    
    class SandboxProvider {
        <<interface>>
        +type: string
        +provision(sessionId, config): Promise~SandboxInstance~
    }
    
    class SandboxInstance {
        <<interface>>
        +sessionId: string
        +execute(cmd, opts): Promise~ExecResult~
        +writeFile(path, content): Promise~void~
        +readFile(path): Promise~string~
        +cleanup(): Promise~void~
    }
    
    class ToolPlugin {
        <<interface>>
        +name: string
        +description: string
        +getTools(): CoreTool[]
    }
    
    class MemoryProvider {
        <<interface>>
        +name: string
        +add(contextId, content): Promise~string~
        +search(contextId, query): Promise~MemoryEntry[]~
        +update(memoryId, content): Promise~void~
        +delete(memoryId): Promise~void~
    }
    
    class SessionManager {
        +create(params): Promise~Session~
        +sendEvent(id, event): Promise
        +subscribe(id, afterSeq): AsyncIterable
        +resume(id, provider?): Promise~Session~
        +stop(id): Promise~void~
        +reconcileOrphans(): Promise~void~
    }
    
    SessionManager --> AgentStrategy: 调用
    AgentStrategy --> ModelProvider: 调模型
    AgentStrategy --> SandboxInstance: 执行工具
    AgentStrategy --> ToolPlugin: 获取工具定义
    SandboxProvider --> SandboxInstance: 创建
    SessionManager --> SandboxProvider: provision
    SessionManager --> MemoryProvider: 可选集成
```

## 10. 部署架构对比

```mermaid
graph TB
    subgraph "本地开发模式（默认）"
        Single[单进程 Node.js]
        Single --> SQLite_L[(SQLite)]
        Single --> Sub[Local Subprocess<br/>Sandbox]
        Single --> Ollama_L[Ollama 本地模型]
    end
    
    subgraph "Docker 部署模式"
        Container[Docker Container]
        Container --> SQLite_D[(SQLite / Volume)]
        Container --> Docker_S[Docker Sandbox<br/>per session]
        Container --> API_Remote[远程 Model API]
    end
    
    subgraph "云端生产模式（v2）"
        K8s[K8s Pod]
        K8s --> PG[(PostgreSQL)]
        K8s --> E2B_S[E2B / Daytona<br/>Sandbox]
        K8s --> Claude[Claude API]
        K8s --> Queue[Redis Queue<br/>多 worker]
    end
    
    style Single fill:#e8f5e9
    style Container fill:#e3f2fd
    style K8s fill:#fff3e0
```
