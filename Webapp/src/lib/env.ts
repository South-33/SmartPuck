export const appEnv = {
  hasConvex: Boolean(process.env.NEXT_PUBLIC_CONVEX_URL),
  hasClerkPublishableKey: Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY),
  hasClerkSecretKey: Boolean(process.env.CLERK_SECRET_KEY),
  hasClerkIssuerDomain: Boolean(process.env.CLERK_JWT_ISSUER_DOMAIN),
  hasClerk:
    Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) &&
    Boolean(process.env.CLERK_SECRET_KEY) &&
    Boolean(process.env.CLERK_JWT_ISSUER_DOMAIN),
  preferredAuthProvider: "clerk" as const,
};
