// attachment WorkNode card. Minimal chrome — kind label + best-effort
// content snippet (filename for file/compact_file_reference, prompt
// for queued_command, etc.).
//
// Rich per-subtype rendering (image thumbnail, syntax-highlighted code
// preview, large text expand) is deferred — design-visual-language.md
// has it as ``[TODO 你回答 — UI 草图]``. v0.3 ships generic chrome so
// the WorkFlow at least has *something* visible for attachments;
// detailed UX lands as part of v0.4 drill panel work.

import { Handle, Position } from "@xyflow/react";
import type { NodeProps } from "@xyflow/react";

import {
  WF_NODE_SIZE,
  attachmentLabel,
  type AttachmentRFNode,
} from "@/canvas/layoutWorkflow";
import { useIsWorkNodeSelected } from "@/store/selectionHooks";
import { handleStyle, workNodeChromeClass } from "./cardChrome";

const ICON_BY_KIND: Record<string, string> = {
  file: "📄",
  edited_text_file: "📝",
  queued_command: "⏳",
  compact_file_reference: "📄",
  invoked_skills: "✨",
  skill_listing: "📋",
};

export function AttachmentCard({ id, data }: NodeProps<AttachmentRFNode>) {
  const n = data.workNode;
  const icon = ICON_BY_KIND[n.attachmentType] ?? "📎";
  const label = attachmentLabel(n);
  // compact_file_reference flag — design-visual-language says we should
  // mark these explicitly because the original content is no longer in
  // the jsonl.
  const isCompacted = n.attachmentType === "compact_file_reference";
  const selected = useIsWorkNodeSelected(id);

  return (
    <div
      className={workNodeChromeClass("gray", selected)}
      style={{ width: WF_NODE_SIZE.attachment.width }}
      data-testid={`worknode-attachment-${n.id}`}
      data-worknode-kind="attachment"
      data-attachment-type={n.attachmentType}
    >
      <Handle
        type="target"
        position={Position.Left}
        isConnectable={false}
        style={handleStyle(data.hasIncomingEdge)}
      />
      <div className="flex items-center gap-1 mb-0.5">
        <span>{icon}</span>
        <span className="text-[10px] text-gray-500">{n.attachmentType}</span>
      </div>
      <div className="text-[11px] text-gray-900 break-words line-clamp-2 font-mono">
        {label}
      </div>
      {isCompacted && (
        <div className="mt-0.5 text-[9px] text-gray-400" title="原文不在 jsonl 中">
          ⊠ content compacted
        </div>
      )}
      <Handle
        type="source"
        position={Position.Right}
        isConnectable={false}
        style={handleStyle(data.hasOutgoingEdge)}
      />
    </div>
  );
}
