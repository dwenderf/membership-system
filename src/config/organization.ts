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
      // Future brand colors can be added here
      primary: "#3B82F6",    // Blue
      secondary: "#10B981"   // Green
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