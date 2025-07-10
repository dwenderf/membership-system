import { organizationConfig } from '@/config/organization';

// Helper functions to get organization info
export function getOrganizationName(variant: 'short' | 'long' = 'short'): string {
  return organizationConfig.name[variant];
}

export function getOrganizationContact() {
  return organizationConfig.contact;
}

export function getOrganizationBranding() {
  return organizationConfig.branding;
}

// Convenience function for common use cases
export function getSystemTitle(): string {
  return `${getOrganizationName('short')} Membership System`;
}

export function getWelcomeMessage(): string {
  return `Welcome to the ${getOrganizationName('long')}!`;
}

export function getCopyrightText(): string {
  const year = new Date().getFullYear();
  return `© ${year} ${getOrganizationName('long')}. All rights reserved.`;
}

// Export the full config for direct access if needed
export { organizationConfig };