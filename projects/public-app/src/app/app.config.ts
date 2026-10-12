import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter, TitleStrategy, withInMemoryScrolling } from '@angular/router';
import { provideClientHydration, withIncrementalHydration } from '@angular/platform-browser';
import { FIRESTORE, FIRESTORE_OPS } from '@aj/core';
import { SeoTitleStrategy } from './seo/seo-title.strategy';
import { routes } from './app.routes';
import { firestore, firestoreOps } from './firebase';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(
      routes,
      withInMemoryScrolling({
        scrollPositionRestoration: 'top',
        anchorScrolling: 'enabled',
      }),
    ),
    // Incremental hydration: cards/scrollers wrapped in `@defer (hydrate on …)`
    // stay server-rendered (SEO + no CLS) but defer their hydration cost until
    // they're needed, cutting the up-front JS work on mobile cold loads.
    // withIncrementalHydration subsumes withEventReplay.
    provideClientHydration(withIncrementalHydration()),
    { provide: TitleStrategy, useClass: SeoTitleStrategy },
    // The REST-only Firestore build (see firebase.ts). No connection warm-up:
    // there is no long-lived channel to open, each read is its own request.
    { provide: FIRESTORE, useValue: firestore },
    { provide: FIRESTORE_OPS, useValue: firestoreOps },
  ],
};
