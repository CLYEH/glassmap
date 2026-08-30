import type { GlassMapFeature } from "@/lib/data/schema";
import type { MapCategory, MapFeature } from "@/lib/store/tier2";

/** One row of the sidebar's selection list. */
export interface SelectedRow {
  id: string;
  /** The feature name, or the id when the feature is not (yet) loaded. */
  name: string;
  /** null when nothing in the loaded data has this id. */
  category: MapCategory | null;
  /** Fabricated demo data, which the UI has to say out loud. */
  sample: boolean;
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
    if (!feature) return { id, name: id, category: null, sample: false };
    return {
      // A POI with no `name` is normal — a nameless car park is still a place
      // you can park — so the English name is tried before falling back to the
      // id. Every bundled feature has a local name, so this only ever fires
      // for tier-2.
      id,
      name: feature.properties.name || feature.properties.nameEn || id,
      category: feature.properties.category,
      sample: feature.properties.sample === true,
    };
  });
}
