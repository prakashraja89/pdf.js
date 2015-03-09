/* -*- Mode: Java; tab-width: 2; indent-tabs-mode: nil; c-basic-offset: 2 -*- */
/* vim: set shiftwidth=2 tabstop=2 autoindent cindent expandtab: */
/*
Copyright 2015 Mozilla Foundation

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
/* globals chrome, getHeaderFromHeaders */

'use strict';

// This file is responsible for restoring the HTTP referer on PDF requests from
// the extension. This is achieved as follows:
// 1. The PDF Viewer sends the PDF URL and document.referrer to the background
//    if the viewer's document.referrer value is non-empty.
// 2. The background (this script) registers a webRequest listener that adds the
//    Referer request header to every XMLHttpRequest that matches the given tab,
//    frame and URL.
//    Redirects are NOT supported, i.e. the Referer header is not added again if
//    the PDF resource is redirected.
// 3. When the frame is unloaded, the listener is removed.
// This feature only works in Chrome 41+, because previous versions did not
// provide the frame ID to message events.
(function PreserveHttpRefererClosure() {

  /**
   * Creates a webRequest.onBeforeSendHeaders listener that adds the Referer
   * request header to the given frame.
   *
   * @param {number} frameId - ID of the PDF Viewer frame within the tab.
   * @param {string} referer - The referer to be sent with the request.
   */
  function createOnBeforeSendHeadersListener(frameId, referer) {
    return function(details) {
      if (details.frameId !== frameId) {
        return;
      }
      var headers = details.requestHeaders;
      var refererHeader = getHeaderFromHeaders(headers, 'referer');
      if (!refererHeader) {
        refererHeader = {name: 'Referer'};
        headers.push(refererHeader);
      }
      refererHeader.value = referer;
      return {requestHeaders: headers};
    };
  }

  // chromecom.js will open a port whenever the referer is set.
  chrome.runtime.onConnect.addListener(function(port) {
    var refererData = /^set-referer(.+)$/.exec(port.name);
    if (!refererData) {
      return;
    }
    if (!('frameId' in port.sender)) {
      // frameId is only supported since Chrome 41.
      port.disconnect();
      return;
    }
    refererData = JSON.parse(refererData);
    var urlPattern = refererData.url;
    var referer = refererData.referer;
    var tabId = port.sender.tab.id;
    var frameId = port.sender.frameId;

    var handler = createOnBeforeSendHeadersListener(frameId, referer);
    port.onDisconnect.addListener(function() {
      // Frame unloaded or tab closed.
      chrome.webRequest.onBeforeSendHeaders.removeListener(handler);
    });
    chrome.webRequest.onBeforeSendHeaders.addListener(handler, {
      urls: [urlPattern],
      types: ['xmlhttprequest'],
      tabId: tabId
    }, ['blocking', 'requestHeaders']);

    // Acknowledge that the port has successfully been created.
    port.postMessage();
  });

})();
