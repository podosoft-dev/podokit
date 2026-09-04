import { describe, expect, it, mock } from "bun:test";
import { processProgress } from "./progress.processor";

describe("progress processor", () => {
  it("publishes provider-neutral progress updates", async () => {
    const values: number[] = [];
    const publish = mock(async (value: number): Promise<void> => { values.push(value); });
    const delay = mock(async (): Promise<void> => undefined);
    await expect(processProgress({ steps: 4 }, publish, delay)).resolves.toEqual({ done: true });
    expect(values).toEqual([25, 50, 75, 100]);
    expect(delay).toHaveBeenCalledTimes(4);
  });
});
