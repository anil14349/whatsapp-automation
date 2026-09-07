import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  typedRoutes: true,
  // A stray lockfile elsewhere on this machine (outside the repo) made
  // Next.js guess the wrong workspace root — pin it explicitly.
  outputFileTracingRoot: __dirname
};

export default nextConfig;
