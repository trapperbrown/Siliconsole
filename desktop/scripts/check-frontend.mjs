// Repo checks: schema validity of shipped JSON, WCAG contrast of shipped themes, no color literals in
// the frontend outside theme files, no em dashes anywhere, no TCP listeners in the service.
// Run: pnpm check (from desktop/). Exits non-zero on any failure.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { validate } from "../src/lib/validate.ts";
import { checkTheme } from "../src/lib/contrast.ts";

const root = fileURLToPath(new URL("../..", import.meta.url));
const read = (p) => readFileSync(join(root, p), "utf8");
const json = (p) => JSON.parse(read(p));
let failures = 0;
const fail = (msg) => {
  failures++;
  console.log(`  FAIL ${msg}`);
};

function walk(dir, skip = /node_modules|[\\/](target|bin|obj|dist|publish|gen|\.git|\.claude)([\\/]|$)/) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (skip.test(p)) continue;
    if (statSync(p).isDirectory()) out.push(...walk(p, skip));
    else out.push(p);
  }
  return out;
}

console.log("Schemas");
const cfg = json("shared/config/defaults.json");
const check = (label, schema, value) => {
  const errors = validate(schema, value);
  if (errors.length) fail(`${label}: ${errors.join("; ")}`);
  else console.log(`  ok   ${label}`);
};
check("shared/config/defaults.json", json("shared/schemas/config.schema.json"), cfg);
const themeSchema = json("shared/schemas/theme.schema.json");
const themes = readdirSync(join(root, "shared/themes")).map((f) => [f, json(`shared/themes/${f}`)]);
for (const [f, t] of themes) check(`shared/themes/${f}`, themeSchema, t);
for (const f of readdirSync(join(root, "shared/dashboards"))) check(`shared/dashboards/${f}`, json("shared/schemas/dashboard.schema.json"), json(`shared/dashboards/${f}`));
const missing = cfg.themes.builtinIds.filter((id) => !themes.some(([, t]) => t.id === id));
if (missing.length) fail(`builtin themes missing files: ${missing.join(", ")}`);

console.log(`Contrast (text >= ${cfg.themes.minContrastRatio}, accent/status >= ${cfg.themes.minLargeTextContrastRatio})`);
for (const [f, t] of themes) {
  const issues = checkTheme(t, cfg.themes.minContrastRatio, cfg.themes.minLargeTextContrastRatio);
  if (issues.length) issues.forEach((i) => fail(`${f}: ${i.pair} is ${i.ratio}, needs ${i.required}`));
  else console.log(`  ok   ${t.name}`);
}

console.log("Color literals in desktop/src (theme files excluded)");
const colorLiteral = /#[0-9a-fA-F]{3,8}\b|\brgba?\s*\(|\bhsla?\s*\(/;
const srcFiles = walk(join(root, "desktop/src")).filter((p) => [".ts", ".tsx", ".css", ".html"].includes(extname(p)));
let colorHits = 0;
for (const p of srcFiles) {
  read(relative(root, p))
    .split("\n")
    .forEach((line, i) => {
      if (colorLiteral.test(line)) {
        colorHits++;
        fail(`${relative(root, p)}:${i + 1}: ${line.trim()}`);
      }
    });
}
console.log(`  ${colorHits} hits`);

console.log("Em dashes (U+2014) in repo files");
const textExt = [".ts", ".tsx", ".js", ".mjs", ".json", ".css", ".html", ".md", ".cs", ".csproj", ".rs", ".toml", ".ps1", ".nsh", ".slnx", ".manifest"];
let dashHits = 0;
for (const p of walk(root).filter((p) => textExt.includes(extname(p)))) {
  if (read(relative(root, p)).includes(String.fromCharCode(0x2014))) {
    dashHits++;
    fail(`${relative(root, p)} contains an em dash`);
  }
}
console.log(`  ${dashHits} hits`);

console.log("Network listeners in sensor-service");
const listener = /TcpListener|HttpListener|UdpClient|Socket\s*\(|Kestrel|UseUrls|WebApplication/;
let netHits = 0;
for (const p of walk(join(root, "sensor-service/src")).filter((p) => extname(p) === ".cs")) {
  if (listener.test(read(relative(root, p)))) {
    netHits++;
    fail(`${relative(root, p)} references a network listener`);
  }
}
console.log(`  ${netHits} hits`);

console.log(failures ? `\n${failures} failure(s)` : "\nAll checks passed");
process.exit(failures ? 1 : 0);
