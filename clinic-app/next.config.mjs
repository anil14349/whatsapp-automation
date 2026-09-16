import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
    reactStrictMode: true,

    // Produces .next/standalone: a self-contained server with only the
    // dependencies actually reached, so the runtime image carries no
    // node_modules and no build tooling.
    output: "standalone",

    // There are lockfiles above this directory and Next was picking one of them
    // as the workspace root, which traces files that are not part of this app
    // and misses ones that are.
    outputFileTracingRoot: here
};

export default nextConfig;
