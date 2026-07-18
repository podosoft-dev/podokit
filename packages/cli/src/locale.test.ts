import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  addLocale,
  listLocales,
  normalizeLocaleCode,
  setLocaleEnabled,
  validateLocale,
} from "./locale";

const created: string[] = [];

function temporaryProject(): string {
  const root = mkdtempSync(join(tmpdir(), "podokit-locale-"));
  created.push(root);
  write(root, "apps/web/src/lib/i18n/locales/en.json", {
    code: "en",
    name: "English",
    direction: "ltr",
    enabled: true,
  });
  write(root, "apps/web/src/lib/i18n/catalogs/core/en.json", {
    common: { greeting: "Hello {name}", save: "Save" },
  });
  write(root, "apps/web/src/lib/i18n/catalogs/app/en.json", {
    common: { save: "Save changes" },
  });
  return root;
}

function write(root: string, relativePath: string, value: unknown): void {
  const path = join(root, relativePath);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

afterEach(() => {
  for (const root of created.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("locale automation", () => {
  it("normalizes BCP 47 locale codes", () => {
    expect(normalizeLocaleCode("pt-br")).toBe("pt-BR");
    expect(() => normalizeLocaleCode("not_a_locale")).toThrow("Invalid locale code");
  });

  it("adds an inactive locale without overwriting existing files", () => {
    const root = temporaryProject();
    const definition = addLocale(root, "pt-br", { name: "Português", direction: "ltr" });

    expect(definition).toEqual({
      code: "pt-BR",
      name: "Português",
      direction: "ltr",
      enabled: false,
    });
    expect(listLocales(root).map((locale) => locale.code)).toEqual(["en", "pt-BR"]);
    expect(readFileSync(join(root, "apps/web/src/lib/i18n/catalogs/app/pt-BR.json"), "utf8")).toBe("{}\n");
    expect(() => addLocale(root, "pt-BR")).toThrow("already exists");
  });

  it("reports partial coverage and permits activation with fallback", () => {
    const root = temporaryProject();
    addLocale(root, "ko", { name: "한국어" });
    write(root, "apps/web/src/lib/i18n/catalogs/app/ko.json", {
      common: { greeting: "안녕하세요 {name}" },
    });

    const coverage = validateLocale(root, "ko");
    expect(coverage).toMatchObject({ translated: 1, total: 2, percent: 50 });
    expect(coverage.missing).toEqual(["common.save"]);
    expect(setLocaleEnabled(root, "ko", true).definition.enabled).toBe(true);
  });

  it("rejects translations that remove placeholders", () => {
    const root = temporaryProject();
    addLocale(root, "ko", { name: "한국어" });
    write(root, "apps/web/src/lib/i18n/catalogs/app/ko.json", {
      common: { greeting: "안녕하세요", save: "저장" },
    });

    expect(() => validateLocale(root, "ko")).toThrow("must preserve placeholders name");
  });

  it("validates nested array entries and their placeholders", () => {
    const root = temporaryProject();
    write(root, "apps/web/src/lib/i18n/catalogs/core/en.json", {
      common: {
        greeting: "Hello {name}",
        save: "Save",
        optional: "",
        steps: [{ title: "Welcome {name}" }, { title: "Continue" }],
      },
    });
    addLocale(root, "ko", { name: "한국어" });
    write(root, "apps/web/src/lib/i18n/catalogs/app/ko.json", {
      common: {
        greeting: "안녕하세요 {name}",
        save: "저장",
        steps: [{ title: "환영합니다 {name}" }],
      },
    });

    const coverage = validateLocale(root, "ko");
    expect(coverage).toMatchObject({ translated: 3, total: 4, percent: 75 });
    expect(coverage.missing).toEqual(["common.steps[1].title"]);
  });

  it("keeps the English fallback active", () => {
    const root = temporaryProject();
    expect(() => setLocaleEnabled(root, "en", false)).toThrow("cannot be deactivated");
  });
});
