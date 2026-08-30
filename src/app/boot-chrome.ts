import { MAX_SHARE_HASH_CHARS, SHARE_VERSIONS } from "@/lib/map-tools/share";

/**
 * Which chrome the document wears at the very first paint.
 *
 * ## The hole this closes
 *
 * A link that carries agent work opens the page in agent chrome (`awake`), and
 * the page knows that only after `useShareHash` has applied the fragment — in
 * an effect, which React runs *after* the first paint. The server cannot help:
 * a URL fragment is never sent to it, so the server-rendered HTML is always the
 * human chrome. Measured on a restored agent link, that was ~45 ms of the human
 * chrome (the corner whisper, the tools row over the full width, no camera
 * chip) before it flipped. The commit that shipped this chrome claimed the flash
 * could not happen; it could, and this is the standard no-flash answer: a tiny
 * synchronous script in the document, before any of it has been painted, that
 * writes the answer onto the root element for CSS to read.
 *
 * What it cannot do is mount the agent panels — the feed, the inspector lane,
 * the badge are React's, and they arrive with hydration whatever this says. So
 * the contract is narrower than "no flash": **nothing that is only true of the
 * human chrome is ever painted on a restored agent link**, and the agent's own
 * surfaces fade in when React gets there. That is the honest half, and it is the
 * half a person actually sees as a flicker.
 *
 * ## What it reads, and where it can be wrong
 *
 * It is a second reader of the wire format `map-tools/share.ts` owns, and being
 * a second reader is the price of running before any module is loaded. It is
 * deliberately not the codec: it validates nothing, rebuilds nothing, and drops
 * nothing. It reads the version prefix (from the codec's own constant, so a new
 * version cannot be missed here without failing there too), un-base64s the
 * payload, and asks `restoredAgentStateOf`'s three questions of the raw JSON —
 * an agent-sourced drawing, an agent-sourced note, or a selected id the link
 * does not attribute to the human.
 *
 * The two readers can disagree, and the divergence is one-directional in
 * practice: this one is the more generous, because the codec *drops* items it
 * cannot rebuild (an impossible coordinate, a ring with more points than
 * `draw_shape` accepts) and this one counts them. So a hand-mangled link whose
 * only agent evidence is an item the codec rejects paints agent chrome for one
 * frame and is corrected by `useChromeAttribute` on the first commit after
 * hydration. The camera gate below removes the large majority of that class up
 * front: a payload with no valid `c`/`z` is a link the codec refuses whole, and
 * refusing it here too keeps a corrupt fragment from dressing the page at all.
 *
 * `boot-chrome.test.ts` runs this string against links the real encoder
 * produced and asserts it agrees with `restoredAgentStateOf`, so the two
 * readers cannot drift silently — a wire change that this misses fails there.
 *
 * ## Why the payload is read as bytes and not as text
 *
 * `atob` returns a binary string, and a UTF-8 note comes back as mojibake in
 * it. That is fine and saves the decode: JSON's structure is ASCII, and every
 * byte of a UTF-8 multi-byte sequence is >= 0x80 — never a quote, a backslash
 * or a control character — so `JSON.parse` sees exactly the same shape it would
 * have seen. The three questions are about `"user"`/`"agent"` and about ids, so
 * no answer here ever depends on the text of a note being readable.
 */
const VERSION_PATTERN = `^(?:${SHARE_VERSIONS.join("|")})\\.([A-Za-z0-9_-]+)$`;

/**
 * The script itself, inlined by `layout.tsx` as the first thing in the body.
 *
 * Every failure path leaves the attribute unwritten, and the stylesheet reads
 * the human chrome as the absence of `awake` (`html:not([data-chrome="awake"])`)
 * rather than as `idle` — so a page with no JavaScript, a browser that refuses
 * the inline script, or a throw in the middle of it all land on exactly the
 * chrome this page shipped with before any of this existed.
 */
export const BOOT_CHROME_SCRIPT = `(function(){try{
var h=location.hash.replace(/^#/,"");
if(!h||h.length>${MAX_SHARE_HASH_CHARS})return;
var m=new RegExp(${JSON.stringify(VERSION_PATTERN)}).exec(h);
if(!m)return;
var b=m[1].replace(/-/g,"+").replace(/_/g,"/");
var p=JSON.parse(atob(b+"===".slice((b.length+3)%4)));
if(!p||typeof p!=="object")return;
var c=p.c;
if(!Array.isArray(c)||c.length<2)return;
var x=c[0],y=c[1];
if(typeof x!=="number"||typeof y!=="number"||!isFinite(x)||!isFinite(y))return;
if(x<-180||x>180||y<-90||y>90)return;
if(typeof p.z!=="number"||!isFinite(p.z)||p.z<0||p.z>22)return;
var agent=false,i;
var d=Array.isArray(p.d)?p.d:[];
for(i=0;i<d.length;i++)if(d[i]&&d[i].o!=="user")agent=true;
var a=Array.isArray(p.a)?p.a:[];
for(i=0;i<a.length;i++)if(a[i]&&a[i].o!=="user")agent=true;
var s=Array.isArray(p.s)?p.s:[];
var u=Array.isArray(p.su)?p.su:[];
for(i=0;i<s.length;i++)if(typeof s[i]==="string"&&s[i]&&u.indexOf(s[i])<0)agent=true;
document.documentElement.dataset.chrome=agent?"awake":"idle";
}catch(e){}})();`;
