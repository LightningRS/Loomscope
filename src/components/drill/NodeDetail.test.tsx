// v0.6 M6 — NodeDetail rendering tests.
//
// Coverage focuses on the new kinds (user_message) + verifies the
// kind-dispatch wiring works for all kinds. Detailed per-kind chrome
// behavior is shared with the legacy WorkNodeDetail tests
// (details.test.tsx) since the underlying logic is the same — the
// only delta is the Node field-name mapping.

import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { NodeDetail } from "@/components/drill/NodeDetail";
import type { Node } from "@/data/types";

function makeNode(overrides: Partial<Node>): Node {
  return {
    id: "x",
    parentId: null,
    kind: "user_message",
    defaultFolded: true,
    ...overrides,
  };
}

describe("NodeDetail kind dispatch", () => {
  it("user_message renders 用户消息 + 助手末次回复 + WorkFlow 概览 sections", () => {
    const node = makeNode({
      id: "u1",
      kind: "user_message",
      content: "list **all** tsx files",
      isTurnRoot: true,
      aggregate: {
        assistantPreview: "Found 5 files.",
        llmCallCount: 2,
        toolCallCount: 1,
        delegateCount: 0,
        attachmentCount: 0,
        thinkingChars: 100,
        contextTokens: 50_000,
        model: "claude-opus-4-7",
      },
    });
    const { container } = render(<NodeDetail node={node} sessionId="sid" />);
    expect(container.textContent).toMatch(/用户消息/);
    expect(container.textContent).toMatch(/助手末次回复/);
    expect(container.textContent).toMatch(/WorkFlow 概览/);
    expect(container.textContent).toMatch(/llm_call: 2/);
    // Markdown bold renders <strong>all</strong>
    expect(container.querySelector("strong")?.textContent).toBe("all");
  });

  it("user_message slash command shows /name + stdout", () => {
    const node = makeNode({
      id: "u-slash",
      kind: "user_message",
      slashCommand: { name: "/model", args: undefined, stdout: "Set to Opus" },
    });
    const { container } = render(<NodeDetail node={node} sessionId="sid" />);
    expect(container.textContent).toMatch(/\/model/);
    expect(container.textContent).toMatch(/Set to Opus/);
  });

  it("assistant_call renders model + text + thinking", () => {
    const node = makeNode({
      id: "a1",
      kind: "assistant_call",
      text: "the answer is **42**",
      thinking: [{ text: "let me think" }],
      model: "claude-opus-4-7",
      usage: { input_tokens: 100 },
    });
    const { container } = render(<NodeDetail node={node} sessionId="sid" />);
    expect(container.textContent).toMatch(/claude-opus-4-7/);
    expect(container.querySelector("strong")?.textContent).toBe("42");
    expect(container.textContent).toMatch(/let me think/);
  });

  it("tool_call Bash command renders inside a <pre> code block", () => {
    const node = makeNode({
      id: "t1",
      kind: "tool_call",
      toolName: "Bash",
      toolInput: { command: "ls -la", description: "list dir" },
    });
    const { container } = render(<NodeDetail node={node} sessionId="sid" />);
    expect(container.querySelector("pre")?.textContent).toBe("ls -la");
    expect(container.textContent).toMatch(/list dir/);
  });

  it("tool_call with structuredPatch toolUseResult renders DiffView", () => {
    const node = makeNode({
      id: "t-edit",
      kind: "tool_call",
      toolName: "Edit",
      toolInput: { file_path: "/x.ts" },
      toolUseResult: {
        filePath: "/x.ts",
        structuredPatch: [
          { oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ["-old", "+new"] },
        ],
      },
    });
    render(<NodeDetail node={node} sessionId="sid" />);
    expect(screen.getByTestId("diff-view")).toBeTruthy();
  });

  it("delegate kind shows agentType + drill button + description", () => {
    const node = makeNode({
      id: "d1",
      kind: "delegate",
      agentType: "Explore",
      agentId: "abc123",
      description: "Map backend",
      delegateContent: "Found 3 services",
      totalDurationMs: 50_000,
    });
    const { container } = render(<NodeDetail node={node} sessionId="sid" />);
    expect(container.textContent).toMatch(/Explore/);
    expect(container.textContent).toMatch(/Map backend/);
    expect(container.textContent).toMatch(/Found 3 services/);
    expect(screen.getByTestId("drill-into-subagent")).toBeTruthy();
  });

  it("compact kind shows trigger + summary", () => {
    const node = makeNode({
      id: "c1",
      kind: "compact",
      compactTrigger: "manual",
      preTokens: 50_000,
      summaryText: "**summary** of prior",
    });
    const { container } = render(<NodeDetail node={node} sessionId="sid" />);
    expect(container.textContent).toMatch(/manual/);
    expect(container.querySelector("strong")?.textContent).toBe("summary");
  });

  it("attachment kind shows type + raw JsonView + compacted note for compact_file_reference", () => {
    const node = makeNode({
      id: "a-comp",
      kind: "attachment",
      attachmentType: "compact_file_reference",
      attachmentRaw: { filename: "x.ts" },
    });
    const { container } = render(<NodeDetail node={node} sessionId="sid" />);
    expect(container.textContent).toMatch(/compact_file_reference/);
    expect(container.textContent).toMatch(/compacted out of jsonl/);
    expect(screen.getByTestId("json-view")).toBeTruthy();
  });
});
