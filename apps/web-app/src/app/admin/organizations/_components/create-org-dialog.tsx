'use client';

import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { apiClient } from '@/lib/api/api-client';
import { Button } from '@/components/ui/primitives/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/primitives/dialog';
import { Input } from '@/components/ui/primitives/input';
import { Label } from '@/components/ui/primitives/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/primitives/select';

export function CreateOrgDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [code, setCode] = useState('');
  const [type, setType] = useState('PRIVATE_CERTIFIER');
  const [contactEmail, setContactEmail] = useState('');

  function reset() {
    setName('');
    setSlug('');
    setCode('');
    setType('PRIVATE_CERTIFIER');
    setContactEmail('');
    setFormError(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setFormError(null);
    try {
      const result = await apiClient.post('/api/platform-admin/organizations', {
        name: name.trim(),
        slug: slug.trim().toLowerCase(),
        code: code.trim().toUpperCase(),
        type,
        ...(contactEmail.trim() ? { contactEmail: contactEmail.trim() } : {}),
      });
      if (!result.success) {
        setFormError(result.error || 'ไม่สามารถสร้างองค์กรได้');
        return;
      }
      reset();
      onCreated();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'ไม่สามารถสร้างองค์กรได้');
    } finally {
      setSubmitting(false);
    }
  }

  function handleCancel() {
    reset();
    onClose();
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleCancel()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>สร้างองค์กรใหม่</DialogTitle>
          <DialogDescription>
            ทุกองค์กรเป็น tenant แยกในระดับข้อมูล slug และ code เปลี่ยนไม่ได้หลังสร้าง
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <Label htmlFor="org-name">ชื่อองค์กร *</Label>
            <Input
              id="org-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              maxLength={255}
            />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="org-slug">Slug (ตัวระบุลิงก์) *</Label>
              <Input
                id="org-slug"
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
                required
                placeholder="doa-chiangmai"
                pattern="^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$"
                title="lowercase, ขีดกลางได้, 1–64 ตัวอักษร"
              />
            </div>
            <div>
              <Label htmlFor="org-code">รหัสองค์กร (Code) *</Label>
              <Input
                id="org-code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                required
                placeholder="DOA_CMI"
                pattern="^[A-Z0-9](?:[A-Z0-9_]{0,30}[A-Z0-9])?$"
                title="UPPERCASE, ขีดล่างได้, 1–32 ตัวอักษร"
              />
            </div>
          </div>
          <div>
            <Label htmlFor="org-type">ประเภท</Label>
            <Select value={type} onValueChange={setType}>
              <SelectTrigger id="org-type" aria-label="ประเภทองค์กร">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="GOVERNMENT">หน่วยงานราชการ</SelectItem>
                <SelectItem value="PRIVATE_CERTIFIER">หน่วยรับรองเอกชน (Certifier)</SelectItem>
                <SelectItem value="COOPERATIVE">สหกรณ์</SelectItem>
                <SelectItem value="FOREIGN_STANDARD">มาตรฐานต่างประเทศ</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="org-email">อีเมลติดต่อ (ไม่บังคับ)</Label>
            <Input
              id="org-email"
              type="email"
              value={contactEmail}
              onChange={(e) => setContactEmail(e.target.value)}
            />
          </div>

          {formError && (
            <div className="rounded border border-destructive bg-destructive/5 px-3 py-2 text-sm text-destructive" role="alert" aria-live="polite">
              {formError}
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={handleCancel} disabled={submitting}>
              ยกเลิก
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting && <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden="true" />}
              {submitting ? 'กำลังสร้าง...' : 'สร้าง'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
