/**
 * The demo script, on screen: four sentences a judge can hand the agent
 * verbatim, each tagged with the tools that answer it.
 *
 * Static text on purpose — these are things to SAY to the agent, not buttons
 * in the app. Every place named resolves first-call against the bundled data:
 * "Daan District" / "Xinyi District" are exact gazetteer matches, where the
 * bare words are not (bare "Daan" hits the station; bare "Xinyi" is ambiguous).
 * `measure` takes one target and needs an id, so its honest tag is the
 * two-step `find_features · measure` chain. Re-verify resolution before
 * changing a single word.
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
];

/**
 * The two strongest prompts, for the bottom sheet: spoken verbatim, the first
 * produces exactly the state the design was captured in, and the second is the
 * shortest two-tool chain. All four still live in the inspector.
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
