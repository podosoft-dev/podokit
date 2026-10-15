import { describe, expect, it } from "bun:test";
import { uploadAccess, uploadKey } from "./upload-keys";

const id = "0b5f6b7e-8c1d-4d6e-9f00-112233445566";

describe("uploadKey", () => {
  it("places a signed-in user's upload under their id", () => {
    expect(uploadKey("user_1", "my photo.png", id)).toBe(`uploads/user_1/${id}-my_photo.png`);
  });

  it("keeps the unowned format when there is no signed-in user", () => {
    expect(uploadKey(undefined, "a.txt", id)).toBe(`uploads/${id}-a.txt`);
  });

  it("keeps file names to one bounded segment", () => {
    expect(uploadKey("u", "../../etc/passwd", id)).toBe(`uploads/u/${id}-.._.._etc_passwd`);
    expect(uploadKey("u", `${"x".repeat(300)}.png`, id)).toBe(`uploads/u/${id}-${"x".repeat(124)}.png`);
  });

  it("refuses a user id that is not a safe key segment", () => {
    expect(() => uploadKey("../admin", "a.txt", id)).toThrow("upload key segment");
  });
});

describe("uploadAccess", () => {
  const owner = { userId: "user_1", admin: false };
  const other = { userId: "user_2", admin: false };
  const admin = { userId: "admin_1", admin: true };
  const anonymous = { userId: undefined, admin: false };

  it("lets owners and administrators read owned uploads", () => {
    const key = `uploads/user_1/${id}-a.txt`;
    expect(uploadAccess(key, owner)).toBe("allowed");
    expect(uploadAccess(key, admin)).toBe("allowed");
    expect(uploadAccess(key, other)).toBe("forbidden");
    expect(uploadAccess(key, anonymous)).toBe("forbidden");
  });

  it("keeps unowned uploads from signed-in users who are not administrators", () => {
    const key = `uploads/${id}-a.txt`;
    expect(uploadAccess(key, owner)).toBe("forbidden");
    expect(uploadAccess(key, admin)).toBe("allowed");
    expect(uploadAccess(key, anonymous)).toBe("allowed");
  });

  it("does not presign keys owned by other features", () => {
    for (const key of [
      "site/favicon",
      "profile-images/a.png",
      "demo/hello",
      "uploads/",
      "uploads/user_1/",
      "uploads/../site/favicon",
      "uploads/user_1/../user_2/a.txt",
      "uploads/user_1/nested/a.txt",
    ]) {
      expect(uploadAccess(key, admin)).toBe("not-found");
    }
  });
});
