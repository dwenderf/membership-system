// Organization configuration - update these values for your organization
export const organizationConfig = {
  name: {
    short: "NYCPHA",                    // Used in navigation, headers, buttons
    long: "NYC Pride Hockey Alliance"   // Used in formal documents, emails, legal text
  },
  contact: {
    email: "finance@nycpha.org",
    phone: "",
    website: "www.nycpha.org"
  },
  branding: {
    // Future logo paths can be added here
    logo: {
      main: "/images/logo.png",           // Main logo
      small: "/images/logo-small.png",    // Small logo for navigation
      icon: "/images/icon.png"            // Favicon/app icon
    },
    colors: {
      // From Brand_Guideline_LibertyTide.pdf. Not wired into Tailwind — see
      // the brand tokens in src/app/globals.css, which are the source of truth.
      primary: "#6DCCC8",    // Liberty Tide
      secondary: "#296163"   // Deep Green
    }
  },
  features: {
    // Feature flags can be added here
    xeroIntegration: true,
    membershipRenewalReminders: true,
    waitlistNotifications: true
  }
} as const;

// Type exports for TypeScript usage
export type OrganizationConfig = typeof organizationConfig;
export type OrganizationName = typeof organizationConfig.name;
export type OrganizationContact = typeof organizationConfig.contact;
export type OrganizationBranding = typeof organizationConfig.branding;