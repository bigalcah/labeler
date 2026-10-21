import test from "node:test";

test("deliberate gate cancellation", {timeout: 50}, () => new Promise(() => {}));
