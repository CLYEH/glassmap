import type { GlassMapFeature } from "@/lib/data/schema";
import { featureBounds } from "@/lib/map-tools/output";
import type { Bounds } from "@/lib/store/map-store";
import type { MapCategory, MapFeature } from "@/lib/store/tier2";
import { featureDetails, sameText, type DetailRow } from "./feature-details";

/**
 * One selected feature, resolved. The sidebar renders every row of these and
 * the tap card renders one (`card-model`), so the two surfaces cannot disagree
 * about what a place is called or what it carries — each shows the part it has
 * room for.
 */
export interface SelectedRow {
  id: string;
  /** The feature name, or the id when the feature is not (yet) loaded. */
  name: string;
  /**
   * The OSM English name, present only when the source has one *and* it is not
   * the name above it. Absent means absent: nothing on this page romanises a
   * name the data does not carry, and a place whose two names are the same
   * string is printed once.
   */
  nameEn?: string;
  /** null when nothing in the loaded data has this id. */
  category: MapCategory | null;
  /** Fabricated demo data, which the UI has to say out loud. */
  sample: boolean;
  /** The OSM tags a human can be shown; empty for bundled features and unknown ids. */
  details: DetailRow[];
  /**
   * [west, south, east, north] of the feature, or null when there is nothing to
   * point a camera at: an id nothing has loaded, or a geometry turf could not
   * box. It is what makes the row clickable — the sidebar offers to fly to a
   * row only when this is non-null, so a "not loaded" row can still be
   * deselected but never pretends to know where its place is. A point feature's
   * box is its own coordinate twice over (`frame-model.hasExtent` is false),
   * which is exactly how the framing tells a place from an area.
   */
  bounds: Bounds | null;
}

/**
 * Turns `store.selection` (ids) into rows the sidebar can render.
 *
 * Both tiers are looked up. The store keeps POIs out of `features` so the six
 * bundled datasets keep rendering exactly as they did, but a selected cafe is
 * still a selected feature: reading only `features` left the sidebar showing a
 * raw `osm:node:…` id — or, once the id resolved nowhere, "not loaded" — for a
 * place the agent had just named out loud. Bundled features win a shared id,
 * the same precedence the store applies when it appends a tier-2 category.
 *
 * Unknown ids are kept as rows rather than dropped: a tool can select an id
 * before the datasets finish loading, or an id that does not exist at all, and
 * the sidebar has to stay consistent with `selection-count` instead of quietly
 * showing fewer entries than the agent believes it selected.
 */
export function resolveSelection(
  features: readonly GlassMapFeature[],
  selection: readonly string[],
  tier2: readonly MapFeature[] = [],
): SelectedRow[] {
  // Only the selected ids are ever looked up, so the index is built from the
  // selection rather than from the (up to 31k) tier-2 slice.
  const wanted = new Set(selection);
  const byId = new Map<string, GlassMapFeature | MapFeature>();
  for (const feature of tier2) {
    if (wanted.has(feature.properties.id)) byId.set(feature.properties.id, feature);
  }
  for (const feature of features) {
    if (wanted.has(feature.properties.id)) byId.set(feature.properties.id, feature);
  }
  return selection.map((id) => {
    const feature = byId.get(id);
    if (!feature) {
      return { id, name: id, category: null, sample: false, details: [], bounds: null };
    }
    const properties = feature.properties;
    // A POI with no `name` is normal — a nameless car park is still a place
    // you can park — so the English name is tried before falling back to the
    // id. Every bundled feature has a local name, so this only ever fires
    // for tier-2.
    const name = properties.name || properties.nameEn || id;
    const nameEn = properties.nameEn;
    return {
      id,
      name,
      // Not when it is the headline itself, which is both the nameless-POI
      // fallback above and 32 of the cafes in the shipped extract, whose
      // `name` and `nameEn` are the same string.
      ...(nameEn && !sameText(nameEn, name) ? { nameEn } : {}),
      category: properties.category,
      sample: properties.sample === true,
      details: featureDetails(properties, [name, nameEn ?? ""]),
      bounds: featureBounds(feature),
    };
  });
}
