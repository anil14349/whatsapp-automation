import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  typedRoutes: true,
  // A stray lockfile elsewhere on this machine (outside the repo) made
  // Next.js guess the wrong workspace root — pin it explicitly.
  outputFileTracingRoot: __dirname,
  // Produces .next/standalone: a minimal, self-contained server bundle
  // (only the node_modules actually used, traced automatically) that
  // the Dockerfile copies wholesale instead of shipping the whole
  // repo + full node_modules into the image. Doesn't affect `next dev`
  // or a non-containerized `next start` at all.
  output: "standalone"
};

export default nextConfig;
