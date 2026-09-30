import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      // Document uploads go through a Server Action. Files are capped at 4 MB in the app
      // (Vercel rejects request bodies over 4.5 MB); the rest is multipart overhead.
      bodySizeLimit: "4.5mb",
    },
  },
};

export default nextConfig;
