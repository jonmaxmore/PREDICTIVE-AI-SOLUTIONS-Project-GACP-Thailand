// This module moved to a shared location so both the applicant preview and the
// provider read-only document view can render the same 9-section application
// document. Kept as a re-export shim to avoid touching existing import paths.
export * from '@/components/application/application-document-helpers';
export type {
  ApplicationData,
  UploadedDocument,
  FormDataShape,
} from '@/components/application/application-document-helpers';
