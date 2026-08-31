import { describe, expect, it } from "vitest";
import { DETAIL_CHARS, featureDetails, sameText } from "./feature-details";

/**
 * The parity rule, in one function: every tag a tool returns about a POI
 * (`describeFeature` — cuisine, brand, opening_hours) has to be readable by the
 * human whose map it is. What matters in these tests is not that three strings
 * come back but *which* three, in what order, and what happens when the data
 * has none of them — because 3 out of 4 POIs in the shipped extract are missing
 * any given one, and a surface that prints labels for absent tags is worse than
 * one that prints nothing.
 */
describe("featureDetails", () => {
  const full = { cuisine: "coffee_shop", brand: "Louisa Coffee", opening_hours: "Mo-Su 07:00-21:00" };

  it("reads the three tags a POI answer is made of, in one fixed order", () => {
    // Fixed so the card never reshuffles between two places: what it serves,
    // whose sign is over the door, when you can go.
    expect(featureDetails(full).map((d) => [d.field, d.label, d.text])).toEqual([
      ["cuisine", "Cuisine", "coffee_shop"],
      ["brand", "Brand", "Louisa Coffee"],
      ["opening_hours", "Hours", "Mo-Su 07:00-21:00"],
    ]);
  });

  it("omits a tag the source does not carry rather than labelling a blank", () => {
    // The common case: only 22%/31%/25% of the 31k POIs carry each tag, so a
    // layout that reserved a row per field would be mostly empty labels.
    expect(featureDetails({ cuisine: "ramen" }).map((d) => d.field)).toEqual(["cuisine"]);
    expect(featureDetails({})).toEqual([]);
    // A tag present but empty is an absent tag, not a row with nothing in it.
    expect(featureDetails({ brand: "   " })).toEqual([]);
  });

  it("does not print a brand the surface has already shown as the name", () => {
    // 2911 of the 2919 branded convenience stores in the extract have
    // `brand === name`. "Brand 7-ELEVEN" under the headline "7-ELEVEN" is a
    // row with no information in it; the string itself is still on the card.
    expect(featureDetails(full, ["Louisa Coffee"]).map((d) => d.field)).toEqual([
      "cuisine",
      "opening_hours",
    ]);
    // Same sign, different capitals and spacing: still the same thing to read.
    expect(featureDetails({ brand: "7-Eleven" }, [" 7-ELEVEN "])).toEqual([]);
    // A different name is not a duplicate: the local name and the brand can
    // legitimately differ, and dropping that would hide the chain.
    expect(featureDetails({ brand: "Starbucks" }, ["星巴克"]).map((d) => d.field)).toEqual(["brand"]);
  });

  it("silences no field but brand, whatever the place is called", () => {
    // The dedupe is about what `brand` *means* — another name for the place —
    // not about string equality in general. A tag that happens to read like
    // the name is still a fact about the place: a cafe called "Coffee Shop"
    // still serves coffee, and (T-97) a place called "Yes" is still the one
    // with the ramp. Dropping those would be a data-dependent silence nobody
    // could see on the page.
    expect(featureDetails({ cuisine: "coffee_shop" }, ["coffee_shop"]).map((d) => d.field)).toEqual([
      "cuisine",
    ]);
    expect(
      featureDetails({ opening_hours: "24/7" }, ["24/7"]).map((d) => d.field),
    ).toEqual(["opening_hours"]);
  });

  it("folds a long value for the card and keeps the whole of it for the hover", () => {
    // Dense OSM hours run to 88 characters in the shipped extract. The card is
    // 238px wide; the row still has to say *something* readable, and the rest
    // has to remain reachable rather than be destroyed.
    const hours = "Mo-Th 11:00-21:00; Fr 11:00-22:00; Sa 14:00-17:45,19:00-22:00";
    const [row] = featureDetails({ opening_hours: hours });
    // Literal, not derived from DETAIL_CHARS: the assertions below hold for a
    // clip of 1 character too, and a card that shows "…" is not a card that
    // told anyone when the place opens.
    expect(row.text).toContain("Mo-Th 11:00-21:00; Fr 11:00");
    expect(row.text).toHaveLength(DETAIL_CHARS);
    expect(row.text.endsWith("…")).toBe(true);
    expect(hours.startsWith(row.text.slice(0, -1))).toBe(true);
    expect(row.full).toBe(hours);
  });

  it("shows opening hours verbatim — this page never claims a place is open", () => {
    // The no-parser decision (see the comment in DETAIL_FIELDS): a wrong "open
    // now" sends someone to a shuttered shop, and the OSM syntax has months,
    // holidays and sunset offsets to get wrong. The value is what OSM says,
    // character for character, and the label is a noun rather than a verdict.
    const raw = "Su-Th 11:00-21:00; PH off";
    const [row] = featureDetails({ opening_hours: raw });
    expect(row.full).toBe(raw);
    expect(row.text).toBe(raw);
    expect(row.label).toBe("Hours");
  });
});

describe("sameText", () => {
  it("matches only what a person would read as the same words", () => {
    expect(sameText("Kebuke", " kebuke ")).toBe(true);
    // Two scripts are two things to read. Nothing here transliterates, so a
    // local name and an English name are never folded into one.
    expect(sameText("星巴克", "Starbucks")).toBe(false);
  });
});
