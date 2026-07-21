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
