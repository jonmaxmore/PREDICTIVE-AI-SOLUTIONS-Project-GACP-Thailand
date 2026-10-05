import { useState } from "react";
import { CheckCircle2, Eye, ExternalLink, FileText, Unlock, X } from "lucide-react";
import { Badge } from '@/components/ui/primitives/badge';
import { Button } from '@/components/ui/primitives/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/primitives/card';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/primitives/dialog';
import { cn } from "@/lib/utils";
import { resolveDocumentUrl, DOCUMENT_FIELDS, type FormDataRecord } from "./provider-application-detail-config";
import { useLanguage } from '@/lib/i18n/language-context';
import { safeSrc } from '@/lib/safe-url';

export function DocumentsTabPanel({
  formData,
  revisionRequest
}: {
  formData: FormDataRecord;
  revisionRequest: Record<string, unknown> | null;
}) {
  const { dict } = useLanguage();
  const docDict = dict.provider?.documentsTab;
  const [previewDocUrl, setPreviewDocUrl] = useState<string | null>(null);
  // DR-6: mobile preview is a dialog because the inline preview pane
  // hides on `< xl` (1280 px). Tapping "Preview" on a phone previously
  // did nothing; we now open the same iframe in a Dialog so reviewers
  // are not blocked when working from a tablet / phone.
  const [mobilePreviewOpen, setMobilePreviewOpen] = useState(false);

  const handlePreview = (url: string) => {
    setPreviewDocUrl(url);
    setMobilePreviewOpen(true);
  };

  return (
    <>
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Card className="overflow-hidden rounded-lg border-border bg-card shadow-none">
          <CardHeader className="border-b border-border/50 bg-muted/30 px-6 py-3">
            <CardTitle className="text-xs font-medium text-foreground">{docDict?.checklist || 'Document Checklist'}</CardTitle>
          </CardHeader>
          <div className="divide-y divide-border/50">
            {DOCUMENT_FIELDS.map((doc) => {
              const url = resolveDocumentUrl(formData, doc.key);
              const revisionItemsList = revisionRequest && Array.isArray(revisionRequest.items) ? (revisionRequest.items as string[]) : [];
              const isRevisionTarget = revisionItemsList.some((item) =>
                item.toLowerCase().includes(doc.name.toLowerCase()) || item.toLowerCase().includes(doc.key.toLowerCase())
              );
              return (
                <div key={doc.key} className={cn(
                  "flex items-center justify-between p-4 transition-colors hover:bg-muted/20",
                  isRevisionTarget && "bg-warning/10"
                )}>
                  <div className="flex items-center gap-3">
                    <span className={cn(
                      "shrink-0",
                      url ? "text-leaf-700" : "text-muted-foreground"
                    )} aria-hidden="true">
                      {url ? <CheckCircle2 className="h-4 w-4" /> : <X className="h-4 w-4" />}
                    </span>
                    <div>
                      <span className="text-sm text-foreground">{doc.name}</span>
                      {isRevisionTarget && (
                        <div className="mt-0.5 flex items-center gap-1">
                          <Unlock className="h-3 w-3 text-warning" />
                          <span className="text-xs font-medium text-warning">{docDict?.needsRevision || 'ต้องแก้ไข'}</span>
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    {url && (
                      <Button size="sm" variant="ghost" className="rounded-md text-info hover:bg-info/10" onClick={() => handlePreview(url)}>
                        <Eye className="mr-1 h-4 w-4" /> {docDict?.previewBtn || 'Preview'}
                      </Button>
                    )}
                    {url ? (
                      <Button asChild size="sm" variant="ghost" className="rounded-md text-primary hover:bg-primary/10">
                        <a href={url} target="_blank" rel="noreferrer">
                          <ExternalLink className="mr-1 h-4 w-4" /> {docDict?.openBtn || 'Open'}
                        </a>
                      </Button>
                    ) : (
                      <Badge tone="neutral" className="rounded-md">{docDict?.missing || 'Missing'}</Badge>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </Card>

        {/* DR-6: keep the desktop split-pane preview at xl+ exactly as
            before so reviewers on a wide screen don't lose the inline
            iframe. */}
        <Card className="hidden overflow-hidden rounded-lg border-border bg-card shadow-none xl:block">
          <CardHeader className="border-b border-border/50 bg-muted/30 px-6 py-3">
            <CardTitle className="text-xs font-medium text-foreground">{docDict?.preview || 'Document Preview'}</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {previewDocUrl ? (
              <iframe
                src={safeSrc(previewDocUrl)}
                className="h-[600px] w-full border-0"
                title="ตัวอย่างเอกสาร"
              />
            ) : (
              <div className="flex h-[600px] flex-col items-center justify-center gap-3 text-muted-foreground">
                <FileText className="h-12 w-12 opacity-20" />
                <p className="text-sm font-medium">{docDict?.previewHint || 'Click "Preview" on a document to view it here'}</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* DR-6: mobile / tablet fallback. The Dialog is rendered for all
          breakpoints but the trigger is the same Preview button — on xl+
          the inline pane also updates so the dialog is redundant; closing
          it leaves the inline pane populated. On < xl the dialog is the
          only way to see the document. */}
      <Dialog
        open={mobilePreviewOpen}
        onOpenChange={(open) => {
          setMobilePreviewOpen(open);
          if (!open) {
            // Keep `previewDocUrl` so the inline pane on xl+ remains
            // populated for the next desktop session.
          }
        }}
      >
        <DialogContent
          className="w-[min(100%-1.5rem,920px)] max-w-[920px] xl:hidden"
          data-testid="document-preview-mobile"
        >
          <DialogHeader>
            <DialogTitle>{docDict?.mobilePreviewTitle || 'ตัวอย่างเอกสาร'}</DialogTitle>
            <DialogDescription className="sr-only">{docDict?.mobilePreviewDescription || 'ตัวอย่างเอกสารที่เลือก'}</DialogDescription>
          </DialogHeader>
          {previewDocUrl ? (
            <iframe
              src={safeSrc(previewDocUrl)}
              className="h-[70vh] w-full rounded-xl border-0"
              title="ตัวอย่างเอกสาร (มือถือ)"
            />
          ) : (
            <div className="flex h-[40vh] flex-col items-center justify-center gap-3 text-muted-foreground">
              <FileText className="h-10 w-10 opacity-20" />
              <p className="text-sm font-medium">{docDict?.mobilePreviewEmpty || 'ยังไม่ได้เลือกเอกสาร'}</p>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
