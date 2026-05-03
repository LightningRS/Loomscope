# v0.6 交付 — Data Model Unification（递归 Node 树重构）

> 这篇是 v0.6 数据模型统一任务的种子上下文。配 `context-handoff.md` 一起读：context-handoff 是项目整体入门，本文是本次任务专属。**这是一个数据模型层的重构，不是渐进式的功能添加**——你接手的是 Loomscope v0.x 阶段最深的一次手术，请按 milestone 走、每步独立 commit + 验证、绝不一次性大刀阔斧。

## 任务一句话

**取消 ChatNode / WorkNode 二分，统一为递归 `Node` 树**。把 v0.1-v0.5 累积的两层数据抽象塌缩成单一节点模型，按 kind 切显示，按 fold state 切可见性，sub-agent 自然递归（不再"多 ChatNode 砍剩 1 个"那种妥协）。

## 触发原因（必须理解的背景）

v0.5 sub-agent 真嵌套实测发现：sub-agent jsonl 是**完整 ChatFlow 含多个 ChatNode**（27%），但 Loomscope 当前架构只能塞进单 WorkFlow 视图。表面看是"补完 sub-agent 多 ChatNode 渲染"，实际根问题是 **Loomscope 沿用 Agentloom 的 ChatFlow / WorkFlow 二分架构硬套到 CC 的扁平 record tree 上**：

- CC jsonl 自己就是 unified parentUuid 树（每条 record 一个 uuid + parentUuid，type=user/assistant/system，按需带 content/tool_use/tool_result blocks）
- 二分（"ChatNode = 一个 turn" + "WorkFlow = ChatNode 内部 DAG"）是 **v0.1 解析时塞进去的人造抽象**
- 这个抽象在外层 ChatFlow 还行，但 sub-agent 进来就崩——sub-agent 是另一棵 ChatFlow，硬塞 WorkFlow 视图就吞掉 27% 的内容

v0.6 = 承认 Loomscope 不是 Agentloom + 还原 CC 数据真相 + 视觉密度靠折叠规则控制（不靠数据结构二分）。

## 现状定位

- **v0.5 已 ship**（commit `74d49d9`）—— sub-agent drill 通了但用 chatNodes[0] 妥协
- **selection perf fix 已 ship**（commit `df65051`）—— per-card Zustand 订阅模型，v0.6 重构必须保住这个 perf
- **227/227 tests 全绿**（baseline）—— v0.6 完成时不允许覆盖率回退
- **数据已经在干净的 jsonl 里**——v0.6 只动 Loomscope 的解析和渲染层，不动 jsonl 格式假设

## ⚠️ 必先解决的设计抉择（4 个）

研究 + 提案后等作者拍板再开工。**绝不 silent 选择**——这是数据模型重构，silent 选错就是回滚 4-6 个 commit。

### 抉择 1：折叠默认状态

新模型每个 Node 有 `defaultFolded` flag（解析时算出，UI 可覆盖）。三个候选：

| 选项 | 描述 | 对当前用户体验的影响 |
|---|---|---|
| **A 保留 v0.5 视觉密度** | 每个 turn 一个聚合卡（user_message + 终态 assistant_call 合一），内部 llm_call/tool_call/delegate 全 fold；双击 turn 节点展开 | 视觉跟现在几乎一致，迁移友好 |
| **B 用户消息 + delegate + compact 默认 unfolded** | turn 内一些"重要"事件浮现，普通 llm_call/tool_call 折叠 | 默认密度比 A 大约 2-3×，可能崩在大 session |
| **C 完全展开（按 v0.3 inner WorkFlow drill 的密度） + 全 fold 切换** | 极端两态，要么全展开要么全折叠，无中间态 | 不推荐，灵活性丢失 |

**强烈倾向 A**（最小行为变化、最容易迁移），但作者拍。

### 抉择 2：drill / focus 模式去留

当前 v0.3-v0.5 用的"drill 替换主视图"模型在统一 Node 树下要怎么处理？

| 选项 | 描述 |
|---|---|
| **A drill 完全删除** | 只 expand/collapse；用户想看子树就展开它，想隐藏 siblings 自己 collapse 其它 |
| **B 保留 focus 模式** | alt+click 或专门按钮 → 临时只显示某 subtree（外观上跟当前 drill 一致），ESC 退出 |
| **C 自动过渡** | expand 子树超过 N 个节点时自动切 focus 模式 |

倾向 B（保留 focus 模式）—— v0.3-v0.5 用户可能习惯 drill 体验，且 256MB session 一次性展开几千节点性能存疑。focus 模式 = 可控降级。

### 抉择 3：Selection 模型

当前两层 selection（`selectedNodeId` ChatFlow 层 + `workflowSelectedNodeId` WorkFlow 层）。统一 Node 树下：

| 选项 | 描述 |
|---|---|
| **A 单一 `selectedNodeId`** | 选中任何 Node（无论 turn-level 还是 内部 step-level），单一字段；focus 模式也复用 |
| **B 分层 selection 保留** | "外层 selection" + "内层 selection"，但层级界定模糊 |

强烈倾向 A —— 统一模型理由就是去除分层。selection per-card 订阅（`useIsNodeSelected(id)`）继承 v0.4 perf fix，零性能损失。

### 抉择 4：Migration 策略

| 选项 | 描述 |
|---|---|
| **A big-bang 一次替换** | 单个 commit 全部切换；高风险、低过渡复杂度 |
| **B 双写过渡（feature flag）** | 解析器同时输出新旧两种结构，前端按 flag 切；稳但代码量大 |
| **C 按 milestone 串行切换** | M1 数据 → M2 store → M3 layout → M4 canvas → M5 panel，每个 milestone 内部完成切换、独立 commit、保持测试全绿 | 

强烈倾向 C —— 5-7 个独立 commit，每步可回滚，每步测试不破。**这是给你的执行模式**。

## 必读文档（按顺序）

1. **`docs/context-handoff.md`** —— 项目整体入门
2. **`docs/plan.md` v0.6 节** —— 任务边界 + milestone 列表
3. **`docs/design-data-model.md`** —— **当前数据模型**全部细节。重构后会重写本文，但你接手时它就是现行 source of truth。重点看 ChatFlow / WorkFlow / WorkNode 三个章节
4. **`docs/design-visual-language.md`** —— 节点视觉规范、token 颜色 / 锚点约定。新模型继承这套视觉约束
5. **当前所有 src/ 代码**：
   - `src/data/types.ts`（要重写）
   - `src/parse/jsonl.ts` + `src/parse/workflow-builder.ts`（要重写）
   - `src/parse/sidecar.ts`（API 不变，但调用形态变）
   - `src/store/sessionSlice.ts` + `src/store/types.ts`（重写 sessions[].chatFlow → nodes/rootNodeIds/foldState）
   - `src/canvas/layoutDag.ts` + `src/canvas/layoutWorkflow.ts`（合并 → `layoutNodes.ts`）
   - `src/canvas/ChatFlowCanvas.tsx` + `src/canvas/WorkFlowCanvas.tsx`（合并 → 单一 `<Canvas>` + 折叠/焦点切换）
   - `src/canvas/nodes/ChatNodeCard.tsx` + 5 类 WorkNode card（合并 → 单一 `<NodeCard>` 按 kind 条件 chrome）
   - `src/components/drill/{DrillPanel,ChatNodeDetail,WorkNodeDetail}.tsx`（panel 改成按 kind 分发）
   - `src/store/selectionHooks.ts`（合并 ChatNode + WorkNode 两个 hook 为一个 `useIsNodeSelected`）
6. **`~/Agentloom/frontend/src/canvas/`** —— 参考 Agentloom 怎么做 expand/collapse + focus 模式（非抄但思路对照）

## 实测基线 / 性能边界

- 256MB session：1522 ChatNode + 39434 llm_call + 21886 tool_call + 93 delegate + 139 compact + 1677 attachment ≈ **64,750 unified Node**
- 折叠模型：默认可见 ≈ 1500（每 turn 一聚合卡，内部 fold）；展开极端情况 60K，必须靠 focus 模式或 viewport culling 保护
- selection 切换 perf 必须保住 v0.4 fix 后的 78.9ms / 86ms p95 数字（per-card 订阅模型继承）
- sub-agent cache 22ms 命中（继承）
- 总体：**v0.6 不允许任何 perf 数字回退**

## v0.6 不做的事（防 scope creep）

- ❌ **v0.7 compact 完整交互** —— compact Node 在统一模型下是个 kind，可以双击展开看 pre-compact 序列，但**完整 chrome 规范 + logical 弱边 + file-history-snapshot 时间窗绑定是 v0.7**
- ❌ **v0.8 fork 浏览** —— `forkedFrom` 字段解析、跨 session merge、ConversationView 都是 v0.8
- ❌ **AttachmentCard subtype 富化（图片缩略图等）** —— 在统一模型下 attachment kind 的 chrome 留 placeholder 即可
- ❌ **代码 syntax highlight** —— v0.10
- ❌ **新增 syntax highlight / bundle code-split** —— v0.10
- ❌ **重写 design-data-model.md 整篇** —— ship 时同步更新，但不要在重构主线里做大规模文档重写。重写后留给作者后续编辑

## Milestone 实施步骤

### M1 — 数据类型 + 解析器

- [ ] 在 `src/data/types.ts` 加 unified `Node` 类型：
  ```ts
  type NodeKind = "user_message" | "assistant_call" | "tool_call" | "delegate" | "compact" | "attachment";
  interface Node {
    id: string;
    parentId: string | null;
    kind: NodeKind;
    role?: "user" | "assistant" | "system";
    text?: string;
    thinking?: ThinkingBlock[];
    toolUse?: { name: string; input: unknown };
    toolResult?: unknown;
    model?: string;
    usage?: Record<string, unknown>;
    attachment?: AttachmentInfo;
    timestamp?: string;
    defaultFolded: boolean;
    // for delegate kind: lazy-load anchor
    agentId?: string;
    // for compact kind:
    summaryText?: string;
    logicalParentUuid?: string;
    trigger?: "auto" | "manual";
  }
  ```
- [ ] 重写 `src/parse/jsonl.ts` + `src/parse/workflow-builder.ts` 输出 `Node[]` + `rootNodeIds[]`，删除 ChatNode/WorkNode 中间层
- [ ] **保留 v0.1 实测确认的所有不变量**（promptId 分组规则、tool_result 反向匹配、compact dup uuid、file-history-snapshot orphan 等等，详见 design-data-model.md "v0.1 实测确认的解析规范"）—— 它们在新模型下表达成 Node 之间的 parent/children 关系
- [ ] 默认折叠规则按抉择 1 实现
- [ ] 既有 fixture（`__fixtures__/synthetic/`）在新模型下重新断言：覆盖率不退、新断言加上"Node 树形态正确"
- [ ] **256MB session 实测**：解析时间 ≤ v0.1 baseline 2.19s

**M1 acceptance**：parser 单元测试全绿（≥ v0.5 数量）+ 解析时间不退 + 一个端到端 round-trip 测试（jsonl → Node 树 → 重新序列化）。

### M2 — store 切片重写

- [ ] `SessionState` 字段调整：
  ```ts
  interface SessionState {
    nodes: Map<string, Node>;          // 替代 chatFlow.chatNodes / workNode 嵌套
    rootNodeIds: string[];               // 替代 chatFlow.rootIds
    foldedNodeIds: Set<string>;          // 用户显式折叠（覆盖 defaultFolded=false 的）
    expandedNodeIds: Set<string>;        // 用户显式展开（覆盖 defaultFolded=true 的）
    selectedNodeId: string | null;       // 单一 selection（抉择 3）
    focusedSubtreeRootId: string | null; // null = 主视图；非 null = focus 模式（抉择 2）
    subAgentCache: Map<string, SubAgentCacheEntry>; // 继承 v0.5
    // 删掉：drillStack / workflowSelectedNodeId / 旧 chatFlow 字段
  }
  ```
- [ ] action 改造：
  - `setSelected(sessionId, nodeId)` 单一字段
  - `toggleFold(sessionId, nodeId)` 翻转 expanded/folded set
  - `enterFocus(sessionId, nodeId)` / `exitFocus(sessionId)`（抉择 2 选 B 时）
  - `loadSubAgent` 不变；`enterSubWorkflow` 拆成"展开 delegate Node + lazy load 子树到 nodes Map"
- [ ] selection hooks 合并：`useIsNodeSelected(id)` 单一 hook 取代 chat/work 两套
- [ ] **store 单元测试全部迁移**（`store.test.ts` / `subAgentDrill.test.ts` / `selectionHooks.test.ts` 等）

**M2 acceptance**：所有 store 单元测试全绿 + 新增"focus 模式 / fold state"测试。

### M3 — 布局合并

- [ ] 新建 `src/canvas/layoutNodes.ts` 取代 `layoutDag.ts` + `layoutWorkflow.ts`
- [ ] 输入：`nodes: Map<id, Node>` + `rootNodeIds[]` + `foldedNodeIds` + `expandedNodeIds` + `focusedSubtreeRootId?`
- [ ] 输出：React Flow `nodes[]` + `edges[]`（仅可见 Node 的 layout）
- [ ] 折叠语义：被 fold 的子树折成它的 parent 单节点；focus 模式下 root 仅是 `focusedSubtreeRootId` 的 subtree
- [ ] dagre LR 布局（继承）
- [ ] 单元测试：树形拓扑 + fold combination + focus
- [ ] **layoutDag.test.ts + layoutWorkflow.test.ts 合并到新 layoutNodes.test.ts**

### M4 — 单一 NodeCard 组件

- [ ] 新建 `src/canvas/nodes/NodeCard.tsx` 取代 ChatNodeCard + 5 类 WorkNode card
- [ ] 按 kind 条件 chrome（按需显示，作者要求）：
  - role=user → 蓝色左条 + "用户"
  - role=assistant + kind=assistant_call → 白底 + "助手"
  - kind=tool_call → 🔧 + toolName + input chips
  - kind=delegate → 🤖 + agentType badge + auto-compact badge（继承 v0.5）+ "double-click to expand sub-agent"
  - kind=compact → ⊞ teal/purple/rose 边框
  - kind=attachment → 📎 + 类型 icon
  - **token bar**：assistant_call (in+out) / delegate (totalTokens) / compact (preTokens) 显示；user_message / tool_call / attachment 跳过
  - **id line**：所有 Node 都加（继承 NodeIdLine click-to-copy）
  - **thinking marker**：有 thinking blocks 加 "▸ thinking (N lines)"
  - **selection ring**：复用 useIsNodeSelected hook
  - **fold/expand 按钮**：有子节点时加 "+/-" 视觉提示
- [ ] 删除：ChatNodeCard / SlashCommandCard / 5 类 WorkNode card / cards.test.tsx 全部迁移到 NodeCard.test.tsx
- [ ] **保留 v0.5 的 ChatNodeCard 已经实现的视觉细节**：3px 左强调条、bg tint、全 uuid 显示等

### M5 — Canvas 合并 + drill 模式调整

- [ ] 新建 `src/canvas/Canvas.tsx` 取代 ChatFlowCanvas + WorkFlowCanvas
- [ ] 接收 `nodes / edges` from layoutNodes，渲染 React Flow
- [ ] 双击节点 → toggleFold
- [ ] 抉择 2 选 B 时：alt+click → enterFocus；ESC / 顶部"返回主视图"按钮 → exitFocus
- [ ] 视觉：focus 模式下顶部 banner / breadcrumb 显示当前焦点路径
- [ ] **删除 App.tsx 的 viewMode = "chatflow" | "workflow" 双视图切换逻辑**，改成单一 Canvas + 可选 focus 状态
- [ ] DrillBreadcrumb 重命名为 FocusBreadcrumb（或删除若抉择 2 选 A）

### M6 — DrillPanel 适配

- [ ] `src/components/drill/DrillPanel.tsx` 接收 `Node` 而非 ChatNode/WorkNode
- [ ] `NodeDetail.tsx` 取代 ChatNodeDetail + WorkNodeDetail，按 kind 分发渲染
- [ ] tool-result lazy-load endpoint 不变（v0.4 ship 的）
- [ ] sub-agent endpoint 不变（v0.5 ship 的）
- [ ] **保留所有 v0.4 实现的细节**（MarkdownView / JsonView / DiffView / chunked tool-result hook / Bash 当 code block / 等等）

### M7 — 端到端验证

- [ ] 全部 227+ tests 迁移完毕、全绿
- [ ] 256MB session 默认视图渲染时间 ≤ v0.5 baseline
- [ ] selection 切换 ≤ 100ms（继承 v0.4 perf fix）
- [ ] sub-agent 多 ChatNode 在新模型下天然完整渲染（v0.5 banner 消失）
- [ ] 双击 delegate 展开（lazy load，不破坏 cache）
- [ ] focus 模式（如选 B）正确进入 / 退出
- [ ] Playwright e2e 端到端跑一次 + 性能采样
- [ ] **同步更新 design-data-model.md** 标记 v0.6 完成（不重写整篇）

## 验收标准

- [ ] 4 个设计抉择都有作者签字
- [ ] 现有 227 测试**全部迁移到新模型且全绿**
- [ ] 新增至少 **30** 个相关测试（Node parsing / fold rules / focus mode / NodeCard kind dispatch / unified selection / etc.）
- [ ] typecheck 净 / build 通过
- [ ] 256MB session：解析 ≤ 2.19s + 默认渲染 ≤ v0.5 baseline + selection round-trip ≤ 100ms + cache hit ≤ 50ms
- [ ] sub-agent 多 ChatNode 不再出现 banner（27% 那批，新模型下天然完整）
- [ ] 旧 v0.5 体验保留：drill / focus 操作流畅，breadcrumb 正确
- [ ] `design-data-model.md` 顶部 v0.6 警告标签已更新为"v0.6 已 ship"
- [ ] context-handoff.md 历史更新区添加 v0.6 ship 条目

## 测试策略

- **每个 milestone 独立 commit + 测试全绿**——M1 不绿不进 M2，依此类推。**绝对不要把 M1-M7 攒一起再跑**
- **既有 fixture 先在 M1 端到端 round-trip 一次**：jsonl → 旧 ChatNode/WorkNode（diff 留作 reference）→ 新 Node 树（迁移到 fixture）→ 渲染断言
- **focus 模式 + 折叠状态**用合成 fixture 单独写 case
- **Playwright e2e 在 M7 跑**（不是每 milestone 都跑）
- **不要重写 256MB session 实测脚本** —— 复用 `/tmp/loomscope-inspect/` 的现有 probe.mjs 模式

## 提交规范

- **每个 milestone 独立 commit**：commit message 写明 "v0.6 M1: ..."、"v0.6 M2: ..." 等等
- 中文跟作者交流；代码 / commit message / 标识符英文
- 用 `git -c user.name=usingnamespacestc -c user.email=usingnamespacestc@gmail.com commit ...`（项目无全局 gitconfig）
- 不 force push / 不 amend / 不 skip hooks
- commit message 写"为什么"

## ⚠️ 任务完成后的报回流程

**任务结束时把下述总结发回给用户**。用户**不是**最终决策者——用户会把你这条总结**原文转交给上游协调 agent**（也就是给你出 handoff 的那个 agent）。所以总结要写得让协调 agent 能直接继续推进，**不要省任何对协调 agent 有用的信息**：

1. 4 个设计抉择各自最终选了什么 + 当时给作者的对比要点摘要
2. **每个 milestone 的 commit hash + 改动统计** —— 协调 agent 可能需要分别回滚某个 M
3. 测试数：227 → 新；typecheck / build 状态
4. 性能数据对比表：v0.5 baseline vs v0.6 实测（解析时间 / 默认渲染 / selection / cache 命中 / sub-agent drill cold 时间）
5. 验收标准每条状况
6. **遇到的 bug / surprise**（特别是 v0.1-v0.5 的某条不变量在新模型下不成立那种 —— 单独 call out）
7. 留给后续版本的 backlog（v0.7 compact / v0.8 fork / v0.10 polish / 等）
8. **design-data-model.md 待重写部分清单** —— 协调 agent 后续会安排重写本文，你列出哪些章节需要更新
9. 在你工作期间发现的"原计划吸收的 v0.5.1 / v0.5.2 / v2.0"是否在新模型下确实完整覆盖了，没有遗漏

格式参考前面 v0.3 / v0.4 / v0.5 的回报样式（在 `context-handoff.md` 历史更新里能看到完整范式）。

## 跨文档引用

- 项目入门 → `context-handoff.md`
- 路线图 → `plan.md` v0.6 节
- 当前数据模型（v0.1-v0.5）→ `design-data-model.md`（重构前的事实依据）
- 视觉 → `design-visual-language.md`（视觉 token / 节点 chrome / 边语义—— 新模型继承）
- v0.5 上一棒 → `handoff-v0.5-subagent-nesting.md`（drillStack / sub-agent cache 已铺好的基础设施）
- v0.4 → `handoff-v0.4-drill-panel.md`（DrillPanel 基础设施 + selection perf fix）
