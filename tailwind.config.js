/** @type {import('tailwindcss').Config} */
import typography from "@tailwindcss/typography";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {},
  },
  // `prose prose-sm` is already used in ConversationView + ChatNodeDetail;
  // without this plugin those classes are no-ops and markdown rendered
  // through MarkdownView falls back to bare-tag styling (no table
  // borders, no inline-code chip background, cramped line-height). The
  // theme.extend.typography fine-tuning to bring density in line with
  // Loomscope's overall compact layout is a follow-up — see
  // handoff-v0.8.1-polish-batch.md milestone M3 / M4 typography polish.
  plugins: [typography],
};
