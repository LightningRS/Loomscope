# v0.8 交付 — Fork 浏览（含 DrillPanel 2-tab + ConversationView）

> 这篇是 v0.8 fork 浏览任务的种子上下文。配 `context-handoff.md` 一起读：context-handoff 是项目整体入门，本文是本次任务专属。
>
> v0.8 是 v0.6 redo（NodeBase + sub-ChatFlow drill）+ v0.7（compact-original drill + logical 弱边）成功落地后的延伸。**v0.6 redo 的 8 条硬约束 + v0.7 新增 2 条继续生效**——尤其"双画布 drill 模型不动"+"无 default-fold"+"NodeBase 形状不变"+"测试不退"。详见 `devlog.md` 2026-05-03 的 v0.6 第一版 revert 条目。

## 任务一句话

**让所有 fork 现象在 Loomscope 里成为一等公民**：parser 识别 CC `/branch` 写的 `forkedFrom` 跨文件指针 + `custom-title` 记录；server 沿 fork 闭包 merge 多个 jsonl 成单一 ChatFlow；canvas 在 fork 点（多孩子 ChatNode）加 visual badge；右栏 DrillPanel 加 Conversation tab 显示 root → focused 线性对话流；多孩子节点加"切换分支"按钮 + branchMemory（v∞.2/v∞.3 composer 在此基础上演进）。

## 现状定位

- v0.7 compact handling 已 ship（commits `fbcc4bb` → `2e2033f`，含 e2e）—— file-history-snapshot 100% 绑定 / compact 三色 dashed chrome / compact-original drill 沿 logicalParentUuid / logical 弱边 / compact_file_reference 精装 card
- v0.6 redo 已 ship —— NodeBase + ChatNode/WorkNode `extends`，sub-ChatFlow drill 走递归 ChatFlowCanvas
- 284/284 单元 + 4 e2e，typecheck/build 净
- **fork 数据现状**：
  - **In-session sibling fork**（CC 的 edit-and-resubmit / restore + resubmit）：实测用户单 session 里 sibling ChatNode 数量从 1 到 6500+ 不等。**已经在画布上铺开**（dagre LR 自动竖向摊开），但用户没有"我现在在哪条分支上"的语义概念
  - **Cross-session fork**（CC `/branch`）：用户当前**没用过**——0 个 jsonl 含 `forkedFrom` 字段。但 parser 应当立即支持，以便用户开始用 `/branch` 时直接 work
  - **canvas fork badge**（多孩子 ChatNode 标记）：当前完全没有视觉标记，用户看 dagre 摊开的 sibling 不一定意识到"这是 fork 点"
  - **ConversationView**：**完全没有**。当前只能通过 canvas drill 浏览 session 内容，没有"按时间线读完整对话流"的视图

## ⚠️ Hard Constraints（继承 v0.6 redo 8 + v0.7 2 + v0.8 新增）

继承不变：

1. ChatFlowCanvas + WorkFlowCanvas 双画布保留
2. App.tsx viewMode union + drillStack 模型保留
3. drill = 主视图替换（v0.3 选项 C）
4. 无 default-fold + expand/collapse 视觉模型
5. selection per-card 订阅模型不动
6. ModelRibbonLayer 在 ChatFlow 视图必须 hover 出
7. 测试不退（284 → 不允许下降）
8. NodeBase + 各 kind extends 形状不动
9. 不破坏 sub-ChatFlow drill 路径（v0.6 redo）
10. 不破坏 compact-original drill 路径（v0.7）

v0.8 新增：

11. **DrillPanel 2-tab 结构改造不破坏现有 Detail 视图**——Detail tab 行为 1:1 跟 v0.4 + v0.5 + v0.7 一致，只是被嵌进 tab 而非整 panel；不允许改 ChatNodeDetail / WorkNodeDetail 内部行为（除非作者拍板）
12. **merged ChatFlow 不破坏 sub-agent cache 路径**——v0.5 的 `subAgentCache` + lazy load 行为继承，merge 是顶层 ChatFlow 跨文件聚合，跟 sub-agent drill 正交
13. **Canvas 顶层仍只显示 ChatNode**——merge 后产生的 sibling ChatNode 也是 ChatNode kind，不引入新顶层节点类型

## 必先解决的设计抉择（4 个）

研究 + 提案后等作者拍板再开工。**绝不 silent 选**——合并多 jsonl 数据是新代码路径，silent 选错就是回滚。

### 抉择 1：Multi-jsonl merge 时机 + 触发

CC `/branch` 写出来的 fork session 是独立 jsonl 文件。Loomscope 怎么发现 + 合并这些文件？

| 选项 | 描述 | 优劣 |
|---|---|---|
| **A 加载时 eager 闭包遍历** | 每次打开 session X，server 立即沿 `forkedFrom.sessionId` 反向找祖先 + 正向扫所有其它 jsonl 找 `forkedFrom.sessionId === X` 的子 fork → 递归 BFS 闭包 → 全部 records 按 uuid dedupe → 喂给 parser → 输出单一 merged ChatFlow | 闭包小（实测 user 0 fork session 闭包 = 1，未来用了 /branch 也基本 1-3）；行为简单；唯一代价是反向扫 jsonl（线性扫所有 jsonl 的第一条记录就够，不用读完）|
| **B Lazy 按需合并** | 默认只 load 当前 session；用户点 sidebar 上的 fork session 时再 merge | 启动快但语义不一致——同一棵 fork 树看不同 session 显示的内容不同 |
| **C 后台索引** | server 启动时扫所有 jsonl 建 forkedFrom 索引，load session 时根据索引立即知道闭包成员 | 启动时间增加（user 21 session × 一次性扫所有第一条记录 ~ 100ms）；但 reload session 极快 |

倾向 **A**。闭包小、行为一致、实现简单；闭包遍历的扫描成本小（每个候选 jsonl 只读第一条记录的 `forkedFrom` 字段就够判断），跟 v0.5 sub-agent endpoint 复杂度一个量级。

### 抉择 2：Sidebar fork session 树状显示

merged ChatFlow 产生后，sidebar 怎么显示 fork 关系？

| 选项 | 描述 |
|---|---|
| **A 不动 sidebar**（推荐 v0.8 默认）| sidebar 仍按 modified time 倒序列出所有 session；fork 关系仅在 canvas 上覆盖（merged ChatFlow 多个 sessionId 的 ChatNode 一起显示）；sidebar 上看 fork 子 session 跟看普通 session 一样 |
| **B 树状缩进**（plan.md 原标"可选/后期"）| fork 子 session 在 sidebar 上缩进显示在原 session 下；title 末尾带 `(Branch)` / `(Branch 2)` 等 customTitle 后缀 |
| **C 折叠组**（fork chain 收成一组，组内只显示 leaf）| 复杂，会丢上下文 |

倾向 **A**——v0.8 主线先做 canvas-side merge 可视化；sidebar 层 fork 树状是 polish，且 user 当前 fork 数据 = 0，做了也无法验证。**作为 backlog 留给 v0.10 polish**。

### 抉择 3：ConversationView 视觉密度

Conversation tab 怎么渲染 root → focused 的线性对话链？

| 选项 | 描述 |
|---|---|
| **A Claude App 风格 chat bubbles**（推荐）| 纵向滚动；user 消息右对齐 + 浅蓝底；assistant 消息左对齐 + 白底；MarkdownView 渲染 markdown；每条消息附 model + token 数 + 时间戳 chip；多孩子 ChatNode 处出现 `ForkInfo` 块给"切换分支"按钮 |
| **B 紧凑列表** | 每条消息一行 / 几行截断 + 展开图标；类似 git log 视觉；信息密度高但不利于阅读完整内容 |
| **C 混合** | 默认 A 风格但加全局"折叠到摘要" toggle | 复杂度跳 |

强烈倾向 **A**。已经在 `plan.md` v0.8 子任务里写过，作者之前确认过"Claude App 风格"这个方向。

### 抉择 4：branchMemory 持久化

multi-child ChatNode 处的"切换分支"按钮按了之后，记住"上次这条 fork 走到哪条 leaf"——这个 memory 存哪？

| 选项 | 描述 |
|---|---|
| **A store-only（reload 丢失）**（推荐 v0.8 默认）| Zustand session slice 加 `branchMemory: Map<forkChildId, leafId>`；session 切换 / reload 重置 |
| **B localStorage 跨 reload 持久化** | per-session key 写 localStorage；用户回到熟悉 session 时切分支位置不丢 |
| **C URL hash** | shareable，但 v0.8 没有 URL routing 计划 |

倾向 **A**——v0.8 先简单。localStorage 持久化是 polish 项，且 v0.7 实测 fork 体验不充分，先看用户日常用得上 v0.8 的 ConversationView 再决定要不要让 branchMemory 跨 reload。

## 必读文档（按顺序）

1. **`docs/context-handoff.md`** —— 项目整体入门
2. **`docs/devlog.md`** 全部 2026-05-03 条目—— 重点理解 v0.6 redo 误读教训 + v0.7 两次中途纠错
3. **`docs/plan.md` v0.8 节**—— 任务边界（Plan A / 已排定 Conversation tab + composer 演进路径）
4. **`docs/design-data-model.md`** "Fork 机制" 小节—— v0.8 旨在落地这一节描述的两套 fork 机制（`/branch` 跨 session + MessageSelector restore in-session）
5. **`docs/design-visual-language.md`** ConversationView + Conversation 视觉规范（如果有；如果没有，参考 Agentloom）
6. **`~/Agentloom/frontend/src/canvas/pathUtils.ts`** + `pathUtils.test.ts` —— ConversationView 的核心算法 (root → selected 线性链 + ForkInfo)。**移植不抄**：Loomscope 的 ChatFlow 形态跟 Agentloom 的 ChatFlowNode 不一样，但算法骨架一致
7. **`~/Agentloom/frontend/src/canvas/ConversationView.tsx`** —— 视觉参考（Claude App 风格的具体实现）
8. **当前代码**：
   - `src/parse/jsonl.ts`（v0.7 落地的 4-pass 解析；v0.8 加 forkedFrom + custom-title 识别）
   - `src/data/types.ts`（NodeBase + ChatNode + WorkNode 各 kind；v0.8 给 ChatNode 加 `forkedFrom?` 字段，给 ChatFlow 加 `customTitle?` + `linkedSessions?`）
   - `src/server/routes/sessions.ts`（v0.4 + v0.5 加 endpoint，v0.8 改 GET 路径接 fork merge）
   - `src/store/sessionSlice.ts`（v0.5/v0.6/v0.7 drillStack；v0.8 加 branchMemory + drillPanelTab + selectedNodeId 在 Conversation tab 双向同步）
   - `src/components/drill/DrillPanel.tsx`（v0.4 + v0.5 + v0.7；v0.8 改 2-tab 结构）
   - `src/canvas/nodes/ChatNodeCard.tsx`（v0.7 给 compact 加 dashed chrome；v0.8 给多孩子加 fork badge）

## 实测基线 / fork 数据现状

| 量 | 数字 | 备注 |
|---|---|---|
| user 单 session 内最大 sibling 数 | 6500+ | session 2362ff7c-... 的极端值；多 sibling 同 parentChatNodeId 自然在 dagre 上摊开 |
| user 中位 session 的 sibling 总数 | 1-13 | 多数 session 仅 1-2 个 fork 点 |
| user `/branch` 使用次数 | **0** | 所有 jsonl 中 `forkedFrom` 字段不存在；v0.8 必须在 fixture 里造测试数据 |
| user `custom-title` 记录数 | **0** | 同样未使用 |
| 跨用户全集 sub-agent 多 ChatNode 占比 | 27% | v0.5 实测；不是 fork 但相关现象 |

⚠ **v0.8 验收无法靠真实 user data 完整测试 fork merge**——必须依赖手工构造的 fixture（mock `/branch` 后的 fork session jsonl 对）。这是 v0.8 跟 v0.7 最大不同：v0.7 真实 data 充分，v0.8 user 还没用 `/branch`，所以**测试覆盖必须靠合成 fixture 顶住**。

## v0.8 不做的事（防 scope creep）

- ❌ **Conversation tab 底部 composer input box** —— v∞.2 / v∞.3
- ❌ **任意节点 fork composer**（写入 jsonl）—— v∞.3
- ❌ **leaf-continuation prompt 提交** —— v∞.2
- ❌ **Sidebar fork 树状缩进显示** —— 抉择 2 选 A，不做；backlog 留 v0.10
- ❌ **branchMemory localStorage 持久化** —— 抉择 4 选 A，不做；backlog
- ❌ **跨 session 搜索（FTS5）** —— v0.10
- ❌ **file-tail 实时增量** —— v0.9
- ❌ **跨层 ChatNode 选择字段修**（v0.6 redo / v0.7 都标过 backlog）—— v0.8 顺手能做就做不能就推 v0.10
- ❌ **ExpandHint 全 kind affordance**（v0.6 第一版残留 backlog）—— 同上
- ❌ **重写 design-data-model.md / design-visual-language.md 整篇** —— 只小幅更新对应小节

## Milestone 实施步骤

每个 milestone 独立 commit + 测试全绿才能进下一步。建议保留 commit message 格式 `v0.8 M{n}: ...`。

### M1 — Parser 扩展（forkedFrom + custom-title）

- [ ] `src/parse/jsonl.ts` 在 4-pass 流程中加：
  - 识别 record 上的 `forkedFrom: { sessionId, messageUuid }` 字段——挂到含该 record 的 ChatNode 上（ChatNode 共享一个 forkedFrom，多条 record 不一致时报警 + 取首个）
  - 识别 `{ type: "custom-title", customTitle, sessionId }` 顶层 record——挂到 ChatFlow 顶层
- [ ] `src/data/types.ts` 加：
  - `ChatNode.forkedFrom?: { sessionId: string; messageUuid: string }`（不破坏 NodeBase + extends 形态）
  - `ChatFlow.customTitle?: string`
  - `ChatFlow.linkedSessions?: string[]`（merged 时记录由哪些 sessionId 拼成；非 merged session 留空或 undefined）
- [ ] 单元测试：forkedFrom 解析 / custom-title 解析 / 多 record forkedFrom 不一致警告 / 不破坏既有 v0.7 测试

**M1 acceptance**：parser 测试全绿；新增 ≥ 4 测试；解析 256MB session 时间 ≤ v0.7 baseline +5%

### M2 — Server forkTree 闭包 + merge

- [ ] 新增 `src/server/services/forkTree.ts`：
  - `findForkClosure(rootSessionId, allSessionIds): SessionId[]`——沿 forkedFrom 反向找祖先 + 正向扫所有其它 session 的第一条 record 找指向 root 的子 fork；BFS 去环
  - 单元测试 ≥ 6 case（无 fork / 单层 fork / 嵌套 fork / fork 树带环防御 / 大量旁支）
- [ ] `src/server/routes/sessions.ts` 改 `GET /api/sessions/:id`：
  - 找闭包 → 加载所有闭包 session 的 jsonl → 按 record uuid 去重（保留最早写入版本）→ 喂给现有 parser → 输出 merged ChatFlow（设 `linkedSessions` 字段）
  - sub-agent endpoint 路径不动（`GET /api/sessions/:id/subagents/:agentId`）—— sub-agent cache 跟 fork merge 正交
- [ ] **测试覆盖**：fixture 必须包含一个手工 fork pair（原 session + fork session，每条 record 同 uuid 但 fork session 多记录多 sessionId）；端到端测试 merge 后 ChatFlow 含两条 sessionId 的 ChatNode（uuid 去重，sibling 自然形成）

**M2 acceptance**：merge 测试全绿；新增 ≥ 8 测试（含 closure + merge + dedupe + endpoint）；解析 user 真实 256MB session 时间不退（无 fork 时闭包 = 1，等价 v0.7 路径）

### M3 — DrillPanel 2-tab 结构

- [ ] `src/components/drill/DrillPanel.tsx` 改造：
  - 顶部加 tab strip：`Detail` | `Conversation`
  - tab state 在 sessionSlice：`drillPanelTab: "detail" | "conversation"` + localStorage 持久化（key `loomscope:drillPanelTab`）
  - Detail tab 内容 = 现有 ChatNodeDetail / WorkNodeDetail 视图（**1:1 不变**，仅嵌进 tab）
  - Conversation tab 内容暂时占位（"Conversation view coming in M4"），避免 M3 commit 带半成品视图
- [ ] **关键不变量**：Detail tab 视觉 / 行为跟 v0.7 完全一致（tab 切换不影响 ChatNodeDetail 内部）
- [ ] 测试：tab 切换 / 持久化 / Detail tab 内容不破

**M3 acceptance**：DrillPanel 单元测试全绿；新增 ≥ 4 测试；视觉 spot check（Detail tab 跟 v0.7 一致）

### M4 — ConversationView 移植 + Claude App 风格 chrome

- [ ] 新增 `src/components/drill/ConversationView.tsx`（搬 Agentloom `pathUtils.ts` 逻辑 + 重写视觉）：
  - **算法**：从 `selectedNodeId` 沿 `parentChatNodeId` 反向走到 root，得到 ChatNode[]；每个 ChatNode 有多孩子时生成 `ForkInfo { childIds[], chosenChildId, ... }`
  - **视觉**：纵向滚动；user 消息右对齐 + 浅蓝底；assistant 消息左对齐 + 白底；MarkdownView 渲染（v0.4 现成）；每条消息附 model badge + 时间戳 + token chip；fork 点显示 `ForkInfo` 块（"This turn has N branches: [Branch A] [Branch B] ..."）
- [ ] **branchMemory**（抉择 4 选 A，store-only）：
  - sessionSlice 加 `branchMemory: Record<sessionId, Record<forkChildId, leafId>>`
  - action `pickBranch(sessionId, forkChildId, leafId)`——切换 selectedNodeId + 记忆该 fork 走过的 leaf
  - 切回 fork 点时优先用 branchMemory 里的 leaf
- [ ] **selection 双向同步**（Conversation ↔ Detail ↔ canvas）：
  - 点 Conversation 某条消息 → 更新 selectedNodeId → canvas 焦点跟随
  - 点 canvas 某 ChatNode → Conversation 自动滚到对应消息 + 高亮
  - 跨层（sub-ChatFlow / compact-original drill）的 selection 复用现有 store 字段
- [ ] 测试：pathUtils 算法（≥ 5 case：linear / fork at end / fork mid / sub-chatflow 范围 / compact-original 范围）+ 视觉单元测试 + branchMemory 切换语义

**M4 acceptance**：ConversationView 单元测试全绿；新增 ≥ 12 测试；user 真实 session 实测：选中某 ChatNode 后 Conversation tab 正确显示 root → 该节点链路；多孩子节点切换流畅

### M5 — Canvas fork badge

- [ ] `src/canvas/nodes/ChatNodeCard.tsx` 扩展：
  - 多孩子 ChatNode（`hasOutgoingEdge` + 多个孩子）加视觉标记
  - 推荐：右上角小 chip "▶ N branches"（N = 子节点数）
  - 不影响 compact / scheduled / slash command / leaf 现有 chrome（badge 是新增层，跟现有 chip 共存）
- [ ] layoutDag 输出每个 ChatNode 的子节点数（已有 hasOutgoingEdge 但没有计数；加一个 `childCount` 字段到 ChatNodeRFData）
- [ ] 测试：badge 出现条件（≥ 2 children）/ 不破坏现有 chrome 测试

**M5 acceptance**：cards.test.tsx 全绿；新增 ≥ 3 测试；user 真实 session 实测：fork 点 ChatNode 上有 chip

### M6 — End-to-end + docs

- [ ] Playwright e2e（继承 v0.7 借 Agentloom binary 模式）：
  - 真实 session 选中某有 fork 后续的 ChatNode → Conversation tab 显示完整对话链 + ForkInfo
  - 切换分支 → canvas 焦点跟随 + branchMemory 记忆
  - mock `/branch` fork session 加进 fixture → merge 显示 fork 关系
  - canvas fork badge 出现位置正确
- [ ] `design-data-model.md` "Fork 机制" 小节确认是否需要小幅更新（v0.8 实施过程中可能发现新约定）
- [ ] `design-visual-language.md` 加 ConversationView 视觉规范小节（如果还没有）+ canvas fork badge 视觉规范
- [ ] devlog.md 加 v0.8 ship 条目
- [ ] context-handoff.md 历史更新区加索引行
- [ ] plan.md v0.8 标 ✅

## 验收标准

- [ ] 4 个设计抉择都有作者签字
- [ ] 现有 284 测试全部保留 + 全绿
- [ ] 新增至少 **30** 个相关测试（M1×4 + M2×8 + M3×4 + M4×12 + M5×3 + e2e×2）
- [ ] typecheck 净 / build 通过
- [ ] **10 + 3 = 13 条硬约束逐条 verified**
- [ ] **Detail tab 跟 v0.7 视觉行为 1:1 一致**（不允许有 panel 二次重构带来的副作用）
- [ ] Conversation tab 在 user 真实 session 上能正确渲染 root → focused 链
- [ ] multi-child ChatNode 处 ForkInfo + branchMemory 切换流畅
- [ ] mock fork session（合成 fixture）能正确 merge + canvas 显示 sibling 关系
- [ ] canvas fork badge 在多孩子 ChatNode 上可见
- [ ] 256MB session 解析时间 ≤ v0.7 baseline +5%（无 fork 时 closure = 1，无额外开销）
- [ ] selection per-card subscription 不退；cache hit 22ms 不退
- [ ] devlog / plan / context-handoff / design 文档同步更新

## 测试策略

- **新增 fixture**：`__fixtures__/synthetic/fork-pair/`——一对模拟 CC `/branch` 产物的 jsonl（原 session 5 ChatNode；fork session 复制前 3 ChatNode + 加 `forkedFrom` 字段 + 新增 2 个续接 ChatNode + custom-title record "(Branch)" 后缀）
- **新增 fixture**：`__fixtures__/synthetic/multi-fork/`——单 session 内多 sibling fork 的 minimal 例子（mimic restore-then-resubmit 行为）
- 单元测试覆盖每个 milestone 算法（forkClosure / merge dedupe / pathUtils / branchMemory / fork badge）
- Playwright e2e 在 M6 一次：用 mock fixture + user 真实 session 共同验证
- **不重写 256MB session 实测脚本**——复用 `/tmp/loomscope-inspect/` 的 probe.mjs 模式

## 提交规范

- 中文跟作者交流；代码 / commit message / 标识符英文
- commit msg 格式：`v0.8 M1: ...` / `v0.8 M2: ...` 等
- 用 `git -c user.name=usingnamespacestc -c user.email=usingnamespacestc@gmail.com commit ...`（项目无全局 gitconfig）
- 不 force push / 不 amend / 不 skip hooks
- commit message 写"为什么"

## ⚠️ 任务完成后的报回流程

任务结束时把下述总结发回给用户。用户会把它**原文转交给上游协调 agent**——所以总结要写得让协调 agent 能直接续接：

1. 4 个设计抉择各自最终选了什么 + 给作者对比时的要点摘要
2. **每个 milestone 的 commit hash + 改动统计**
3. 测试数 284 → 新；typecheck / build 状态
4. 性能对比表：v0.7 baseline vs v0.8 实测（解析 / merge 闭包成本 / selection / cache hit / Conversation 渲染时间）
5. 验收标准每条状况
6. **10 + 3 = 13 条硬约束逐条状态确认**
7. 遇到的 bug / surprise（特别是 fork 路径下既有 v0.1-v0.7 不变量是否成立）
8. 留给后续版本的 backlog（v∞.2 composer / v0.10 polish / 等）
9. **fixture 构造方式 + 实际测试覆盖率**（user 0 fork data 这件事必须靠 fixture 顶；要明说怎么覆盖）
10. design-data-model.md / design-visual-language.md 改动范围

格式参考 `devlog.md` 里 v0.5 / v0.6 redo / v0.7 的报回样式。

## 跨文档引用

- 项目入门 → `context-handoff.md`
- 路线图 → `plan.md` v0.8 节
- Fork 数据模型 → `design-data-model.md` "Fork 机制" 小节
- 视觉规范 → `design-visual-language.md`
- v0.7 上一棒 → `handoff-v0.7-compact-handling.md`（compact-original drill / logical 弱边 / file-history-snapshot 实测纠正）
- v0.6 redo → `handoff-v0.6-redo-node-base-interop.md`（NodeBase + sub-ChatFlow drill 已铺好）
- v∞.2 / v∞.3 后续 → `plan.md` v∞ 节（Conversation tab 底部 composer 演进路径）
- Agentloom pathUtils 参考 → `~/Agentloom/frontend/src/canvas/pathUtils.ts`
