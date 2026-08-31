import { describe, expect, it } from "vitest";
import { TIER2_TEXT_FIELDS } from "@/lib/store/tier2";
import {
  DETAIL_CHARS,
  DETAIL_FIELDS,
  featureDetails,
  linkHref,
  sameText,
} from "./feature-details";

/**
 * The parity rule, in one function: every tag a tool returns about a POI
 * (`get_place_details`, and cuisine/brand/opening_hours on every list answer)
 * has to be readable by the human whose map it is. What matters in these tests
 * is not that some strings come back but *which*, in what order, and what
 * happens when the data has none of them — because most POIs in the shipped
 * extract are missing any given tag, and a surface that prints labels for
 * absent tags is worse than one that prints nothing.
 */
describe("featureDetails", () => {
  const full = { cuisine: "coffee_shop", brand: "Louisa Coffee", opening_hours: "Mo-Su 07:00-21:00" };

  it("reads the three tags every POI list answer carries, in one fixed order", () => {
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

/**
 * T-97: the extract gained eleven tags, `get_place_details` gained the ability
 * to answer all of them, and this is the half that gets them in front of the
 * person whose map it is. The tests below are the parity rule applied to the
 * new fields — plus the one piece of copy in this module that is a decision
 * about what the page is allowed to claim.
 */
describe("the T-97 fields", () => {
  /** The richest shape the shipped extract can produce: 伯朗咖啡館, 7 of 14. */
  const cafe = {
    cuisine: "coffee_shop",
    brand: "Mr. Brown 伯朗咖啡館",
    opening_hours: "Mo-Fr 07:00-22:00; Sa-Su 07:30-22:00",
    address: "10489臺北市中山區南京東路二段218號",
    phone: "+886 2 2507 3600",
    website: "https://www.mrbrown.com.tw/",
    wheelchair: "yes",
  };

  it("shows every tag the store can hold, and never invents an order", () => {
    // The table IS the order — reach it, then contact, then what this kind of
    // place is asked about — and it is fixed so two cards never disagree about
    // where to look for the phone number.
    expect(DETAIL_FIELDS.map((f) => f.field)).toEqual([...TIER2_TEXT_FIELDS]);
  });

  it("carries a label for every field, and never the raw OSM key", () => {
    // A row headed `opening_hours` or `place_of_worship:denomination` is the
    // database leaking onto a card a person is reading. Every label is a word.
    for (const { field, label } of DETAIL_FIELDS) {
      expect(label, field).toMatch(/^[A-Z][a-z]+$/);
    }
  });

  it("prints the contact rows a person acts on, in the order they are used", () => {
    expect(featureDetails(cafe).map((d) => [d.field, d.label])).toEqual([
      ["cuisine", "Cuisine"],
      ["brand", "Brand"],
      ["opening_hours", "Hours"],
      ["address", "Address"],
      ["phone", "Phone"],
      ["website", "Website"],
      ["wheelchair", "Wheelchair"],
    ]);
  });

  it("shows the category-gated tags only for the places that carry them", () => {
    // Five categories have a tag nobody else has. A hotel card must not grow a
    // "Dispensing" row, and the reason it cannot is that the data decides:
    // absent is absent, here as everywhere else in this module.
    expect(featureDetails({ stars: "5" }).map((d) => [d.field, d.text])).toEqual([["stars", "5"]]);
    expect(featureDetails({ fee: "yes", capacity: "180" }).map((d) => d.label)).toEqual([
      "Fee",
      "Capacity",
    ]);
    expect(featureDetails({ dispensing: "no" }).map((d) => d.label)).toEqual(["Dispensing"]);
    expect(
      featureDetails({ religion: "christian", denomination: "catholic" }).map((d) => d.text),
    ).toEqual(["christian", "catholic"]);
    expect(featureDetails({ emergency: "yes" }).map((d) => d.label)).toEqual(["Emergency"]);
    // And a hotel's own row is the only one it gets.
    expect(featureDetails({ stars: "5", wheelchair: "yes" }).map((d) => d.field)).toEqual([
      "wheelchair",
      "stars",
    ]);
  });

  /**
   * The one row whose *words* are a ruling rather than a layout choice.
   *
   * "Wheelchair: limited" reports a tag one mapper recorded. "Wheelchair
   * accessible" asserts a fact nobody in this repo verified, about a door
   * somebody may be planning their afternoon around — and the repo's
   * no-accessibility-claims rule governs the page's copy exactly as it governs
   * the pitch. These assertions exist so that a later pass at "friendlier
   * wording" has to delete a test that says why, rather than quietly reword a
   * label.
   */
  it("reports the wheelchair tag and never claims accessibility", () => {
    for (const value of ["yes", "no", "limited"]) {
      const [row] = featureDetails({ wheelchair: value });
      // The label names the tag; it is not a verdict, a claim or an icon.
      expect(row.label).toBe("Wheelchair");
      // The value is OSM's own word, character for character. "limited" is the
      // one that proves it: no honest English sentence expands it.
      expect(row.text).toBe(value);
      expect(row.full).toBe(value);
    }
    const words = DETAIL_FIELDS.map((f) => f.label).join(" ").toLowerCase();
    expect(words).not.toMatch(/accessib|barrier|friendly|step-free/);
  });

  it("makes the website followable, because half a URL is not a URL", () => {
    // Every other value survives the fold — half an address still names the
    // street. A clipped URL cannot be typed or copied, and a quarter of the
    // 2,934 websites in the extract are longer than DETAIL_CHARS. So the text
    // is the raw tag, clipped like everything else, and the href is all of it.
    const long = "https://www.marriott.com/hotels/travel/tpecy-courtyard-taipei/";
    const [row] = featureDetails({ website: long });
    expect(row.text).toHaveLength(DETAIL_CHARS);
    expect(row.full).toBe(long);
    expect(row.href).toBe(long);
  });

  it("links nothing but a website, so no other row can become clickable", () => {
    // `link` is opt-in per field, exactly as `dedupe` is: a phone number that
    // happens to parse as a URL must not turn into a link, and a value that
    // arrives in `address` is not a place to navigate to.
    for (const row of featureDetails({ ...cafe, phone: "https://evil.example/" })) {
      expect(row.href === undefined, row.field).toBe(row.field !== "website");
    }
  });
});

/**
 * The link guard. `website` is arbitrary text from an open, editable database
 * and it ends up in an `href`, so this is a security boundary and not a
 * formatting preference.
 */
describe("linkHref", () => {
  it("follows http and https, and hands back the parser's own normalisation", () => {
    expect(linkHref("https://www.85cafe.com/")).toBe("https://www.85cafe.com/");
    expect(linkHref("http://www.wtaipei.com/")).toBe("http://www.wtaipei.com/");
    // Normalised: what the browser is handed is what a URL parser made of it,
    // never the raw string. The human still reads the raw string.
    expect(linkHref("https://example.com")).toBe("https://example.com/");
  });

  it("refuses a scheme a click could execute", () => {
    // `new URL("javascript:alert(1)")` parses happily, and React will put that
    // string in an href given the chance. One OSM edit is all it would take.
    expect(linkHref("javascript:alert(1)")).toBeUndefined();
    expect(linkHref("data:text/html,<script>alert(1)</script>")).toBeUndefined();
    expect(linkHref("mailto:someone@example.com")).toBeUndefined();
  });

  it("refuses what is not a URL rather than guessing one", () => {
    // A bare host would need a scheme guessed for somebody else's server, and
    // the extract's one broken value is a pasted search result. Both keep
    // their text and lose only the link.
    expect(linkHref("www.example.com")).toBeUndefined();
    expect(linkHref("https://www.hotpot106.com.tw › nanjing")).toBeUndefined();
    expect(linkHref("")).toBeUndefined();
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
