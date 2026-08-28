/* Viewport readout laid over the real deck (test2.html): what the page
   measures at launch and at every resize since, against the screen — for
   the black band under the sheets on the 17e (2026-08-28). Read-only:
   pointer-events none, so the deck behaves as it does without it. */
(function () {
  const t0 = performance.now();
  const log = [];
  const box = document.createElement('pre');
  box.style.cssText = 'position:fixed;left:8px;right:8px;top:calc(env(safe-area-inset-top,0px) + 30px);z-index:10000;' +
    'margin:0;padding:8px;background:rgba(0,0,0,0.85);color:#0f0;font:11px/1.4 monospace;white-space:pre-wrap;' +
    'word-break:break-all;pointer-events:none;border-radius:6px';
  const line = document.createElement('div');   // a hairline where fixed bottom:0 lands
  line.style.cssText = 'position:fixed;left:0;right:0;bottom:0;height:2px;background:#e33;z-index:10000;pointer-events:none';
  const probe = document.createElement('div');
  probe.style.cssText = 'position:fixed;visibility:hidden;pointer-events:none;' +
    'padding:env(safe-area-inset-top,0px) 0 env(safe-area-inset-bottom,0px) 0';

  function stamp(why) {
    log.push(`${why} @${Math.round(performance.now() - t0)}ms inner ${innerWidth}×${innerHeight} vv ${visualViewport ? Math.round(visualViewport.height) : '-'}`);
    if (log.length > 8) log.shift();
  }
  function read() {
    const p = getComputedStyle(probe);
    const html = document.documentElement.getBoundingClientRect();
    const main = document.querySelector('.main');
    const cur = document.querySelector('section.current');
    const r = cur && cur.getBoundingClientRect();
    const m = main && main.getBoundingClientRect();
    const cs = cur && getComputedStyle(cur);
    box.textContent = [
      `${location.pathname}  screen ${screen.width}×${screen.height} @${devicePixelRatio}  standalone ${matchMedia('(display-mode: standalone)').matches}`,
      `inner ${innerWidth}×${innerHeight}  vv ${visualViewport ? Math.round(visualViewport.height) + ' top ' + Math.round(visualViewport.offsetTop) : '-'}`,
      `html rect ${Math.round(html.top)} → ${Math.round(html.bottom)}  client ${document.documentElement.clientHeight}`,
      `.main rect ${m ? Math.round(m.top) + ' → ' + Math.round(m.bottom) : '-'}  --app-height ${getComputedStyle(document.documentElement).getPropertyValue('--app-height').trim()}`,
      `sheet.current rect ${r ? Math.round(r.top) + ' → ' + Math.round(r.bottom) : '-'}  css top ${cs ? cs.top : '-'} bottom ${cs ? cs.bottom : '-'} pos ${cs ? cs.position : '-'}`,
      `safe-area top ${p.paddingTop} bottom ${p.paddingBottom}  radius ${getComputedStyle(document.documentElement).getPropertyValue('--screen-radius').trim()}`,
      '— events —',
      ...log,
    ].join('\n');
  }
  function go() {
    document.body.append(probe, line, box);
    stamp('load');
    read();
    addEventListener('resize', () => { stamp('resize'); read(); });
    if (window.visualViewport) visualViewport.addEventListener('resize', () => { stamp('vv-resize'); read(); });
    addEventListener('orientationchange', () => { stamp('orientation'); read(); });
    document.addEventListener('visibilitychange', () => { stamp('visibility ' + document.visibilityState); read(); });
    setInterval(read, 1000);
  }
  if (document.body) go(); else addEventListener('DOMContentLoaded', go);
})();
