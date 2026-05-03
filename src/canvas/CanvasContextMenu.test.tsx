// v0.6 M5 — CanvasContextMenu unit tests.

import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { CanvasContextMenu } from "@/canvas/CanvasContextMenu";

describe("CanvasContextMenu", () => {
  it("renders Focus + Copy id menu items + the node id as data attribute", () => {
    const onFocus = vi.fn();
    const onClose = vi.fn();
    render(
      <CanvasContextMenu
        x={100}
        y={200}
        nodeId="test-node-id"
        onFocus={onFocus}
        onClose={onClose}
      />,
    );
    const menu = screen.getByTestId("canvas-context-menu");
    expect(menu.dataset.nodeId).toBe("test-node-id");
    expect(screen.getByTestId("ctx-focus")).toBeTruthy();
    expect(screen.getByTestId("ctx-copy-id")).toBeTruthy();
  });

  it("Focus item invokes onFocus(nodeId) then closes the menu", () => {
    const onFocus = vi.fn();
    const onClose = vi.fn();
    render(
      <CanvasContextMenu
        x={100}
        y={200}
        nodeId="my-id"
        onFocus={onFocus}
        onClose={onClose}
      />,
    );
    fireEvent.click(screen.getByTestId("ctx-focus"));
    expect(onFocus).toHaveBeenCalledWith("my-id");
    expect(onClose).toHaveBeenCalled();
  });

  it("Escape key closes the menu", () => {
    const onClose = vi.fn();
    render(
      <CanvasContextMenu
        x={0}
        y={0}
        nodeId="x"
        onFocus={() => {}}
        onClose={onClose}
      />,
    );
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("clicking outside the menu closes it", () => {
    const onClose = vi.fn();
    const { container } = render(
      <div>
        <div data-testid="outside">click outside</div>
        <CanvasContextMenu
          x={0}
          y={0}
          nodeId="x"
          onFocus={() => {}}
          onClose={onClose}
        />
      </div>,
    );
    fireEvent.mouseDown(screen.getByTestId("outside"));
    expect(onClose).toHaveBeenCalled();
    expect(container).toBeTruthy();
  });

  it("positions at (x, y) via inline style", () => {
    render(
      <CanvasContextMenu
        x={123}
        y={456}
        nodeId="x"
        onFocus={() => {}}
        onClose={() => {}}
      />,
    );
    const menu = screen.getByTestId("canvas-context-menu");
    expect(menu.style.left).toBe("123px");
    expect(menu.style.top).toBe("456px");
  });
});
