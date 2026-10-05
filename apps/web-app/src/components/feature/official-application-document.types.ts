import type { OrganizationConfig } from '@/config/document-config';

export type OfficialDocumentRow = {
  path?: string;
  label: string;
  value: string;
};

export type OfficialDocumentSection = {
  key: string;
  title: string;
  subtitle?: string;
  rows: OfficialDocumentRow[];
  /** If set, only render when applicant type matches */
  applicantBranch?: string[];
};

export type OfficialDocumentAttachment = {
  type: string;
  name: string;
  uploaded: boolean;
  required?: boolean;
  url?: string;
};

export type OfficialDocumentMeta = {
  label: string;
  value: string;
};

export type OfficialApplicationDocumentProps = {
  /** Organization config — defaults to DTAM_ORG from config */
  org?: OrganizationConfig;
  documentTitle: string;
  documentSubtitle?: string;
  metadata: OfficialDocumentMeta[];
  sections: OfficialDocumentSection[];
  attachments: OfficialDocumentAttachment[];
  /** Current applicant branch for conditional section rendering */
  applicantBranch?: string;
  onPrint?: () => void;
  showPrintButton?: boolean;
};
