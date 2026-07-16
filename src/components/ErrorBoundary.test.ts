import { describe, it, expect, vi } from "vitest";
import type { ReactNode } from "react";
import ErrorBoundary from "./ErrorBoundary";

/**
 * fix/global-error-boundary
 *
 * No jsdom/testing-library in this project (see LoginPage.test.ts /
 * AdminPanel.test.ts for the same situation), so this doesn't render into a
 * DOM. It doesn't need to: React class components are plain objects, and
 * calling getDerivedStateFromError / componentDidCatch / render directly —
 * without ever mounting — exercises the exact same logic a real thrown
 * error would trigger, since JSX just builds plain element descriptor
 * objects (React.createElement output), not DOM nodes.
 */

type AnyNode = any;

function collectText(node: AnyNode, acc: string[] = []): string[] {
  if (node === null || node === undefined || typeof node === "boolean") return acc;
  if (typeof node === "string" || typeof node === "number") {
    acc.push(String(node));
    return acc;
  }
  if (Array.isArray(node)) {
    node.forEach((child) => collectText(child, acc));
    return acc;
  }
  if (typeof node === "object" && "props" in node) {
    collectText(node.props?.children, acc);
  }
  return acc;
}

function findByType(node: AnyNode, type: string): AnyNode | null {
  if (node === null || node === undefined || typeof node !== "object") return null;
  if (node.type === type) return node;
  const children = node.props?.children;
  if (Array.isArray(children)) {
    for (const child of children) {
      const found = findByType(child, type);
      if (found) return found;
    }
    return null;
  }
  return findByType(children, type);
}

describe("ErrorBoundary.getDerivedStateFromError", () => {
  it("flips to the error state for any thrown error, regardless of what was thrown", () => {
    expect(ErrorBoundary.getDerivedStateFromError()).toEqual({ hasError: true });
  });
});

describe("ErrorBoundary — no error", () => {
  it("starts in the non-error state", () => {
    const instance = new ErrorBoundary({ children: "the app" as unknown as ReactNode });
    expect(instance.state).toEqual({ hasError: false });
  });

  it("renders children unchanged, preserving existing behavior when no error occurs", () => {
    const children = "the app" as unknown as ReactNode;
    const instance = new ErrorBoundary({ children });
    expect(instance.render()).toBe(children);
  });
});

describe("ErrorBoundary — error state fallback UI", () => {
  it("renders the required heading and reload button text, nothing else business-specific", () => {
    const instance = new ErrorBoundary({ children: "the app" as unknown as ReactNode });
    instance.state = { hasError: true };
    const texts = collectText(instance.render());
    expect(texts).toContain("Something went wrong.");
    expect(texts).toContain("Reload Application");
  });

  it("wires the reload button's onClick to the boundary's own reload handler", () => {
    const instance = new ErrorBoundary({ children: null });
    instance.state = { hasError: true };
    const button = findByType(instance.render(), "button");
    expect(button).not.toBeNull();
    expect(button.props.onClick).toBe(instance.handleReload);
  });

  it("does not render the app's children while in the error state", () => {
    const children = "the app" as unknown as ReactNode;
    const instance = new ErrorBoundary({ children });
    instance.state = { hasError: true };
    const texts = collectText(instance.render());
    expect(texts).not.toContain("the app");
  });
});

describe("ErrorBoundary — logging and reload behavior", () => {
  it("componentDidCatch logs the error instead of throwing or silently swallowing it", () => {
    const instance = new ErrorBoundary({ children: null });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const thrown = new Error("boom");
    expect(() => instance.componentDidCatch(thrown, { componentStack: "" })).not.toThrow();
    expect(spy).toHaveBeenCalledWith("Uncaught application error:", thrown, { componentStack: "" });
    spy.mockRestore();
  });

  it("reloads the page via window.location.reload when triggered", () => {
    const reload = vi.fn();
    (globalThis as any).window = { location: { reload } };
    try {
      const instance = new ErrorBoundary({ children: null });
      instance.handleReload();
      expect(reload).toHaveBeenCalledTimes(1);
    } finally {
      delete (globalThis as any).window;
    }
  });
});
