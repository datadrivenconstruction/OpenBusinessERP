// DDC-CWICR-OE: DataDrivenConstruction · OpenBusinessERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
/**
 * Address-to-Nominatim query builder, factored out of ``ProjectMap.tsx``
 * so that consumers can call it without pulling in the full ``react-map-gl``
 * + ``maplibre-gl`` chunk (and crucially the ~220 KB maplibre CSS that
 * lives as a side-effect import in ``ProjectMap.tsx``).
 *
 * Pure string-builder. Zero runtime deps.
 */
export function buildGeocodeQuery(
  address?: string | null,
  city?: string | null,
  country?: string | null,
): string | null {
  const parts = [address, city, country].filter(
    (p): p is string => !!p && p.trim().length > 0,
  );
  if (parts.length === 0) return null;
  return parts.join(', ');
}

export interface GeocodeSuggestion {
  lat: string | number;
  lon: string | number;
}

/** No geocoder backend ships with the business build: a map with only a text
 *  address has nothing to pin, so callers get an empty result. */
export async function geocodeSuggest(
  _query: string,
  _opts?: { limit?: number; signal?: AbortSignal },
): Promise<{ suggestions: GeocodeSuggestion[] }> {
  return { suggestions: [] };
}
