/**
 * Offline place lookup over the loaded features. There is no geocoder in this
 * app by design, so "Daan Station" has to resolve against the same GeoJSON the
 * map draws. Pure function of (query, features) so it is trivially testable.
 *
 * Ranking is deliberately coarse — exact beats prefix beats substring — because
 * the caller only has to decide "one confident answer" vs "ask the human".
 */
import type { GazetteerEntry, GlassMapFeature } from "@/lib/data/schema";
import type { LngLat } from "@/lib/store/map-store";
import { distanceMeters, featureCenter } from "./output";
import { round5 } from "./state";

export interface GazetteerMatch extends GazetteerEntry {
  /** See SCORE: 4 exact name, 3 exact after station wording is stripped, 2 prefix, 1 substring. */
  score: number;
}

/**
 * An exact hit on the name as written outranks one that needed suffix
 * stripping — otherwise "大安森林公園" could not tell the park apart from
 * 大安森林公園站, and the park is what the human said.
 */
const SCORE = { exact: 4, exactStripped: 3, prefix: 2, substring: 1 } as const;

/**
 * What an ambiguous lookup shows the agent so it can retry with feature_id.
 * Chain stores share a name (208 branches are called 全聯福利中心 in the real
 * data), so distance is the only field that tells the candidates apart.
 */
export interface PlaceCandidate {
  id: string;
  name: string;
  name_en?: string;
  category: GazetteerEntry["category"];
  /** Metres from the current view centre, when the caller supplied one. */
  distance_m?: number;
}

export type PlaceResolution =
  | { kind: "found"; entry: GazetteerMatch }
  | { kind: "ambiguous"; candidates: PlaceCandidate[] }
  | { kind: "none" };

export const AMBIGUOUS_CANDIDATE_LIMIT = 5;

/**
 * Station names appear with and without the suffix in both languages, and users
 * type either. Longest pattern first: 捷運站 must not be cut down to 捷運.
 */
const SUFFIX_PATTERNS = [/捷運站$/, /車站$/, /站$/, /\s*\bmrt\s+station$/i, /\s*\bstation$/i, /\s*\bmrt$/i];
const PREFIX_PATTERNS = [/^捷運/, /^mrt\s+/i];

/**
 * Latin transcriptions of Taipei names are punctuated inconsistently — OSM has
 * "Da-an Forest Park" and "Da'an District" while people type "Daan ...". Fold
 * the separators away on both sides so spelling does not decide the answer.
 */
const PUNCTUATION = /[-\u2010-\u2015'\u2018\u2019\u02bc.\u00b7\u2022]/g;

export const normaliseName = (s: string) =>
  s.trim().toLowerCase().replace(PUNCTUATION, "").replace(/\s+/g, " ");

/** Normalised form with at most one station prefix and one station suffix removed. */
export function stripPlaceSuffix(raw: string): string {
  let s = normaliseName(raw);
  for (const p of PREFIX_PATTERNS) {
    if (p.test(s)) {
      s = s.replace(p, "");
      break;
    }
  }
  for (const p of SUFFIX_PATTERNS) {
    if (p.test(s)) {
      s = s.replace(p, "");
      break;
    }
  }
  return s.trim();
}

function pairScore(query: string, candidate: string, exact: number): number {
  if (!query || !candidate) return 0;
  if (query === candidate) return exact;
  if (candidate.startsWith(query)) return SCORE.prefix;
  if (candidate.includes(query)) return SCORE.substring;
  return 0;
}

function toEntry(feature: GlassMapFeature): GazetteerEntry | null {
  const p = feature?.properties;
  if (!p?.id || !p.name) return null;
  const center = featureCenter(feature);
  if (!center) return null;
  return {
    id: p.id,
    name: p.name,
    nameEn: p.nameEn,
    category: p.category,
    center: [round5(center[0]), round5(center[1])],
  };
}

/** Every named, locatable feature, usable as a place. */
export function buildGazetteer(features: readonly GlassMapFeature[]): GazetteerEntry[] {
  return features.map(toEntry).filter((e): e is GazetteerEntry => e !== null);
}

/** Ranked matches, best first. Empty when the query is blank or matches nothing. */
export function resolvePlace(query: string, features: readonly GlassMapFeature[]): GazetteerMatch[] {
  if (typeof query !== "string") return [];
  const qRaw = normaliseName(query);
  if (!qRaw) return [];
  const qStripped = stripPlaceSuffix(query);

  const matches: GazetteerMatch[] = [];
  for (const entry of buildGazetteer(features)) {
    let score = 0;
    // GazetteerEntry.aliases exists in the schema but no dataset fills it in;
    // matching name and nameEn is all the real data supports today.
    for (const name of [entry.name, entry.nameEn]) {
      if (!name) continue;
      score = Math.max(
        score,
        pairScore(qRaw, normaliseName(name), SCORE.exact),
        pairScore(qStripped, stripPlaceSuffix(name), SCORE.exactStripped),
      );
    }
    if (score > 0) matches.push({ ...entry, score });
  }

  // Stable order: best score, then the shortest name (the most specific match
  // for a prefix query), then id so two runs never disagree.
  return matches.sort(
    (a, b) => b.score - a.score || a.name.length - b.name.length || a.id.localeCompare(b.id),
  );
}

export function toPlaceCandidate(entry: GazetteerEntry, from?: LngLat | null): PlaceCandidate {
  const c: PlaceCandidate = { id: entry.id, name: entry.name, category: entry.category };
  if (entry.nameEn) c.name_en = entry.nameEn;
  if (from) c.distance_m = distanceMeters(from, entry.center);
  return c;
}

/**
 * Confidence rule: a single best-scoring match wins. Two matches of equal
 * quality are ambiguous — the tool must ask rather than guess, because moving
 * the map to the wrong "大安" is invisible to an agent that cannot see pixels.
 */
export function resolvePlaceOne(
  query: string,
  features: readonly GlassMapFeature[],
  from?: LngLat | null,
): PlaceResolution {
  const matches = resolvePlace(query, features);
  if (matches.length === 0) return { kind: "none" };
  const best = matches.filter((m) => m.score === matches[0].score);
  if (best.length > 1) {
    // Equally named candidates are only useful if the agent can tell them
    // apart, so offer the nearest ones to where the human is already looking.
    const candidates = best.map((e) => toPlaceCandidate(e, from));
    if (from) candidates.sort((a, b) => (a.distance_m ?? 0) - (b.distance_m ?? 0));
    return { kind: "ambiguous", candidates: candidates.slice(0, AMBIGUOUS_CANDIDATE_LIMIT) };
  }
  return { kind: "found", entry: matches[0] };
}
