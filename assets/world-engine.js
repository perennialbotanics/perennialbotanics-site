
/* assets/world-engine.js
   One engine for all pages:
   - Finds a root: #world-root or #axis-root
   - Loads SVG from data-desktop-svg / data-phone-svg
   - Locks camera to #focus-region if present
   - Wires SVG buttons:
       #btn-axismundi -> axis-mundi.html
       #btn-home      -> index.html
   - Adds pan + zoom (wheel + drag + touch)
*/

(function () {
  "use strict";

  document.addEventListener("DOMContentLoaded", () => {
    boot().catch((e) => console.error("WORLD ENGINE BOOT FAIL:", e));
  });

  function detectRoot() {
    return (
      document.getElementById("world-root") ||
      document.getElementById("axis-root")
    );
  }

  function isMobileLike() {
    return window.matchMedia("(max-width: 768px)").matches;
  }

  async function loadSvgIntoRoot(root) {
    const desktopSvg = root.getAttribute("data-desktop-svg");
    const phoneSvg = root.getAttribute("data-phone-svg");
    const svgUrl = isMobileLike() ? phoneSvg || desktopSvg : desktopSvg;

    if (!svgUrl) throw new Error("Missing data-desktop-svg on root.");

    const res = await fetch(svgUrl, { cache: "no-store" });
    if (!res.ok) throw new Error("Failed to fetch SVG: " + svgUrl);

    root.innerHTML = await res.text();

    const svg = root.querySelector("svg");
    if (!svg) throw new Error("SVG not found after injection.");

    // make SVG fill the viewport container
    svg.removeAttribute("width");
    svg.removeAttribute("height");
    svg.style.width = "100%";
    svg.style.height = "100%";
    svg.style.display = "block";

    return svg;
  }

  function fitViewBoxToFocus(svg, root) {
    const focus = svg.querySelector("#focus-region");
    if (!focus) return; // optional

    const bbox = focus.getBBox(); // stable
    const fx = bbox.x,
      fy = bbox.y,
      fw = bbox.width,
      fh = bbox.height;

    const vw = root.clientWidth || window.innerWidth;
    const vh = root.clientHeight || window.innerHeight;

    const scale = Math.min(vw / fw, vh / fh);
    const newWidth = vw / scale;
    const newHeight = vh / scale;

    const cx = fx + fw / 2;
    const cy = fy + fh / 2;

    const newX = cx - newWidth / 2;
    const newY = cy - newHeight / 2;

    svg.setAttribute("viewBox", `${newX} ${newY} ${newWidth} ${newHeight}`);
  }

  function wireButtons(svg) {
  const routes = [
    { id: "btn-axismundi", href: "axis-mundi.html" },
    { id: "btn-home", href: "index.html" },
  ];

  for (const r of routes) {
    const g = svg.querySelector(`#${cssEscape(r.id)}`);
    if (!g) continue;

    // Make sure the group and its children can receive pointer events
    g.style.cursor = "pointer";
    g.style.pointerEvents = "all";
    g.querySelectorAll("*").forEach((n) => {
      n.style.pointerEvents = "all";
    });

    // Some SVG exports don't fire click reliably on <g>, so listen on children too.
    const targets = [g, ...Array.from(g.querySelectorAll("*"))];

    targets.forEach((t) => {
      t.addEventListener("click", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        console.log("NAV:", r.id, "->", r.href);
        window.location.assign(r.href);
      });
    });
  }
}


  // Pan/Zoom by changing viewBox
  function enablePanZoom(svg, root) {
    // Make sure there is a viewBox to manipulate
    if (!svg.getAttribute("viewBox")) {
      // fallback: create a viewBox from bbox of entire SVG contents
      const bb = svg.getBBox();
      svg.setAttribute("viewBox", `${bb.x} ${bb.y} ${bb.width} ${bb.height}`);
    }

    const state = {
      dragging: false,
      last: { x: 0, y: 0 },
      pointerId: null,
    };

    function getViewBox() {
      const vb = svg.getAttribute("viewBox").trim().split(/\s+/).map(Number);
      return { x: vb[0], y: vb[1], w: vb[2], h: vb[3] };
    }

    function setViewBox(vb) {
      svg.setAttribute("viewBox", `${vb.x} ${vb.y} ${vb.w} ${vb.h}`);
    }

    // Convert client (screen) -> SVG coords, using current viewBox
    function clientToSvgPoint(clientX, clientY) {
      const rect = root.getBoundingClientRect();
      const vb = getViewBox();

      const nx = (clientX - rect.left) / rect.width;  // 0..1
      const ny = (clientY - rect.top) / rect.height;  // 0..1

      return {
        x: vb.x + nx * vb.w,
        y: vb.y + ny * vb.h,
      };
    }

    // Wheel zoom, anchored under mouse
    root.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();

        const vb = getViewBox();
        const mouse = clientToSvgPoint(e.clientX, e.clientY);

        // zoom factor: trackpad gentle, mouse wheel stronger
        const delta = e.deltaY;
        const zoom = Math.exp(delta * 0.0015); // >1 zoom out, <1 zoom in

        const newW = vb.w * zoom;
        const newH = vb.h * zoom;

        // Keep mouse point stationary by shifting x/y accordingly
        const mx = (mouse.x - vb.x) / vb.w; // 0..1
        const my = (mouse.y - vb.y) / vb.h;

        const newX = mouse.x - mx * newW;
        const newY = mouse.y - my * newH;

        setViewBox({ x: newX, y: newY, w: newW, h: newH });
      },
      { passive: false }
    );

    // Drag pan (mouse/touch)
    root.addEventListener("pointerdown", (e) => {
      // only primary button for mouse
      if (e.pointerType === "mouse" && e.button !== 0) return;

      state.dragging = true;
      state.pointerId = e.pointerId;
      state.last.x = e.clientX;
      state.last.y = e.clientY;
      root.setPointerCapture(e.pointerId);
    });

    root.addEventListener("pointermove", (e) => {
      if (!state.dragging || e.pointerId !== state.pointerId) return;

      const vb = getViewBox();
      const rect = root.getBoundingClientRect();

      const dxPx = e.clientX - state.last.x;
      const dyPx = e.clientY - state.last.y;

      // pixel move -> viewBox move
      const dx = (dxPx / rect.width) * vb.w;
      const dy = (dyPx / rect.height) * vb.h;

      setViewBox({ x: vb.x - dx, y: vb.y - dy, w: vb.w, h: vb.h });

      state.last.x = e.clientX;
      state.last.y = e.clientY;
    });

    function endDrag(e) {
      if (e.pointerId !== state.pointerId) return;
      state.dragging = false;
      state.pointerId = null;
    }

    root.addEventListener("pointerup", endDrag);
    root.addEventListener("pointercancel", endDrag);

    // Stop double-click selecting weird stuff
    root.style.touchAction = "none";
  }

  async function boot() {
    const root = detectRoot();
    if (!root) {
      console.warn("No #world-root or #axis-root found. Engine idle.");
      return;
    }

    const svg = await loadSvgIntoRoot(root);

    // Optional: lock camera to #focus-region if you have it in each SVG
    fitViewBoxToFocus(svg, root);

    // Buttons (your Axis Mundi button already exists as <g id="btn-axismundi">)
    wireButtons(svg);

    // Pan/Zoom
    enablePanZoom(svg, root);

    console.log("WORLD ENGINE READY:", root.id);
  }

  // CSS.escape polyfill-ish for IDs with weird chars
  function cssEscape(id) {
    // keep it simple: your IDs are normal, but this avoids surprises
    return id.replace(/([ #;?%&,.+*~\':"!^$[\]()=>|/@])/g, "\\$1");
  }
})();
