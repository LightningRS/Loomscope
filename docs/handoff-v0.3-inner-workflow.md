# v0.3 交付 — Inner WorkFlow

> 这篇是 v0.3 inner WorkFlow 任务的种子上下文。配 `context-handoff.md` 一起读：context-handoff 是项目整体入门，本文是本次任务专属。

## 任务一句话

**让用户点 ChatNode 后能看见它内部的 WorkFlow**（llm_call / tool_call / delegate / compact / attachment 等 WorkNode）。当前 ChatNode 是不可展开的「黑盒卡片」，里面跑了什么 tool / 调了几次 LLM 全靠卡片角落的计数数字猜 —— v0.3 把这层揭开。

## 现状定位

- v0.2 minimal canvas 已 ship（`342357f`），后面还落了一连串 polish（slash command 特殊渲染、model ribbon overlay 横穿卡片、focus latest node、edge model tooltip、auto-fitView 修复等等）
- 数据层 v0.1 早已 ship（`ea61a98`）—— **WorkFlow / WorkNode 已经存在 `chatNode.workflow` 里**，只是没渲染。本任务是纯前端 visualization，不动 parser
- v0.3 之后是 v0.4 drill panel（右侧详情）、v0.5 sub-agent 双态、v0.6 compact、v0.7 fork 浏览（详 `plan.md` 总览表）

## ⚠️ 必先解决的设计抉择

`plan.md` v0.3 节标了 [TODO 作者]，有三个候选方案，**先做对比研究、等作者拍板再开工**：

| 选项 | 描述 | 已知优劣 |
|---|---|---|
| **A** | 每个 ChatNode 展开时打开一个新 React Flow 实例（隔离） | 上下文绝对干净；选中状态不互通；多个同时展开时 N 个 RF 实例性能未知 |
| **B** | 所有节点都在一个大 flow 里，按 z-order / collapsed-expanded 控制可见性 | 单一选中 / 缩放 / pan 体验一致；最坏情况 256MB session 全展开 ≈ 60K 节点（实测 39434 llm_call + 21886 tool_call 总计），要做 culling |
| **C** | 点 ChatNode 后切换主视图到 WorkFlow，类似 drill-down navigation（面包屑回退） | 单层 RF 实例性能最好；但用户失去"全局 ChatFlow + 局部 WorkFlow 同屏"的总览感 |

研究 + 提案的产出：

1. 阅读 `~/Agentloom/frontend/src/canvas/WorkFlowCanvas.tsx`（Agentloom 同位组件）和它在 `ChatFlowCanvas.tsx` 里的挂载方式 —— Agentloom 选了哪种、为什么
2. 评估 Loomscope 自己数据形状下三种方案的性能 / UX / 实现成本
3. 写一份对比给作者，**带你的明确推荐**，等作者拍后再写代码

不要直接选一个动手。这步走偏了后面全部要重做。

## 必读文档（按顺序）

1. **`docs/context-handoff.md`** —— 项目整体入门。你之前没接触过 Loomscope，这篇必读
2. **`docs/plan.md` v0.3 节 + 总览表** —— 任务边界 + 在路线图里的位置
3. **`docs/design-data-model.md`** —— WorkFlow / WorkNode 字段速查、isCompactSummary / sourceToolUseID / sidechain 等关键概念
4. **`docs/design-visual-language.md`** —— 节点视觉规范（特别是 llm_call / tool_call / delegate / compact / attachment 五类 WorkNode 各自 chrome）和锚点约定
5. **`~/Agentloom/frontend/src/canvas/WorkFlowCanvas.tsx`**（参考、不抄）+ **`ChatFlowCanvas.tsx`** 挂载方式
6. **当前 `src/canvas/`** —— 已有的 ChatFlowCanvas / ChatNodeCard / ContinuationEdge / ModelRibbonLayer / layoutDag 上下文

## 实测基线 / 性能边界

来自 v0.1 / v0.2 实测，作者本机 256MB session 数据：

| 量纲 | 值 |
|---|---|
| ChatNode 数 | 1522 |
| llm_call 总数 | 39434（平均 26 / ChatNode） |
| tool_call 总数 | 21886（平均 14 / ChatNode） |
| delegate 总数 | 93 |
| compact ChatNode 数 | 139 |
| attachment 总数 | 1677 |

⇒ **单 ChatNode 内 WorkFlow 节点数可达上百**，全展开极端情况 ~60K 节点。这直接影响选项 B 的可行性 —— 必须算清楚 React Flow 在 60K 节点下的 baseline，要么靠 viewport culling 要么靠折叠默认收起。

## v0.3 不做的事（防 scope creep）

- ❌ **drill panel**（v0.4）—— WorkNode 点选后右侧详情面板是 v0.4
- ❌ **sub-agent 真嵌套**（v0.5）—— delegate WorkNode 点开后展开子 ChatFlow / WorkFlow（lazy 读 `subagents/agent-X.jsonl`）是 v0.5
- ❌ **compact ChatNode 视觉规范**（v0.6）—— compact 三色（auto/manual/failed）chrome 是 v0.6
- ❌ **fork 浏览**（v0.7）—— ConversationView / branchMemory / merged ChatFlow 是 v0.7
- ❌ **重构 ChatFlow 层布局** —— layoutDag 的 LR dagre 不动
- ❌ **WorkFlow 层布局算法选型 deep dive** —— v0.3 用最简单可行布局（dagre LR 同套就行），具体优化推到 v0.9 polish

## 实施步骤（建议）

1. **读完上面"必读文档"** —— 不要跳过，作者之前因 stack mismatch 栽过几次（agent 把 Loomscope 当 Vue 项目搞过）
2. **研究 Agentloom `WorkFlowCanvas` 实现** —— 看它怎么处理 nested、怎么挂载到外层、性能策略
3. **写 A/B/C 对比文档**（不一定要单独成文，发一段消息也行），等作者决策
4. 实现选定方案的最小骨架：单个 ChatNode 展开能看见内部 llm_call + tool_call WorkNode（其它 kind 视觉先用占位 chrome）
5. 加上 delegate / compact / attachment 的折叠态 chrome（不做内部展开 —— 那是 v0.5/v0.6）
6. **写测试** —— 单元（layoutDag for WorkFlow / 节点渲染）+ 一次 Playwright 验真（点开 ChatNode 看见 WorkNode）
7. 跑 `npm run typecheck && npm test && npm run build`，全绿
8. commit + 写一段总结发给作者

## 验收标准

- [ ] A/B/C 决策有作者签字（在对话里他明确说"用 X"）
- [ ] 至少 1 个 ChatNode 展开后看到完整 WorkFlow（llm_call + tool_call + delegate + compact + attachment 五类 WorkNode chrome 都对得上 `design-visual-language.md` 规范）
- [ ] 现有 118 测试全绿
- [ ] 新增至少 8 个相关单元测试 + 1 个 Playwright e2e
- [ ] typecheck 净 / build 通过
- [ ] 256MB session 实测：切换 session / 展开 ChatNode 时 FPS 可接受（具体阈值跟作者讨论，初步定 30+ FPS）

## 测试策略

- **单元**：用 v0.1 的 fixture（`src/parse/__fixtures__/synthetic/`）构造 ChatNode 包含各 kind WorkNode，断言渲染产出节点数 / kind / 顺序
- **e2e (Playwright)**：复用 `/tmp/loomscope-inspect/probe.mjs` 的模式，开 dev server，点开一个真实 ChatNode，确认 DOM 出现 `[data-testid^="worknode-"]` 之类的标记
- **fixture 拓展**：v0.1 的合成 fixture 可能 WorkFlow 太简单，必要时加几条覆盖 multi-llm-call + tool_use_loop 的样例

## 提交规范

- 中文跟作者交流；代码 / commit message / 标识符英文
- 用 `git -c user.name=usingnamespacestc -c user.email=usingnamespacestc@gmail.com commit ...`（项目无全局 gitconfig）
- 不 force push / 不 amend / 不 skip hooks
- commit message 写清"为什么"而不是"做了什么"（diff 自己会说话）

## 报回作者什么

任务完成后告诉作者：

1. 选了 A/B/C 哪个方案、当时给的对比要点是什么
2. 改了哪些文件、加了多少行 / 多少测试
3. 验收标准里每条的实际状况（哪些过了、哪些 partial、哪些跳了为什么）
4. 256MB session 的实测 FPS 数字
5. 留给后续版本的 backlog（v0.4 drill / v0.6 compact 视觉 / 等等）

## 跨文档引用

- 项目入门 → `context-handoff.md`
- 路线图 → `plan.md` v0.3 节
- 数据 → `design-data-model.md`（WorkFlow / WorkNode 部分）
- 视觉 → `design-visual-language.md`（WorkNode 节点视觉规范）
- 架构 → `design-architecture.md`（前后端 / Stack）
