import { describe, expect, it, mock } from "bun:test";
import { processProgress, progressEvent, progressPayload } from "./progress.processor";

describe("progress processor", () => {
  it("publishes provider-neutral progress updates", async () => {
    const values: number[] = [];
    const publish = mock(async (value: number): Promise<void> => { values.push(value); });
    const delay = mock(async (): Promise<void> => undefined);
    await expect(processProgress({ steps: 4 }, publish, delay)).resolves.toEqual({ done: true });
    expect(values).toEqual([25, 50, 75, 100]);
    expect(delay).toHaveBeenCalledTimes(4);
  });

  it("reads the owner from the job payload", () => {
    expect(progressPayload({ steps: 2, ownerId: "alice" })).toEqual({ steps: 2, ownerId: "alice" });
    expect(progressPayload({ ownerId: "" })).toEqual({});
    expect(progressPayload({ ownerId: 7 })).toEqual({});
    expect(progressPayload(null)).toEqual({});
  });

  it("addresses progress events to the owner", () => {
    expect(progressEvent("job-1", "alice", 40)).toEqual({
      topic: "job-progress",
      audience: { userIds: ["alice"] },
      data: { jobId: "job-1", progress: 40 },
    });
  });
});
