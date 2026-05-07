# Loomscope dream features

> 远期愿景类功能。每条记录：(1) 想法本身、(2) 为什么是 dream（不是
> 即将开发）、(3) 依赖项 / 前置条件、(4) 最早能启动的时机。
>
> 跟 `plan.md` 的 roadmap 不同：roadmap 是"已经开始 / 即将开始"的
> 顺序队列；dream 是"未来希望但现在动不了"的留念册。

---

## 会话分支 ↔ 代码分支耦合（git auto-branch / auto-merge）

**想法**：当 CC 对话 fork（`/branch`）时，自动 `git branch <new-conv-id>`
让代码也分叉。当对话 merge（CC 还没 ship `/merge`，待 v∞）时触发
`git merge`。多人协作 agent 场景：N 个 agent 在同一 session 不同
分支并行写代码，最后合到主线。

**为什么是 dream**：
- CC 当前 `/branch` 命令产生的是**会话副本**（jsonl 文件复制 + 独立
  续接），跟代码版本控制完全独立。Loomscope 看得见会话分支，但
  没法影响代码 git 状态。
- 自动 branch/merge 需要 Loomscope 在 fork 瞬间有 hook 能触发
  `git branch` 命令，并且能跟踪每条会话分支跟一个 git ref 的对应
  关系（持久化映射、跨 session 还要稳）。
- merge 部分卡在 CC 还没实装 `/merge`。我们想自动响应一个尚不存在
  的 CC 命令。
- 多人 agent 协作的语义还没有统一约定（哪个分支当主、冲突怎么解、
  agent 之间能不能互看对方的 branch）。

**依赖**：
1. CC `/merge` 实装（Anthropic 路线图待定），或
2. Loomscope 拥有 SDK spawn CC 的能力（v∞.1+），自己生成会话事件
   而非被动观察 CC 写的 jsonl
3. 持久化 conv_branch_id ↔ git_branch_name 的映射存储（per workspace）
4. 多 agent 协作的语义约定（先在 Agentloom 的 ChatFlow merge 那边
   验证一遍，那里语义先成熟）

**最早启动时机**：v∞.2 之后 + Agentloom MemoryBoard / merge 玩明白
后。预计不会早于 2026 下半年。届时跟 Agentloom 共享一个 git-coupling
后端服务（Loomscope 输出会话事件，Agentloom 输出 ChatFlow 事件，
共用 git-coupling layer）。

**线索 / 不要忘的细节**：
- CC `/branch` 产生的新 jsonl 里每条 record 都带 `forkedFrom`
  指向源 record，Loomscope parser 已经能识别（详见 `design-data-model.md`
  v0.8 fork browsing 章节）
- 多 agent 写到同一 git repo 时容易撞 `.git/index.lock`，得有锁
  协调
- Agentloom 的 MemoryBoard merge Stage 1/2 已经 ship，里面 LCA-aware
  merge + joint-compact 经验可以借鉴

---

## (record more dreams here as they come up)
