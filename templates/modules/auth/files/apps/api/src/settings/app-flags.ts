// This owned file is never overwritten by `podo update`. Declare the
// application's on/off settings and their defaults here. They are stored with
// PodoKit's feature flags in app_setting: administrators change them through
// PUT /account/settings, the API reads them with SettingsService.getBool(), and
// GET /account/capabilities returns them as `appFlags`, so do not put anything
// secret in a name. A missing row keeps the default. For example:
//
//   export const APP_FLAG_DEFAULTS = { reportsEnabled: true } satisfies Record<string, boolean>;
export const APP_FLAG_DEFAULTS = {} satisfies Record<string, boolean>;
