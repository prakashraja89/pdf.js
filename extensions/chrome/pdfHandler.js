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
/* globals chrome, checkIfUpgradedSync, deactivate_extension */

'use strict';

function isPdfDownloadable(details) {
  return details.url.indexOf('pdfjs.action=download') >= 0;
}

function pdf_webRequestListener(details) {
  if (isPdfDownloadable(details))
    return;

  if (checkIfUpgradedSync()) {
    // Upgraded, the new viewer will take care of the pdf file.
    deactivate_extension();
    return;
  }

  var viewerPage = 'update-pdf-viewer.html';
  var url = chrome.extension.getURL(viewerPage) +
    '?file=' + encodeURIComponent(details.url);
  return { redirectUrl: url };
}
chrome.webRequest.onBeforeRequest.addListener(
  pdf_webRequestListener,
  {
    urls: [
      'http://*/*.pdf',
      'https://*/*.pdf',
      'file://*/*.pdf',
      'http://*/*.PDF',
      'https://*/*.PDF',
      'file://*/*.PDF'
    ],
    types: ['main_frame']
  },
  ['blocking']);
