// tool_call WorkNode card. Folded chrome — 🔧 toolName + up to 3
// "key: value" input lines + first non-empty line of result.
//
// Failed tool_calls (``isError`` from the tool_result block, or any
// "is_error":true / "status":"failed" inside ``toolUseResult``) get
// rose accent + ✗ marker.

import { Handle, Position } from "@xyflow/react";
import type { NodeProps } from "@xyflow/react";

import {
  WF_NODE_SIZE,
  previewToolInput,
  previewToolResult,
  type ToolCallRFNode,
} from "@/canvas/layoutWorkflow";
import { NodeIdLine } from "@/canvas/nodes/chrome/NodeIdLine";
import { useStore } from "@/store";
import { useIsWorkNodeSelected } from "@/store/selectionHooks";
import { handleStyle, workNodeChromeClass } from "./cardChrome";

// v0.11 Phase 4 — file_path extraction for Git ↔ WorkFlow cross-
// highlight. Mirrors `distinctToolUseFiles` in layoutDag, except
// here we want EACH tool_call's path (one or more), not a per-
// ChatNode union.
function getEditedFilePaths(
  toolName: string,
  input: unknown,
): string[] {
  if (!input || typeof input !== "object") return [];
  const inp = input as Record<string, unknown>;
  if (
    toolName === "Edit" ||
    toolName === "Write" ||
    toolName === "MultiEdit"
  ) {
    const fp = inp["file_path"];
    return typeof fp === "string" && fp.length > 0 ? [fp] : [];
  }
  if (toolName === "NotebookEdit") {
    const fp = inp["notebook_path"];
    return typeof fp === "string" && fp.length > 0 ? [fp] : [];
  }
  return [];
}

export function ToolCallCard({ id, data }: NodeProps<ToolCallRFNode>) {
  const n = data.workNode;
  const inputLines = previewToolInput(n);
  const resultPreview = previewToolResult(n);
  const failed = n.isError === true;
  const accent = failed ? "rose" : "amber";
  const selected = useIsWorkNodeSelected(id);
  const isRunning = (data as { isRunning?: boolean }).isRunning === true;

  // v0.11 Git ↔ WorkFlow cross-highlight: extract this tool_call's
  // edited file path (if any). Hover writes to store; panel reads.
  // Reverse: panel hover writes to `gitFileHoverFromPanel`; this
  // card reads & lights up when its file matches.
  const editedFiles = getEditedFilePaths(n.toolName, n.input);
  const setHover = useStore((s) => s.setGitFileHoverFromWorkflow);
  const setFocus = useStore((s) => s.setGitFileFocusFromWorkflow);
  const setTab = useStore((s) => s.setDrillPanelTab);
  const panelHover = useStore((s) => s.gitFileHoverFromPanel);
  const isHoveredFromPanel =
    panelHover != null && editedFiles.includes(panelHover);

  return (
    <div
      className={[
        workNodeChromeClass(accent, selected, isRunning),
        isHoveredFromPanel
          ? "outline outline-2 outline-offset-2 outline-blue-400"
          : "",
      ]
        .filter(Boolean)
        .join(" ")}
      style={{ width: WF_NODE_SIZE.tool_call.width }}
      data-testid={`worknode-tool_call-${n.id}`}
      data-worknode-kind="tool_call"
      data-running={isRunning ? "true" : "false"}
      data-cross-highlighted={isHoveredFromPanel ? "true" : "false"}
      onMouseEnter={() => {
        if (editedFiles.length > 0) setHover(editedFiles[0]);
      }}
      onMouseLeave={() => {
        if (editedFiles.length > 0) setHover(null);
      }}
      onClick={() => {
        if (editedFiles.length === 0) return;
        // Set focus → Git panel auto-expands + scrolls to that file.
        // Also auto-switch DrillPanel to git tab so user sees it.
        setFocus(editedFiles[0]);
        setTab("git");
        // Reset focus after a short window so subsequent hovers
        // don't keep triggering the auto-expand.
        window.setTimeout(() => setFocus(null), 50);
      }}
    >
      <Handle
        type="target"
        position={Position.Left}
        isConnectable={false}
        style={handleStyle(data.hasIncomingEdge)}
      />
      <div className="flex items-center gap-1 mb-1">
        <span className="text-amber-500">🔧</span>
        <span className="text-[11px] font-semibold text-gray-900 truncate">
          {n.toolName}
        </span>
        {failed && (
          <span className="ml-auto text-rose-600 font-bold" title="failed">
            ✗
          </span>
        )}
      </div>
      {inputLines.length > 0 && (
        <ul className="text-[10px] text-gray-700 font-mono space-y-0.5">
          {inputLines.map((line, i) => (
            <li key={i} className="truncate" title={line}>
              {line}
            </li>
          ))}
        </ul>
      )}
      {resultPreview && (
        <div className="mt-1 pt-1 border-t border-gray-200/60 text-[10px] text-gray-600">
          <span className={failed ? "text-rose-600" : "text-gray-500"}>
            {failed ? "✗" : "✓"}
          </span>{" "}
          <span className="break-words line-clamp-2">{resultPreview}</span>
        </div>
      )}
      <NodeIdLine nodeId={n.id} />
      <Handle
        type="source"
        position={Position.Right}
        isConnectable={false}
        style={handleStyle(data.hasOutgoingEdge)}
      />
    </div>
  );
}
