import type { FeatureCategory, GlassMapFeature } from "@/lib/data/schema";

/** One row of the sidebar's selection list. */
export interface SelectedRow {
  id: string;
  /** The feature name, or the id when the feature is not (yet) loaded. */
  name: string;
  /** null when nothing in the loaded data has this id. */
  category: FeatureCategory | null;
  /** Fabricated demo data, which the UI has to say out loud. */
  sample: boolean;
}

/**
 * Turns `store.selection` (ids) into rows the sidebar can render.
 *
 * Unknown ids are kept as rows rather than dropped: a tool can select an id
 * before the datasets finish loading, or an id that does not exist at all, and
 * the sidebar has to stay consistent with `selection-count` instead of quietly
 * showing fewer entries than the agent believes it selected.
 */
export function resolveSelection(
  features: readonly GlassMapFeature[],
  selection: readonly string[],
): SelectedRow[] {
  const byId = new Map(features.map((feature) => [feature.properties.id, feature]));
  return selection.map((id) => {
    const feature = byId.get(id);
    if (!feature) return { id, name: id, category: null, sample: false };
    return {
      id,
      name: feature.properties.name || id,
      category: feature.properties.category,
      sample: feature.properties.sample === true,
    };
  });
}
