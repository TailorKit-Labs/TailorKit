// Mintlify loads custom scripts on every page. Reuse its heading depth and
// active-section attributes so scrolling and anchor navigation stay native.
(() => {
  const namespace = "http://www.w3.org/2000/svg";

  const indent = 12;

  /** @type {HTMLElement | null | undefined} */
  let currentList;

  /** @type {number | undefined} */
  let frame;

  /** @param {HTMLElement} list @param {HTMLElement[]} items */
  const drawRail = (list, items) => {
    const bounds = list.getBoundingClientRect();
    if (!bounds.width || !bounds.height) {
      return;
    }

    const rows = items.map((item) => {
      // A parent li contains its nested list. Measure only the heading link,
      // otherwise its bottom extends past the children and the path doubles back.
      const link = item.querySelector(":scope > a");
      if (link === null) {
        throw new Error("TOC item lost its heading link during drawing");
      }
      const rect = link.getBoundingClientRect();
      return {
        active: Object.hasOwn(item.dataset, "activeDeepest"),
        bottom: rect.bottom - bounds.top,
        top: rect.top - bounds.top,
        x: 1 + Math.max(0, Number(item.dataset.depth) || 0) * indent,
      };
    });
    const existing = list.querySelector(".patchsmith-toc-rail");
    const svg = existing ?? document.createElementNS(namespace, "svg");
    svg.setAttribute("class", "patchsmith-toc-rail");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute(
      "width",
      String(Math.max(...rows.map((row) => row.x)) + 1)
    );
    svg.setAttribute("height", String(bounds.height));

    let activeTop = 0;
    let activeBottom = bounds.height;
    const [firstRow] = rows;
    if (firstRow === undefined) {
      return;
    }
    let track = `M ${firstRow.x} ${firstRow.top}`;
    for (const [index, row] of rows.entries()) {
      const previous = rows[index - 1];
      // Fit a 45-degree join between heading rows, including wrapped titles.
      const join = previous
        ? Math.min(Math.abs(row.x - previous.x), (row.bottom - row.top) / 2)
        : 0;
      if (previous) {
        track += ` L ${previous.x} ${row.top}`;
        track += ` L ${row.x} ${row.top + join}`;
      }
      track += ` L ${row.x} ${row.bottom}`;
      if (row.active) {
        activeTop = row.top + join;
        activeBottom = bounds.height - row.bottom;
      }
    }
    // Keep both paths mounted. CSS moves a clipping window along a bright
    // copy of the full rail, including its angled joins.
    for (const className of [
      "patchsmith-toc-rail-track",
      "patchsmith-toc-rail-active",
    ]) {
      let path = svg.querySelector(`.${className}`);
      if (!(path instanceof SVGPathElement)) {
        path = document.createElementNS(namespace, "path");
        path.setAttribute("class", className);
        svg.append(path);
      }
      path.setAttribute("d", track);
      if (className === "patchsmith-toc-rail-active") {
        path.setAttribute(
          "style",
          `clip-path: inset(${activeTop}px 0px ${activeBottom}px 0px) view-box`
        );
      }
    }
    if (!existing) {
      list.append(svg);
    }
  };

  const renderer = {
    draw: () => {
      frame = undefined;
      const candidate = document.querySelector("#table-of-contents .toc");
      const list = candidate instanceof HTMLElement ? candidate : null;
      if (list !== currentList) {
        renderer.resizeObserver.disconnect();
        currentList = list;
        if (list) {
          renderer.resizeObserver.observe(list);
        }
      }
      if (!list) {
        return;
      }

      const items = [...list.querySelectorAll(".toc-item")]
        .filter((item) => item instanceof HTMLElement)
        .filter((item) => item.querySelector(":scope > a") !== null);
      if (!items.length) {
        list.querySelector(".patchsmith-toc-rail")?.remove();
        delete list.dataset.patchsmithRail;
        return;
      }

      for (const item of items) {
        const depth = Math.max(0, Number(item.dataset.depth) || 0);
        item.style.setProperty(
          "--patchsmith-toc-indent",
          `${depth * indent}px`
        );
      }
      list.dataset.patchsmithRail = "";
      drawRail(list, items);
    },
    resizeObserver: new ResizeObserver(() => {
      renderer.schedule();
    }),
    schedule: () => {
      if (frame !== undefined) {
        return;
      }
      frame = requestAnimationFrame(renderer.draw);
    },
  };

  new MutationObserver((records) => {
    if (
      records.some((record) => {
        // Ignore our SVG writes to avoid a mutation/redraw loop.
        if (record.type === "attributes") {
          return (
            record.target instanceof Element &&
            record.target.matches("#table-of-contents .toc-item")
          );
        }
        return [...record.addedNodes, ...record.removedNodes].some(
          (node) =>
            node instanceof Element && !node.matches(".patchsmith-toc-rail")
        );
      })
    ) {
      renderer.schedule();
    }
  }).observe(document.documentElement, {
    attributeFilter: ["data-active-deepest", "data-depth"],
    attributes: true,
    childList: true,
    subtree: true,
  });

  window.addEventListener("resize", renderer.schedule, { passive: true });

  void (async () => {
    await document.fonts?.ready;
    renderer.schedule();
  })();

  renderer.schedule();
})();
