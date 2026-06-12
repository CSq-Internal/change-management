import type { NextConfig } from "next";

// `output: 'standalone'` + explicit Prisma file-tracing are for the self-hosted
// CONTAINER image (Docker / Cloud Run). They must NOT be set on Vercel: Vercel
// packages functions with its own pipeline and rejects the pnpm-symlinked
// standalone output ("invalid deployment package ... files in symlinked directories").
const isVercel = !!process.env.VERCEL;

const nextConfig: NextConfig = isVercel
  ? {}
  : {
      output: "standalone",
      outputFileTracingIncludes: {
        "/**": ["./node_modules/.prisma/client/**/*", "./node_modules/@prisma/client/**/*"],
      },
    };

export default nextConfig;
