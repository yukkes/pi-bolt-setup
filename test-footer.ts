// Run inside Pi to use the real host pi-tui implementation, without a model call.
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { visibleWidth } from "@earendil-works/pi-tui";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function(pi: ExtensionAPI) {
	pi.on("session_start", async (_event, ctx) => {
		const agentDir = process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi/agent");
		const root = join(agentDir, "local-packages/nerd-footer/extensions");
		const { renderFooter, quotaLabel } = await import(join(root, "footer/render.ts"));
		const { createState } = await import(join(root, "footer/state.ts"));
		const strip = (text: string) => text.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "");
		const state = createState();
		Object.assign(state, { currentModelId: "gpt-6.1-sol", currentModelProvider: "github-copilot", currentModelReasoning: true, thinkingLevel: "medium", copilotCredits: "800/1000", tokenSpeed: 123 });
		let entries: any[] = [{ type: "message", message: { role: "assistant", usage: { input: 20, output: 1250, cacheRead: 70, cacheWrite: 10, cost: { total: 0.125 } } } }];
		let percent: number | null = 42;
		let branch = "feature/footer";
		let pending = true;
		const H: any = { state, ctx: {
			cwd: "/work/ｐｒｏｊｅｃｔ", sessionManager: { getCwd: () => "/work/ｐｒｏｊｅｃｔ", getEntries: () => entries },
			getContextUsage: () => ({ tokens: percent === null ? null : 84000, percent, contextWindow: 200000 }),
			isIdle: () => true, hasPendingMessages: () => pending,
		}, footerData: { getGitBranch: () => branch, getExtensionStatuses: () => new Map([["goal", "ｒｕｎｎｉｎｇ"], ["search", "search[search:ddg,fetch]"]]) } };
		const rows = renderFooter(H, 180).map(strip);
		assert.equal(rows.length, 2);
		assert.match(rows[0], /ｐｒｏｊｅｃｔ.*feature\/footer │ .*gpt-6.1-sol.*medium │ .*rem 800\/1000/);
		assert.doesNotMatch(rows[0], /github-copilot|84k|CH|\uf544|\uf5dc/);
		assert.match(rows[0], /\uf1b2 gpt-6.1-sol \uf0eb medium/);
		assert.match(rows[1], /\uf1c0 84k\/200k │ \uf2db CH70% R70 W10 │ \uf062 20 \uf063 1.3k │ \$0.125 \uf0e7 123t\/s/);
		assert.match(rows[1], /queued.*ｒｕｎｎｉｎｇ/);
		state.tokenSpeedEstimated = true;
		assert.match(strip(renderFooter(H, 180)[1]), /~123t\/s/);
		state.tokenSpeedEstimated = false;
		for (const speed of [null, 0, -1, NaN, Infinity]) {
			state.tokenSpeed = speed;
			assert.doesNotMatch(strip(renderFooter(H, 180)[1]), /t\/s/);
		}
		state.tokenSpeed = 123;
		for (const row of rows) {
			assert.equal(row, row.trim());
			assert.doesNotMatch(row, / {2,}/, "No alignment padding");
			assert.doesNotMatch(row, /█|░|ctx|42%|idle|search\[/);
		}
		assert.equal(rows[1].split("84k/200k").length, 2, "Context shown once");
		const narrow = renderFooter(H, 80).map(strip);
		assert.match(narrow[0], /gpt-6.1-sol.*medium.*rem 800\/1000/);
		assert.match(narrow[1], /84k\/200k/);
		assert.match(narrow[1], /\uf062 20.*\uf063 1.3k/);
		assert.match(narrow[1], /ｒｕｎｎｉｎｇ/);
		for (const [value, color] of [[49, 253], [50, 221], [80, 203]]) {
			percent = value;
			assert.ok(renderFooter(H, 180)[1].includes(`\x1b[38;5;${color}m84k`));
		}
		for (const [hit, color] of [[0, 203], [39, 203], [40, 221], [69, 221], [70, 114], [100, 114]]) {
			entries = [{ type: "message", message: { role: "assistant", usage: { input: 100 - hit, cacheRead: hit, cacheWrite: 0 } } }];
			assert.ok(renderFooter(H, 180)[1].includes(`CH\x1b[39m\x1b[38;5;${color}m${hit}%`));
		}
		percent = null;
		assert.match(strip(renderFooter(H, 180)[1]), /\uf1c0 \?\/200k/);
		entries = [];
		assert.doesNotMatch(strip(renderFooter(H, 180)[1]), /CH|R\d|W\d|\$|\uf2db/);
		percent = 42;
		const capturedAt = Date.now();
		state.rateWindows = [
			{ scope: "codex:primary", windowDurationMins: 300, percent: 75, hasReset: true, resetSec: 60, capturedAt },
			{ scope: "codex:secondary", windowDurationMins: 10080, percent: 40, hasReset: true, resetSec: 120, capturedAt },
			{ scope: "expired", percent: 10, hasReset: true, resetSec: -1, capturedAt },
		];
		const quotas = renderFooter(H, 200).map(strip).join("\n");
		assert.match(quotas, /5h used 25% 1w used 60%/);
		assert.doesNotMatch(quotas, /expired|█|░/);
		assert.equal(quotaLabel(state.rateWindows[0]), "5h");
		for (let width = 0; width <= 220; width++) {
			for (const name of ["dark", "light"]) {
				H.theme = { name, appearance: name };
				const lines = renderFooter(H, width);
				assert.equal(lines.length, 2);
				for (const line of lines) assert.ok(visibleWidth(line) <= width, `width ${width}: ${visibleWidth(line)}`);
			}
		}
		H.theme = { name: "light", appearance: "light" };
		assert.match(renderFooter(H, 160)[0], /38;5;24m/);
		H.theme = { name: "dark", appearance: "dark" };
		branch = "feature/" + "ｌｏｎｇｂｒａｎｃｈ".repeat(50);
		assert.match(strip(renderFooter(H, 80)[0]), /gpt-6.1-sol.*medium.*800\/1000/);
		assert.match(strip(renderFooter(H, 80)[1]), /84k\/200k/);
		branch = "";
		state.currentModelProvider = "openai";
		assert.match(strip(renderFooter(H, 180)[0]), /openai\/gpt-6.1-sol/);
		assert.doesNotMatch(strip(renderFooter(H, 180)[0]), /rem 800\/1000/);
		state.currentModelProvider = "github-copilot";
		state.rateWindows = [];
		pending = false;
		entries = [{ type: "message", message: { role: "assistant", usage: { input: 300, output: 39000, cacheRead: 6900000, cacheWrite: 105000, cost: { total: 1.346 } } } }];
		const sample = renderFooter(H, 120).join("\n");
		assert.match(strip(sample), /R6.9M W105k/);
		assert.doesNotMatch(sample, /38;5;(?:5|13|53|54|55|56|57|93|129|165)m/);
		writeFileSync("/tmp/pi-footer-test-result.txt", `PASS: two left-aligned grouped rows, vertical separators, exact context once, no graphs/context percent, Nerd Font groups, cache/cost/speed, quota semantics/expiry, omitted idle/static search, warnings, Unicode, dark/light, widths 0–220.\n\n${sample}\n`);
		ctx.shutdown();
	});
}
