/**
 * One head block for every public surface.
 *
 * Judges and buildathon reviewers reach this site through a pasted link, so a
 * missing description/OG block costs a preview card at exactly the moment the
 * project is being skimmed. Kept in one place so the three surfaces cannot
 * drift apart.
 */

export const REPO_URL = "https://github.com/Kleangkao/agenttab";

/** Overridable so a fork or preview host does not advertise the demo origin. */
export function siteUrl(): string {
  return (
    process.env.AGENTTAB_PUBLIC_URL ?? "https://agenttab-production.up.railway.app"
  );
}

/** Brand mark inline, so the tab icon needs no binary asset in the image. */
const FAVICON_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">' +
  '<rect width="64" height="64" rx="14" fill="#0f1319"/>' +
  '<text x="32" y="43" text-anchor="middle" font-family="monospace" font-size="28"' +
  ' font-weight="700" fill="#ffb020">AT</text></svg>';

const FAVICON_HREF = `data:image/svg+xml,${encodeURIComponent(FAVICON_SVG)}`;

function attr(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/**
 * `path` is the canonical path of the surface ("/", "/demo", "/ui").
 * No og:image: a card with a broken image reads worse than a text card, and
 * this repo ships no raster asset for one.
 */
export function pageHead(input: {
  title: string;
  description: string;
  path: string;
  stylesheet: string;
}): string {
  const url = `${siteUrl().replace(/\/$/, "")}${input.path}`;
  return `  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${attr(input.title)}</title>
  <meta name="description" content="${attr(input.description)}" />
  <link rel="canonical" href="${attr(url)}" />
  <meta property="og:type" content="website" />
  <meta property="og:site_name" content="AgentTab" />
  <meta property="og:title" content="${attr(input.title)}" />
  <meta property="og:description" content="${attr(input.description)}" />
  <meta property="og:url" content="${attr(url)}" />
  <meta name="twitter:card" content="summary" />
  <meta name="twitter:title" content="${attr(input.title)}" />
  <meta name="twitter:description" content="${attr(input.description)}" />
  <link rel="icon" href="${attr(FAVICON_HREF)}" />
  <link rel="stylesheet" href="${attr(input.stylesheet)}" />`;
}
