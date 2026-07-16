/** @type {import('next').NextConfig} */
const nextConfig = {
  output: undefined,
  serverExternalPackages: ["pg"],
  transpilePackages: ["@workspace/api-client-react", "@workspace/api-zod", "@workspace/db"],
  allowedDevOrigins: ["localhost", "127.0.0.1"],
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
          {
            key: "Content-Security-Policy",
            value: "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https: http:; font-src 'self' data:; connect-src 'self' https:; media-src 'self' data: blob: https: http:",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
