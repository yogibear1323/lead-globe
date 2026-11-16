/* Lead Globe home: animated background globe + scroll reveals.
   Decorative only: the stage has pointer-events:none and aria-hidden. */
(function () {
  document.documentElement.classList.remove("no-js");

  // Scroll reveals
  var els = document.querySelectorAll(".reveal, .steps");
  if ("IntersectionObserver" in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); } });
    }, { threshold: 0.12 });
    els.forEach(function (el) { io.observe(el); });
  } else { els.forEach(function (el) { el.classList.add("in"); }); }

  var onScroll = function () { document.body.classList.toggle("scrolled", window.scrollY > window.innerHeight * 0.55); };
  window.addEventListener("scroll", onScroll, { passive: true }); onScroll();

  // Background globe: only on capable, wide screens without reduced motion.
  var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var small = window.matchMedia("(max-width: 760px)").matches;
  var hasGL = (function () { try { var c = document.createElement("canvas"); return !!(c.getContext("webgl2") || c.getContext("webgl")); } catch (e) { return false; } })();
  if (reduce || small || !hasGL) return;

  // Approximate city centres across the covered regions (decorative, not business data).
  var C = [
    [33.45,-112.07],[39.74,-104.99],[37.69,-97.34],[39.10,-94.58],[41.88,-87.63],[29.76,-95.37],[32.78,-96.80],[25.76,-80.19],
    [33.75,-84.39],[40.71,-74.01],[42.36,-71.06],[38.91,-77.04],[47.61,-122.33],[37.77,-122.42],[34.05,-118.24],[44.98,-93.27],
    [36.17,-115.14],[39.96,-82.99],[35.23,-80.84],[45.52,-122.68],[43.65,-79.38],[45.50,-73.57],[49.28,-123.12],[51.05,-114.07],
    [53.55,-113.49],[49.90,-97.14],[44.65,-63.57],[46.81,-71.21],[60.72,-135.06],[62.45,-114.37],
    [51.51,-0.13],[48.86,2.35],[52.52,13.40],[40.42,-3.70],[41.90,12.50],[52.37,4.90],[50.85,4.35],[48.21,16.37],
    [59.33,18.07],[55.68,12.57],[59.91,10.75],[60.17,24.94],[52.23,21.01],[50.08,14.44],[47.50,19.04],[44.43,26.10],
    [38.72,-9.14],[53.35,-6.26],[37.98,23.73],[46.95,7.45],[45.46,9.19],[41.39,2.17],[64.15,-21.94],[35.17,33.36]
  ];
  var pts = C.map(function (c) { return { lat: c[0], lng: c[1], s: 0.25 + Math.random() * 0.5 }; });
  function pick() { return pts[Math.floor(Math.random() * pts.length)]; }
  var arcs = [];
  for (var i = 0; i < 26; i++) {
    var a = pick(), b = pick(); if (a === b) continue;
    arcs.push({ startLat: a.lat, startLng: a.lng, endLat: b.lat, endLng: b.lng,
      color: [["rgba(34,230,242,0.95)", "rgba(139,92,246,0.9)"], ["rgba(255,79,216,0.9)", "rgba(34,230,242,0.9)"], ["rgba(125,255,179,0.9)", "rgba(139,92,246,0.9)"]][i % 3],
      t: 1800 + Math.random() * 2600 });
  }

  var s = document.createElement("script");
  s.src = "https://unpkg.com/globe.gl";
  s.async = true;
  s.onload = init;
  document.head.appendChild(s);

  function init() {
    var el = document.getElementById("bg-globe");
    if (!el || !window.Globe) return;
    var g = Globe({ rendererConfig: { antialias: false, alpha: true, powerPreference: "low-power" } })(el)
      .width(el.clientWidth).height(el.clientHeight)
      .backgroundColor("rgba(0,0,0,0)")
      .globeImageUrl("https://unpkg.com/three-globe/example/img/earth-night.jpg")
      .showAtmosphere(true).atmosphereColor("#22e6f2").atmosphereAltitude(0.28)
      .pointsData(pts).pointColor(function () { return "#7dffb3"; }).pointAltitude(0.01).pointRadius(function (d) { return d.s; }).pointsMerge(true)
      .ringsData(pts.filter(function (_, i) { return i % 3 === 0; }))
      .ringColor(function () { return function (t) { return "rgba(34,230,242," + (1 - t) + ")"; }; })
      .ringMaxRadius(4).ringPropagationSpeed(2.2).ringRepeatPeriod(1400)
      .arcsData(arcs).arcColor("color").arcStroke(0.45).arcAltitudeAutoScale(0.45)
      .arcDashLength(0.4).arcDashGap(2.2).arcDashInitialGap(function () { return Math.random() * 3; }).arcDashAnimateTime("t")
      .onGlobeReady(function () { el.classList.add("ready"); document.body.classList.add("globe-on"); });

    try { g.renderer().setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5)); } catch (e) {}
    var ctl = g.controls();
    ctl.autoRotate = true; ctl.autoRotateSpeed = 0.55; ctl.enableZoom = false; ctl.enablePan = false; ctl.enableRotate = false;
    g.pointOfView({ lat: 42, lng: -45, altitude: 2.1 }, 0);

    document.addEventListener("visibilitychange", function () {
      if (document.hidden) g.pauseAnimation(); else g.resumeAnimation();
    });
    var rt;
    window.addEventListener("resize", function () {
      clearTimeout(rt);
      rt = setTimeout(function () { g.width(el.clientWidth).height(el.clientHeight); }, 150);
    });
    // Subtle mouse parallax on the background layer.
    var raf = 0, tx = 0, ty = 0;
    window.addEventListener("mousemove", function (e) {
      tx = (e.clientX / window.innerWidth - 0.5) * -24;
      ty = (e.clientY / window.innerHeight - 0.5) * -16;
      if (!raf) raf = requestAnimationFrame(function () { el.style.transform = "translate3d(" + tx + "px," + ty + "px,0)"; raf = 0; });
    }, { passive: true });
  }
})();
