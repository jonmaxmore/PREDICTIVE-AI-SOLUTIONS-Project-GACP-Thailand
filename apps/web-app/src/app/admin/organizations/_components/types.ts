export interface Organization {
  id: string;
  slug: string;
  code: string;
  name: string;
  type: string;
  status: string;
  isolationTier: string;
  createdAt: string;
  contactEmail?: string | null;
}

export interface ListPayload {
  items: Organization[];
  nextCursor: string | null;
}

export interface CreatedUserPayload {
  user: { providerId: string; organizationId: string };
  generatedPassword: string | null;
  loginHint?: { loginPath: string; portal: string };
}
