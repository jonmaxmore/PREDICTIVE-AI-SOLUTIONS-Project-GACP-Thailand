'use client';

import { toast } from 'sonner';

type NotificationPayload = {
  id?: string;
  title?: string;
  message?: string;
  color?: string;
  autoClose?: number | boolean;
  [key: string]: unknown;
};

export const notifications = {
  show(payload: NotificationPayload): string {
    const id = payload.id ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const opts = { id, description: payload.message };
    if (payload.color === 'red') {
      toast.error(payload.title ?? '', opts);
    } else if (payload.color === 'green') {
      toast.success(payload.title ?? '', opts);
    } else if (payload.color === 'yellow' || payload.color === 'orange') {
      toast.warning(payload.title ?? '', opts);
    } else {
      toast(payload.title ?? '', opts);
    }
    return id;
  },
  update(payload: NotificationPayload): string {
    return notifications.show(payload);
  },
  hide(id: string) {
    toast.dismiss(id);
  },
  clean() {
    toast.dismiss();
  },
  cleanQueue() {
    toast.dismiss();
  },
};
