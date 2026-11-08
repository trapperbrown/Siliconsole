// Minimal JSON Schema validator for the subset used in shared/schemas: type (incl. nullable arrays),
// properties, required, additionalProperties, enum, const, items, min/maxItems, min/maxLength,
// minimum/maximum/exclusiveMinimum, pattern, oneOf and local $ref. Used for imported files and by
// scripts/check-frontend.mjs, so the app and the checks agree.

type Schema = Record<string, any>;

function typeOf(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  if (typeof v === "number") return Number.isInteger(v) ? "integer" : "number";
  return typeof v;
}

function resolve(root: Schema, ref: string): Schema {
  if (!ref.startsWith("#/")) throw new Error(`Unsupported $ref ${ref}`);
  return ref
    .slice(2)
    .split("/")
    .reduce((node: Schema, key) => node[key], root);
}

function check(root: Schema, s: Schema, v: unknown, path: string, errors: string[]) {
  if (s.$ref) return check(root, resolve(root, s.$ref), v, path, errors);
  if (s.oneOf) {
    const passing = s.oneOf.filter((sub: Schema) => {
      const e: string[] = [];
      check(root, sub, v, path, e);
      return e.length === 0;
    });
    if (passing.length !== 1) errors.push(`${path}: must match exactly one allowed shape`);
    return;
  }
  if ("const" in s && v !== s.const) errors.push(`${path}: must be ${JSON.stringify(s.const)}`);
  if (s.enum && !s.enum.includes(v)) errors.push(`${path}: must be one of ${s.enum.join(", ")}`);
  if (s.type) {
    const types: string[] = Array.isArray(s.type) ? s.type : [s.type];
    const t = typeOf(v);
    if (!types.includes(t) && !(t === "integer" && types.includes("number"))) {
      errors.push(`${path}: expected ${types.join(" or ")}, got ${t}`);
      return;
    }
  }
  if (typeof v === "number") {
    if (s.minimum !== undefined && v < s.minimum) errors.push(`${path}: below ${s.minimum}`);
    if (s.maximum !== undefined && v > s.maximum) errors.push(`${path}: above ${s.maximum}`);
    if (s.exclusiveMinimum !== undefined && v <= s.exclusiveMinimum) errors.push(`${path}: must exceed ${s.exclusiveMinimum}`);
  }
  if (typeof v === "string") {
    if (s.minLength !== undefined && v.length < s.minLength) errors.push(`${path}: too short`);
    if (s.maxLength !== undefined && v.length > s.maxLength) errors.push(`${path}: too long`);
    if (s.pattern && !new RegExp(s.pattern).test(v)) errors.push(`${path}: does not match ${s.pattern}`);
  }
  if (Array.isArray(v)) {
    if (s.minItems !== undefined && v.length < s.minItems) errors.push(`${path}: needs at least ${s.minItems} items`);
    if (s.maxItems !== undefined && v.length > s.maxItems) errors.push(`${path}: allows at most ${s.maxItems} items`);
    if (s.items) v.forEach((item, i) => check(root, s.items, item, `${path}[${i}]`, errors));
  }
  if (typeOf(v) === "object") {
    const obj = v as Record<string, unknown>;
    for (const key of s.required ?? []) if (!(key in obj)) errors.push(`${path}: missing ${key}`);
    const props: Schema = s.properties ?? {};
    for (const [key, val] of Object.entries(obj)) {
      if (props[key]) check(root, props[key], val, `${path}.${key}`, errors);
      else if (s.additionalProperties === false) errors.push(`${path}: unknown property ${key}`);
      else if (typeof s.additionalProperties === "object") check(root, s.additionalProperties, val, `${path}.${key}`, errors);
    }
  }
}

/** Returns a list of problems; empty means valid. `def` picks a $defs entry instead of the root. */
export function validate(schema: Schema, value: unknown, def?: string): string[] {
  const errors: string[] = [];
  check(schema, def ? schema.$defs[def] : schema, value, "$", errors);
  return errors.slice(0, 10);
}
