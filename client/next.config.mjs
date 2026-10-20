import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Two `next dev` processes sharing one build dir overwrite each other's chunks,
  // so the browser hydrates with JS from the other server and hydration fails.
  // scripts/e2e.sh sets NEXT_DIST_DIR so it can run beside ./scripts/dev.sh.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  env: {
    NEXT_PUBLIC_API_BASE: process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:3001",
  },
  // src/vendor/shared is written NodeNext-style (`export * from './x.js'`). tsc and
  // vitest map that to x.ts; webpack does not, so the first RUNTIME import of the
  // barrel (a zod schema, not an erased `import type`) failed with "Can't resolve".
  webpack(config) {
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      ".js": [".ts", ".tsx", ".js"],
    };
    return config;
  },
};

export default withNextIntl(nextConfig);
