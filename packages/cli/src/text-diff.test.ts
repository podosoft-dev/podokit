import { describe, expect, it } from "vitest";
import { unifiedDiff } from "./text-diff";

const labels = { fromLabel: "a/file.ts", toLabel: "b/file.ts" };

describe("unifiedDiff", () => {
  it("returns nothing for equal text", () => {
    expect(unifiedDiff("a\nb\n", "a\nb\n", labels)).toBe("");
  });

  it("shows a changed line with three lines of context", () => {
    const from = ["1", "2", "3", "4", "5", "6", "7", "8"].join("\n") + "\n";
    const to = ["1", "2", "3", "4", "five", "6", "7", "8"].join("\n") + "\n";
    expect(unifiedDiff(from, to, labels)).toBe(
      [
        "--- a/file.ts",
        "+++ b/file.ts",
        "@@ -2,7 +2,7 @@",
        " 2",
        " 3",
        " 4",
        "-5",
        "+five",
        " 6",
        " 7",
        " 8",
        "",
      ].join("\n"),
    );
  });

  it("splits distant changes into separate hunks", () => {
    const lines = Array.from({ length: 20 }, (_, index) => `line ${index + 1}`);
    const changed = [...lines];
    changed[1] = "second";
    changed[17] = "eighteenth";
    const diff = unifiedDiff(`${lines.join("\n")}\n`, `${changed.join("\n")}\n`, labels);
    expect(diff.match(/^@@ /gm)).toHaveLength(2);
    expect(diff).toContain("@@ -1,5 +1,5 @@\n line 1\n-line 2\n+second\n");
    expect(diff).toContain("@@ -15,6 +15,6 @@\n line 15\n line 16\n line 17\n-line 18\n+eighteenth\n");
  });

  it("reports added lines at the end of the file", () => {
    expect(unifiedDiff("a\n", "a\nb\nc\n", labels)).toBe(
      "--- a/file.ts\n+++ b/file.ts\n@@ -1 +1,3 @@\n a\n+b\n+c\n",
    );
  });

  it("reports a file that only gained a trailing newline", () => {
    const diff = unifiedDiff("a", "a\n", labels);
    expect(diff).toContain("the template has no newline at end of file");
    expect(diff).toContain("the file ends with a newline");
  });
});
