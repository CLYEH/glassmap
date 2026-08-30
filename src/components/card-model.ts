import type { SelectionSource } from "@/lib/store/map-store";

/**
 * What the "On the map" card is allowed to say about who put this place on the
 * map, and the evidence behind each sentence.
 *
 *  - **user** — the store recorded this id as the human's at the click that
 *    selected it (`selectionSources`). Proven.
 *  - **agent** — recorded as the agent's by `select_features`, or unrecorded on
 *    a link that carried `su`. `su` states the human's ids, so the ids outside
 *    it are the sender's recorded agent selections: proven, then
 *    inferred-from-evidence.
 *  - **link** — unrecorded, and the link stated nothing. Every `su`-less link
 *    is one indistinguishable wire state (a legacy link, or an all-agent link
 *    from the new encoder — byte identity makes them the same bytes), so the
 *    sentence hedges rather than claiming a fact the wire never carried.
 *
 * The bead stays teal in the last case, and only the words change: Ruling 3's
 * recorded asymmetry — a false rose would hide that an agent was involved at
 * all, a false teal only under-credits the human — and it is the direction the
 * codec itself leans. design2-v5 §2.5 and §8.4 item 5.
 */
export type CardProvenance = "user" | "agent" | "link";

export const CARD_COPY: Record<CardProvenance, { line: string; tag: string }> = {
  user: { line: "On the map — you tapped it", tag: "YOU" },
  agent: { line: "On the map — the agent selected it", tag: "AGENT" },
  link: { line: "On the map — from a shared link", tag: "FROM LINK" },
};

/**
 * @param recorded what `selectionSources` holds for this id, if anything
 * @param attributionExplicit whether the link this page opened carried `su`
 *   (`selectionAttributionExplicit`); false on a page opened without a link,
 *   which is why an unrecorded id on a live page hedges too — nothing on this
 *   page ever claimed it.
 */
export function cardProvenance(
  recorded: SelectionSource | undefined,
  attributionExplicit: boolean,
): CardProvenance {
  if (recorded) return recorded;
  return attributionExplicit ? "agent" : "link";
}
