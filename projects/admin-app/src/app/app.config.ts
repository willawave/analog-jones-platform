import {
  ApplicationConfig,
  inject,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
} from '@angular/core';
import { provideRouter } from '@angular/router';
import { AUTH, FIRESTORE, FIRESTORE_OPS } from '@aj/core';
import { UserStore } from '@aj/core';
import { routes } from './app.routes';
import { auth, firestore, firestoreOps } from './firebase';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes),
    { provide: AUTH, useValue: auth },
    { provide: FIRESTORE, useValue: firestore },
    { provide: FIRESTORE_OPS, useValue: firestoreOps },
    provideAppInitializer(() => inject(UserStore).init()),
  ],
};
