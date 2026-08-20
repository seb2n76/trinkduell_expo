const test = require("node:test");
const assert = require("node:assert/strict");
const { startTestServer } = require("./helpers/server");

async function befriend(call, a, b) {
  await call("POST", "/friends/request", { receiver_username: b.name }, a.token);
  const accepted = await call("POST", "/friends/accept", { sender_username: a.name }, b.token);
  assert.equal(accepted.status, 200, "Freundschaft konnte nicht hergestellt werden");
}

test("Feed Reaktionen (Prost / Cheers)", async (t) => {
  const server = await startTestServer();
  t.after(() => server.stop());
  const { call, register } = server;

  await t.test("erlaubt das Hinzufügen und Entfernen (Toggle) von Reaktionen", async () => {
    const alice = await register("alice_react");
    const bob = await register("bob_react");
    await befriend(call, alice, bob);

    // Alice posts a status
    const postRes = await call(
      "POST",
      "/posts",
      { text: "Auf ein gutes Wochenende!", contextType: "friends", contextId: alice.id },
      alice.token
    );
    assert.equal(postRes.status, 201);
    const post = postRes.json;

    // Bob reacts with 'cheers'
    const react1 = await call("POST", `/feed/${post.id}/react`, { emoji: "cheers" }, bob.token);
    assert.equal(react1.status, 200);
    assert.deepEqual(react1.json.reactions.cheers, [bob.id]);

    // Feed reflects the reaction
    const feedRes = await call("GET", "/feed?scope=friends", undefined, alice.token);
    assert.equal(feedRes.status, 200);
    const feedItem = feedRes.json.find((item) => item.id === post.id);
    assert.ok(feedItem);
    assert.deepEqual(feedItem.reactions.cheers, [bob.id]);

    // Bob toggles reaction off
    const react2 = await call("POST", `/feed/${post.id}/react`, { emoji: "cheers" }, bob.token);
    assert.equal(react2.status, 200);
    assert.deepEqual(react2.json.reactions.cheers, []);

    // Feed reflects removal
    const feedRes2 = await call("GET", "/feed?scope=friends", undefined, alice.token);
    const feedItem2 = feedRes2.json.find((item) => item.id === post.id);
    assert.deepEqual(feedItem2.reactions.cheers, []);
  });

  await t.test("weist ungültige Reaktions-Typen ab", async () => {
    const user = await register("charlie_react");
    const res = await call("POST", "/feed/dummy-id/react", { emoji: "invalid_emoji" }, user.token);
    assert.equal(res.status, 400);
  });
});
