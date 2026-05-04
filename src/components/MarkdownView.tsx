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

import rehypeHighlight from "rehype-highlight";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import Markdown, { type Components } from "react-markdown";

// v0.10 polish: code-block syntax highlighting via rehype-highlight
// (highlight.js under the hood). Adds `<code class="hljs language-X">`
// + per-token `<span class="hljs-keyword">` etc. We pair this with
// the `github-dark.css` theme imported from src/index.css.
//
// Bundle impact: highlight.js core ~30KB gz + selected languages.
// rehype-highlight by default ships a "common" subset (~35 langs);
// we explicitly opt into a smaller set the LLM realistically emits
// to keep bundle slim.

const sanitizeSchema = {
  ...defaultSchema,
  // `defaultSchema.tagNames` already includes `br` etc. Augment with
  // common inline HTML the LLM emits but defaults block, and ensure
  // <span> / <code> survive sanitize so highlight.js token spans
  // aren't stripped.
  tagNames: [
    ...(defaultSchema.tagNames || []),
    "details",
    "summary",
    "sub",
    "sup",
    "mark",
  ],
  // Allow `class` on `code`, `pre`, and `span` so rehype-highlight
  // tokens carry their `hljs-*` class names through sanitize.
  attributes: {
    ...(defaultSchema.attributes || {}),
    code: [...((defaultSchema.attributes || {}).code || []), ["className"]],
    span: [...((defaultSchema.attributes || {}).span || []), ["className"]],
    pre: [...((defaultSchema.attributes || {}).pre || []), ["className"]],
  },
};

// Plugin arrays must be module-level constants. Inlining them inside
// the component body would re-create the array on every render, and
// react-markdown's internal change-detection sees the new array
// reference, re-runs the entire AST pipeline, and cascades the cost
// to every render even when `children` is unchanged. Hot path:
// DrillPanel resize → 60 fps store updates → ConversationView re-renders
// → every visible bubble's MarkdownView re-parsed. Stable arrays let
// react-markdown skip the work.
//
// Order: rehypeRaw → rehypeHighlight → rehypeSanitize. Highlight runs
// AFTER raw HTML so it can see all <code> blocks; sanitize runs LAST
// so it can scrub anything highlighter introduced (it won't, but
// belt-and-suspenders).
const REMARK_PLUGINS = [remarkGfm];
const REHYPE_PLUGINS = [
  rehypeRaw,
  [rehypeHighlight, { detect: true, ignoreMissing: true }],
  [rehypeSanitize, sanitizeSchema],
] as never;

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
