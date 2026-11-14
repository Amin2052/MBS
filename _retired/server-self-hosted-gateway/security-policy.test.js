const assert = require("node:assert/strict");
const {
  isAllowedRole,
  isBodyWithinLimit,
  requireAuthenticatedUser,
} = require("./security-policy");

assert.equal(isAllowedRole("owner"), true);
assert.equal(isAllowedRole("admin"), true);
assert.equal(isAllowedRole("employee"), true);
assert.equal(isAllowedRole("superuser"), false);
assert.equal(isBodyWithinLimit(1024), true);
assert.equal(isBodyWithinLimit(3 * 1024 * 1024), false);
assert.equal(requireAuthenticatedUser({ id: "u1", role: "admin" }).role, "admin");
assert.throws(() => requireAuthenticatedUser(null), /Authentication required/);
console.log("MBS security policy: PASS");
