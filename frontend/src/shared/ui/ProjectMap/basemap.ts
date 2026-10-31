/**
 * Basemap sources shared by every map surface: OpenFreeMap vector styles for
 * street maps and public OpenStreetMap raster tiles for the static fallback.
 */

import { useThemeStore } from '@/stores/useThemeStore';

/** XYZ template for the raster fallback basemap: public OpenStreetMap tiles. */
export const PROXY_TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';

/** Base path (without ``/{z}/{x}/{y}.png``) for static single-tile thumbnails. */
export const PROXY_TILE_BASE = 'https://tile.openstreetmap.org';

/**
 * Deepest zoom the relief source has. Asking past it returns a blank tile,
 * so raster consumers must clamp: Cesium via ``maximumLevel``, the card
 * thumbnail's relief FALLBACK by requesting this zoom directly. The card's
 * normal picture is a vector snapshot and is not bound by this ceiling.
 */
export const RELIEF_MAX_ZOOM = 6;

/** Public OpenFreeMap style for a street basemap. */
export function basemapStyleUrl(name: BasemapStyleName): string {
  return `https://tiles.openfreemap.org/styles/${name}`;
}

/**
 * The vendored OpenFreeMap styles the backend serves. All three are street
 * maps with named roads and place labels in the local script: ``liberty`` is
 * full colour, ``positron`` light and desaturated, ``dark`` the same streets
 * for the dark theme. None of them draws shaded relief; the backend strips
 * that layer when vendoring, because blended under a zoomed-out map it made
 * the street map read as a terrain map.
 */
export type BasemapStyleName = 'liberty' | 'positron' | 'dark';

/** Full-colour street cartography. The default for every interactive map. */
export const VECTOR_BASEMAP_STYLE_URL = basemapStyleUrl('liberty');

/** The same streets for the dark theme. */
export const DARK_VECTOR_BASEMAP_STYLE_URL = basemapStyleUrl('dark');

/**
 * The street style for a theme. Every interactive street map picks its style
 * through this (or ``useStreetBasemapStyleUrl``) so a page never hardcodes a
 * style of its own.
 */
export function streetBasemapStyleUrl(theme: 'light' | 'dark'): string {
  return theme === 'dark' ? DARK_VECTOR_BASEMAP_STYLE_URL : VECTOR_BASEMAP_STYLE_URL;
}

/** ``streetBasemapStyleUrl`` for the theme the app is showing right now. */
export function useStreetBasemapStyleUrl(): string {
  return streetBasemapStyleUrl(useThemeStore((s) => s.resolved));
}

/** Plain-text credit for the raster fallback tiles (OpenStreetMap, ODbL). */
export const RELIEF_ATTRIBUTION = '© OpenStreetMap contributors';

/**
 * The same credit as linked HTML, for MapLibre's ``AttributionControl``.
 *
 * Exported as ONE constant on purpose. This string used to be pasted
 * literally into three components; a migration that updated two of them
 * would have left the third crediting the wrong provider, and nothing in
 * the build would have said so. Import it, never retype it.
 *
 * OpenStreetMap is credited because the data is ODbL and a rendered map is
 * a Produced Work, which owes attribution. OpenMapTiles and OpenFreeMap are
 * credited as the tile schema and the tile provider.
 *
 * This is the credit for the VECTOR surfaces. The raster relief surfaces
 * carry ``RELIEF_ATTRIBUTION`` instead, because they show different data.
 */
export const TILE_ATTRIBUTION_HTML =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors ' +
  '&copy; <a href="https://openmaptiles.org/">OpenMapTiles</a> ' +
  '&copy; <a href="https://openfreemap.org/">OpenFreeMap</a>';

/**
 * The vector credit as plain text, for surfaces that render it as text
 * rather than as markup.
 *
 * The project card is one: it shows a rendered snapshot inside a card that
 * navigates on click, where an anchor is either a click target competing
 * with the card or a link that looks like one and is not. Plain text in a
 * small chip is the honest shape there, and the interactive map the card
 * leads to carries the linked credit in full.
 *
 * DERIVED, not retyped, and derived from the VALUE rather than from this
 * file's source text. Retyping is the exact defect the constant above
 * exists to prevent, and slicing a constant out of module source is the
 * defect the attribution test documents in its own history: a checkout
 * with CRLF terminators broke the slice and the assertion silently began
 * reading a different constant. Reading the value through the module
 * system cannot drift from the value.
 */
export const TILE_ATTRIBUTION_TEXT = TILE_ATTRIBUTION_HTML.replace(/<[^>]*>/g, '')
  .replace(/&copy;/g, '©')
  .replace(/\s+/g, ' ')
  .trim();
