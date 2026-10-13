// Mintlify loads custom scripts on every page. Reuse its heading depth and
// active-section attributes so scrolling and anchor navigation stay native.
(() => {
  const namespace = "http://www.w3.org/2000/svg";

  const indent = 12;

  let currentList;

  let frame;

  const draw = () => {
    frame = undefined;
    const list = document.querySelector("#table-of-contents .toc");
    if (list !== currentList) {
      // oxlint-disable-next-line no-use-before-define -- This deferred callback runs after initialization; the definitions are mutually dependent.
      resizeObserver.disconnect();
      currentList = list;
      if (list) {
        // oxlint-disable-next-line no-use-before-define -- This deferred callback runs after initialization; the definitions are mutually dependent.
        resizeObserver.observe(list);
      }
    }
    if (!list) {
      return;
    }

    const items = [...list.querySelectorAll(".toc-item")].filter((item) =>
      item.querySelector(":scope > a")
    );
    if (!items.length) {
      list.querySelector(".tailorkit-toc-rail")?.remove();
      delete list.dataset.tailorkitRail;
      return;
    }

    for (const item of items) {
      const depth = Math.max(0, Number(item.dataset.depth) || 0);
      item.style.setProperty("--tailorkit-toc-indent", `${depth * indent}px`);
    }
    list.dataset.tailorkitRail = "";
    const bounds = list.getBoundingClientRect();
    if (!bounds.width || !bounds.height) {
      return;
    }

    const rows = items.map((item) => {
      // A parent li contains its nested list. Measure only the heading link,
      // otherwise its bottom extends past the children and the path doubles back.
      const rect = item.querySelector(":scope > a").getBoundingClientRect();
      return {
        active: Object.hasOwn(item.dataset, "activeDeepest"),
        bottom: rect.bottom - bounds.top,
        top: rect.top - bounds.top,
        x: 1 + Math.max(0, Number(item.dataset.depth) || 0) * indent,
      };
    });
    const existing = list.querySelector(".tailorkit-toc-rail");
    const svg = existing || document.createElementNS(namespace, "svg");
    svg.setAttribute("class", "tailorkit-toc-rail");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("width", Math.max(...rows.map((row) => row.x)) + 1);
    svg.setAttribute("height", bounds.height);

    let activeTop = 0;
    let activeBottom = bounds.height;
    let track = `M ${rows[0].x} ${rows[0].top}`;
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
      "tailorkit-toc-rail-track",
      "tailorkit-toc-rail-active",
    ]) {
      let path = svg.querySelector(`.${className}`);
      if (!path) {
        path = document.createElementNS(namespace, "path");
        path.setAttribute("class", className);
        svg.append(path);
      }
      path.setAttribute("d", track);
      if (className === "tailorkit-toc-rail-active") {
        path.style.clipPath = `inset(${activeTop}px 0px ${activeBottom}px 0px) view-box`;
      }
    }
    if (!existing) {
      list.append(svg);
    }
  };

  const schedule = () => {
    if (frame) {
      return;
    }
    frame = requestAnimationFrame(draw);
  };

  const resizeObserver = new ResizeObserver(schedule);

  new MutationObserver((records) => {
    if (
      records.some((record) => {
        // Ignore our SVG writes to avoid a mutation/redraw loop.
        if (record.type === "attributes") {
          return record.target.matches("#table-of-contents .toc-item");
        }
        return [...record.addedNodes, ...record.removedNodes].some(
          (node) => node.nodeType === 1 && !node.matches(".tailorkit-toc-rail")
        );
      })
    ) {
      schedule();
    }
  }).observe(document.documentElement, {
    attributeFilter: ["data-active-deepest", "data-depth"],
    attributes: true,
    childList: true,
    subtree: true,
  });

  window.addEventListener("resize", schedule, { passive: true });

  void (async () => {
    await document.fonts?.ready;
    schedule();
  })();

  schedule();
})();
