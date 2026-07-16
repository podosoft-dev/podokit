import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  bootstrapAdmin,
  resolveBootstrapInput,
} from "../templates/modules/admin-dashboard/files/apps/api/scripts/bootstrap-admin.mjs";

const input = {
  email: "admin@example.com",
  password: "Podokit3e-Str0ng!pw",
  name: "Administrator",
};

function record(overrides = {}) {
  return {
    id: "user-1",
    email: input.email,
    role: "admin",
    emailVerified: true,
    signupApproved: true,
    passwordHash: "stored-hash",
    ...overrides,
  };
}

describe("initial administrator bootstrap", () => {
  it("requires the bootstrap email to be listed in ADMIN_EMAILS", () => {
    assert.throws(
      () =>
        resolveBootstrapInput({
          ADMIN_EMAILS: "other@example.com",
          ADMIN_BOOTSTRAP_EMAIL: input.email,
          ADMIN_BOOTSTRAP_PASSWORD: input.password,
        }),
      /must be listed in ADMIN_EMAILS/,
    );
  });

  it("prints only a redacted plan during dry-run", async () => {
    const result = await bootstrapAdmin(
      {
        findUser: async () => null,
        createUser: async () => assert.fail("dry-run must not create a user"),
        verifyPassword: async () => false,
      },
      input,
      { dryRun: true },
    );

    assert.deepEqual(result, {
      status: "planned",
      action: "create",
      email: input.email,
      name: input.name,
      password: "<redacted>",
    });
    assert.doesNotMatch(JSON.stringify(result), new RegExp(input.password));
  });

  it("creates a verified and approved administrator once", async () => {
    let stored = null;
    let createCalls = 0;
    const result = await bootstrapAdmin(
      {
        findUser: async () => stored,
        createUser: async (user) => {
          createCalls += 1;
          assert.equal(user.role, "admin");
          assert.deepEqual(user.data, { emailVerified: true, signupApproved: true });
          stored = record();
        },
        verifyPassword: async (hash, password) =>
          hash === "stored-hash" && password === input.password,
      },
      input,
    );

    assert.deepEqual(result, { status: "created", email: input.email });
    assert.equal(createCalls, 1);
  });

  it("verifies an existing administrator without creating another account", async () => {
    let createCalls = 0;
    const result = await bootstrapAdmin(
      {
        findUser: async () => record(),
        createUser: async () => {
          createCalls += 1;
        },
        verifyPassword: async () => true,
      },
      input,
    );

    assert.deepEqual(result, { status: "existing", email: input.email });
    assert.equal(createCalls, 0);
  });

  it("never changes an existing account when the password is wrong", async () => {
    let createCalls = 0;
    await assert.rejects(
      bootstrapAdmin(
        {
          findUser: async () => record(),
          createUser: async () => {
            createCalls += 1;
          },
          verifyPassword: async () => false,
        },
        input,
      ),
      /supplied password does not match; no changes were made/,
    );
    assert.equal(createCalls, 0);
  });

  it("keeps check-only mode read-only when the account is absent", async () => {
    await assert.rejects(
      bootstrapAdmin(
        {
          findUser: async () => null,
          createUser: async () => assert.fail("check-only must not create a user"),
          verifyPassword: async () => false,
        },
        input,
        { checkOnly: true },
      ),
      /does not exist; no changes were made/,
    );
  });
});
