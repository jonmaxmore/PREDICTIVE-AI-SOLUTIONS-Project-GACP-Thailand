'use client';

import { useState } from 'react';

// เติมพิกัดจากตำแหน่งปัจจุบันของอุปกรณ์ลงช่องละติจูด/ลองจิจูด แล้วให้ฟอร์มบันทึกอัตโนมัติ
export function UseCurrentLocationButton({
  label,
  unavailableLabel,
  latitudeInputId,
  longitudeInputId,
}: {
  readonly label: string;
  readonly unavailableLabel: string;
  readonly latitudeInputId: string;
  readonly longitudeInputId: string;
}) {
  const [failed, setFailed] = useState(false);

  const locate = () => {
    if (!('geolocation' in navigator)) {
      setFailed(true);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const latitude = document.getElementById(latitudeInputId) as HTMLInputElement | null;
        const longitude = document.getElementById(longitudeInputId) as HTMLInputElement | null;
        if (!latitude || !longitude) return;
        latitude.value = position.coords.latitude.toFixed(6);
        longitude.value = position.coords.longitude.toFixed(6);
        longitude.dispatchEvent(new Event('input', { bubbles: true }));
        setFailed(false);
      },
      () => setFailed(true),
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  };

  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        onClick={locate}
        className="text-xs font-semibold text-leaf hover:underline"
      >
        {label}
      </button>
      {failed ? <span className="text-xs text-danger">{unavailableLabel}</span> : null}
    </span>
  );
}
