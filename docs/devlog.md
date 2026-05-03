# Loomscope 开发日志

> 按时间倒序的开发记录，每条 = 一个完成的 milestone / fix / 决策。比 `context-handoff.md` "历史更新"区**更详细**，比 `plan.md` 的版本小节**更编年**。新人想看"项目是怎么演化到这里的"读这篇；想看"下一步做什么"读 `plan.md`；想看"项目是什么"读 `requirements.md` + `context-handoff.md`。
>
> 跟 commit 相关时，hash 在条目里直接给出（短 hash 7 位）。跟 handoff 相关时，链 `handoff-vX.Y-*.md` 文件名。

---

## 2026-05-03

### v0.6 第一版 revert + 重做方向澄清

**作者发现回归** —— 上线 v0.6 后两个可见问题：(1) ChatFlow 上 hover 边的 model ribbon 不见了 (2) ChatNode `bacd662d` 的内部 llm_call/tool_call 在 v0.6 unified flat tree 下作为 ChatFlow 顶层 sibling 出现。

**作者澄清原意** —— "之前我说的打通 ChatFlow 和 WorkFlow，不是说取消嵌套。表层 ChatFlow 仍然要保持原样，只是内部 WorkFlow 可以支持 ChatFlow 的特性，WorkNode 也能和 ChatNode 互通。"

**误读路径**：协调 agent 把"取消 WorkNode/ChatNode 划分"读成"type + visual 双层都压平"，提出 default-fold 模型作为视觉密度补偿；新 agent 严格按提案实施了 single Canvas + flat Node tree。错出在协调（我）这层而不是实施层。

**Revert** `f9f6f03` —— 把 M3 (layoutNodes) / M4 (NodeCard) / M5 (single Canvas + App.tsx 改) / M6 (DrillPanel 改读 nodeTree) / M7 (doc banner) 全部 revert。M1 (Node 类型) + M2 (store dual-write nodeTree) **保留**作为下一版数据层基础。测试 324 → 280（删 44 个针对 reverted 路径的测试）。

**v0.6 第一版的 5 个实测发现保留作 redo 参考**：
- 默认折叠语义混淆（`defaultFolded` 字段必须精确为"我的 children 是否默认隐藏"，不是"我自己是否默认隐藏"）
- cross-bucket linking 让 focus 拖全图（`collectSubtreeIds` 必须在遇到 descendant turn root 时 stop）
- parser linkTurnRoots 第一版 O(N²)（4083ms），加 `terminalAssistantByPromptId` Map 后 O(N)（2816ms）
- legacy ChatFlow/WorkFlow 二分有 4233 个 dup ID（llm_call 3915 + attachment 318），是因为同 uuid record 被多 bucket 引用；v0.5 没爆是因为 drill 一次只渲一个 ChatNode 的 WorkFlow；v0.6 Map.set dedup 自动修
- Playwright `dispatchEvent('dblclick')` 不触发 React Flow 12 的 onNodeDoubleClick（合成事件缺真实 click-counting 序列）；e2e 走按钮路径 workaround，canvas dblclick 路径靠 store 单测覆盖

**v0.6 redo 方向**（待新 handoff）：
- 数据层 `Node` 类型作为 ChatNode/WorkNode 共享 base
- 视觉层 ChatFlow/WorkFlow dual-canvas drill 嵌套**保留不动**
- delegate WorkNode 可 drill 进 sub-ChatFlow（解决 sub-agent 27% 多 ChatNode 信息丢失）
- WorkNode 卡片加 TokenBar + NodeIdLine 跟 ChatNode chrome 互通

Commits: `f9f6f03` (revert) + `773648e` (doc) + `b2940b0` (Conversation tab plan)。

### Conversation tab + composer 排进 v0.8 / v∞.2 / v∞.3

作者提出右侧 panel 改 2-tab：Detail（现 v0.4） + Conversation（read-only root→focused 历史，Claude App 风格）；后续 Conversation tab 底部加 input box 做 composer。

排法定为 **A**：read-only Conversation 跟 v0.8 fork 浏览的 ConversationView 是同一组件，并入 v0.8。v∞.2 加 leaf-continuation composer，v∞.3 解除 leaf 限制扩成任意节点 fork。三件事在同一 ConversationView 演进路径上递进，**不是三个独立 milestone**。

`b2940b0` 把这套排进 plan.md：v0.8 子任务表加 2-tab DrillPanel + ConversationView 视觉规范 + 双向 selection 联动；v∞.2/v∞.3 改写成"composer 在 Conversation tab 底部"的演进型描述。

### v0.6 第一版 ship（commits `01c3bcf` → `cfe9026`，7 milestone）

新 agent 接 `handoff-v0.6-data-model-unification.md`，按"取消 WorkNode/ChatNode 划分 + flat Node tree + default-fold"实施 7 milestone：

| M | hash | 描述 |
|---|---|---|
| M1 | `01c3bcf` | unified Node type + parser，alongside legacy |
| M2 | `e28b28f` | store dual-write nodeTree alongside chatFlow |
| M3 | `6c198d1` | layoutNodes — visibility filter + dagre + turn-root carve-out |
| M4 | `4b7c364` | single NodeCard component branching on Node.kind |
| M5 | `ff259f3` | single Canvas + right-click focus mode，drill-replace gone |
| M6 | `4558fff` | DrillPanel reads from Node tree |
| M7 | `cfe9026` | doc banner ship |

测试 227 → 324（+97）；selection round-trip 78.9 → 21.2ms（4×，flat tree 默认 fold 减少可见节点数副产物）；多 ChatNode amber banner 消失。**这一版后被 revert**，但 M1 + M2 保留作 redo 数据基础。详情见上文 revert 条目。

### v0.5 sub-agent 真嵌套（commit `74d49d9`）

`handoff-v0.5-subagent-nesting.md` → 双击 delegate 走 drillStack subworkflow 帧 + lazy load `subagents/agent-<agentId>.jsonl` + sessionSlice Map cache + auto-compact agent badge（按 `agentId.startsWith("acompact-")` 判别，老 meta 有时 agentType 误标）+ DrillBreadcrumb 多级回退。

4 个设计抉择拍：1A drill 替换主视图（继承 v0.3 drillStack）/ 2 双击 + cache + 失败保留折叠 / 3 badge 方案（不另起组件）/ 4 breadcrumb 完整链 + 不设深度上限。

**实测发现**：sub-agent jsonl 不是单 WorkFlow，**是多 ChatNode 的 ChatFlow**。跨用户全 session 165 sidecar 实测 121 单 ChatNode（73%）/ 44 多 ChatNode（27%，最大 47 个 = auto-compact 多次自压）。v0.5 妥协：渲染 chatNodes[0] + canvas 右上 amber banner 提示总数。完整渲染 → v0.6 redo（不再单独立 v0.5.1，吸收进 v0.6 redo）。

性能：cache hit 22ms / cold drill 1830ms / 跨用户嵌套深度 max 2 层。227/227 tests。Playwright dblclick 限制首次发现，e2e 走 DrillPanel 按钮路径。

`design-data-model.md` 同步纠正"sub-agent = WorkFlow"为"sub-agent = ChatFlow"。

### Selection perf fix 提前到 v0.4 之后（commit `df65051`）

v0.4 报告暴露 1522-ChatNode session selection round-trip avg 458ms。诊断：`decoratedNodes = useMemo(() => nodes.map((n) => ({ ...n, selected: n.id === selectedNodeId })))` 给所有 1500 张卡新生成 props 引用 → React Flow reconcile 整图。

修法：每张卡用 `useIsChatNodeSelected(id)` / `useIsWorkNodeSelected(id)` 自己订阅 boolean。Zustand 默认 Object.is 对比，1498 张返回 `false → false` short-circuit 不 re-render；只 deselect + new-select 两张真翻转。canvas wrapper 直接传 `nodes`，不再 decorate。

Playwright 实测同 1522-ChatNode session：458ms → **78.9ms**（5.8×）。原计划在 v0.10 polish 做，提前到 v0.4 之后是因为 v0.5 sub-agent drill 之后会再嵌一层渲染量级，先修 perf 再做 v0.5 不会叠加 reconcile 税。

### v0.4 drill panel ship（commit `36f02b7`）

`handoff-v0.4-drill-panel.md` → 选中节点右侧弹 panel 显示完整内容（user message 全文、assistant reply、tool args + result、thinking blocks、token usage、等等）。

3 个设计抉择拍：1A 右侧 resizable sidebar / 2 跟随 viewMode + 面包屑 / 3 chunked GET + `?start=` byte offset + 滚动加载（不是初版"截断 + Load full 按钮"）。

落地组件：
- `MarkdownView`（抄 Agentloom，remark-gfm + rehype-raw + rehype-sanitize）
- `JsonView`（自写，collapsible objects/arrays + 长字符串 fold）
- `DiffView`（自写，自动检测 `toolUseResult.structuredPatch` 红绿渲染，零 diff lib）
- `DrillPanel` + `ChatNodeDetail` + `WorkNodeDetail`
- `useToolResultChunks` 滚动钩子
- `GET /api/sessions/:id/tool-results/:refId?start=N` chunked endpoint + 双重路径穿越防护
- Bash tool input 当 code block；Edit/MultiEdit/Write 走 DiffView

195/195 tests；bundle 410KB → 755KB（markdown 全家桶 +330KB 预期内）。256MB session selection round-trip avg 458ms（v0.4 报回时已分析根因，留 v0.10 polish；后被 v0.4+ perf fix 提前解决）。

**实测纠正**：CC v2.1.104+ 的 tool_result overflow 用 `<persisted-output>` 字符串 marker（不是文档原写的 `ContentReplacementRecord` 对象）。`extractOverflowRefId` 双格式都吃。design-data-model.md 同步双格式说明。

### v0.3 inner WorkFlow drill（commits `cba8518` + `4d48232`）

`handoff-v0.3-inner-workflow.md` → ChatNode 不再是黑盒卡，点"进入工作流"按钮把主视图切到该 ChatNode 的 WorkFlow canvas，看里面跑了什么 llm_call / tool_call / delegate / compact / attachment。

设计抉择拍 **C drill 替换主视图**（不选 B 单一大 flow + culling，因为 256MB session 全展开 ~60K WorkNode）。drill state 不持久化，URL 路由是后续版本。

落地：`drillStack` store 切面 + `WorkFlowCanvas.tsx` + 5 类 WorkNode chrome（llm_call / tool_call / delegate / compact / attachment）+ ChatFlow 和 WorkFlow `selectedNodeId` 各自独立。150/150 tests；256MB drill 进 413-WorkNode ChatNode 实测 60.9 FPS avg / 59.5 1%-low。

**Spawn marker fix**（`4d48232`）：WorkFlowCanvas 第一版用 React Flow 内置 `MarkerType.ArrowClosed`（实心箭头）覆盖了所有边，违反 `design-visual-language.md` 的"spawn = 空心三角"。custom SVG marker `arrow-spawn` 已经定义但被覆盖。删 markerEnd 覆盖让每个 edge 组件自己 markerEnd 生效。

### v0.2 minimal canvas + polish round（commit `342357f` + 后续 ~25 个 commits）

`342357f` 主体落地：Hono backend (`src/server/`) + Zustand 4-slice (`src/store/`) + ChatFlow 横向 dagre LR canvas + ChatNodeCard + Sidebar + Header + dev wiring（vite 5175 proxy → hono 5174）。99/99 tests，256MB session 端到端 3.37s。

之后是密集的 v0.2 polish 期，作者一边用一边提：
- v0.2 视觉对齐 Agentloom palette（`4164909`）→ w-52 卡片 + 3px 左 accent strip + TokenBar + 隐藏 handle（`d155791`）→ bezier 边 + token-cap + drill stub + green leaf（`6fa6354`）
- ChatNode id 从右上移到底部（`2adeb36`）+ 完整 UUID 显示（`8af22d9`）+ click-to-copy + clipboard fallback（`0e1ede9` `c562a73`）
- 进入工作流按钮 inline always-visible（`a83df46`）+ user/assistant labels 改 gray-500 "助手" 中文（`036826e`）+ 删 chat/root/leaf chip 只标 functional events（`8f9fbda`）
- 1M context window 推断改成 model→context lookup table（`908ed13` → `c0ecf9f` → `d933416`）
- slash command ChatNode 特殊渲染（`a1bab17`）+ 修正 root user 优先级（`10aa1b5`）
- auto-focus latest ChatNode + 删 MiniMap（`5d2ce2a`）+ 改 fitView gate 用 `nodeLookup` 直接订阅（`dc12d11`）
- ChatFlow id click-to-copy 加 Header（`3caf5a2`）
- hover 边显示 target ChatNode model（`7271ec3`）
- model-usage ribbon overlay：经历 `2dcc8a0`（Agentloom 端口、第一版）→ `2d010d3`（误删，每边按 model 染色）→ `9a2f12a`（hover 触发所有模型，catmull-rom 穿过中心）→ `abc518e`（z-index 拉到 1100 上层）→ `489843d`（重写为 Agentloom BFS family + sidewaysArc）→ `a9cb46f`（用 `nodeLookup.measured` 跟真实卡片中心，不再 fallback h=140）。**核心教训**：xyflow 的 `s.nodes` 用户层不带 measured，必须用 `s.nodeLookup` 拿 InternalNode；且 Map 是原地变异，`useMemo([map])` 缓存会卡死，要么不 memo 要么订阅一个稳定的衍生值
- zoom 控件移到 bottom-left + 删 lock 图标（`02f116e`）

每条都是作者实际用过提的（不是脑补需求），polish 完后 ChatFlow canvas 跟 Agentloom 视觉非常接近。

### v0.1 数据解析层（commit `ea61a98`）

`src/data/types.ts` + `src/parse/raw-record.ts` + `src/parse/jsonl.ts`（4-pass：parse → split → workflow-build → linkParents）+ `src/parse/workflow-builder.ts` + `src/parse/sidecar.ts`（lazy loader API）+ `__fixtures__/synthetic/`。39/39 unit tests；256MB session 实测 2.19s 解析 / 0 失败。

**实测纠正了 7 处 doc 错误**（`bac9485`）：promptId 仅在 user 记录、sourceToolUseID 罕见走 block-level（要走 block-level `tool_use_id` 反查）、compact dup uuid 处理、file-history-snapshot 全 orphan、scheduled trigger 启发式、多 root 不存在、flow events carve-out 时机。这些细节落到 `design-data-model.md` 的 "v0.1 实测确认的解析规范" 小节。

### v0.0 scaffold + 设计文档收敛（commits `8ca1ef0` → `c4edc8f`）

Vite 5 + React 18 + TS 5.6 + Tailwind 3 + `@xyflow/react` 12 + `@dagrejs/dagre` + Vitest 工程框架，空壳 + 一个 smoke test。

随后大量设计讨论收敛到 6 篇文档（context-handoff / requirements / design-architecture / design-data-model / design-visual-language / plan）。关键发现：
- **Sub-agent trace 实测在 sidecar 文件里**（不是不存在）—— `subagents/agent-<id>.jsonl` 完整 trace；推翻原"v∞ 才能看 sub-agent"假设
- ScheduleWakeup vs CronCreate 区分：前者本地、后者远端 CCR（私有协议不走）；222 vs 0 实测频次说明日常用的是 ScheduleWakeup
- Recap (away_summary) 真相：是 next-ChatNode brief，91% 后继 user record（之前以为是 ScheduleWakeup 流水的一环）
- 主轴方向修正：ChatFlow 不是纵向、跟 WorkFlow 一样**横向**
- Edge kinds：v0 渲 3 类 + schema 留 5 类
- Anchor 约定：左/右/上/下四锚点各承担一类语义
- Compact 数据语义：平铺（不嵌套）+ summary 在 user 记录（不是 assistant！）
- Stack 锁定：Hono + zod + Zustand 5 + 4 slice 模式
- 安全：Mode A (默认 localhost) + Mode B (opt-in collab token)
- 不做：CCR 逆向、Docker、跨机器部署、L3 multiplayer、公网 SaaS
- CC settings.json 用原生 `type:'http'` hooks（不是 curl 包裹）
- Native install only（Tailscale / SSH tunnel 处理远端访问）

## 2026-05-01

### 项目立项 + scaffold（commit `4884d0e`）

Loomscope = Claude Code session jsonl 的可视化阅读器 + 第三方交互界面（远期）。从作者开发 Agentloom 期间频繁回看自己 Claude Code session 的痛点出发。Stack 主要对齐 Agentloom（差异：dagre 而非自家 layoutDag、不上 i18n）。

**命名注意**：曾考虑 "Claudeloom" 后否决（Anthropic 商标合规风险）。"Loom" 后缀保留与 Agentloom 家族关系，"scope" 表明它是观察者类工具。

---

## 关于这份日志

每完成一个 milestone / fix / 重大决策时**append 一条**。不要用这份替代 `plan.md`（路线图）或 `context-handoff.md`（项目入口）；它是它们之间的"流水账"，给想理解"项目是怎么演化到这里"的人读。

格式约定：
- 倒序（newest first）
- 日期分组（`## YYYY-MM-DD`）
- 每条用 `### 标题` + 内容；标题包含 commit hash 或 milestone 编号
- 涉及具体决策时优先写"为什么这么决定"和"实测发现"，写"做了什么"次要（diff 自己会说话）
- 跟 handoff 相关时引用 `handoff-vX.Y-*.md` 文件名
