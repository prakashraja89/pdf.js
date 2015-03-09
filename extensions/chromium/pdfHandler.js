/* -*- Mode: Java; tab-width: 2; indent-tabs-mode: nil; c-basic-offset: 2 -*- */
/* vim: set shiftwidth=2 tabstop=2 autoindent cindent expandtab: */
/*
Copyright 2012 Mozilla Foundation

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/
/* globals chrome, Features */

'use strict';

var VIEWER_URL = chrome.extension.getURL('content/web/viewer.html');

function getViewerURL(pdf_url) {
  return VIEWER_URL + '?file=' + encodeURIComponent(pdf_url);
}

/**
 * @param {Object} details First argument of the webRequest.onHeadersReceived
 *                         event. The property "url" is read.
 * @return {boolean} True if the PDF file should be downloaded.
 */
function isPdfDownloadable(details) {
  if (details.url.indexOf('pdfjs.action=download') >= 0) {
    return true;
  }
  // Display the PDF viewer regardless of the Content-Disposition header
  // if the file is displayed in the main frame.
  if (details.type === 'main_frame') {
    return false;
  }
  var cdHeader = (details.responseHeaders &&
    getHeaderFromHeaders(details.responseHeaders, 'content-disposition'));
  return (cdHeader && /^attachment/i.test(cdHeader.value));
}

/**
 * Get the header from the list of headers for a given name.
 * @param {Array} headers responseHeaders of webRequest.onHeadersReceived
 * @return {undefined|{name: string, value: string}} The header, if found.
 */
function getHeaderFromHeaders(headers, headerName) {
  for (var i=0; i<headers.length; ++i) {
    var header = headers[i];
    if (header.name.toLowerCase() === headerName) {
      return header;
    }
  }
}

/**
 * Check if the request is a PDF file.
 * @param {Object} details First argument of the webRequest.onHeadersReceived
 *                         event. The properties "responseHeaders" and "url"
 *                         are read.
 * @return {boolean} True if the resource is a PDF file.
 */
function isPdfFile(details) {
  var header = getHeaderFromHeaders(details.responseHeaders, 'content-type');
  if (header) {
    var headerValue = header.value.toLowerCase().split(';',1)[0].trim();
    return (headerValue === 'application/pdf' ||
            headerValue === 'application/octet-stream' &&
            details.url.toLowerCase().indexOf('.pdf') > 0);
  }
}

/**
 * Takes a set of headers, and set "Content-Disposition: attachment".
 * @param {Object} details First argument of the webRequest.onHeadersReceived
 *                         event. The property "responseHeaders" is read and
 *                         modified if needed.
 * @return {Object|undefined} The return value for the onHeadersReceived event.
 *                            Object with key "responseHeaders" if the headers
 *                            have been modified, undefined otherwise.
 */
function getHeadersWithContentDispositionAttachment(details) {
  var headers = details.responseHeaders;
  var cdHeader = getHeaderFromHeaders(headers, 'content-disposition');
  if (!cdHeader) {
    cdHeader = {name: 'Content-Disposition'};
    headers.push(cdHeader);
  }
  if (!/^attachment/i.test(cdHeader.value)) {
    cdHeader.value = 'attachment' + cdHeader.value.replace(/^[^;]+/i, '');
    return { responseHeaders: headers };
  }
}

// Remembers the request headers for every http(s) page request for the duration
// of the request.
var g_requestHeaders = {};
(function() {
  var requestFilter = {
    urls: ['*://*/*'],
    types: ['main_frame', 'sub_frame']
  };
  chrome.webRequest.onSendHeaders.addListener(function(details) {
    g_requestHeaders[details.requestId] = details.requestHeaders;
  }, requestFilter, ['requestHeaders']);
  chrome.webRequest.onBeforeRedirect.addListener(forgetHeaders, requestFilter);
  chrome.webRequest.onCompleted.addListener(forgetHeaders, requestFilter);
  chrome.webRequest.onErrorOccurred.addListener(forgetHeaders, requestFilter);
  function forgetHeaders(details) {
    delete g_requestHeaders[details.requestId];
  }
})();

// This method binds a webRequest event handler which adds the Referer header
// to matching PDF resource requests (only if the Referer is non-empty). The
// handler is removed as soon as the PDF viewer frame is unloaded.
// NOTE: A limitation of this method is that the referrer is not added again
// when the page reloads, or when the page is navigated away.
function stickRefererToResource(requestId, tabId, frameId, pdfUrl) {
  if (!g_requestHeaders[requestId]) {
    // This case should not happen, because g_requestHeaders is set before the
    // request is sent to the server, and reset upon completion of the request.
    return;
  }
  var referer = getHeaderFromHeaders(g_requestHeaders[requestId], 'referer');
  referer = referer && referer.value;
  if (!referer) {
    return;
  }

  chrome.runtime.onConnect.addListener(onReceivePort);
  chrome.tabs.onRemoved.addListener(onTabRemoved);
  chrome.webNavigation.onBeforeNavigate.addListener(onBeforeNavigate);
  chrome.webRequest.onBeforeSendHeaders.addListener(onBeforeSendHeaders, {
    urls: [pdfUrl],
    types: ['xmlhttprequest'],
    tabId: tabId
  }, ['blocking', 'requestHeaders']);

  function onReceivePort(port) {
    if (port.name !== 'chromecom-is-alive') {
      return;
    }
    // Note: sender.frameId is only set in Chrome 41+.
    if (port.sender.tabId !== tabId || port.sender.frameId !== frameId) {
      return;
    }
    // The port is only disconnected when the other end reloads.
    port.onDisconnect.addListener(unstickHandlers);
    // Remove these listeners, because we now have a more granular event handler
    // that only gets triggered when the page really unloads.
    chrome.runtime.onConnect.removeListener(onReceivePort);
    chrome.tabs.onRemoved.addListener(onTabRemoved);
    chrome.webNavigation.onBeforeNavigate.removeListener(onBeforeNavigate);
  }
  function onTabRemoved(removedTabId) {
    if (removedTabId === tabId) {
      unstickHandlers();
    }
  }
  function onBeforeNavigate(details) {
    if (details.tabId !== tabId) {
      return;
    }
    if (details.frameId === frameId || details.frameId === 0) {
      unstickHandlers();
    }
  }
  function onBeforeSendHeaders(details) {
    if (details.frameId !== frameId) {
      return;
    }
    var headers = details.requestHeaders;
    var refererHeader = getHeaderFromHeaders(headers, 'referer');
    if (!refererHeader) {
      refererHeader = {name: 'Referer'};
      headers.push(refererHeader);
    } else if (refererHeader.value &&
        refererHeader.value.lastIndexOf('chrome-extension:', 0) !== 0) {
      // Sanity check. If the referer is set, and the value is not the URL of
      // this extension, then the request was not initiated by this extension.
      unstickHandlers();
      return;
    }
    refererHeader.value = referer;
    return {requestHeaders: headers};
  }

  function unstickHandlers() {
    chrome.runtime.onConnect.removeListener(onReceivePort);
    chrome.tabs.onRemoved.removeListener(onTabRemoved);
    chrome.webNavigation.onBeforeNavigate.removeListener(onBeforeNavigate);
    chrome.webRequest.onBeforeSendHeaders.removeListener(onBeforeSendHeaders);
  }
}


chrome.webRequest.onHeadersReceived.addListener(
  function(details) {
    if (details.method !== 'GET') {
      // Don't intercept POST requests until http://crbug.com/104058 is fixed.
      return;
    }
    if (!isPdfFile(details)) {
      return;
    }
    if (isPdfDownloadable(details)) {
      // Force download by ensuring that Content-Disposition: attachment is set
      return getHeadersWithContentDispositionAttachment(details);
    }

    var viewerUrl = getViewerURL(details.url);

    stickRefererToResource(details.requestId, details.tabId, details.frameId,
        details.url);

    // Replace frame with viewer
    if (Features.webRequestRedirectUrl) {
      return { redirectUrl: viewerUrl };
    }
    // Aww.. redirectUrl is not yet supported, so we have to use a different
    // method as fallback (Chromium <35).

    if (details.frameId === 0) {
      // Main frame. Just replace the tab and be done!
      chrome.tabs.update(details.tabId, {
        url: viewerUrl
      });
      return { cancel: true };
    } else {
      // Sub frame. Requires some more work...
      // The navigation will be cancelled at the end of the webRequest cycle.
      chrome.webNavigation.onErrorOccurred.addListener(function listener(nav) {
        if (nav.tabId !== details.tabId || nav.frameId !== details.frameId) {
          return;
        }
        chrome.webNavigation.onErrorOccurred.removeListener(listener);

        // Locate frame and insert viewer
        chrome.tabs.executeScriptInFrame(details.tabId, {
          frameId: details.frameId,
          code: 'location.href = ' + JSON.stringify(viewerUrl) + ';'
        }, function(result) {
          if (!result) {
            console.warn('Frame not found! Opening viewer in new tab...');
            chrome.tabs.create({
              url: viewerUrl
            });
          }
        });
      }, {
        url: [{ urlEquals: details.url.split('#', 1)[0] }]
      });
      // Prevent frame from rendering by using X-Frame-Options.
      // Do not use { cancel: true }, because that makes the frame inaccessible
      // to the content script that has to replace the frame's URL.
      return {
        responseHeaders: [{
          name: 'X-Content-Type-Options',
          value: 'nosniff'
        }, {
          name: 'X-Frame-Options',
          value: 'deny'
        }]
      };
    }

    // Immediately abort the request, because the frame that initiated the
    // request will be replaced with the PDF Viewer (within a split second).
  },
  {
    urls: [
      '<all_urls>'
    ],
    types: ['main_frame', 'sub_frame']
  },
  ['blocking','responseHeaders']);

chrome.webRequest.onBeforeRequest.addListener(
  function onBeforeRequestForFTP(details) {
    if (!Features.extensionSupportsFTP) {
      chrome.webRequest.onBeforeRequest.removeListener(onBeforeRequestForFTP);
      return;
    }
    if (isPdfDownloadable(details)) {
      return;
    }
    var viewerUrl = getViewerURL(details.url);
    return { redirectUrl: viewerUrl };
  },
  {
    urls: [
      'ftp://*/*.pdf',
      'ftp://*/*.PDF'
    ],
    types: ['main_frame', 'sub_frame']
  },
  ['blocking']);

chrome.webRequest.onBeforeRequest.addListener(
  function(details) {
    if (isPdfDownloadable(details)) {
      return;
    }

    // NOTE: The manifest file has declared an empty content script
    // at file://*/* to make sure that the viewer can load the PDF file
    // through XMLHttpRequest. Necessary to deal with http://crbug.com/302548
    var viewerUrl = getViewerURL(details.url);

    return { redirectUrl: viewerUrl };
  },
  {
    urls: [
      'file://*/*.pdf',
      'file://*/*.PDF'
    ],
    types: ['main_frame', 'sub_frame']
  },
  ['blocking']);
