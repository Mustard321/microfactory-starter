// supabase/functions/_shared/site_template.ts
import { SITE_THEME_CSS } from "./site_theme.ts";

export type RenderSiteArgs = {
  siteTitle: string;
  siteSlug: string;
  niche: string;
  subtitle?: string;
  updatedIso?: string;
  placements: Array<{
    title: string;
    note?: string;
    domain?: string;
    href: string;        // primary CTA target (tracking ok)
    copyHref?: string;   // optional raw URL for copy
    createdIso?: string; // optional
    rank?: number;       // optional
    clicks?: number;     // optional
  }>;
};

function esc(s: string): string {
  return (s || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function niceUpdated(updatedIso?: string): string {
  if (!updatedIso) return "Updated recently";
  // Keep it simple: ISO → date portion
  return `Updated ${updatedIso.slice(0, 10)}`;
}

function chipPalette(i: number): string {
  const list = ["var(--p1)", "var(--p2)", "var(--p3)", "var(--p4)", "var(--p5)"];
  return list[i % list.length];
}

export function renderSiteHtml(args: RenderSiteArgs): string {
  const subtitle =
    args.subtitle ||
    "Curated picks with clean links, fast browsing, and a warm, trustworthy feel.";

  const chips = [
    { label: "Newest", key: "new" },
    { label: "Under $50", key: "u50" },
    { label: "Most clicked", key: "top" },
    { label: "Editor vibe", key: "vibe" },
  ];

  const cards = args.placements.map((p, idx) => {
    const domain = p.domain ? esc(p.domain) : "source";
    const title = esc(p.title || "Untitled");
    const note = esc(p.note || "");
    const href = esc(p.href);
    const copyHref = esc(p.copyHref || p.href);
    const rank = typeof p.rank === "number" ? p.rank : idx + 1;
    const clicks = typeof p.clicks === "number" ? p.clicks : 0;

    return `
      <article class="card" data-rank="${rank}" data-domain="${domain.toLowerCase()}" data-clicks="${clicks}">
        <div class="card-inner">
          <div class="meta">
            <span class="badge">${esc(args.niche)}</span>
            <span class="badge">${domain}</span>
          </div>

          <h3 class="title">${title}</h3>
          ${note ? `<p class="note">${note}</p>` : `<p class="note">A clean pick worth a look.</p>`}

          <div class="actions">
            <a class="btn" href="${href}" target="_blank" rel="noopener noreferrer nofollow">
              See deal
            </a>
            <button class="btn btn-ghost" type="button" data-copy="${copyHref}">
              Copy link
            </button>
          </div>
        </div>
      </article>
    `;
  }).join("\n");

  const chipHtml = chips.map((c, i) => `
    <div class="chip" data-chip="${esc(c.key)}" style="background:${chipPalette(i)};">
      <span class="kbd-pop">⌘</span> ${esc(c.label)}
    </div>
  `).join("\n");

  // Minimal JS: search + copy + tiny “pop” UX (no tracking yet; that’s B1 later)
  const js = `
  (function(){
    const q = document.getElementById("q");
    const cards = Array.from(document.querySelectorAll("article.card"));
    const grid = document.querySelector(".grid");
    const chips = Array.from(document.querySelectorAll(".chip"));

    function applyFilter(){
      const v = (q.value || "").trim().toLowerCase();
      for(const c of cards){
        const t = (c.innerText || "").toLowerCase();
        c.style.display = (!v || t.includes(v)) ? "" : "none";
      }
    }
    q.addEventListener("input", applyFilter);

    function byRank(a,b){
      const ra = parseInt(a.getAttribute("data-rank") || "0", 10);
      const rb = parseInt(b.getAttribute("data-rank") || "0", 10);
      return ra - rb;
    }

    function byClicksThenRank(a,b){
      const ca = parseInt(a.getAttribute("data-clicks") || "0", 10);
      const cb = parseInt(b.getAttribute("data-clicks") || "0", 10);
      if(cb !== ca) return cb - ca;
      return byRank(a,b);
    }

    function applySort(compareFn){
      if(!grid) return;
      const sorted = cards.slice().sort(compareFn);
      for(const c of sorted) grid.appendChild(c);
    }

    for(const chip of chips){
      chip.addEventListener("click", () => {
        const key = chip.getAttribute("data-chip") || "";
        if(key === "top") applySort(byClicksThenRank);
        if(key === "new") applySort(byRank);
      });
    }

    document.addEventListener("click", async (e) => {
      const el = e.target;
      if(!(el instanceof HTMLElement)) return;

      const copy = el.getAttribute("data-copy");
      if(copy){
        try{
          await navigator.clipboard.writeText(copy);
          el.textContent = "Copied ✓";
          setTimeout(() => el.textContent = "Copy link", 900);
        }catch{}
      }
    });
  })();
  `;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>${esc(args.siteTitle)} • Mustard</title>
  <meta name="description" content="${esc(subtitle)}"/>
  <style>${SITE_THEME_CSS}</style>
</head>
<body>
  <div class="topbar">
    <div class="topbar-inner">
      <div class="brand">
        <span class="brand-dot"></span>
        <span>Mustard</span>
      </div>

      <div class="search">
        <input id="q" class="input" type="search" placeholder="Search picks…" aria-label="Search picks"/>
      </div>

      <span class="badge">${esc(args.siteSlug)}</span>
    </div>
  </div>

  <div class="container">
    <section class="hero">
      <h1 class="h1">${esc(args.siteTitle)}</h1>
      <p class="sub">${esc(subtitle)} <span class="kbd-pop">${esc(niceUpdated(args.updatedIso))}</span></p>
      <div class="chips">
        ${chipHtml}
      </div>
    </section>

    <section class="grid" aria-label="Product picks">
      ${cards || `<div class="badge">No picks yet.</div>`}
    </section>

    <section class="footer">
      <div class="badge">Disclosure</div>
      <p>
        Some links may be affiliate links. If you buy, we may earn a commission at no extra cost to you.
        We only post picks we believe are worth your time.
      </p>
      <p>
        Want this kind of page for your niche? <span class="kbd-pop">mustard</span> it.
      </p>
    </section>
  </div>

  <script>${js}</script>
</body>
</html>`;
}
