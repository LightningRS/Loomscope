// @vitest-environment happy-dom
//
// HookOnboardingModal v0.11 — first-launch banner that no longer
// patches anything itself; it only redirects the user to Settings →
// Hooks via the `loomscope:open-settings` window event.

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { HookOnboardingModal } from "./HookOnboardingModal";

import "@/i18n";

const mockStatus = {
  settingsPath: "/home/test/.claude/settings.json",
  settingsExists: false,
  configured: [],
  missing: [
    "PreToolUse",
    "PostToolUse",
    "SubagentStart",
    "SubagentStop",
    "PreCompact",
    "PostCompact",
    "TaskCompleted",
    "SessionStart",
    "SessionEnd",
    "PermissionRequest",
    "PermissionDenied",
  ],
  malformed: false,
  shellRcSnippet: "export LOOMSCOPE_SECRET=abc",
  pasteableJson: "{}",
};

beforeEach(() => {
  // Reset dismissed flag so the banner shows up.
  localStorage.removeItem("loomscope:hook-onboarding-dismissed");
  vi.spyOn(global, "fetch").mockImplementation(async () => {
    return new Response(JSON.stringify(mockStatus), { status: 200 });
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe("HookOnboardingModal", () => {
  it("renders when status.missing.length > 0", async () => {
    render(<HookOnboardingModal />);
    await waitFor(() =>
      expect(screen.getByTestId("hook-onboarding-modal")).toBeTruthy(),
    );
  });

  it("dismiss writes localStorage flag + closes the modal", async () => {
    render(<HookOnboardingModal />);
    await waitFor(() =>
      expect(screen.getByTestId("hook-onboarding-modal")).toBeTruthy(),
    );
    fireEvent.click(screen.getByTestId("dismiss-onboarding"));
    expect(
      localStorage.getItem("loomscope:hook-onboarding-dismissed"),
    ).toBe("true");
    expect(screen.queryByTestId("hook-onboarding-modal")).toBeNull();
  });

  it("'Open settings' button dispatches `loomscope:open-settings` + closes (does NOT patch settings)", async () => {
    const onOpenSettings = vi.fn();
    window.addEventListener("loomscope:open-settings", onOpenSettings);
    try {
      render(<HookOnboardingModal />);
      await waitFor(() =>
        expect(
          screen.getByTestId("open-settings-from-onboarding"),
        ).toBeTruthy(),
      );
      fireEvent.click(screen.getByTestId("open-settings-from-onboarding"));
      expect(onOpenSettings).toHaveBeenCalledTimes(1);
      // Onboarding modal closes.
      expect(screen.queryByTestId("hook-onboarding-modal")).toBeNull();
      // Did NOT write the dismissed flag — this isn't a brush-off, it's
      // a redirect; if the user closes Settings without configuring,
      // the banner re-appears next reload.
      expect(
        localStorage.getItem("loomscope:hook-onboarding-dismissed"),
      ).toBeNull();
    } finally {
      window.removeEventListener("loomscope:open-settings", onOpenSettings);
    }
  });
});
