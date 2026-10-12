# Changelog

All notable changes to this project are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions are `MAJOR.MINOR.PATCH.MICRO` (the `VERSION` file is the source of truth).

## [1.0.3.0] - 2026-10-12

### Fixed

- Episodes, Explorer and episode pages no longer depend on a connection to the database that the site kept open in the background. On phones that connection could die quietly, most likely while the phone was idle, and the next page you opened then sat on empty placeholder cards for 30 seconds or more. Each page now fetches its data with an ordinary request, tries again by itself if a request gets no answer, and gives up on a request after 30 seconds instead of waiting on it indefinitely.
- With no connection, the site now says "Could not reach the server. Check your connection and try again." It used to say no episodes were found.

### Changed

- Pages load with less code. A first visit downloads about 160 kB less.
- The episode list is downloaded once per visit and reused across Episodes, Explorer search and the related episodes on an episode page.
- The sitemap, `llms.txt` and the episode feed stop waiting after 10 seconds if the database does not answer.

## [1.0.2.0] - 2026-10-10

### Added

- A rollback command for the hosts' release tooling. If a release goes wrong, `pnpm rollback` puts the site back on an earlier version and clears the cached pages, so visitors do not end up on a page that loads but never responds.

### Changed

- Pages on analogjonestof.com load with less code. The site no longer downloads sign-in code that only the admin site uses, which takes about 78 kB off the first visit.
- The site now runs on Angular 22. Nothing should look or behave differently.
- A release now moves visitors to the new version by itself, including after a rollback.

### Fixed

- The release command stops when given an option it does not recognise, instead of ignoring it and releasing anyway.

## [1.0.1.0] - 2026-10-09

### Changed

- Fonts and icons are now served from analogjonestof.com itself. Loading a page no longer sends a request to Google Fonts.
- The Privacy Policy has a new "Fonts and icons" section saying so.

### Removed

- The Material Icons font. The menu and clear-search icons are drawn inline instead.

## [1.0.0.3] - 2026-10-09

### Fixed

- The footer credit now spells the name correctly: WillaWave.

## [1.0.0.2] - 2026-10-09

### Added

- `llms.txt` now opens with an About section describing the podcast, its hosts, the archive, and what each episode page contains, so AI assistants can describe the site accurately.

### Changed

- The one-line site summary in `llms.txt` now leads with the VHS focus.

## [1.0.0.1] - 2026-10-09

### Added

- The footer now credits WillaWave, with a link to willawave.ai.

### Changed

- The GitHub link on the Contact page points to the project's new home under the WillaWave organization.

## [1.0.0.0] - 2026-10-09

The baseline: the site as it stands on the day versioning was introduced.

### Added

- Public site at analogjonestof.com: home page, a browsable episode archive, a page for every episode, and an Explorer for searching episodes by category, genre, and tag.
- Contact, Terms of Use, and Privacy Policy pages.
- Server-rendered pages for search engines, with a sitemap, an `llms.txt` summary for AI crawlers, and redirects from the old site's URLs.
- Admin app for the hosts: sign in with Google to add and edit episodes, manage categories, genres, and tags (including bulk edits across episodes), and manage users.
