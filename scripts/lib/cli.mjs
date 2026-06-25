// Tiny shared CLI argument parser.
//
// Supports: --flag value, --flag=value, -f value, and boolean --flag.
// Every script in this project parses args through here so the surface stays
// uniform and testable. Keep this dependency-free and side-effect-free.

/**
 * Parse argv into a plain object.
 *
 * @param {string[]} argv - usually process.argv.slice(2)
 * @param {object} [options]
 * @param {Record<string,string>} [options.aliases] - short -> long flag map, e.g. { i: "input" }
 * @param {string[]} [options.booleans] - flags that take no value, e.g. ["help", "no-scaffold"]
 * @param {Record<string,unknown>} [options.defaults] - default values
 * @returns {Record<string, string | boolean>}
 */
export function parseArgs(argv, { aliases = {}, booleans = [], defaults = {} } = {}) {
  const out = { ...defaults };
  const booleanSet = new Set(booleans);

  for (let i = 0; i < argv.length; i += 1) {
    let token = argv[i];
    if (!token.startsWith("-")) {
      (out._ ??= []).push(token);
      continue;
    }

    let inlineValue;
    const eq = token.indexOf("=");
    if (eq !== -1) {
      inlineValue = token.slice(eq + 1);
      token = token.slice(0, eq);
    }

    let name = token.replace(/^-+/, "");
    if (aliases[name]) name = aliases[name];

    if (booleanSet.has(name)) {
      out[name] = inlineValue === undefined ? true : inlineValue !== "false";
      continue;
    }

    if (inlineValue !== undefined) {
      out[name] = inlineValue;
    } else {
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("-")) {
        out[name] = next;
        i += 1;
      } else {
        out[name] = true; // lone flag treated as boolean true
      }
    }
  }

  return out;
}

/** Throw a friendly error if a required arg is missing. */
export function requireArg(args, name, hint = "") {
  const value = args[name];
  if (value === undefined || value === true || value === "") {
    throw new Error(`Missing required --${name}${hint ? ` (${hint})` : ""}`);
  }
  return value;
}
