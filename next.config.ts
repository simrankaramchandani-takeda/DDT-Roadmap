import type { NextConfig } from 'next';

/**
 * THE IMPORT-RESOLUTION PROBLEM
 * -----------------------------
 * This codebase imports with explicit `.js` extensions that resolve to `.ts` files
 * (`@/types/domain.js` -> `src/types/domain.ts`, `./fiscal-year.js` ->
 * `fiscal-year.ts`). That is TypeScript's ESM convention, and `tsc`, `tsx` and
 * vitest all handle it natively. There are 56 such aliased import sites plus many
 * relative ones.
 *
 * Turbopack does not support it, in either form:
 *   - aliased  `@/lib/rollup.js`   -> resolved to a literal path, file not found
 *   - relative `./fiscal-year.js`  -> same
 * `experimental.extensionAlias` does not fix it: that option is webpack-only.
 * Mapping each aliased specifier via `turbopack.resolveAlias` fixes the aliased
 * half but cannot express relative specifiers at all.
 *
 * webpack's `resolve.extensionAlias` fixes both, because it is applied to the
 * final request after alias substitution. So the app builds with webpack.
 *
 * THIS IS A DEFERRED DECISION, NOT A PREFERENCE. See
 * reference/plan-001-mvp-build.md. The alternative is dropping the `.js` suffixes
 * repo-wide -- which `moduleResolution: "bundler"` makes unnecessary anyway, and
 * which would regain Turbopack -- but that is a mechanical change across files
 * explicitly out of bounds for WP0/WP1, including `jira-client.ts` and `sync.ts`.
 * Worth doing deliberately later; Next will eventually be Turbopack-only.
 */
const nextConfig: NextConfig = {
  webpack: (config) => {
    config.resolve = config.resolve ?? {};
    config.resolve.extensionAlias = {
      ...(config.resolve.extensionAlias ?? {}),
      '.js': ['.ts', '.tsx', '.js'],
      '.mjs': ['.mts', '.mjs'],
    };
    return config;
  },

  /**
   * `next dev` generated `AGENTS.md` and `CLAUDE.md` in the repo root on first run.
   * Nobody asked for them, they are not part of this project's documentation set,
   * and a generated `CLAUDE.md` would silently compete with the real project
   * instructions. Disabled; the generated files were deleted.
   */
  agentRules: false,
};

export default nextConfig;
