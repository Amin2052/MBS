const assert = require("node:assert/strict");
const { hasMbsPermission } = require("./role-permission-policy");

assert.equal(hasMbsPermission("owner", "database.delete"), true);
assert.equal(hasMbsPermission("admin", "database.delete"), true);
assert.equal(hasMbsPermission("employee", "database.delete"), false);
assert.equal(hasMbsPermission("owner", "users.delete"), true);
assert.equal(hasMbsPermission("admin", "users.delete"), false);
assert.equal(hasMbsPermission("employee", "users.view"), false);
assert.equal(hasMbsPermission("employee", "messages.add"), true);
console.log("MBS role permission policy: PASS");
