/** @type {import('tailwindcss').Config} */
import typography from "@tailwindcss/typography";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      // v0.8.1 #10: tighten the default `prose-sm` rhythm so markdown
      // in DrillPanel matches Loomscope's compact card density.
      // Calibrated against Agentloom's Conversation viewer — same
      // text size, but ~30-40% smaller margins / row gaps.
      typography: ({ theme }) => ({
        sm: {
          css: {
            // Paragraph / list / heading vertical rhythm tightened.
            "p, ul, ol, blockquote, pre, table": {
              marginTop: "0.5em",
              marginBottom: "0.5em",
            },
            "h1, h2, h3, h4": {
              marginTop: "1em",
              marginBottom: "0.4em",
            },
            li: {
              marginTop: "0.15em",
              marginBottom: "0.15em",
            },
            // Tighter line-height (typography defaults to ~leading-7).
            lineHeight: "1.55",
            // Inline code: subtler background, smaller font, and —
            // critically — `overflow-wrap: anywhere` so long tokens
            // (e.g. `userTier`) don't overflow the narrow DrillPanel.
            // Override typography default: without `overflow-wrap`
            // long tokens overflow the right edge of a narrow panel.
            // Re-verify on @tailwindcss/typography major upgrades.
            "code::before": { content: "''" },
            "code::after": { content: "''" },
            code: {
              backgroundColor: theme("colors.gray.100"),
              color: theme("colors.gray.800"),
              fontWeight: "500",
              fontSize: "0.85em",
              padding: "0.1em 0.3em",
              borderRadius: "0.25rem",
              overflowWrap: "anywhere",
              wordBreak: "break-word",
            },
            // Tables: half the default cell padding.
            "thead th": {
              paddingTop: "0.35em",
              paddingBottom: "0.35em",
              paddingLeft: "0.5em",
              paddingRight: "0.5em",
            },
            "tbody td, tfoot td": {
              paddingTop: "0.3em",
              paddingBottom: "0.3em",
              paddingLeft: "0.5em",
              paddingRight: "0.5em",
            },
          },
        },
      }),
    },
  },
  // `prose prose-sm` is already used in ConversationView + ChatNodeDetail;
  // without this plugin those classes are no-ops and markdown rendered
  // through MarkdownView falls back to bare-tag styling (no table
  // borders, no inline-code chip background, cramped line-height).
  plugins: [typography],
};
