# GlassMap — tool behaviour in detail

Behaviour the README summarises, spelled out.

## `describe_surroundings` district fallback

`describe_surroundings` names the district a point is in — falling back to the nearest district boundary within 300 m when the point sits in a seam between two independently simplified polygons, and naming none rather than guessing beyond that — then lists nearby features grouped into up to eight compass directions, nearest first, each with a distance in metres and a feature id an agent can act on next (`select_features`, `set_map_view`). When more features match than the tool describes, it says so instead of staying quiet: `total` is how many are within `radius_m`, `returned` is how many were actually listed (at most 30) — so a wider radius is never implied to reveal features that were simply cut off.

## `select_features` 500-match cap

`select_features` still highlights every match a filter finds, its contract since the tool shipped — but once a point-of-interest category is involved, a filter matching more than 500 of them is refused rather than lighting up half the city: the answer gives the true count and asks for `near`+`radius_m`, `within` or `query` to narrow it. The six bundled categories are exempt from that cap.

## `get_share_link` versioning (v1/v2/v3)

A `get_share_link` link carries the *names* of every point-of-interest category the sender had loaded, not their features — the recipient's page fetches the same files itself — so opening the link rebuilds the sender's map, selection included, instead of resolving to features the recipient's session never heard of. A link that names a category is written as `v2`; a link with none still encodes to the exact `v1` bytes it always did, so no existing link breaks. The one exception is a map whose drawings would not fit in a URL at all: their coordinates then travel delta-encoded and the link is written as `v3` — smaller maps keep their old bytes, and every older link still decodes.

## Tier-2 fetch failure: permanent vs. transient

Fetching a category file can fail two honestly different ways: a **permanent** failure (this deployment ships no such file — a 404) drops the category and is not retried; a **transient** one (a slow connection, a rate-limited mirror — a 5xx, or a 408/425/429 that means "ask again") keeps the category on the books, including in any share link handed out meanwhile, so the next call simply tries again.
