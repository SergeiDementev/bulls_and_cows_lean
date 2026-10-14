import { describe, expect, it, vi } from "vitest";
import { createReporter, MAX_REPORTS } from "./report.ts";

describe("error reports", () => {
  it("send the message, stack and current screen", () => {
    const send = vi.fn(async () => undefined);
    const reporter = createReporter(send);
    reporter.setScreen("game");
    const error = new Error("boom");
    reporter.report(error);
    expect(send).toHaveBeenCalledWith({ message: "boom", stack: error.stack, screen: "game" });
  });

  it("accept things that are not errors", () => {
    const send = vi.fn(async () => undefined);
    createReporter(send).report("plain text");
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ message: "plain text" }));
  });

  it("stop after a few, so a broken page cannot flood the log", () => {
    const send = vi.fn(async () => undefined);
    const reporter = createReporter(send);
    for (let i = 0; i < MAX_REPORTS + 3; i++) reporter.report(new Error(`e${i}`));
    expect(send).toHaveBeenCalledTimes(MAX_REPORTS);
  });

  it("never fail themselves", async () => {
    const send = vi.fn(async () => Promise.reject(new Error("offline")));
    expect(() => createReporter(send).report(new Error("boom"))).not.toThrow();
  });
});
