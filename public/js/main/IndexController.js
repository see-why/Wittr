import PostsView from './views/Posts';
import ToastsView from './views/Toasts';
import idb from 'idb';

function openDatabase() {
  // If the browser doesn't support service worker,
  // we don't care about having a database
  if (!navigator.serviceWorker) {
    return Promise.resolve();
  }

  return idb.open('wittr', 1, function(upgradeDb) {
    switch(upgradeDb.oldVersion) {
      case 0:
        var wittrsStore = upgradeDb.createObjectStore('wittrs', { keyPath: 'id' });
        wittrsStore.createIndex('by-date', 'time');
    }
  });
}

export default function IndexController(container) {
  this._container = container;
  this._postsView = new PostsView(this._container);
  this._toastsView = new ToastsView(this._container);
  this._lostConnectionToast = null;
  this._openSocket();
  this._dbPromise = openDatabase();
  this._registerServiceWorker();
  this._cleanImageCache();

  var indexController = this;

  setInterval(function(){
    indexController._cleanImageCache();
  }, 1000 * 5 * 60);

  this._showCachedMessages().then(function() {
    indexController._openSocket();
  });
}

IndexController.prototype._registerServiceWorker = function(){
  if (!navigator.serviceWorker) return;

  var indexController = this;

  navigator.serviceWorker.register('sw.js').then(function(reg) {
    if (!navigator.serviceWorker.controller) return;

    console.log('service worker registered');

    if (reg.waiting) {
      indexController._updateReady(reg.waiting);
      return;
    }

    if (reg.installing) {
      indexController._trackInstalling(reg.installing);
      return;
    }

    reg.addEventListener('updatefound', function(){
      indexController._trackInstalling(reg.installing);
    });
  }).catch(function(error) {
    console.log(`error registering service worker: ${error}`);
  });

  navigator.serviceWorker.addEventListener('controllerchange', function(){
    window.location.reload();
  });
};

IndexController.prototype._trackInstalling = function(worker){
  var indexController = this;

  worker.addEventListener('statechange', function() {
    if (worker.state === 'installed') {
      indexController._updateReady(worker);
    }
  });
};

IndexController.prototype._updateReady = function(worker){
  var toast = this._toastsView.show("New version available", { buttons: ['refresh', 'dismiss'] });

  toast.answer.then(function(answer) {
    if (answer != 'refresh') return;
    worker.postMessage({ action: 'skipWaiting'});
  });
};

// open a connection to the server for live updates
IndexController.prototype._openSocket = function() {
  var indexController = this;
  var latestPostDate = this._postsView.getLatestPostDate();

  // create a url pointing to /updates with the ws protocol
  var socketUrl = new URL('/updates', window.location);
  socketUrl.protocol = 'ws';

  if (latestPostDate) {
    socketUrl.search = 'since=' + latestPostDate.valueOf();
  }

  // this is a little hack for the settings page's tests,
  // it isn't needed for Wittr
  socketUrl.search += '&' + location.search.slice(1);

  var ws = new WebSocket(socketUrl.href);

  // add listeners
  ws.addEventListener('open', function() {
    if (indexController._lostConnectionToast) {
      indexController._lostConnectionToast.hide();
    }
  });

  ws.addEventListener('message', function(event) {
    requestAnimationFrame(function() {
      indexController._onSocketMessage(event.data);
    });
  });

  ws.addEventListener('close', function() {
    // tell the user
    if (!indexController._lostConnectionToast) {
      indexController._lostConnectionToast = indexController._toastsView.show("Unable to connect. Retrying…");
    }

    // try and reconnect in 5 seconds
    setTimeout(function() {
      indexController._openSocket();
    }, 5000);
  });
};

// ensure only latest images are cached
IndexController.prototype._cleanImageCache = function() {
  return this._dbPromise.then(function(db) {
    var wittrsStore = db.transaction('wittrs').objectStore('wittrs');

    var images = [];

    return wittrsStore.getAll().then(function(messages) {
      messages.forEach(function(message) {
        if (message.photo) {
          images.push(message.photo);
        }
          images.push(message.avatar);
      });

      return caches.open('wittr-content-imgs').then(function(cache){
       return cache.keys().then(function(requests){
          requests.forEach(function(request){
            var url = new URL(request.url);
            if(!images.includes(url.pathname)){
              cache.delete(request);
            }
          });
        });
      });

    });
  });
};

// called when the web socket sends message data
IndexController.prototype._onSocketMessage = function(data) {
  var messages = JSON.parse(data);

  this._dbPromise.then(function(db) {
    if(!db) return;

    var tx = db.transaction('wittrs', 'readwrite');
    var wittrsStore = tx.objectStore('wittrs');

    messages.forEach(function(message) {
      wittrsStore.put(message);
    });

    var byDateIndex = wittrsStore.index('by-date');
    byDateIndex.openCursor(null, 'prev').then(function(cursor) {
      return cursor.advance(30);
    }).then(function deleteRest(cursor){
      if (!cursor) return;
      cursor.delete();
      return cursor.continue().then(deleteRest);
    });
  });

  this._postsView.addPosts(messages);
};

// show cache messages in IndexDb
IndexController.prototype._showCachedMessages = function() {
  var indexController = this;

  indexController._dbPromise.then(function(db) {
    if (!db || indexController._postsView.showingPosts()) return;

    var wittrsStore = db.transaction('wittrs').objectStore('wittrs');
    var dateIndex = wittrsStore.index('by-date');

    return dateIndex.getAll().then(function(messages){
      indexController._postsView.addPosts(messages.reverse());
    });
  });
};