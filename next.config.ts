import { withSentryConfig } from "@sentry/nextjs";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  env: {
    // Inlined at build time so instrumentation-client.ts can tag Sentry events
    // with the real deployment environment. Relying on the "Automatically
    // expose System Environment Variables" project toggle for this would be
    // silent and easy to leave off; setting it here works unconditionally,
    // since VERCEL_ENV is always present in the build step regardless of
    // that toggle (which only governs its default NEXT_PUBLIC_ exposure).
    NEXT_PUBLIC_VERCEL_ENV: process.env.VERCEL_ENV,
  },
  webpack: (config) => {
    // Suppress Supabase realtime warnings
    config.ignoreWarnings = [
      {
        module: /node_modules\/@supabase\/realtime-js/,
        message: /Critical dependency: the request of a dependency is an expression/,
      },
    ];
    
    return config;
  },
};

export default withSentryConfig(nextConfig, {
  // For all available options, see:
  // https://github.com/getsentry/sentry-webpack-plugin#options
  
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  
  // Only print logs for uploading source maps in CI
  silent: !process.env.CI,
  
  // For all available options, see:
  // https://docs.sentry.io/platforms/javascript/guides/nextjs/manual-setup/
  
  // Upload a larger set of source maps for prettier stack traces (increases build time)
  widenClientFileUpload: true,

  // Uploads source maps to Sentry for readable stack traces (requires
  // SENTRY_AUTH_TOKEN; falls back to no-op with a warning if it's unset).
  // Uploaded maps are deleted from the build output afterward by default,
  // so they are never served publicly.
});
