import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Emit a minimal, self-contained server bundle (.next/standalone) for containers.
  output: "standalone",
  // Next's file tracer can miss Prisma's dynamically-loaded client/engine files;
  // force-include them so the standalone image can reach the database.
  outputFileTracingIncludes: {
    "/**": ["./node_modules/.prisma/client/**/*", "./node_modules/@prisma/client/**/*"],
  },
  allowedDevOrigins: ["https://thin-ants-write.loca.lt", "https://red-onions-lay.loca.lt"],
};

export default nextConfig;
