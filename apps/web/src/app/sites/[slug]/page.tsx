import { getSupabase } from "@/lib/supabase";

export const dynamic = "force-dynamic"; // prevents build-time data collection

export default async function SitePage({ params }: { params: { slug: string } }) {
  const slug = params.slug;

  const supabase = getSupabase();

  const { data: site, error: siteErr } = await supabase
    .from("sites")
    .select("slug,title,description,niche,status,updated_at,published_url")
    .eq("slug", slug)
    .maybeSingle();

  if (siteErr || !site) {
    return (
      <main style={{ padding: 24, fontFamily: "system-ui" }}>
        <h1>Site not found</h1>
        <p>Slug: {slug}</p>
        <pre style={{ whiteSpace: "pre-wrap" }}>{siteErr?.message || "No row returned"}</pre>
      </main>
    );
  }

  const { data: products, error: prodErr } = await supabase
    .from("products")
    .select("rank,title,affiliate_url,source_url,price_text")
    .eq("site_slug", slug)
    .order("rank", { ascending: true });

  return (
    <main style={{ padding: 24, fontFamily: "system-ui", maxWidth: 800 }}>
      <h1 style={{ marginBottom: 8 }}>{site.title}</h1>

      <p style={{ marginTop: 0, opacity: 0.8 }}>
        Niche: {site.niche} • Status: {site.status} • Updated: {String(site.updated_at)}
      </p>

      {site.description ? <p>{site.description}</p> : null}

      {site.published_url ? (
        <p style={{ marginTop: 12 }}>
          <a href={site.published_url} target="_blank" rel="noreferrer noopener">
            View generated page
          </a>
        </p>
      ) : null}

      <hr style={{ margin: "24px 0" }} />

      <h2>Products</h2>

      {prodErr ? (
        <pre style={{ whiteSpace: "pre-wrap" }}>{prodErr.message}</pre>
      ) : (products?.length ?? 0) === 0 ? (
        <p>No products yet.</p>
      ) : (
        <ol>
          {products!.map((p) => {
            const href = p.affiliate_url || p.source_url || "#";
            return (
              <li key={p.rank} style={{ marginBottom: 10 }}>
                <a href={href} target="_blank" rel="noreferrer noopener nofollow">
                  {p.title || href}
                </a>
                {p.price_text ? <span> — {p.price_text}</span> : null}
              </li>
            );
          })}
        </ol>
      )}

      <hr style={{ margin: "24px 0" }} />

      <h2>Affiliate disclosure</h2>
      <p>
        This site contains affiliate links. If you buy through them, we may earn a commission at no additional cost to
        you.
      </p>
    </main>
  );
}
