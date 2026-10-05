'use client';

import { useEffect } from 'react';
import { MapContainer, TileLayer, Marker, useMapEvents } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import { resolveMapTileConfig } from '@/lib/config/map-tiles';
// RF-MAP-ICONS — self-host the Leaflet default marker icons.
// These three URLs previously pointed at a foreign US CDN, forcing a
// third-party asset fetch on every applicant who opened the farm-location
// wizard step. Self-hosting removes that third-party fetch entirely. The
// three Leaflet marker PNGs are committed under
// `public/leaflet/` and referenced by their same-origin string path — this
// avoids a PNG static-import (whose `*.png` type comes from the auto-generated,
// gitignored `next-env.d.ts`, so the CI standalone `tsc --noEmit` fails it with
// TS2307).
// The tile source is no longer hardcoded either: it comes from
// `lib/config/map-tiles`, which has no built-in default. Tile requests encode
// the area being viewed, so a foreign tile server learns roughly where a Thai
// farm is on every map view. With no in-country source configured this
// component renders coordinates as text instead of quietly falling back
// abroad — fail closed, not fail abroad.

type LeafletIconDefaultWithPrivate = L.Icon.Default & {
    _getIconUrl?: () => string;
};

// Fix Leaflet Default Icon — point it at the self-hosted (same-origin) assets.
delete (L.Icon.Default.prototype as LeafletIconDefaultWithPrivate)._getIconUrl;
L.Icon.Default.mergeOptions({
    iconRetinaUrl: '/leaflet/marker-icon-2x.png',
    iconUrl: '/leaflet/marker-icon.png',
    shadowUrl: '/leaflet/marker-shadow.png',
});

function LocationMarker({ position, onLocationSelect }: { position: [number, number] | null, onLocationSelect: (lat: number, lng: number) => void }) {
    const map = useMapEvents({
        click(e) {
            onLocationSelect(e.latlng.lat, e.latlng.lng);
            map.flyTo(e.latlng, map.getZoom());
        },
    });

    useEffect(() => {
        if (position) {
            map.flyTo(position, map.getZoom());
        }
    }, [position, map]);

    return position === null ? null : (
        <Marker position={position}></Marker>
    );
}

interface InteractiveMapProps {
    initialLat?: number;
    initialLng?: number;
    onLocationSelect: (lat: number, lng: number) => void;
}

export default function InteractiveMap({ initialLat, initialLng, onLocationSelect }: InteractiveMapProps) {
    const defaultPosition: [number, number] = [13.7563, 100.5018]; // Bangkok
    const position: [number, number] | null = initialLat && initialLng ? [initialLat, initialLng] : null;

    const tiles = resolveMapTileConfig();

    if (!tiles) {
        // No in-country tile source configured. Say so plainly and keep the
        // coordinates usable rather than drawing a map from a foreign server.
        return (
            <div
                role="status"
                className="flex h-full w-full flex-col items-center justify-center gap-2 rounded-lg border border-border bg-muted/40 p-4 text-center"
            >
                <p className="text-sm font-semibold text-foreground">ยังไม่ได้ตั้งค่าแผนที่</p>
                <p className="max-w-sm text-xs leading-relaxed text-muted-foreground">
                    ระบบยังไม่ได้เชื่อมต่อบริการแผนที่ในประเทศ จึงยังไม่แสดงภาพแผนที่
                    คุณยังระบุพิกัดได้ตามปกติ
                </p>
                {position ? (
                    <p className="text-xs font-medium tabular-nums text-foreground">
                        พิกัดที่เลือก: {position[0].toFixed(6)}, {position[1].toFixed(6)}
                    </p>
                ) : null}
            </div>
        );
    }

    return (
        <MapContainer center={position || defaultPosition} zoom={13} scrollWheelZoom={true} style={{ height: '100%', width: '100%' }}>
            <TileLayer attribution={tiles.attribution} url={tiles.url} />
            <LocationMarker position={position} onLocationSelect={onLocationSelect} />
        </MapContainer>
    );
}
