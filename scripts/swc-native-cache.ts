/**
 * Side-effect module: import it before anything that loads @swc/core (next-intl/plugin).
 *
 * @swc/core >= 1.16 materializes its native binding in a cache under %LOCALAPPDATA%\swc and
 * refuses to load when an ancestor folder grants write access to another principal (e.g. an
 * AppContainer sandbox SID). A project-local absolute cache path avoids that on any machine.
 */
import { join } from "node:path";

process.env.SWC_NATIVE_BINDING_CACHE ??= join(process.cwd(), "node_modules", ".cache", "swc");
