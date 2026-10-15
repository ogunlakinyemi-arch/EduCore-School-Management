// Loaded in the test app, never in the normal preview or the setup/build tools.
const net = require("node:net");
const socket = `${process.env.EDUCORE_TERMINAL_TEST_DB_HOST}/.s.PGSQL.${process.env.EDUCORE_TERMINAL_TEST_DB_PORT}`;
if (!socket.startsWith("/tmp/educore-terminal-test-nfc_hw_")) {
  throw new Error("Exact disposable hardware-test socket required");
}
const connect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
  let options = args[0];
  if (Array.isArray(options)) options = options[0];
  const path = typeof options === "string" ? options : options && options.path;
  if (path !== socket) throw new Error("Outbound network disabled for synthetic NFC testing");
  return connect.apply(this, args);
};
globalThis.fetch = async () => { throw new Error("Outbound fetch disabled for synthetic NFC testing"); };
for (const name of ["node:http", "node:https"]) {
  const api = require(name);
  api.request = api.get = () => { throw new Error("Outbound HTTP disabled for synthetic NFC testing"); };
}
