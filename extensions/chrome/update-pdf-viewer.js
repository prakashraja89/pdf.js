// Migration assistent for PDF Viewer, created by Rob W <gwnRob@gmail.com>
// See also https://github.com/mozilla/pdf.js/issues/3042
/* globals chrome */
'use strict';

function getViewerURL() {
    var viewerPage = 'content/web/viewer.html';
    var url = chrome.extension.getURL(viewerPage) +
              location.search + location.hash;
    return url;
}
function getOriginalPDFUrl() {
    var match = /^\?file=(.*)/.exec(location.search);
    return match ? decodeURIComponent(match[1]) : 'unknown.pdf';
}
if (location.search) {
    document.getElementById('viewer-link').href = getViewerURL();
    document.getElementById('viewer-link').textContent = getOriginalPDFUrl();
} else {
    document.getElementById('not-now').textContent = '';
}

document.getElementById('cws-link').onmousedown = function() {
    chrome.extension.getBackgroundPage().watchUpdateStatus();
    console.log('Started to watch update progress after clicking CWS link');
};
chrome.extension.getBackgroundPage().checkIfViewerShouldBeDeactivated();
