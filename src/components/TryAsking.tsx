/**
 * The demo script, on screen: five sentences a judge can hand the agent
 * verbatim, each tagged with the tools that answer it.
 *
 * Static text on purpose — these are things to SAY to the agent, not buttons
 * in the app. Every place named resolves first-call against the bundled data
 * once that data is in — in the load window a name is refused rather than
 * resolved, which is point 3 below and is not a detail:
 * "Daan District" / "Xinyi District" are exact gazetteer matches, where the
 * bare words are not (bare "Daan" hits the station; bare "Xinyi" is ambiguous).
 * `measure` takes one target and needs an id, so its honest tag is the
 * two-step `find_features · measure` chain. Re-verify resolution before
 * changing a single word.
 *
 * And these strings are not only here: README.md's "Try it" section quotes all
 * five cards verbatim, question and tool tag both. Editing any of them without
 * editing the README leaves the repo saying two different things a judge can
 * hand the same agent. (Adding a card is safe; changing one is not.)
 *
 * The `get_place_details` card (F-4) is held to the same bar twice over, and
 * both halves are easy to break by rewording it:
 *
 * 1. *It must not name a field a list already carries.* `describeFeature`
 *    echoes cuisine, brand and opening_hours on every row (see output.ts), so
 *    "when does it open" is answered by `find_features` alone and tagging
 *    `get_place_details` on it would be a lie about which tool was needed.
 *    Phone and address are served by `get_place_details` and by nothing else.
 * 2. *The field must actually be there on the place named.* Enrichment is
 *    partial (T-97 measured the Overpass sample at address 55-58%, phone 30%),
 *    so the category is picked from the shipped file rather than from the
 *    average: `public/data/tier2/post_office.geojson` carries an address on
 *    245 of 254 records (96%) and a phone on 242 (95%), and all eight post
 *    offices within 1.1 km of Daan Station have both. Verified through
 *    `document.modelContext` on a settled page — every dataset loaded before
 *    the first call:
 *    find_features({categories:["post_office"], near:"Daan Station"}) loads the
 *    category city-wide on first use and answers nearest-first with
 *    "osm:node:14014671411" (Taipei Xinwei Post Office, 382 m E), and
 *    get_place_details on that id returns phone
 *    "+886 2 2707 7130;+886 2 2708 3670" plus a full one-line street address
 *    (postcode, district, road, number) and a website. "Nearest" rather than a
 *    name on purpose: a POI id resolves only once a call has named its
 *    category, so asking for a post office BY NAME would need a third call.
 *
 * 3. *And "settled" is the load-bearing word — do not weaken it to "cold".*
 *    An earlier draft of this comment offered `features_loaded: 0` as the proof
 *    that the chain was safe. It proved the opposite. `resolveQueryInput` loads
 *    a named category BEFORE it resolves `near` (deliberately, so that
 *    {near:"Fika Fika Cafe", categories:["cafe"]} can find its own origin),
 *    while the six base datasets are still arriving; in that window a place
 *    name was matched against the just-fetched category alone. Every spelling
 *    of this card's origin — "Daan Station", "Daan", "Da'an Station",
 *    "Daan MRT Station", "MRT Daan Station", and both Chinese spellings of the
 *    station, with and without the suffix — then collapses onto the single
 *    post office whose own name contains it, "osm:way:206062024"
 *    (Taipei Da-an Post Office), 524 m from the real station and not the one
 *    this card means. One match is not a tie, so `resolvePlaceOne` returned
 *    `found`: the chain would have answered a judge with a confident wrong
 *    post office and its real phone number. The other cards were safe only by
 *    luck of category — theirs are base-only, so a half-loaded store gives them
 *    nothing to match and they refuse loudly instead.
 *
 *    T-103 closed the window: `MapToolStore.isBaseDataLoaded()` now guards the
 *    place-name form of `resolveNear` and of set_map_view's `place`, so a name
 *    looked up mid-load gets a loud retryable refusal ("map data not ready")
 *    instead of the wrong office. Ids and coordinates are deliberately not
 *    gated, and the fetch-then-resolve ordering above is preserved. That guard,
 *    not anything about the sentence, is what makes phrasing this card around
 *    "nearest <named place>" safe — so it is a prerequisite of this card, not a
 *    coincidence next to it.
 */
export interface AskCard {
  question: string;
  tools: string;
}

export const ASK_CARDS: readonly AskCard[] = [
  {
    question: "“Show every park within a 10-minute walk of Daan Station.”",
    tools: "draw_shape · find_features · select_features",
  },
  {
    question: "“Compare Daan District and Xinyi District for parks and supermarkets.”",
    tools: "compare_areas",
  },
  {
    question: "“Describe the area around Daan Station.”",
    tools: "describe_surroundings",
  },
  {
    question: "“How big is Daan Forest Park?”",
    tools: "find_features · measure",
  },
  {
    question: "“What is the phone number and address of the post office nearest Daan Station?”",
    tools: "find_features · get_place_details",
  },
];

/**
 * The two strongest prompts, for the bottom sheet: spoken verbatim, the first
 * produces exactly the state the design was captured in, and the second is the
 * shortest two-tool chain. All five still live in the inspector. Index-
 * addressed on purpose (the pair is a choice, not a slice), which makes
 * appending to ASK_CARDS safe and INSERTING in the middle silently re-point it.
 */
export const SHEET_ASK_CARDS: readonly AskCard[] = [ASK_CARDS[0], ASK_CARDS[3]];

export function TryAsking({ cards }: { cards: readonly AskCard[] }) {
  return (
    <section className="insp-section" data-testid="try-asking">
      <div className="sec-head">
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
          <path
            d="M1.8 2.6h8.4v5.2H6.4L4 10.2V7.8H1.8V2.6Z"
            stroke="#b9c3ce"
            strokeWidth="1.2"
            strokeLinejoin="round"
          />
        </svg>
        <h3>Try asking</h3>
      </div>
      {cards.map((card) => (
        <div className="ask-card" key={card.question} data-testid="ask-card">
          <p className="ask-q">{card.question}</p>
          <p className="ask-tools">{card.tools}</p>
        </div>
      ))}
    </section>
  );
}
