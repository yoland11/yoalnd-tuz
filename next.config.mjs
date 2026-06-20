/** @type {import('next').NextConfig} */
const nextConfig = {
  output: undefined,
  serverExternalPackages: ["pg"],
  transpilePackages: ["@workspace/api-client-react", "@workspace/api-zod", "@workspace/db"],
  allowedDevOrigins: ["localhost", "127.0.0.1"],
};

export default nextConfig;
