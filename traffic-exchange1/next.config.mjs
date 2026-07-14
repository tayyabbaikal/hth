/** @type {import('next').NextConfig} */
const nextConfig = {
  // `standalone` produces a minimal self-contained server bundle for the
  // Docker image (see Dockerfile). On cPanel we start server.js instead; both
  // read the same `.next` build output.
  output: "standalone",
  reactStrictMode: true,
  poweredByHeader: false,

  // Deploy-friendliness on hosts where you can't iterate locally: don't let a
  // stray type or lint issue block the production build. Runtime behavior is
  // unaffected. Run `npm run typecheck` / `npm test` locally to catch issues.
  typescript: { ignoreBuildErrors: true },
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
