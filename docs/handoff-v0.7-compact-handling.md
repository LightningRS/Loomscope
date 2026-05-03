# v0.7 交付 — Compact Handling

> 这篇是 v0.7 compact handling 任务的种子上下文。配 `context-handoff.md` 一起读：context-handoff 是项目整体入门，本文是本次任务专属。
>
> v0.7 是基于 v0.6 redo（Node 互通 + 视觉嵌套保留 + sub-ChatFlow drill）落地后的延伸。**v0.6 redo 的 8 条硬约束继续生效**——尤其"双画布 drill 模型不动"+"无 default-fold + expand/collapse"——v0.7 不要破例。详见 `devlog.md` 2026-05-03 v0.6 第一版 revert 条目。

## 任务一句话

**让 compact 段在 canvas 和 panel 里都能"被看见"**：compact ChatNode 视觉特殊化（三色按 trigger）+ 双击展开能看到 pre-compact 的原 turn 序列 + `logicalParentUuid` 跨 compact 弱边可视化 + file-history-snapshot 时间窗绑定到 turn（之前全是 orphan）+ panel 里 compact_file_reference attachment 显式标记"原文不可恢复"。

## 现状定位

- v0.6 redo 已 ship（commits `a48f990` → `121aa4b`）—— NodeBase 共享 + dual-canvas drill 嵌套保留 + sub-ChatFlow drill + WorkNode chrome shared atoms（TokenBar / NodeIdLine）
- `<synthetic>` fix 已 ship（`a13da49`）—— 所有 last-llm_call 派生（TokenBar / ribbon / tooltip）跳过 synthetic + errored 记录
- 235/235 tests，typecheck/build 净
- v0.5 已经识别 `isCompactSummary` 为 ChatNode kind=compact，但**视觉跟普通 ChatNode 几乎一样**（只多了个 ⊞ compact chip + teal accent）；展开后看不到原 turn 序列；logicalParentUuid 解析了但没画边
- file-history-snapshot 全部进 `chatFlow.orphans`（v0.1 实测 2099 条 / 跨用户共 3054 条），看不见

## 实测基线（CC 真实数据）

| 量 | 数字 | 备注 |
|---|---|---|
| compact ChatNode（跨用户 session）| 149 | 主要在 2362ff7c (139) + c0098244 (6) + 4 个 session ×1 |
| compact_boundary system record | 281 | 1:多 关系（一条 user `isCompactSummary` 可能对多条 boundary）|
| trigger=auto | 143 | harness 自动触发 |
| trigger=manual | 6 | 用户敲 `/compact` |
| 无 trigger 字段 | 132 | 老 CC 版本 / 边界场景；视觉 fallback 到 auto 颜色 |
| logicalParentUuid 出现频次 | 跟 compact 1:1 | 都在 compact ChatNode 上 |
| file-history-snapshot 总数 | 3054 | 全部 `parentUuid:null`，进 orphans，需要时间窗反推绑定 |
| 单 ChatNode 时间跨度（用作时间窗）| 中位数 ~30s，p95 ~3min | 决定时间窗 fuzzy match 容忍度 |

## ⚠️ Hard Constraints（继承 v0.6 redo + v0.7 特定）

继承自 v0.6 redo（不能违反）：

1. **ChatFlowCanvas + WorkFlowCanvas 双画布保留**——不要为 compact "原序列展开"引入第三种画布或单一 Canvas
2. **App.tsx viewMode union + drillStack 模型保留**——加新 viewMode 是允许的，但要走同套 union 模式（参考 v0.6 redo M3 加 `"sub-chatflow"` 那次）
3. **drill = 主视图替换**——不要 inline expand
4. **不允许引入 default-fold + expand/collapse 视觉模型**
5. **selection per-card 订阅模型不动**
6. **ModelRibbonLayer 在 ChatFlow 视图必须 hover 出**

v0.7 新增：

7. **NodeBase + 各 kind extends 不动**——compact 已经是一个 ChatNode kind，所有新字段（如果加）也要走 NodeBase 共享路径
8. **测试 235 → 不允许回退**

## 必先解决的设计抉择（4 个）

### 抉择 1：compact 双击展开 pre-compact 序列的视觉

CC 的 compact 段是这么个结构：

```
... ChatNode N-3 (pre)  ← logicalParentUuid 的目标 (post-compact 反指)
    ChatNode N-2 (pre)
    ChatNode N-1 (pre)
[compact_boundary - 切断点]
    ChatNode N+0 (compact summary, isCompactSummary=true)  ← logicalParentUuid 指向 N-1 或 N-3
    ChatNode N+1 (post, 用 summary 续接)
    ...
```

双击 compact ChatNode 应该能看到被压缩进 summary 的 N-3 / N-2 / N-1 那段原始 turn 序列。Loomscope 怎么呈现：

| 选项 | 描述 | 优劣 |
|---|---|---|
| **A 走 sub-ChatFlow drill 同款机制**（推荐）| compact ChatNode 双击 → drillStack push 一帧（kind 新增 `"compact-original"`）→ 主视图变成 ChatFlowCanvas 显示 pre-compact 那段原 turn 序列 | 跟 v0.6 redo sub-ChatFlow drill 一致；零边际成本继承 dual-canvas + breadcrumb；ChatFlowCanvas 递归挂载已 free upgrade |
| **B side panel 里"原序列"tab** | 选中 compact 时 DrillPanel 多一个 tab "原序列"，纵向显示 N-3/N-2/N-1 的 turn 卡片 | 不动 canvas；但 panel 已经在 v0.8 排了 Detail/Conversation 两个 tab，再加第三个语义混乱 |
| **C 弱边连接 + 同屏显示** | 不 drill，在 ChatFlow 顶层 canvas 上 compact ChatNode 周围把 pre-compact 那段也画出来（可能用半透明 / 灰边区分）| 视觉密度爆炸；跟 ChatFlow 顶层"只显示 turn 卡"原则冲突；不推荐 |

强烈倾向 **A**。理由：drillStack subworkflow 帧 v0.3 铺好、v0.5 sub-agent drill 用上、v0.6 redo sub-ChatFlow drill 复用——这是统一抽象。compact "看原序列"语义上也是"drill 进当前节点的另一种内容呈现"，跟 sub-agent drill 同构。

### 抉择 2：compact 三色 chrome 的边界情况

`design-visual-language.md` 写了 auto=teal / manual=purple / failed=rose。实测有 132/281 boundary 没 trigger 字段。

| 选项 | 描述 |
|---|---|
| **A** trigger 缺失 → fallback 到 auto 颜色（teal），加小灰 badge 提示 "trigger unknown" | 默认安全；UX 层面 auto 是绝对多数，错把 unknown 染成 auto 视觉影响小 |
| **B** trigger 缺失 → 第四色（gray），跟 3 色明确区分 | 视觉上更诚实 |
| **C** trigger 缺失 → 在 user record 上启发式推断（messageCount / preTokens 阈值之类）猜 auto vs manual | 复杂度高、容错差 |

倾向 **A**，简单直接；如果作者更看重视觉诚实选 B 也行。

### 抉择 3：file-history-snapshot 时间窗绑定策略

当前 3054 条 snapshot 全 `parentUuid: null` 进 `chatFlow.orphans`，看不到。reattach 策略：

| 选项 | 描述 |
|---|---|
| **A** snapshot.timestamp 落在某 ChatNode `[firstUserRecord.timestamp, lastRecord.timestamp]` 区间 → 归该 ChatNode；多 ChatNode 时间窗重叠 → 归 timestamp 最近的那个 | 简单、无歧义 |
| **B** snapshot.timestamp 严格 ≤ ChatNode.lastRecord.timestamp 且 ≥ 该 ChatNode 起点 | 同 A，更严格（不允许 fuzzy） |
| **C** 用 git reflog / file path heuristic 关联（看哪个 ChatNode 改了同名文件）| 信息更准但实施复杂、依赖 git 状态 |

倾向 **A**。简单 + 实测 ChatNode 中位数 30s 时间窗，重叠率低。

### 抉择 4：compact "已压缩文件"在 panel 里的呈现

compact_file_reference attachment 在 compact 段内出现（实测 271 条），含 `{filename, displayPath}` 但 content 已丢。WorkNodeDetail 里怎么渲？

| 选项 | 描述 |
|---|---|
| **A** 普通 file icon + displayPath + ⊠ "content compacted" 灰色 badge | 跟其他 file attachment 视觉差异最小 |
| **B** 单独的灰色 box "this file's content was compacted to summary"，明确告诉用户原文不可恢复 | 视觉差异大但语义清楚 |

倾向 **A**（design-visual-language 已有此约定，落地即可）。

## 必读文档（按顺序）

1. **`docs/context-handoff.md`** —— 项目整体入门
2. **`docs/devlog.md` 2026-05-03 全部条目** —— 重点：v0.6 redo + 第一版 revert + synthetic fix；理解 8 硬约束的来源
3. **`docs/plan.md` v0.7 节** —— 任务边界
4. **`docs/design-data-model.md`** ——
   - "Compact 段的数据语义"小节：isCompactSummary 在 user 记录、boundary 1:1 配对、logicalParentUuid 反向指针
   - "v0.1 实测确认的解析规范"小节：compact dup uuid 处理、file-history-snapshot 全 orphan 实测
5. **`docs/design-visual-language.md`** —— Compact 节点视觉规范（三色 chrome + dashed border + 弱边样式）
6. **`~/Agentloom/frontend/src/canvas/nodes/ChatFoldNodeCard.tsx`** —— Agentloom 的同位组件，三色 chrome 范本（不抄，只 anchor 思路）
7. **当前代码**：
   - `src/parse/jsonl.ts`（compact handling 现状 + file-history-snapshot 入 orphans 的 4-pass 逻辑）
   - `src/canvas/nodes/ChatNodeCard.tsx`（compact ChatNode 现有最小 chrome：⊞ compact chip + teal accent）
   - `src/canvas/edges/{ContinuationEdge,SpawnEdge}.tsx`（已有 2 类边；v0.7 加第 3 类 logical 弱边）
   - `src/store/sessionSlice.ts` 的 drillStack + enterWorkflow / enterSubWorkflow（v0.7 新增 enterCompactOriginal action）
   - `src/components/drill/{DrillPanel,WorkNodeDetail}.tsx`（compact_file_reference 渲染点）
   - `src/data/types.ts`（NodeBase + ChatNode + WorkNode kinds，含 CompactNode）

## v0.7 不做的事（防 scope creep）

- ❌ **DrillPanel 2-tab Detail/Conversation 改造** —— v0.8 fork 浏览
- ❌ **fork 浏览（forkedFrom 解析、merge 树、ConversationView）** —— v0.8
- ❌ **file-tail 实时增量** —— v0.9
- ❌ **AttachmentCard subtype 富化（图片缩略图等，除 compact_file_reference 外）** —— backlog
- ❌ **ExpandHint 全 kind affordance** —— v0.6 第一版残留 backlog；如顺手可做但**不是 v0.7 范围**
- ❌ **跨层 selection 漏层修**（v0.6 redo backlog）—— 同上，顺手能做就做不能就推 v0.10
- ❌ **重写 design-data-model.md / design-visual-language.md 整篇** —— 只小幅更新对应小节
- ❌ **代码 syntax highlight / bundle code-split / audit fix** —— v0.10 polish

## Milestone 实施步骤

每个 milestone 独立 commit + 测试全绿才能进下一步。

### M1 — Parser 扩展

- [ ] file-history-snapshot 时间窗绑定（按抉择 3 拍板实施）
  - parser pass 4.5（在 linkChatNodeParents 之后）扫所有 orphans 中 type=file-history-snapshot 的 record
  - 按 timestamp 反推绑定到对应 ChatNode（落到 ChatNode.fileHistorySnapshots 字段或 WorkFlow 内的新 attachment kind）
  - **新增字段**走 NodeBase / ChatNode 已有结构（不引入新 kind 除非必要）
- [ ] compact ChatNode `compactMetadata.trigger` 字段透传到 ChatNode 层（如果 v0.5 还没透传）
- [ ] **保留 v0.1 实测确认的所有 compact 不变量**（dup uuid 处理、isCompactSummary 在 user 记录、boundary 1:1 等）

**M1 acceptance**：parser 单测全绿；新增至少 4 个 test（snapshot binding 时间窗 / 多 ChatNode 重叠归最近 / trigger 字段透传 / compact 边界 dup uuid 不变量）；解析时间不退（≤ v0.6 redo baseline 1960ms）

### M2 — Compact ChatNode 视觉规范

- [ ] ChatNodeCard 当 `isCompactSummary=true` 时按 `compactMetadata.trigger` 切色（按抉择 2 拍板）
  - auto = teal-500 边 + teal-50 bg
  - manual = purple-500 边 + purple-50 bg
  - failed (compactMetadata.error 等) = rose-500
  - 缺失 trigger = fallback（按抉择 2）
- [ ] dashed border 跟 design-visual-language.md "compact 是 fold marker" 约定
- [ ] ⊞ compact chip 文字带 trigger（"⊞ compact (auto)" / "⊞ compact (manual)"）
- [ ] compact ChatNode 卡片下加 "double-click to see pre-compact" affordance 文字（类似 DelegateCard 的 "double-click to drill"）

**M2 acceptance**：3 类 trigger + fallback 4 个 case 视觉测试通过（cards.test.tsx 风格快照）；现有 ChatNodeCard 测试不破

### M3 — Compact original drill

- [ ] sessionSlice 新增 action `enterCompactOriginal(sessionId, compactChatNodeId)`（推 drillStack subworkflow-compact 帧）
- [ ] DrillFrame union 加新 kind `{ kind: "compact-original"; compactChatNodeId: string }`
- [ ] resolveDrilled 增加 case：compact-original 帧 → 通过 logicalParentUuid 反查 pre-compact ChatNode 链路 → 喂给 ChatFlowCanvas 渲染（同 sub-ChatFlow 的递归套路）
- [ ] App.tsx viewMode union 加 `"compact-original"`，按抉择 1 选 A 走同套切换
- [ ] DrillBreadcrumb 显示新帧（"⊞ compact (auto): xxxxxxxx" 紫色加粗）
- [ ] ChatNodeCard / WorkFlowCanvas 双击 compact 节点触发 enterCompactOriginal
- [ ] 退出回 Top 跟现有 exit 路径一致

**M3 acceptance**：双击 compact ChatNode → 主视图变成 pre-compact 原 turn 链 → breadcrumb 显示 compact 标记 → ESC / Top 退出回 ChatFlow；store 单测覆盖 push/pop/resolve 边界

### M4 — logicalParentUuid 弱边

- [ ] 新增 `src/canvas/edges/LogicalEdge.tsx`：dashed gray bezier，反向弧（跟 design-visual-language `A╮╰┄▶ B` 示意一致），arrow head 用空心或简化版
- [ ] layoutDag 增加：检测 ChatNode.logicalParentUuid → 找到对应 ChatNode 的 lastRecord uuid → 发出一条 logical edge（kind="logical"）
- [ ] ChatFlowCanvas edgeTypes 注册 logical
- [ ] 边不入 dagre 布局（避免影响主链 LR 顺序），用 React Flow `markerEnd` + 自定义 path

**M4 acceptance**：256MB session 实测 139 条 compact 全部产生 logical 反向弱边可见；不影响主 continuation 边的 LR 顺序；新增至少 2 个 test（edge 生成 / dashed 样式）

### M5 — DrillPanel compact_file_reference 渲染

- [ ] WorkNodeDetail attachment kind 分支处理 `attachmentType === "compact_file_reference"`：按抉择 4 拍板渲染（A 选项：file icon + displayPath + ⊠ "content compacted" badge）

**M5 acceptance**：compact ChatNode 内含 compact_file_reference 时 panel 正确显示标记；现有 attachment 渲染逻辑不破

### M6 — End-to-end + 文档

- [ ] 全部新增测试 + Playwright e2e（drill compact original / 三色 chrome / logical edge / panel compact_file_reference）
- [ ] 256MB session 实测：解析时间 / selection / cache 不退
- [ ] `design-data-model.md` "Compact 段的数据语义"小节小幅更新（提 file-history-snapshot 时间窗绑定 / compact-original drill 的 drillStack 帧约定）
- [ ] `design-visual-language.md` 三色 chrome + dashed border + logical 弱边视觉规范确认（v0 已有，确保实施跟文档一致）
- [ ] devlog.md 加 v0.7 ship 条目
- [ ] context-handoff.md 历史更新区加索引行

## 验收标准

- [ ] 4 个设计抉择都有作者签字
- [ ] 现有 235 测试全部保留 + 全绿
- [ ] 新增至少 **15** 个相关测试（M1×4 + M2×4 + M3×3 + M4×2 + M5×1 + e2e×1）
- [ ] typecheck 净 / build 通过
- [ ] **v0.6 redo 8 条硬约束 + v0.7 新增 2 条全部 verified**
- [ ] 双击 compact ChatNode 能 drill 进 pre-compact 原 turn 序列；breadcrumb 正确；ESC 退出
- [ ] compact ChatNode 三色 chrome（auto/manual/缺失 fallback）按 trigger 区分
- [ ] logicalParentUuid 弱边在 ChatFlow 视图可见（虚线浅灰反向弧）
- [ ] file-history-snapshot 不再全部 orphan，绑定到对应 ChatNode（实测 256MB session 至少 80% 的 snapshot 有归属）
- [ ] DrillPanel 内 compact_file_reference 显式标"content compacted"
- [ ] 256MB session 解析时间 ≤ v0.6 redo baseline 的 +10%
- [ ] devlog.md 加 ship 条目；plan.md v0.7 标 ✅；design 文档同步小幅更新

## 测试策略

- 既有 fixture 已有 compact 例子（v0.1 留下的合成 fixture）；如需扩，加 multi-compact + logicalParentUuid 链路 + file-history-snapshot 多 ChatNode 重叠的 case
- 单元测试覆盖每个 milestone 的核心算法（时间窗绑定 / 三色切换 / drill stack push/pop / logical edge 生成）
- Playwright e2e 在 M6 一次：navigate 到带 compact 的 session（2362ff7c 或 c0098244），双击 compact ChatNode 验证 drill 行为，截图验证三色 chrome
- **不要重写 256MB session 实测脚本** —— 复用 `/tmp/loomscope-inspect/` 的现有 probe.mjs

## 提交规范

- 中文跟作者交流；代码 / commit message / 标识符英文
- commit msg 格式：`v0.7 M1: ...` / `v0.7 M2: ...` 等
- 用 `git -c user.name=usingnamespacestc -c user.email=usingnamespacestc@gmail.com commit ...`（项目无全局 gitconfig）
- 不 force push / 不 amend / 不 skip hooks
- commit message 写"为什么"

## ⚠️ 任务完成后的报回流程

任务结束时把下述总结发回给用户。用户会把它**原文转交给上游协调 agent**——所以总结要写得让协调 agent 能直接续接：

1. 4 个设计抉择各自最终选了什么 + 给作者对比时的要点摘要
2. **每个 milestone 的 commit hash + 改动统计**
3. 测试数 235 → 新；typecheck / build 状态
4. 性能对比表：v0.6 redo baseline vs v0.7 实测（解析时间 / selection / cache 命中）
5. 验收标准每条状况
6. **v0.6 redo 的 8 条硬约束 + v0.7 新增 2 条逐条状态确认**
7. 遇到的 bug / surprise（特别是 v0.1-v0.6 实测不变量在 compact 路径下不成立的情况）
8. 留给后续版本的 backlog（v0.8 fork / v0.10 polish / 等）
9. file-history-snapshot 实测绑定率（多少 % 找到归属、多少 % 留 orphan + 为什么）
10. design-data-model.md / design-visual-language.md 改动范围

格式参考 `devlog.md` 里 v0.3 / v0.4 / v0.5 / v0.6 redo 的报回样式。

## 跨文档引用

- 项目入门 → `context-handoff.md`
- 路线图 → `plan.md` v0.7 节
- 当前数据模型（含 NodeBase + 5 类 WorkNode + ChatNode）→ `design-data-model.md`
- 视觉规范（compact 三色 + dashed border + logical 弱边）→ `design-visual-language.md`
- v0.6 redo 上一棒 → `handoff-v0.6-redo-node-base-interop.md`（NodeBase + sub-ChatFlow drill 已铺好的基础设施）
- v0.5 → `handoff-v0.5-subagent-nesting.md`（drillStack subworkflow 帧 + cache 已铺好）
- v0.4 → `handoff-v0.4-drill-panel.md`（DrillPanel + chunked endpoint + selection perf fix）
