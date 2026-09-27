/* Hlala Link — Web Push service worker */
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) { /* plain text or empty */ }
  const title = data.title || 'Hlala Link';
  const options = {
    body: data.body || 'You have a new update.',
    icon: '/images/hlala-icon.jpg',
    badge: '/images/hlala-icon.jpg',
    data: { url: data.url || '/' },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const raw = (event.notification.data && event.notification.data.url) || '/';
  let target;
  try { target = new URL(raw, self.location.origin); }
  catch (e) { target = new URL('/', self.location.origin); }
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        try {
          if (new URL(c.url).pathname === target.pathname) return c.focus();
        } catch (e) { /* ignore bad client urls */ }
      }
      return clients.openWindow(target.pathname + target.search + target.hash);
    })
  );
});
