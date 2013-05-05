// Created by Rob W <gwnRob@gmail.com>
// This file is a part of a migration tool to help users to upgrade to the
// official version of the PDF.js Chrome extension.
//
// https://chrome.google.com/webstore/detail/oemmndcbldboiebfnladdacbdfmadadm
// https://github.com/mozilla/pdf.js/issues/3042

/* globals chrome, pdf_webRequestListener */
'use strict';

// Check if other extension has already been installed by checking if a
// resource is available (publicly visible through `web_accessible_resources`)
var url = 'chrome-extension://oemmndcbldboiebfnladdacbdfmadadm/patch-worker.js';

var _failCount = 0;
function failed() {
    // Clear console after 20 failed requests.
    if (++_failCount % 20 === 0) {
        console.clear();
    }
}

function checkIfUpgraded(callback) {
    var x = new XMLHttpRequest();
    x.open('GET', url);
    x.timeout = 1000;
    x.onload = function() {
        callback(true);
    };
    x.onerror = function() {
        failed();
        callback(false);
    };
    x.send();
}
// Synchronous request.
// Typically takes 1-2 ms for failure, and 2-3 ms for success
function checkIfUpgradedSync() {
    try {
        // Note: When this request fails, readyState stays at 0
        // and Chrome's devtools show the request as "pending"
        // even though the request has already been finished.
        var x = new XMLHttpRequest();
        x.timeout = 1000;
        x.open('GET', url, false);
        x.send();
        return true;
    } catch (e) {
        failed();
        return false;
    }
}

// Replace existing old pdf viewers with original URL.
function migrateOldPDFViewers(callback) {
    var totalTabs = 1;
    var hasFinished = false;
    var checkIfFinished = function() {
        if (--totalTabs <= 0 && hasFinished === true) {
            callback();
        }
    };
    chrome.extension.getViews({type:'tab'}).forEach(function(window) {
        var originalURL = window.location.search.match(/^\?file=([^=]*)/);
        if (originalURL) {
            ++totalTabs;
            window.addEventListener('unload', checkIfFinished, true);
            window.location.href = decodeURIComponent(originalURL[1]);
        }
    });
    hasFinished = true;
    checkIfFinished();
}

// Should be called only once - Replaces existing PDF Viewer tabs with original
// URLs (the updated PDF viewer can view PDFs without modifying the URL),
// and uninstall the extension.
var _deactivated = false;
function deactive_extension() {
    if (_deactivated) return; _deactivated = true;
    chrome.webRequest.onBeforeRequest.removeListener(pdf_webRequestListener);
    migrateOldPDFViewers(function() {
        // Farewell
        chrome.management.uninstallSelf();
    });
}


// Light-weight checks if extension has been upgraded
var _poller = 0;
var _pollCount = 0;
var _pollDurationMS = 10*60*1000;
var _pollDelayMS = 5*1000;

var _bgPoller = 0;
var _bgPollDelayMS = 60*1000;

function checkIfViewerShouldBeDeactivated() {
    checkIfUpgraded(function(isUpgraded) {
        if (isUpgraded) {
            unwatchUpdateStatus();
            clearInterval(_bgPoller);
            deactive_extension();
        }
    });
}
function watchUpdateStatus() {
    _pollCount = Math.ceil(_pollDurationMS / _pollDelayMS);
    if (_poller) return;
    _poller = setInterval(function() {
        checkIfViewerShouldBeDeactivated();
        if (--_pollCount <= 0) {
            unwatchUpdateStatus();
        }
    }, _pollDelayMS);
}
function unwatchUpdateStatus() {
    clearInterval(_poller);
    _poller = 0;
}
_bgPoller = setInterval(checkIfViewerShouldBeDeactivated, _bgPollDelayMS);
