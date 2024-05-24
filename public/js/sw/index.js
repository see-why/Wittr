function allStaticCacheNames() {
 return ["wittr-static-v6", "wittr-content-imgs"];
}

function servePhoto(request) {
  var storageUrl = request.url.replace(/-\d+px\.jpg$/, '');
  return caches.open(allStaticCacheNames()[1]).then(function(cache){
    return cache.match(storageUrl).then(function(response){
      if (response) return response;
      
      return fetch(request).then(function(networkResponse) {
        cache.put(storageUrl, networkResponse.clone());
        return networkResponse;
      });
    });
  });
}

function serveAvatar(request){
  var storageUrl = request.url.replace(/-\dx\.jpg$/, '');
  return caches.open(allStaticCacheNames()[1]).then(function(cache){
    return cache.match(storageUrl).then(function(response){
      var networkResponse = fetch(request).then(function(networkResponse) {
        cache.put(storageUrl, networkResponse.clone());
        return networkResponse;   
      });

      return response || networkResponse;
    });
  });
}

self.addEventListener("install", function(event) {
  event.waitUntil(
    caches.open(allStaticCacheNames()[0]).then(function(cache){
      return cache.addAll([
      "/skeleton",
      "js/main.js",
      "css/main.css",
      "imgs/icon.png",
      "https://fonts.gstatic.com/s/roboto/v15/2UX7WLTfW3W8TclTUvlFyQ.woff",
      "https://fonts.gstatic.com/s/roboto/v15/d-6IYplOFocCacKzxwXSOD8E0i7KZn-EPnyo3HZu7kw.woff"
    ]);
    })
  );
});

self.addEventListener("activate", function(event) {
  event.waitUntil(
    caches.keys().then(function(cacheNames) {
      return Promise.all(
        cacheNames.filter(function(cacheName) {
          return cacheName.startsWith("wittr-") && !allStaticCacheNames().includes(cacheName);
        }).map(function(cacheName){
          return caches.delete(cacheName);
        })
      );
    }));
});

self.addEventListener("fetch", function(event){
  var requestUrl = new URL(event.request.url);

  if (requestUrl.origin === location.origin){
    if(requestUrl.pathname === "/"){
      event.respondWith(caches.match("/skeleton"));
      return;
    }

    if (requestUrl.pathname.startsWith("/photos/")){
      event.respondWith(servePhoto(event.request));
      return;
    }

    if (requestUrl.pathname.startsWith("/avatars/")){
      event.respondWith(serveAvatar(event.request));
      return;
    }
  }

  event.respondWith(
    caches.match(event.request).then(function(response) {
      return response || fetch(event.request);
    })
  );
});

self.addEventListener("message", function(event){
  if (event.data.action == "skipWaiting") {
    self.skipWaiting();
  }
});
