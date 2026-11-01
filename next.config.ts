import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // libSQL ships native bindings for file: URLs; keep it out of the server bundle.
  serverExternalPackages: ["@libsql/client", "libsql"],
};

export default nextConfig;
