import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// Whole-reply throughput, not decoder speed: include initial latency and hidden
// reasoning so whole-message usage is never divided by a tiny delta interval.
export const MIN_SAMPLE_MS = 1000;
const REFRESH_MS = 250;
type SpeedState = { tokenSpeed: number | null; tokenSpeedEstimated: boolean };

export function replyRate(tokens: number, elapsedMs: number): number | null {
	if (!Number.isFinite(tokens) || tokens <= 0 || !Number.isFinite(elapsedMs) || elapsedMs < MIN_SAMPLE_MS) return null;
	const rate = tokens / (elapsedMs / 1000);
	return Number.isFinite(rate) && rate > 0 ? rate : null;
}

/** Register in the footer's lifecycle; no timers, tokenizer or provider calls. */
export function registerTokenSpeed(
	pi: ExtensionAPI,
	getState: () => SpeedState,
	render: () => void,
	isMounted: () => boolean,
	now: () => number = () => performance.now(),
) {
	let sample: { state: SpeedState; startedAt: number; renderedAt: number; tokens: number } | undefined;
	const reset = () => {
		sample = undefined;
		Object.assign(getState(), { tokenSpeed: null, tokenSpeedEstimated: false });
	};
	pi.on("session_start", reset);
	pi.on("session_shutdown", reset);
	pi.on("model_select", () => { reset(); render(); });
	pi.on("message_start", (event) => {
		if (event.message?.role !== "assistant") return;
		reset();
		if (isMounted()) {
			const time = now();
			sample = { state: getState(), startedAt: time, renderedAt: time, tokens: 0 };
		}
		render();
	});
	pi.on("message_update", (event) => {
		if (!sample || sample.state !== getState() || event.message?.role !== "assistant") return;
		const delta = event.assistantMessageEvent;
		if (delta.type !== "text_delta" && delta.type !== "thinking_delta" && delta.type !== "toolcall_delta") return;
		// A marked heuristic (not reported usage), including the first chunk.
		for (const char of delta.delta ?? "") sample.tokens += char.codePointAt(0)! < 128 ? 0.25 : 1;
		const time = now();
		if (time - sample.renderedAt < REFRESH_MS) return;
		const rate = replyRate(sample.tokens, time - sample.startedAt);
		if (rate === null) return;
		Object.assign(sample.state, { tokenSpeed: rate, tokenSpeedEstimated: true });
		sample.renderedAt = time;
		render();
	});
	pi.on("message_end", (event) => {
		if (event.message?.role !== "assistant") return;
		const current = sample;
		sample = undefined;
		if (!current || current.state !== getState()) return;
		const message = event.message;
		const elapsed = now() - current.startedAt;
		// Output already includes reasoning and tool arguments. Their generation
		// is inside this reply's timing; tool execution follows message_end.
		const complete = message.stopReason !== "error" && message.stopReason !== "aborted";
		const measured = complete ? replyRate(message.usage?.output ?? 0, elapsed) : null;
		const estimated = measured === null ? replyRate(current.tokens, elapsed) : null;
		Object.assign(current.state, { tokenSpeed: measured ?? estimated, tokenSpeedEstimated: measured === null && estimated !== null });
		render();
	});
}
