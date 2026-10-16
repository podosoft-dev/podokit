/**
 * Line-based unified diff for `podo diff <path>`. It is dependency-free and
 * meant for source files of a few thousand lines; above `MAX_CELLS` it reports
 * the whole file as replaced instead of building the LCS table.
 */

const MAX_CELLS = 25_000_000;

type Op = { kind: " " | "-" | "+"; line: string };

function splitLines(text: string): string[] {
  if (text === "") return [];
  const lines = text.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
}

function operations(a: string[], b: string[]): Op[] {
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start += 1;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA -= 1;
    endB -= 1;
  }
  const head: Op[] = a.slice(0, start).map((line) => ({ kind: " ", line }));
  const tail: Op[] = a.slice(endA).map((line) => ({ kind: " ", line }));
  const midA = a.slice(start, endA);
  const midB = b.slice(start, endB);
  const m = midA.length;
  const n = midB.length;
  const middle: Op[] = [];
  if ((m + 1) * (n + 1) > MAX_CELLS) {
    middle.push(...midA.map((line): Op => ({ kind: "-", line })));
    middle.push(...midB.map((line): Op => ({ kind: "+", line })));
    return [...head, ...middle, ...tail];
  }
  const width = n + 1;
  const table = new Uint32Array((m + 1) * width);
  for (let i = m - 1; i >= 0; i -= 1) {
    for (let j = n - 1; j >= 0; j -= 1) {
      table[i * width + j] = midA[i] === midB[j]
        ? table[(i + 1) * width + j + 1]! + 1
        : Math.max(table[(i + 1) * width + j]!, table[i * width + j + 1]!);
    }
  }
  let i = 0;
  let j = 0;
  while (i < m || j < n) {
    if (i < m && j < n && midA[i] === midB[j]) {
      middle.push({ kind: " ", line: midA[i]! });
      i += 1;
      j += 1;
    } else if (i < m && (j === n || table[(i + 1) * width + j]! >= table[i * width + j + 1]!)) {
      middle.push({ kind: "-", line: midA[i]! });
      i += 1;
    } else {
      middle.push({ kind: "+", line: midB[j]! });
      j += 1;
    }
  }
  return [...head, ...middle, ...tail];
}

function range(start: number, count: number): string {
  if (count === 0) return `${start},0`;
  return count === 1 ? `${start + 1}` : `${start + 1},${count}`;
}

export interface UnifiedDiffOptions {
  fromLabel: string;
  toLabel: string;
  context?: number;
}

/** Unified diff from `from` to `to`, or an empty string when they are equal. */
export function unifiedDiff(from: string, to: string, options: UnifiedDiffOptions): string {
  if (from === to) return "";
  const context = options.context ?? 3;
  const ops = operations(splitLines(from), splitLines(to));
  const changed = ops.flatMap((op, index) => (op.kind === " " ? [] : [index]));
  const out = [`--- ${options.fromLabel}`, `+++ ${options.toLabel}`];
  if (!changed.length) {
    // Only the trailing newline differs.
    out.push(
      from.endsWith("\n") ? "\\ the template ends with a newline" : "\\ the template has no newline at end of file",
      to.endsWith("\n") ? "\\ the file ends with a newline" : "\\ the file has no newline at end of file",
    );
    return `${out.join("\n")}\n`;
  }

  let hunkStart = 0;
  while (hunkStart < changed.length) {
    let hunkEnd = hunkStart;
    while (
      hunkEnd + 1 < changed.length &&
      changed[hunkEnd + 1]! - changed[hunkEnd]! <= context * 2 + 1
    ) {
      hunkEnd += 1;
    }
    const first = Math.max(0, changed[hunkStart]! - context);
    const last = Math.min(ops.length - 1, changed[hunkEnd]! + context);
    let fromLine = 0;
    let toLine = 0;
    for (let index = 0; index < first; index += 1) {
      if (ops[index]!.kind !== "+") fromLine += 1;
      if (ops[index]!.kind !== "-") toLine += 1;
    }
    const body = ops.slice(first, last + 1);
    const fromCount = body.filter((op) => op.kind !== "+").length;
    const toCount = body.filter((op) => op.kind !== "-").length;
    out.push(`@@ -${range(fromLine, fromCount)} +${range(toLine, toCount)} @@`);
    out.push(...body.map((op) => `${op.kind}${op.line}`));
    hunkStart = hunkEnd + 1;
  }
  return `${out.join("\n")}\n`;
}
