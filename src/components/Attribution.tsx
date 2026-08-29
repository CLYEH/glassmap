import { Fragment } from "react";
import { STYLE_ATTRIBUTION } from "./map-style";

/**
 * The basemap's licence attribution, with its links. Not decoration and not
 * optional: OpenFreeMap, OpenMapTiles and OpenStreetMap each require the
 * credit, and OSM's requires it to be a working link to the copyright page.
 *
 * It is ours to render rather than MapLibre's because the built-in control
 * lives in the map's bottom-right corner, which the inspector covers at every
 * desktop width; the text itself is `STYLE_ATTRIBUTION`, kept beside the style
 * URL it belongs to.
 */
export function Attribution() {
  return (
    <span className="attribution" data-testid="attribution">
      {STYLE_ATTRIBUTION.map((item, index) => (
        <Fragment key={item.href}>
          {index > 0 ? " " : null}
          {"prefix" in item ? item.prefix : null}
          <a href={item.href} target="_blank" rel="noopener noreferrer">
            {item.text}
          </a>
        </Fragment>
      ))}
    </span>
  );
}
