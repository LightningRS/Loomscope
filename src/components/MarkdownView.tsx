/**
 * Shared markdown renderer with GFM tables + sanitised inline HTML.
 *
 * Direct port of Agentloom's `frontend/src/components/MarkdownView.tsx`
 * (see that file's doc comment for the full plugin choice rationale).
 * Same plugin set so the two projects render LLM output identically:
 *
 *   remark-gfm     — GFM tables, strikethrough, task lists, autolinks.
 *   rehype-raw     — parse raw HTML inside markdown so `<br>` line-breaks.
 *   rehype-sanitize — whitelist HTML elements; blocks `<script>`, etc.
 *
 * Plugin order matters: rehypeRaw → rehypeSanitize. Sanitize must run
 * AFTER raw HTML enters the tree, otherwise it can't see the nodes
 * to scrub.
 *
 * v0.4 use sites: drill panel surfaces only. Card previews stay plain
 * text — running the full markdown pipeline on 1500+ ChatNode cards
 * would cost more than it surfaces.
 */
import { memo } from "react";

import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import Markdown, { type Components } from "react-markdown";

const sanitizeSchema = {
  ...defaultSchema,
  // `defaultSchema.tagNames` already includes `br` etc. Augment with
  // common inline HTML the LLM emits but defaults block.
  tagNames: [
    ...(defaultSchema.tagNames || []),
    "details",
    "summary",
    "sub",
    "sup",
    "mark",
  ],
};

// Plugin arrays must be module-level constants. Inlining them inside
// the component body would re-create the array on every render, and
// react-markdown's internal change-detection sees the new array
// reference, re-runs the entire AST pipeline, and cascades the cost
// to every render even when `children` is unchanged. Hot path:
// DrillPanel resize → 60 fps store updates → ConversationView re-renders
// → every visible bubble's MarkdownView re-parsed. Stable arrays let
// react-markdown skip the work.
const REMARK_PLUGINS = [remarkGfm];
const REHYPE_PLUGINS = [rehypeRaw, [rehypeSanitize, sanitizeSchema]] as never;

interface Props {
  children: string;
  components?: Components;
  className?: string;
}

function MarkdownViewImpl({ children, components, className }: Props) {
  return (
    <div className={className}>
      <Markdown
        remarkPlugins={REMARK_PLUGINS}
        rehypePlugins={REHYPE_PLUGINS}
        components={components}
      >
        {children}
      </Markdown>
    </div>
  );
}

// Wrap in React.memo so that conversation-bubble parents that re-render
// for non-content reasons (DrillPanel width change during resize-drag,
// selectedNodeId flip, etc.) don't force the markdown pipeline to
// re-parse every visible message. Default shallow compare is correct:
// children is a string (cheap to compare by ref + value), components
// and className are typically stable.
export const MarkdownView = memo(MarkdownViewImpl);
