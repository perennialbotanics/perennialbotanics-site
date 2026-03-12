/* assets/world-engine.js
   One engine for all pages:
   - Finds a root: #world-root or #axis-root
   - Loads SVG from data-desktop-svg / data-phone-svg
   - Locks camera to #focus-region if present
   - Wires SVG buttons:
       #btn-axismundi -> axis-mundi.html
       #btn-home      -> index.html
   - Adds pan + zoom:
       desktop: wheel + drag
       touch: one-finger pan + two-finger pinch zoom
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

    console.log("Loading SVG:", svgUrl);

    const res = await fetch(svgUrl, { cache: "no-store" });
    if (!res.ok) throw new Error("Failed to fetch SVG: " + svgUrl);

    root.innerHTML = await res.text();

    const svg = root.querySelector("svg");
    if (!svg) throw new Error("SVG not found after injection.");

    svg.removeAttribute("width");
    svg.removeAttribute("height");
    svg.style.width = "100%";
    svg.style.height = "100%";
    svg.style.display = "block";

    return svg;
  }

  function fitViewBoxToFocus(svg, root) {
    const focus = svg.querySelector("#focus-region");
    if (!focus) {
      console.warn("No #focus-region found in SVG.");
      return;
    }

    const bbox = focus.getBBox();
    const fx = bbox.x, fy = bbox.y, fw = bbox.width, fh = bbox.height;

    const vw = root.clientWidth || window.innerWidth;
    const vh = root.clientHeight || window.innerHeight;

    let scale = Math.min(vw / fw, vh / fh);

    // Slightly tighter opening shot on phone
    if (isMobileLike()) {
      scale *= 1.12;
    }

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

      g.style.cursor = "pointer";
      g.style.pointerEvents = "all";

      g.querySelectorAll("*").forEach((n) => {
        n.style.pointerEvents = "all";
      });

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

  function enablePanZoom(svg, root) {
    if (!svg.getAttribute("viewBox")) {
      const bb = svg.getBBox();
      svg.setAttribute("viewBox", `${bb.x} ${bb.y} ${bb.width} ${bb.height}`);
    }

    const state = {
      dragging: false,
      last: { x: 0, y: 0 },
      pointerId: null,
      pointers: new Map(),
      pinchStartDist: null,
      pinchStartViewBox: null,
      pinchCenterSvg: null,
    };

    function getViewBox() {
      const vb = svg.getAttribute("viewBox").trim().split(/\s+/).map(Number);
      return { x: vb[0], y: vb[1], w: vb[2], h: vb[3] };
    }

    function setViewBox(vb) {
      svg.setAttribute("viewBox", `${vb.x} ${vb.y} ${vb.w} ${vb.h}`);
    }

    function clientToSvgPoint(clientX, clientY) {
      const rect = root.getBoundingClientRect();
      const vb = getViewBox();

      const nx = (clientX - rect.left) / rect.width;
      const ny = (clientY - rect.top) / rect.height;

      return {
        x: vb.x + nx * vb.w,
        y: vb.y + ny * vb.h,
      };
    }

    function distance(a, b) {
      const dx = a.clientX - b.clientX;
      const dy = a.clientY - b.clientY;
      return Math.hypot(dx, dy);
    }

    function midpoint(a, b) {
      return {
        clientX: (a.clientX + b.clientX) / 2,
        clientY: (a.clientY + b.clientY) / 2,
      };
    }

    // Desktop / trackpad wheel zoom
    root.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();

        const vb = getViewBox();
        const mouse = clientToSvgPoint(e.clientX, e.clientY);

        // slightly gentler than before
        const zoom = Math.exp(e.deltaY * 0.001);

        const newW = vb.w * zoom;
        const newH = vb.h * zoom;

        const mx = (mouse.x - vb.x) / vb.w;
        const my = (mouse.y - vb.y) / vb.h;

        const newX = mouse.x - mx * newW;
        const newY = mouse.y - my * newH;

        setViewBox({ x: newX, y: newY, w: newW, h: newH });
      },
      { passive: false }
    );

    root.addEventListener("pointerdown", (e) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;

      state.pointers.set(e.pointerId, {
        clientX: e.clientX,
        clientY: e.clientY,
      });

      if (state.pointers.size === 1) {
        state.dragging = true;
        state.pointerId = e.pointerId;
        state.last.x = e.clientX;
        state.last.y = e.clientY;
      }

      if (state.pointers.size === 2) {
        const pts = Array.from(state.pointers.values());
        state.pinchStartDist = distance(pts[0], pts[1]);
        state.pinchStartViewBox = getViewBox();

        const mid = midpoint(pts[0], pts[1]);
        state.pinchCenterSvg = clientToSvgPoint(mid.clientX, mid.clientY);

        state.dragging = false;
        state.pointerId = null;
      }

      root.setPointerCapture(e.pointerId);
    });

    root.addEventListener("pointermove", (e) => {
      if (state.pointers.has(e.pointerId)) {
        state.pointers.set(e.pointerId, {
          clientX: e.clientX,
          clientY: e.clientY,
        });
      }

      // Two-finger pinch zoom
      if (state.pointers.size === 2 && state.pinchStartDist && state.pinchStartViewBox) {
        const pts = Array.from(state.pointers.values());
        const currentDist = distance(pts[0], pts[1]);

        if (currentDist > 0) {
          const ratio = state.pinchStartDist / currentDist;

          const startVB = state.pinchStartViewBox;
          const center = state.pinchCenterSvg;

          const newW = startVB.w * ratio;
          const newH = startVB.h * ratio;

          const mx = (center.x - startVB.x) / startVB.w;
          const my = (center.y - startVB.y) / startVB.h;

          const newX = center.x - mx * newW;
          const newY = center.y - my * newH;

          setViewBox({ x: newX, y: newY, w: newW, h: newH });
        }
        return;
      }

      // One-finger / mouse drag pan
      if (!state.dragging || e.pointerId !== state.pointerId) return;

      const vb = getViewBox();
      const rect = root.getBoundingClientRect();

      const dxPx = e.clientX - state.last.x;
      const dyPx = e.clientY - state.last.y;

      const dx = (dxPx / rect.width) * vb.w;
      const dy = (dyPx / rect.height) * vb.h;

      setViewBox({ x: vb.x - dx, y: vb.y - dy, w: vb.w, h: vb.h });

      state.last.x = e.clientX;
      state.last.y = e.clientY;
    });

    function endPointer(e) {
      state.pointers.delete(e.pointerId);

      if (e.pointerId === state.pointerId) {
        state.dragging = false;
        state.pointerId = null;
      }

      if (state.pointers.size < 2) {
        state.pinchStartDist = null;
        state.pinchStartViewBox = null;
        state.pinchCenterSvg = null;
      }

      // if one finger remains after pinch, re-seed dragging from it
      if (state.pointers.size === 1) {
        const [id, pt] = Array.from(state.pointers.entries())[0];
        state.dragging = true;
        state.pointerId = id;
        state.last.x = pt.clientX;
        state.last.y = pt.clientY;
      }
    }

    root.addEventListener("pointerup", endPointer);
    root.addEventListener("pointercancel", endPointer);
    root.addEventListener("pointerleave", endPointer);

    root.style.touchAction = "none";
  }

  async function boot() {
    const root = detectRoot();
    if (!root) {
      console.warn("No #world-root or #axis-root found. Engine idle.");
      return;
    }

    const svg = await loadSvgIntoRoot(root);

    fitViewBoxToFocus(svg, root);
    wireButtons(svg);
    enablePanZoom(svg, root);

    console.log("WORLD ENGINE READY:", root.id);
  }

  function cssEscape(id) {
    return id.replace(/([ #;?%&,.+*~\\:'"!^$[\]()=>|/@])/g, "\\$1");
  }
})();