import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const ipc = vi.hoisted(() => ({
  debugResolveVariable: vi.fn(),
  debugVariables: vi.fn(),
}));

vi.mock("@/platform/ipc", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/platform/ipc")>();
  return { ...real, isTauri: () => true, commands: { ...real.commands, ...ipc } };
});

import type { DebugSessionId, Variable } from "@/platform/ipc";
import { VariablesView, type VarRoot } from "../ui/VariablesView";

const ok = <T,>(data: T) => Promise.resolve({ status: "ok" as const, data });

// A C array big enough that formatting all elements costs seconds in CodeLLDB.
const BIG: Variable = {
  name: "rows",
  value: "{...}",
  typeName: "result_row_t[8192]",
  variablesReference: 314,
  evaluateName: "res.rows",
};
const BIG_CHILDREN: Variable[] = [
  { name: "[0]", value: "{...}", typeName: "result_row_t", variablesReference: 0, evaluateName: "res.rows[0]" },
];

// The same shape, small enough to keep reloading every stop.
const SMALL: Variable = {
  ...BIG,
  name: "samples",
  typeName: "uint64_t[8]",
  variablesReference: 315,
  evaluateName: "rr.samples",
};

function setup(generation: number) {
  const roots: VarRoot[] = [
    { key: "rows", kind: "var", variable: BIG, container: 100 },
    { key: "samples", kind: "var", variable: SMALL, container: 100 },
  ];
  ipc.debugVariables.mockImplementation(() => ok(BIG_CHILDREN));
  const view = render(
    <VariablesView roots={roots} session={1 as DebugSessionId} generation={generation} aria-label="Variables" />,
  );
  return { view, tree: screen.getByRole("tree") };
}

const stop = (generation: number) => (
  <VariablesView
    roots={[
      { key: "rows", kind: "var", variable: BIG, container: 100 },
      { key: "samples", kind: "var", variable: SMALL, container: 100 },
    ]}
    session={1 as DebugSessionId}
    generation={generation}
    aria-label="Variables"
  />
);

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("huge collections", () => {
  it("loads a huge array when opened by hand, then does not fetch it again on the next stop", async () => {
    const { view, tree } = setup(1);
    tree.focus();
    fireEvent.keyDown(tree, { key: "Home" });
    fireEvent.keyDown(tree, { key: "ArrowRight" });
    await waitFor(() => expect(ipc.debugVariables).toHaveBeenCalledWith(1, 314));

    ipc.debugVariables.mockClear();
    view.rerender(stop(2));
    // Give the reload effect a turn; it must collapse the row instead of loading it.
    await new Promise((r) => setTimeout(r, 50));
    expect(ipc.debugVariables).not.toHaveBeenCalledWith(1, 314);
  });

  it("keeps reloading a small array on every stop", async () => {
    const { view, tree } = setup(1);
    tree.focus();
    fireEvent.keyDown(tree, { key: "Home" });
    fireEvent.keyDown(tree, { key: "ArrowDown" });
    fireEvent.keyDown(tree, { key: "ArrowRight" });
    await waitFor(() => expect(ipc.debugVariables).toHaveBeenCalledWith(1, 315));

    ipc.debugVariables.mockClear();
    view.rerender(stop(2));
    await waitFor(() => expect(ipc.debugVariables).toHaveBeenCalledWith(1, 315));
  });
});
