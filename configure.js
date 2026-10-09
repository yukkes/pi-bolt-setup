// Apply config.json with Pi-Bolt's bundled Bun (BUN_BE_BUN=1); no Node.js/npm dependency.
// Managed fields are reproduced exactly; unrelated settings, extra agents and credentials remain intact.
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

const root = dirname(fileURLToPath(import.meta.url));
const config = JSON.parse(readFileSync(join(root, "config.json"), "utf8"));
if (process.argv[2] === "--plugins") {
  console.log(config.plugins.join("\n"));
  process.exit(0);
}
const agentDir = process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent");
const read = path => existsSync(path) ? readFileSync(path, "utf8") : undefined;
const readJSON = path => JSON.parse(read(path) ?? "{}");
// Atomic write; the original file is backed up once as *.pre-config.bak.
const save = (path, contents) => {
  if (typeof contents !== "string") contents = `${JSON.stringify(contents, null, 2)}\n`;
  if (read(path) === contents) return;
  if (existsSync(path) && !existsSync(`${path}.pre-config.bak`)) copyFileSync(path, `${path}.pre-config.bak`);
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, contents, { mode: 0o600 });
  renameSync(tmp, path);
};

// Models, footer behavior and subagent options.
mkdirSync(join(agentDir, "agents"), { recursive: true });
const [defaultProvider, ...modelId] = config.models.default.split("/");
const managedFiles = {
  "settings.json": { enabledModels: config.models.enabled, defaultProvider, defaultModel: modelId.join("/") },
  ...config.files,
};
for (const [name, managed] of Object.entries(managedFiles)) {
  const path = join(agentDir, name);
  const settings = Object.assign(readJSON(path), managed);
  // Existing Pi-Bolt-specific model overrides must not shadow the reproduced defaults.
  if (name === "settings.json" && settings.piBolt && typeof settings.piBolt === "object") {
    for (const [key, value] of Object.entries(managed)) if (Object.hasOwn(settings.piBolt, key)) settings.piBolt[key] = value;
  }
  save(path, settings);
}
// Agent definitions: prompts from agents/*.md, model from config.json.
for (const [name, model] of Object.entries(config.agents)) {
  const text = readFileSync(join(root, "agents", `${name}.md`), "utf8");
  save(join(agentDir, "agents", `${name}.md`), text.replace(/^(description:.*\n)/m, `$1model: ${model}\n`));
}
console.log(`Pi settings and agent definitions configured: ${agentDir}`);

// Footer: reuse pinned pi-better-footer quota/lifecycle code with the local two-row renderer.
const FOOTER = "pi-better-footer@0.1.4";
const upstream = join(agentDir, "npm", "node_modules", "pi-better-footer");
const target = join(agentDir, "local-packages", "nerd-footer");
if (readJSON(join(upstream, "package.json")).version !== "0.1.4") throw new Error(`Expected ${FOOTER}; review customization before upgrading`);
mkdirSync(target, { recursive: true });
cpSync(upstream, target, { recursive: true });
writeFileSync(join(target, "extensions", "footer", "render.ts"), readFileSync(join(root, "footer-render.ts"), "utf8"));
writeFileSync(join(target, "extensions", "footer", "speed.ts"), readFileSync(join(root, "footer-speed.ts"), "utf8"));
// Replace only pinned upstream speed logic; retain quota, billing and other lifecycle code.
// Fail loudly if the pinned source changes instead of silently running two meters.
const indexPath = join(target, "extensions", "footer", "index.ts");
let index = readFileSync(indexPath, "utf8");
const replaceBlock = (start, end, replacement) => {
  const from = index.indexOf(start);
  const to = index.indexOf(end, from + start.length);
  if (from < 0 || to < 0 || index.indexOf(start, from + start.length) >= 0) throw new Error(`Unexpected ${FOOTER} speed source: ${start}`);
  index = index.slice(0, from) + replacement + index.slice(to);
};
replaceBlock("type StreamUsage =", "export default function", "");
replaceBlock("\tconst resetStreamTiming =", '\tpi.on("message_end",', '\tregisterTokenSpeed(pi, () => H.state, requestRender, () => !!H.timer);\n\n');
replaceBlock("\t\t// Providers report whole-message output usage,", "\t\trequestRender();\n\t});", "");
index = index.replace("\t\t\t\t\tusage?: StreamUsage;\n", "");
index = index.replace('import { createState, type FooterState } from "./state";', 'import { createState, type FooterState } from "./state";\nimport { registerTokenSpeed } from "./speed";');
index = index.replace(/ \* Token speed covers[\s\S]*? \*\/\n/, " * Token speed is whole-reply throughput (including initial latency and reasoning),\n * implemented locally in speed.ts. Tool execution is outside the reply.\n */\n");
if (/measureTokenSpeed|estimateRate|resetStreamTiming|updateLiveSpeed|StreamUsage/.test(index)) throw new Error("Upstream speed logic was not fully replaced");
writeFileSync(indexPath, index);
writeFileSync(join(target, "NERD-FONT.md"), `Local grouped customization of ${FOOTER} (MIT).
Generated by ${fileURLToPath(import.meta.url)} from footer-render.ts and footer-speed.ts in ${root}.
Display specification: ${join(root, "README.md")}. Re-run the generator after editing; /reload or restart Pi to apply.
`);
// Keep the upstream package for regeneration but load only the local footer.
// Normalize both top-level and Pi-Bolt override lists so neither can re-enable a second footer.
const settingsPath = join(agentDir, "settings.json");
const settings = readJSON(settingsPath);
const owner = Array.isArray(settings.piBolt?.packages) ? settings.piBolt : settings;
const sourceOf = entry => typeof entry === "string" ? entry : entry.source ?? "";
const isUpstream = entry => /^npm:pi-better-footer(?:@|$)/.test(sourceOf(entry));
for (const list of [settings, settings.piBolt].filter(Boolean)) {
  if (!Array.isArray(list.packages)) continue;
  list.packages = list.packages.filter(entry => sourceOf(entry) !== target)
    .map(entry => isUpstream(entry) ? { ...(typeof entry === "string" ? { source: entry } : entry), extensions: [] } : entry);
}
owner.packages ??= [];
if (!owner.packages.some(isUpstream)) owner.packages.push({ source: `npm:${FOOTER}`, extensions: [] });
owner.packages.push(target);
save(settingsPath, settings);
console.log(`Readable statusline footer configured: ${target}`);
