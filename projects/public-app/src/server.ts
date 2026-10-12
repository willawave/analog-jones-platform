import {
  AngularNodeAppEngine,
  createNodeRequestHandler,
  isMainModule,
  writeResponseToNodeResponse,
} from '@angular/ssr/node';
import compression from 'compression';
import express from 'express';
// The lite (REST) build, to match the Firestore instance from ./app/firebase.
import { collection, getDocs, orderBy, query, where } from 'firebase/firestore/lite';
import { join } from 'node:path';
import { withDeadline } from '@aj/core';
import { CANONICAL_ORIGIN } from './app/seo/origin.token';
import { stripMarkdown } from './app/seo/seo.text';
import { firestore } from './app/firebase';

const browserDistFolder = join(import.meta.dirname, '../browser');

const app = express();
const angularApp = new AngularNodeAppEngine({ trustProxyHeaders: true });

// Compress every response (brotli/gzip, negotiated via Accept-Encoding) — the
// SSR HTML, the SEO text/XML/JSON routes, and the static JS/CSS bundles all ship
// uncompressed otherwise (Lighthouse: "No compression applied"). Registered first
// so it wraps every downstream handler.
app.use(compression());

const SITE_DESCRIPTION =
  'A VHS-focused film podcast exploring cult classics, genre movies, forgotten films, and the strange corners of cinema — one tape at a time.';

interface EpisodeDoc {
  title?: string;
  intelligence?: string | null;
  links?: { spotify?: string; youtube?: string };
  episodeDate?: { toDate?: () => Date };
}

// A REST read has no time limit of its own. Without one, a Firestore stall would
// hold these routes open until the hosting timeout; with it they fail with a 500
// that a crawler will retry.
const FEED_READ_TIMEOUT_MS = 10_000;

/** Visible episodes, newest first — shared by the sitemap, llms.txt, and JSON API routes. */
async function getVisibleEpisodes() {
  const snapshot = await withDeadline(
    getDocs(
      query(
        collection(firestore, 'episodes'),
        where('isVisible', '==', true),
        orderBy('episodeDate', 'desc'),
      ),
    ),
    FEED_READ_TIMEOUT_MS,
  );
  return snapshot.docs.map((doc) => ({ id: doc.id, ...(doc.data() as EpisodeDoc) }));
}

app.get('/sitemap-episodes.xml', async (_req, res, next) => {
  try {
    const episodes = await getVisibleEpisodes();

    const urls = episodes
      .map((episode) => {
        const lastmod = episode.episodeDate?.toDate?.().toISOString();
        const loc = `${CANONICAL_ORIGIN}/episodes/${episode.id}`;
        return lastmod
          ? `  <url><loc>${loc}</loc><lastmod>${lastmod}</lastmod></url>`
          : `  <url><loc>${loc}</loc></url>`;
      })
      .join('\n');

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>
`;

    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=3600');
    res.send(xml);
  } catch (err) {
    next(err);
  }
});

/**
 * Plain-text site map for LLM crawlers (the llms.txt convention). Lists the main
 * pages plus every visible episode with a stripped one-line summary.
 */
app.get('/llms.txt', async (_req, res, next) => {
  try {
    const episodes = await getVisibleEpisodes();

    const episodeLines = episodes
      .map((episode) => {
        const url = `${CANONICAL_ORIGIN}/episodes/${episode.id}`;
        const title = (episode.title ?? 'Untitled episode').replace(/[\r\n\]]+/g, ' ').trim();
        const summary = stripMarkdown(episode.intelligence);
        return summary ? `- [${title}](${url}): ${summary}` : `- [${title}](${url})`;
      })
      .join('\n');

    const body = `# Analog Jones and the Temple of Film

> ${SITE_DESCRIPTION}

## About

Analog Jones and the Temple of Film is a long-running movie podcast and
digital archive dedicated to VHS-era film culture.

Hosts Steve, Chris, and Brad explore cult classics, horror, action,
science fiction, animation, exploitation films, forgotten movies,
franchises, and video-store oddities.

The website serves as a digital film museum built from more than 300
podcast episodes. Visitors can browse the archive, discover movies,
explore franchises and genres, and read insights extracted from years
of conversations about film.

Each episode may include:
- Episode overview
- Key takeaways
- Memorable quotes
- Film and production insights
- Podcast listening links
- Related movies and resources

## Pages
- [Home](${CANONICAL_ORIGIN}/)
- [Episodes](${CANONICAL_ORIGIN}/episodes)
- [Explorer](${CANONICAL_ORIGIN}/explorer)
- [Contact](${CANONICAL_ORIGIN}/contact)

## Episodes
${episodeLines}
`;

    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=3600');
    res.send(body);
  } catch (err) {
    next(err);
  }
});

/**
 * Read-only JSON feed of visible episodes for programmatic / AI-agent consumption.
 * Core fields and links only — no category/genre/tag relations.
 */
app.get('/api/episodes', async (_req, res, next) => {
  try {
    const episodes = await getVisibleEpisodes();

    const payload = {
      site: CANONICAL_ORIGIN,
      count: episodes.length,
      episodes: episodes.map((episode) => ({
        id: episode.id,
        title: episode.title ?? null,
        url: `${CANONICAL_ORIGIN}/episodes/${episode.id}`,
        episodeDate: episode.episodeDate?.toDate?.().toISOString() ?? null,
        summary: stripMarkdown(episode.intelligence),
        links: {
          spotify: episode.links?.spotify ?? null,
          youtube: episode.links?.youtube ?? null,
        },
      })),
    };

    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=3600');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.json(payload);
  } catch (err) {
    next(err);
  }
});

// Firebase Hosting (our CDN) layers proxy headers on top of Cloud Run's. With
// trustProxyHeaders enabled, @angular/ssr rebuilds the request URL from them and
// the result matches no server route, so it serves the client shell instead of
// SSR — server-rendered SEO silently vanishes behind the CDN. Strip the whole
// forwarding set so a proxied request reconstructs exactly like a (proven-good)
// direct one: bare Host header + real path. SeoService builds absolute URLs from
// the hardcoded ORIGIN, so dropping the forwarded host/proto changes nothing in
// the rendered canonical/og URLs.
const FORWARDING_HEADERS = [
  'x-forwarded-host',
  'x-forwarded-url',
  'x-forwarded-proto',
  'x-forwarded-port',
  'x-forwarded-server',
  'forwarded',
];
app.use((req, _res, next) => {
  for (const h of FORWARDING_HEADERS) delete req.headers[h];
  next();
});

/**
 * Serve static files from /browser
 */
app.use(
  express.static(browserDistFolder, {
    maxAge: '1y',
    index: false,
    redirect: false,
  }),
);

/**
 * Handle all other requests by rendering the Angular application.
 *
 * Episode and listing pages are CDN-cacheable, but only when they render
 * successfully. A resolver-issued 404 (missing or hidden episode) must not be
 * cached as if it were a real page — otherwise the edge would keep serving a
 * stale 404 after the episode is published. The cache header is therefore
 * applied after render and gated on a 200 status.
 */
app.use((req, res, next) => {
  angularApp
    .handle(req)
    .then((response) => {
      if (!response) return next();
      if (
        req.method === 'GET' &&
        response.status === 200 &&
        /^\/(explorer|episodes(\/[^/]+)?)?\/?$/.test(req.path)
      ) {
        res.setHeader(
          'Cache-Control',
          'public, max-age=0, s-maxage=300, stale-while-revalidate=86400',
        );
      }
      return writeResponseToNodeResponse(response, res);
    })
    .catch(next);
});

/**
 * Start the server if this module is the main entry point, or it is ran via PM2.
 * The server listens on the port defined by the `PORT` environment variable, or defaults to 4000.
 */
if (isMainModule(import.meta.url) || process.env['pm_id']) {
  const port = process.env['PORT'] || 4000;
  app.listen(port, (error) => {
    if (error) {
      throw error;
    }

    console.log(`Node Express server listening on http://localhost:${port}`);
  });
}

/**
 * Request handler used by the Angular CLI (for dev-server and during build) or Firebase Cloud Functions.
 */
export const reqHandler = createNodeRequestHandler(app);
