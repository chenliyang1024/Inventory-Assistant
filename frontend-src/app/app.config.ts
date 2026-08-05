import { ApplicationConfig } from '@angular/core';
import { provideHttpClient, withFetch } from '@angular/common/http';

// NOTE: `ng new` already generates this file with its own providers
// (zoneless/zone.js setup, router, etc. depending on the options you
// picked). Merge this HttpClient provider into your existing array rather
// than replacing the whole file, unless you started from a blank slate.
export const appConfig: ApplicationConfig = {
  providers: [
    provideHttpClient(withFetch()),
  ],
};
