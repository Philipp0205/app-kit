(function () {
  'use strict';

  var status = document.getElementById('sw-status');
  var out = document.getElementById('out');
  var banner = document.getElementById('update-banner');

  function setStatus(text) {
    status.textContent = 'sw: ' + text;
  }

  function show(text) {
    out.textContent = text;
  }

  var registering = AppKit.sw.register({
    url: '/sw.js',
    scope: '/',
    onUpdate: function (update) {
      setStatus('update waiting');
      banner.hidden = false;
      document.getElementById('btn-update').addEventListener('click', function () {
        update.apply();
      });
    }
  });

  if (!registering) {
    setStatus('unsupported');
  } else {
    registering.then(function (registration) {
      if (!registration) {
        setStatus('unsupported');
        return;
      }
      if (banner.hidden) {
        setStatus(registration.active ? 'active' : 'registered');
      }
      if (!registration.active) {
        navigator.serviceWorker.ready.then(function () {
          if (banner.hidden) {
            setStatus('active');
          }
        });
      }
    });
  }

  document.getElementById('btn-api').addEventListener('click', function () {
    fetch('/api/time').then(function (r) { return r.json(); }).then(function (data) {
      show('api: ' + data.now);
    }, function (error) {
      show('api failed: ' + error.message);
    });
  });

  document.getElementById('btn-vendor').addEventListener('click', function () {
    fetch('/vendor/blob.bin').then(function (r) { return r.arrayBuffer(); }).then(function (buf) {
      show('vendor: ' + buf.byteLength + ' bytes');
    }, function (error) {
      show('vendor failed: ' + error.message);
    });
  });
})();
