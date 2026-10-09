import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { basename } from "node:path";
import { CHATGPT_QUOTA_KEY, CHATGPT_USAGE_URL, COPILOT_PROVIDER, hasRecentChatGPTLimit } from "../quota/quotas";
import type { RateWindow } from "../quota/quotas";
import type { FooterState } from "./state";
import { summarizeSessionUsage } from "./session-stats";

export interface FooterTheme {
	readonly name?: string;
	readonly appearance?: "dark" | "light";
	fg(color: string, text: string): string;
	bold(text: string): string;
}

type Handle = {
	state: FooterState;
	ctx: ExtensionContext | undefined;
	theme?: FooterTheme;
	footerData?: {
		getGitBranch(): string | null;
		getExtensionStatuses(): ReadonlyMap<string, string>;
	};
};

// Footer-only palette: no inherited purple accent or unreadably faint dim text.
const dark = { icon: 117, branch: 222, text: 253, label: 250, good: 114, warning: 221, error: 203 };
const light = { icon: 24, branch: 94, text: 234, label: 240, good: 28, warning: 94, error: 160 };
type Color = keyof typeof dark;
const clamp = (percent: number) => Math.max(0, Math.min(100, percent));
const sanitize = (text: string) => text.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "").replace(/[\x00-\x1f\x7f-\x9f]/g, " ").replace(/ +/g, " ").trim();

/** Duration labels must not be confused with a shrinking reset countdown. */
export function quotaLabel(window: RateWindow): string {
	const mins = window.windowDurationMins;
	if (mins === 300) return "5h";
	if (mins === 10080) return "1w";
	if (window.scope === "zai:monthly" || /monthly/.test(window.scope)) return "month";
	if (/weekly/.test(window.scope)) return "1w";
	if (mins !== undefined && mins > 0) return mins < 60 ? `${mins}m` : mins < 1440 ? `${Math.round(mins / 60)}h` : `${Math.round(mins / 1440)}d`;
	return sanitize(window.scope.replace(/^[^:]+:/, "")) || "limit";
}

function formatTokens(count: number): string {
	if (count < 1000) return `${count}`;
	if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
	if (count < 1_000_000) return `${Math.round(count / 1000)}k`;
	if (count < 10_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
	return `${Math.round(count / 1_000_000)}M`;
}

export function renderFooter(H: Handle, width: number): string[] {
	width = Math.max(0, Math.floor(width));
	const { state, ctx, theme, footerData } = H;
	const isLight = theme?.appearance === "light" || (theme?.appearance === undefined && /light/i.test(theme?.name ?? ""));
	const palette = isLight ? light : dark;
	const fg = (color: Color, text: string) => `\x1b[38;5;${palette[color]}m${text}\x1b[39m`;
	const separator = ` ${fg("label", "│")} `;
	const groups = (parts: string[]) => parts.filter(Boolean).join(separator);
	const items = (parts: string[]) => parts.filter(Boolean).join(" ");
	const stat = (label: string, value: string) => `${fg("label", label)}${fg("text", value)}`;
	const icon = (glyph: string) => fg("icon", glyph);
	const usedColor = (percent: number): Color => percent >= 80 ? "error" : percent >= 50 ? "warning" : "text";
	const hitColor = (percent: number): Color => percent >= 70 ? "good" : percent >= 40 ? "warning" : "error";

	// Row 1: workspace │ model + effort │ remaining account balance.
	const cwd = ctx?.sessionManager.getCwd() ?? ctx?.cwd ?? "";
	const directory = `${icon("\uf07b")} ${fg("text", sanitize(basename(cwd) || "/"))}`;
	const branch = footerData?.getGitBranch();
	const project = items([directory, branch ? `${icon("\ue0a0")} ${fg("branch", sanitize(branch))}` : ""]);
	const provider = state.currentModelProvider ?? ctx?.model?.provider;
	const modelId = sanitize(state.currentModelId ?? ctx?.model?.id ?? "no-model");
	// The usual Copilot provider is redundant; retain other provider identities.
	const model = `${icon("\uf1b2")} ${fg("text", provider && provider !== COPILOT_PROVIDER ? `${sanitize(provider)}/${modelId}` : modelId)}`;
	const effort = state.currentModelReasoning ? `${icon("\uf0eb")} ${fg("branch", sanitize(state.thinkingLevel || "off"))}` : "";
	let balance = "";
	if (provider === COPILOT_PROVIDER && state.copilotCredits) {
		const match = /^(\d+)\/(\d+)$/.exec(state.copilotCredits);
		const remaining = match && Number(match[2]) > 0 ? Number(match[1]) / Number(match[2]) * 100 : undefined;
		balance = `${icon("\uf51e")} ${fg("label", "rem")} ${fg(remaining === undefined ? "text" : remaining <= 10 ? "error" : remaining <= 30 ? "warning" : "good", sanitize(state.copilotCredits))}`;
	}
	if (state.currentQuotaKey === CHATGPT_QUOTA_KEY) {
		const limited = hasRecentChatGPTLimit(state.providerQuotas.get(CHATGPT_QUOTA_KEY)?.chatgptLimitAt);
		balance = `\x1b]8;;${CHATGPT_USAGE_URL}\x1b\\${fg(limited ? "error" : "text", limited ? "ChatGPT limit" : "ChatGPT")}\x1b]8;;\x1b\\`;
	}
	let identity = groups([items([model, effort]), balance]);
	if (visibleWidth(identity) > width) {
		const tail = items([effort, balance]);
		const room = width - visibleWidth(tail) - (tail ? 1 : 0);
		identity = room >= 4 ? items([truncateToWidth(model, room, "…"), tail]) : truncateToWidth(items([model, tail]), width, "");
	}
	const projectRoom = width - visibleWidth(identity) - visibleWidth(separator);
	const firstLine = projectRoom >= 4 ? groups([truncateToWidth(project, projectRoom, "…"), identity]) : identity;

	// Row 2: exact context amount │ cache │ session input/output │ cost + speed.
	// Percentage is used only for warning colors; no context percentage or graphs.
	const context = ctx?.getContextUsage();
	const capacity = context?.contextWindow ?? ctx?.model?.contextWindow;
	const percent = context?.percent;
	const contextAmount = `${icon("\uf1c0")} ${fg(percent == null || !Number.isFinite(percent) ? "text" : usedColor(percent), context?.tokens == null ? "?" : formatTokens(context.tokens))}/${fg("text", capacity && capacity > 0 ? formatTokens(capacity) : "?")}`;
	const { totals, latestHit } = summarizeSessionUsage(ctx?.sessionManager);
	const hit = latestHit === undefined ? "" : `${fg("label", "CH")}${fg(hitColor(latestHit), `${Math.round(clamp(latestHit))}%`)}`;
	const cacheParts = [hit, totals.cacheRead > 0 ? stat("R", formatTokens(totals.cacheRead)) : "", totals.cacheWrite > 0 ? stat("W", formatTokens(totals.cacheWrite)) : ""];
	const cache = cacheParts.some(Boolean) ? `${icon("\uf2db")} ${items(cacheParts)}` : "";
	const compactCache = hit ? `${icon("\uf2db")} ${hit}` : "";
	const tokens = items([`${icon("\uf062")} ${fg("text", formatTokens(totals.input))}`, `${icon("\uf063")} ${fg("text", formatTokens(totals.output))}`]);
	const performance = items([
		totals.cost > 0 ? stat("$", totals.cost.toFixed(3)) : "",
		state.tokenSpeed != null && state.tokenSpeed > 0 && Number.isFinite(state.tokenSpeed)
			? `${icon("\uf0e7")} ${fg("text", `${state.tokenSpeedEstimated ? "~" : ""}${Math.round(state.tokenSpeed)}t/s`)}` : "",
	]);
	const now = Date.now();
	const quotas = state.rateWindows
		.filter(w => Number.isFinite(w.percent) && (!w.hasReset || w.resetSec - (now - w.capturedAt) / 1000 > 0))
		.map(w => `${fg("label", `${quotaLabel(w)} used `)}${fg(usedColor(100 - clamp(w.percent)), `${Math.round(100 - clamp(w.percent))}%`)}`);
	const quotaGroup = items(quotas);
	const statuses = Array.from(footerData?.getExtensionStatuses() ?? [])
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([key, text]) => {
			const label = sanitize(text);
			// Static search capability text is not a live status and crowds the footer.
			if (/^search\[search:/.test(label)) return "";
			return label && /goal/i.test(key) ? `\uf140 ${label}` : label;
		}).filter(Boolean).join(" ");
	const pending = ctx?.hasPendingMessages?.() ? `${icon("\uf252")} ${fg("warning", "queued")}` : "";
	const status = items([pending, statuses ? fg("label", statuses) : ""]);
	const statusText = statuses || pending ? truncateToWidth(status, Math.floor(width / 3), "") : "";
	const detailWidth = Math.max(0, width - (statusText ? visibleWidth(statusText) + visibleWidth(separator) : 0));
	// Prefer whole groups; drop performance/cache details before essential counts.
	const variants = [
		groups([contextAmount, cache, tokens, performance, quotaGroup]),
		groups([contextAmount, cache, tokens, quotaGroup]),
		groups([contextAmount, compactCache, tokens, quotaGroup]),
		groups([contextAmount, tokens, quotaGroup]),
		groups([contextAmount, quotaGroup]),
		contextAmount,
	];
	const second = variants.find(text => visibleWidth(text) <= detailWidth) ?? truncateToWidth(contextAmount, detailWidth, "");
	return [truncateToWidth(firstLine, width, ""), truncateToWidth(groups([second, statusText]), width, "")];
}
