// `server-only` throws unless resolved with the "react-server" condition, which only
// Next.js sets. Scripts and the worker are server code too: resolve it to an empty module.
// Usage: tsx --import ./scripts/shims/server-only.mjs <entry>
import { registerHooks } from "node:module";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") {
      return { url: "data:text/javascript,export {};", shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});
