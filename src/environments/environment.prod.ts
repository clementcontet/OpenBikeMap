// This file can be replaced during build by using the `fileReplacements` array.
// `ng build --prod` replaces `environment.ts` with `environment.prod.ts`.
// The list of file replacements can be found in `angular.json`.

export const environment = {
  production: true,
  firebase: {
    apiKey: 'AIzaSyCSjGuRAv7PEAGdIsWFgex99wrMvW1yXTM',
    authDomain: 'open-bike-map.firebaseapp.com',
    databaseURL: 'https://open-bike-map.firebaseio.com',
    projectId: 'open-bike-map',
    storageBucket: 'open-bike-map.appspot.com',
    messagingSenderId: '377402317727',
    appId: '1:377402317727:web:89ff93bb137e6bb22fbbaa',
    measurementId: 'G-C8R0DZZM4V'
  },
  signInEmailLinkDomain: 'https://open-bike-map.web.app/'
};

/*
 * For easier debugging in development mode, you can import the following file
 * to ignore zone related error stack frames such as `zone.run`, `zoneDelegate.invokeTask`.
 *
 * This import should be commented out in production mode because it will have a negative impact
 * on performance if an error is thrown.
 */
// import 'zone.js/dist/zone-error';  // Included with Angular CLI.
