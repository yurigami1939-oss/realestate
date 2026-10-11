/*
 * Service worker of the app (CLAUDE.md §7 Push notifications): shows the push messages the
 * server sends (title, body, the page to open) and opens that page when one is clicked. No
 * caching: pages always show live data.
 */
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: event.data ? event.data.text() : "" };
  }
  const title = data.title || "Notification";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || "",
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      lang: data.lang || "fr",
      dir: data.lang === "ar" ? "rtl" : "ltr",
      tag: data.tag || undefined,
      data: { url: data.url || "/" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || "/", self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
      const open = windows.find((w) => w.url === url && "focus" in w);
      return open ? open.focus() : self.clients.openWindow(url);
    }),
  );
});
