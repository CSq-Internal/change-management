import type { NextConfig } from "next";

// `output: 'standalone'` + explicit Prisma file-tracing are for the self-hosted
// CONTAINER image (Docker / Cloud Run). They must NOT be set on Vercel: Vercel
// packages functions with its own pipeline and rejects the pnpm-symlinked
// standalone output ("invalid deployment package ... files in symlinked directories").
const isVercel = !!process.env.VERCEL;

// The evidence PDF reads its embedded font from disk at runtime (src/server/pdf/evidence-document.tsx).
const pdfFonts = { "/api/changes/[id]/evidence.pdf": ["./src/server/pdf/fonts/*.ttf"] };

const nextConfig: NextConfig = isVercel
  ? { outputFileTracingIncludes: pdfFonts }
  : {
      output: "standalone",
      outputFileTracingIncludes: {
        "/**": ["./node_modules/.prisma/client/**/*", "./node_modules/@prisma/client/**/*"],
        ...pdfFonts,
      },
    };

export default nextConfig;
