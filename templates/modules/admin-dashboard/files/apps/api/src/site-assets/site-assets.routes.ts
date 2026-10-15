import { AppException } from "@podosoft/podokit-contracts";
import { objectResponse } from "@podosoft/podokit-runtime";
import { Elysia, t } from "elysia";
import type { ElysiaPlugin } from "../core/services";
import type { ProfileImageService } from "../profile-image/profile-image.service";
import type { SiteSettingsService } from "../site-settings/site-settings.service";

export const IMMUTABLE_CACHE_CONTROL = "public, max-age=31536000, immutable";

/** Public images streamed from object storage with validators for 304 replies. */
export function siteAssetRoutes(
  site: Pick<SiteSettingsService, "getFavicon">,
  profileImages: Pick<ProfileImageService, "get">,
): ElysiaPlugin {
  return new Elysia({ name: "podokit.admin.site-assets" })
    .get("/site/favicon", async ({ request }) => {
      const icon = await site.getFavicon();
      if (!icon) throw new AppException("FAVICON_NOT_FOUND", "No favicon set", 404);
      return objectResponse(request, icon.object, { contentType: icon.contentType });
    }, {
      detail: { tags: ["site"], summary: "Get the site favicon" },
    })
    .get("/profile-images/:fileName", async ({ request, params }) => {
      const image = await profileImages.get(params.fileName);
      // Every upload gets a new random file name, so a name never changes content.
      return objectResponse(request, image.object, {
        contentType: image.contentType,
        cacheControl: IMMUTABLE_CACHE_CONTROL,
      });
    }, {
      params: t.Object({ fileName: t.String({ minLength: 1 }) }),
      detail: { tags: ["account"], summary: "Get a public profile image" },
    });
}
