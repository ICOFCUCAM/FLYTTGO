/*!
 * FlyttGo booking widget (docs/WHITE_LABEL.md → Booking widget).
 *
 * Paste on your own website:
 *
 *   <div id="flyttgo-booking"></div>
 *   <script src="https://flyttgo.no/widget.js" data-company="your-slug"
 *           data-target="#flyttgo-booking" async></script>
 *
 * It shows your FlyttGo booking page in a frame and keeps the frame as tall
 * as its content. No API key and no cookies of your own site are involved:
 * customers book through your FlyttGo page, as on /b/<slug>. The frame works
 * only on the websites you list in the Corporate dashboard (API and widget);
 * elsewhere FlyttGo refuses to be framed.
 *
 * Options (data- attributes on the script tag):
 *   data-company  your company's slug (required)
 *   data-target   a CSS selector for the element to fill (default: right
 *                 after the script tag)
 *   data-height   the height before the page has loaded, in pixels (640)
 * No dependencies; works without any build step.
 */
(function () {
  'use strict';
  var script = document.currentScript;
  if (!script) {
    var all = document.querySelectorAll('script[data-company][src*="widget.js"]');
    script = all[all.length - 1];
  }
  if (!script || script.getAttribute('data-flyttgo-done')) return;
  script.setAttribute('data-flyttgo-done', '1');

  var slug = (script.getAttribute('data-company') || '').toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(slug)) {
    if (typeof console !== 'undefined') console.error('FlyttGo widget: data-company must be your company slug (as in flyttgo.no/b/<slug>).');
    return;
  }
  var base;
  try { base = new URL(script.src, document.baseURI).origin; } catch (e) { base = 'https://flyttgo.no'; }
  var height = parseInt(script.getAttribute('data-height') || '640', 10);
  if (!(height >= 200 && height <= 4000)) height = 640;

  var frame = document.createElement('iframe');
  frame.src = base + '/embed/' + slug + '?origin=' + encodeURIComponent(window.location.origin);
  frame.title = 'Booking';
  frame.loading = 'lazy';
  frame.referrerPolicy = 'strict-origin';
  /* FlyttGo's page runs its own booking flow; it may open payment in a new
   * tab, and never navigates your page without the visitor's click. */
  frame.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms allow-popups ' +
    'allow-popups-to-escape-sandbox allow-top-navigation-by-user-activation');
  frame.setAttribute('allow', 'payment');
  frame.style.cssText = 'display:block;width:100%;max-width:100%;border:0;overflow:hidden;height:' + height + 'px';

  window.addEventListener('message', function (event) {
    if (event.source !== frame.contentWindow || event.origin !== base) return;
    var data = event.data;
    if (!data || data.type !== 'flyttgo:resize' || typeof data.height !== 'number') return;
    var h = Math.round(data.height);
    if (h >= 200 && h <= 10000) frame.style.height = h + 'px';
  });

  var target = script.getAttribute('data-target');
  var host = target ? document.querySelector(target) : null;
  if (host) host.appendChild(frame);
  else if (script.parentNode) script.parentNode.insertBefore(frame, script.nextSibling);
})();
