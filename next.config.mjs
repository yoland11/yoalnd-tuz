/** @type {import('next').NextConfig} */
const nextConfig = {
  output: undefined,
  serverExternalPackages: ["pg"],
  transpilePackages: ["@workspace/api-client-react", "@workspace/api-zod", "@workspace/db"],
};

export default nextConfig;
