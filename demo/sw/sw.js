importScripts('/app-kit/ak-sw.js');
AppKitSW.setup({
  version: '__VERSION__',
  prefix: 'akdemo',
  shell: ['/', '/demo.js', '/manifest.webmanifest', '/icons/icon-192.png',
    '/app-kit/ak-tokens.css', '/app-kit/ak-components.css', '/app-kit/app-kit.css',
    '/app-kit/ak-sw-register.js'],
  networkOnly: ['/api/'],
  runtime: [{ match: '/vendor/', cache: 'vendor' }],
  offlineFallback: '/'
});
