import _ from 'lodash';
import URL from 'url';

Object.defineProperty(chrome.runtime, 'foreground', {
  get() { return _.has(chrome, 'webstore'); }
});
Object.defineProperty(chrome.runtime, 'background', {
  get() { return !chrome.runtime.foreground && _.has(chrome, 'permissions'); }
});
Object.defineProperty(chrome.runtime, 'sideground', {
  get() { return !chrome.runtime.background && _.has(chrome, 'extension'); }
});

if(chrome.runtime.background) {
  chrome.webRequest.onBeforeSendHeaders.addListener((info) => {
    if(info.tabId > 0) {
      chrome.tabs.get(info.tabId, (tab) => {
        if(!tab) return;
        const headerReferer = _(info.requestHeaders).chain().find({ name: 'Referer' }).get('value', tab.url).value();
        const headerOrigin  = _(info.requestHeaders).chain().find({ name: 'Origin'  }).get('value', headerReferer).value();

        const bufferURL = URL.parse(headerReferer, true);
        const originURL = URL.parse(headerOrigin, true);
        if(_.eq(bufferURL.hostname, originURL.hostname)) {
          const targetURL = URL.parse(info.url, true);
          const key = targetURL.hostname;
          const sub = originURL.hostname;
          chrome.storage.local.get(key, (storage) => {
            storage[key] = storage[key] || {};
            storage[key][sub] = storage[key][sub] || info.requestHeaders;
            storage[key][sub] = _.uniqBy(_.concat(info.requestHeaders, storage[key][sub]), (header)=>header.name.toLowerCase());
            chrome.storage.local.set(storage);
          });  
        }
      })
    }
    return { requestHeaders: info.requestHeaders };
  }, { urls: ["<all_urls>"] }, [ "requestHeaders" ]);
};
if(chrome.runtime.background || chrome.runtime.sideground) {
  window.fetchCORS = (url, options = {}) => {
    const originURL = URL.parse(_.get(options, 'origin', location.href), true);
    const targetURL = URL.parse(url);
    targetURL.query = _.merge(targetURL.query, options.query);

    const key = targetURL.hostname;
    const sub = originURL.hostname;
    return new Promise((resolve)=>chrome.storage.local.get(key, resolve)).then((storage) => {
      const defaultOptions = { method: 'GET', credentials: 'same-origin' };
      const requestHeaders = _.get(options, 'headers', new Headers());
      // merge headers
      const headers = storage[key] && storage[key][sub];
      _.each(headers, (header) => !requestHeaders.has(header.name) && requestHeaders.append(header.name, header.value));
      // parse content
      const requestBody = _.get(options, 'body', undefined);

      let migrateBody = requestBody;
      if(_.isPlainObject(requestBody)) {
        const contentType = _.get(options, 'contentType', requestHeaders.get('Content-Type'));
        requestHeaders.set('Content-Type', contentType || 'application/x-www-form-urlencoded');
        if(_.includes(contentType, '/json')) {
          migrateBody = JSON.stringify(requestBody);
        }else if(_.includes(contentType, 'application/x-www-form-urlencoded')) {
          migrateBody = new URLSearchParams();
          _.each(requestBody, (val, key) => migrateBody.append(key, val));
        }else if(_.includes(contentType, 'multipart/form-data')) {
          migrateBody = new FormData();
          _.each(requestBody, (val, key) => migrateBody.append(key, val));
        }else { // text/plain
          migrateBody = _.reduce(requestBody, (str, val, key) => `${str}${str?'&':''}${key}=${val}`, '');
        }
      }
      // fetch request
      return fetch(targetURL.href, _.merge(defaultOptions, _.omit(options, 'body', 'origin', 'headers'), { body: migrateBody, headers: requestHeaders }));
    });
  };
}