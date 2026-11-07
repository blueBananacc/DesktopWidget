// 把 doc/http-api/openapi/ 下按资源拆分的 OpenAPI 片段合并成一份 openapi.json（网页调试页 / 本地桥使用）。
// 用法：node scripts/openapi-bundle.mjs [--check]
//   --check  只校验、不写文件；生成结果与已提交的 public/openapi.json 不一致时退出码 1（CI 用）
import { readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

const here = dirname(fileURLToPath(import.meta.url));
const SRC = join(here, "../../doc/http-api/openapi");
const OUT = join(here, "../public/openapi.json");
const REQ_ID_REF = { $ref: "#/components/parameters/XRequestId" };

const fail = (msg) => { console.error(`openapi-bundle: ${msg}`); process.exit(1); };

const root = parse(readFileSync(join(SRC, "openapi.yaml"), "utf8"));
root.paths ??= {};
root.tags ??= [];
root.components.schemas ??= {};

for (const file of readdirSync(SRC).filter((f) => f.endsWith(".yaml") && f !== "openapi.yaml").sort()) {
  const part = parse(readFileSync(join(SRC, file), "utf8")) ?? {};
  for (const t of part.tags ?? []) {
    if (root.tags.some((x) => x.name === t.name)) fail(`${file}: duplicate tag "${t.name}"`);
    root.tags.push(t);
  }
  for (const [p, item] of Object.entries(part.paths ?? {})) {
    if (!p.startsWith("/api/")) fail(`${file}: path "${p}" must start with /api/`);
    if (root.paths[p]) fail(`${file}: duplicate path "${p}"`);
    root.paths[p] = item;
  }
  for (const [name, schema] of Object.entries(part.schemas ?? {})) {
    if (root.components.schemas[name]) fail(`${file}: duplicate schema "${name}"`);
    root.components.schemas[name] = schema;
  }
}

// 隧道规范 §5：每个请求都带 X-Request-Id——统一注入到 path item 级参数，片段里不必重复书写
for (const item of Object.values(root.paths)) {
  item.parameters = [REQ_ID_REF, ...(item.parameters ?? [])];
}

// 校验所有组件引用都能解析
const missing = new Set();
const walk = (v) => {
  if (Array.isArray(v)) return v.forEach(walk);
  if (!v || typeof v !== "object") return;
  if (typeof v.$ref === "string") {
    const m = /^#\/components\/(\w+)\/(.+)$/.exec(v.$ref);
    if (!m || !root.components[m[1]]?.[m[2]]) missing.add(v.$ref);
  }
  Object.values(v).forEach(walk);
};
walk(root);
if (missing.size) fail(`unresolved $ref:\n  ${[...missing].join("\n  ")}`);

// operationId 唯一
const ops = new Map();
for (const [p, item] of Object.entries(root.paths))
  for (const [method, op] of Object.entries(item))
    if (op && typeof op === "object" && op.operationId) {
      if (ops.has(op.operationId)) fail(`duplicate operationId "${op.operationId}" (${ops.get(op.operationId)} / ${method.toUpperCase()} ${p})`);
      ops.set(op.operationId, `${method.toUpperCase()} ${p}`);
    }

const json = JSON.stringify(root, null, 2) + "\n";
if (process.argv.includes("--check")) {
  if (!existsSync(OUT) || readFileSync(OUT, "utf8") !== json) fail("public/openapi.json is stale — run `npm run openapi`");
  console.log(`openapi-bundle: OK (${Object.keys(root.paths).length} paths, ${ops.size} operations)`);
} else {
  writeFileSync(OUT, json);
  console.log(`openapi-bundle: wrote public/openapi.json (${Object.keys(root.paths).length} paths, ${ops.size} operations, ${Object.keys(root.components.schemas).length} schemas)`);
}
