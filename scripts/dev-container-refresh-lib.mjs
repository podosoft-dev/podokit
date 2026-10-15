export function planRefreshModules(installedModules, addFlag = "") {
  const externalModules = installedModules
    .filter((module) => typeof module.packageName === "string" && module.packageName.length > 0)
    .map((module) => ({
      name: module.name,
      packageName: module.packageName,
      moduleVersion: typeof module.moduleVersion === "string" ? module.moduleVersion : undefined,
    }));
  const externalNames = new Set(externalModules.map((module) => module.name));
  const bundledModules = [];

  for (const module of installedModules) {
    if (!externalNames.has(module.name) && !bundledModules.includes(module.name)) {
      bundledModules.push(module.name);
    }
  }
  for (const module of addFlag.split(",").map((value) => value.trim()).filter(Boolean)) {
    if (!externalNames.has(module) && !bundledModules.includes(module)) {
      bundledModules.push(module);
    }
  }

  return { bundledModules, externalModules };
}

export function externalPackageSpec(module) {
  return module.moduleVersion ? `${module.packageName}@${module.moduleVersion}` : module.packageName;
}

export function refreshHost(corsOrigin, fallback = "app.localhost") {
  const firstOrigin = corsOrigin.split(",")[0]?.trim();
  if (!firstOrigin) return fallback;

  try {
    return new URL(firstOrigin).host || fallback;
  } catch {
    return firstOrigin.replace(/^https?:\/\//, "").trim() || fallback;
  }
}

/**
 * The app's previous .podokit/dev.json plus the direct API paths that `podo add`
 * wrote into the regenerated one, so restoring instance config keeps them.
 */
export function restoreDevConfig(previousText, regeneratedText) {
  const previous = JSON.parse(previousText);
  const regenerated = JSON.parse(regeneratedText);
  const base = (path) => path.replace(/\/$/, "");
  const current = Array.isArray(previous.apiPaths) ? previous.apiPaths : [];
  const added = (Array.isArray(regenerated.apiPaths) ? regenerated.apiPaths : []).filter(
    (path) => !current.some((entry) => base(path) === base(entry) || base(path).startsWith(`${base(entry)}/`)),
  );
  if (added.length === 0) return previousText;
  previous.apiPaths = [...current, ...added];
  return `${JSON.stringify(previous, null, 2)}\n`;
}
