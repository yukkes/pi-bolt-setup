// Run with Pi-Bolt's bundled Bun; no model call or user configuration changes.
import assert from "node:assert/strict";
import { replyRate, registerTokenSpeed } from "./footer-speed";

for (const ms of [0, 50, 999, -1, NaN, Infinity]) assert.equal(replyRate(10000, ms), null);
for (const tokens of [0, -1, NaN, Infinity]) assert.equal(replyRate(tokens, 2000), null);
assert.equal(replyRate(100, 1000), 100);
assert.equal(replyRate(100, 2000), 50);

let time = 0;
let mounted = true;
let state = { tokenSpeed: null as number | null, tokenSpeedEstimated: false };
const handlers = new Map<string, Function>();
const pi: any = { on: (name: string, callback: Function) => handlers.set(name, callback) };
registerTokenSpeed(pi, () => state, () => {}, () => mounted, () => time);
const emit = (name: string, event: any = {}) => handlers.get(name)!(event);
const start = () => emit("message_start", { message: { role: "assistant" } });
const delta = (text: string, type = "text_delta") => emit("message_update", { message: { role: "assistant" }, assistantMessageEvent: { type, delta: text } });
const end = (output?: number, stopReason = "stop", extra = {}) => emit("message_end", { message: { role: "assistant", usage: { output, reasoning: 50 }, stopReason, ...extra } });

// Buffered reply: 10s initial wait, 60ms between chunks. Not 166,667t/s.
start();
time = 10000; delta("a".repeat(400));
assert.equal(state.tokenSpeed, 10); // First chunk is counted over the whole reply.
assert.equal(state.tokenSpeedEstimated, true);
time = 10060; delta("b".repeat(400));
end(10000);
assert.equal(state.tokenSpeed, 10000 / 10.06);
assert.equal(state.tokenSpeedEstimated, false);

// A new reply clears the previous rate; very short replies stay hidden.
start();
assert.equal(state.tokenSpeed, null);
time += 60; delta("a".repeat(40000)); end(10000);
assert.equal(state.tokenSpeed, null);
assert.equal(state.tokenSpeedEstimated, false);

// Hidden reasoning and tool arguments are timed with their reported output.
start();
time += 1000; delta("考える", "thinking_delta");
time += 1000; delta('{"x":123}', "toolcall_delta");
end(100, "toolUse", { content: [{ type: "toolCall" }] });
assert.equal(state.tokenSpeed, 50);
assert.equal(state.tokenSpeedEstimated, false);
// Tool-result events and time spent running a tool cannot change the rate.
time += 60000;
emit("message_start", { message: { role: "toolResult" } });
emit("message_end", { message: { role: "toolResult" } });
assert.equal(state.tokenSpeed, 50);
start(); time += 2000; end(100);
assert.equal(state.tokenSpeed, 50);

// Missing/invalid usage and aborted replies remain explicitly estimated.
for (const [output, stopReason] of [[undefined, "stop"], [NaN, "stop"], [Infinity, "stop"], [10000, "aborted"], [10000, "error"]] as const) {
	start(); time += 2000; delta("a".repeat(400)); end(output, stopReason);
	assert.equal(state.tokenSpeed, 50);
	assert.equal(state.tokenSpeedEstimated, true);
}
// Unicode code points, not UTF-16 halves.
start(); time += 2000; delta("😀日本"); end();
assert.equal(state.tokenSpeed, 1.5);
start(); time += 2000; end();
assert.equal(state.tokenSpeed, null);
// A model/session change must not let an old sample overwrite the new state.
start(); time += 2000; delta("a".repeat(400));
emit("model_select"); end(10000);
assert.equal(state.tokenSpeed, null);
start(); state = { tokenSpeed: null, tokenSpeedEstimated: false }; time += 2000; end(10000);
assert.equal(state.tokenSpeed, null);
start(); emit("session_start"); time += 2000; end(10000);
assert.equal(state.tokenSpeed, null);
start(); emit("session_shutdown"); time += 2000; end(10000);
assert.equal(state.tokenSpeed, null);
// Non-TUI runs do not start samples.
mounted = false; start(); time += 2000; delta("a".repeat(400)); end(100);
assert.equal(state.tokenSpeed, null);
console.log("PASS: whole-reply token speed; buffering, minimum window, reasoning/tools, estimates, errors, Unicode, lifecycle, non-TUI.");
