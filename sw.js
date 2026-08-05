/* The page itself is network-first, everything else is cache-first.
   Cache-first on the HTML means an edited itinerary never reaches the phone -
   it keeps serving the copy it already has. Network-first fixes that while
   still falling back to cache the moment there is no signal, which is the
   whole point of this app. */
const CACHE = "honeymoon-vmsfpao4p";
const ASSETS = ["./", "./index.html", "./manifest.webmanifest", "./apple-touch-icon.png", "./icon-192.png", "./icon-512.png"];

/* The montage lives in its own cache, deliberately.

   It is tens of megabytes. Adding it to the ASSETS list above would mean one
   slow or failed fetch fails the whole addAll, and the app would install with
   nothing cached at all - itinerary included. The video is a gift; the
   itinerary is the point. They must not share a failure mode.

   This name is NOT versioned, so a rebuild of the app does not re-download the
   video. It is also excluded from the activate sweep below. */
const MEDIA_CACHE = "honeymoon-media";

self.addEventListener("install", (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).catch(() => {}));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE && k !== MEDIA_CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

function isMontage(pathname) {
  const name = pathname.split("/").pop() || "";
  return name.startsWith("v-") && name.endsWith(".mp4");
}

function isPage(req) {
  if (req.mode === "navigate") return true;
  const p = new URL(req.url).pathname;
  return p.endsWith("/") || p.endsWith("index.html");
}

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;

  if (isPage(e.request)) {
    e.respondWith(
      fetch(e.request)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put("./index.html", copy)).catch(() => {});
          return res;
        })
        .catch(() =>
          caches.match("./index.html", { ignoreSearch: true }).then(
            (hit) => hit || caches.match("./", { ignoreSearch: true })
          )
        )
    );
    return;
  }

  /* Cache-first, into the media bucket, and never fatal if it fails. */
  /* The montage is named from a hash and that name lives inside the encrypted
     payload, so this worker cannot know it. Match the shape instead: v-<hex>.mp4
     Cached on first watch, so a re-watch on the plane needs no signal. */
  if (isMontage(new URL(e.request.url).pathname)) {
    e.respondWith(
      caches.match(e.request, { ignoreSearch: true }).then((hit) => {
        if (hit) return hit;
        return fetch(e.request).then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(MEDIA_CACHE).then((c) =>
              c.put(e.request, copy).then(() =>
                /* The montage name is a content hash, so a replacement arrives
                   under a NEW name and the old one would sit here orphaned
                   forever - tens of megabytes of her storage, never reclaimed.
                   Drop any montage that is not this one. */
                c.keys().then((keys) =>
                  Promise.all(keys.map((k) =>
                    k.url !== e.request.url && isMontage(new URL(k.url).pathname)
                      ? c.delete(k)
                      : null
                  ))
                )
              )
            ).catch(() => {});
          }
          return res;
        });
      })
    );
    return;
  }

  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then((hit) => {
      if (hit) return hit;
      return fetch(e.request).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
        return res;
      });
    })
  );
});
