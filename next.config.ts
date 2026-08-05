import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // sharp is a native module — keep it external (loaded from node_modules at
  // runtime, never bundled by the compiler).
  serverExternalPackages: ["sharp"],

  // Momente's server actions call sharp, whose native libvips ships as a
  // SEPARATE optional package (@img/sharp-libvips-linux-x64). Under pnpm's
  // symlinked node_modules, Next's file tracer doesn't follow that dynamic
  // require, so the .so is missing from the deployed function and `import sharp`
  // throws ERR_DLOPEN_FAILED (libvips-cpp.so...). Force-include the linux-x64
  // binaries so they get copied into the function bundle. Keyed to every route
  // so it applies wherever the server action runs.
  // Include ONLY each package's lib/ (the real .node / .so binaries). Globbing
  // the whole package dir also grabs pnpm's internal node_modules symlinks,
  // which Vercel rejects as "an invalid deployment package ... symlinked
  // directories". lib/ holds just the binaries, no symlinks.
  outputFileTracingIncludes: {
    "/**/*": [
      "./node_modules/.pnpm/@img+sharp-linux-x64@*/node_modules/@img/sharp-linux-x64/lib/**",
      "./node_modules/.pnpm/@img+sharp-libvips-linux-x64@*/node_modules/@img/sharp-libvips-linux-x64/lib/**",
    ],
  },
};

export default nextConfig;
