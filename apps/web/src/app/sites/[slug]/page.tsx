import { getSupabase } from "@/lib/supabase";

export const dynamic = "force-dynamic"; // IMPORTANT: prevents build-time data collection

export default async function SitePage({ params }: { params: { slug: string } }) {
  const slug = params.slug;

  const supabase = getSupabase();

  const { data: site, error } = await supabase
    .from("sites")
    .select("slug,title,description,niche,status,updated_at")
    .eq("slug", slug)
    .single();

  if (error) {
    return (
      <main style={{ padding: 24, fontFamily: "system-ui" }}>
        <h1>Site not found</h1>
        <p>Slug: {slug}</p>
        <pre style={{ whiteSpace: "pre-wrap" }}>{error.message}</pre>
      </main>
    );
  }

  return (
    <main style={{ padding: 24, fontFamily: "system-ui", maxWidth: 800 }}>
      <h1 style={{ marginBottom: 8 }}>{site.title}</h1>
      <p style={{ marginTop: 0, opacity: 0.8 }}>
        Niche: {site.niche} • Status: {site.status} • Updated: {String(site.updated_at)}
      </p>
      <p>{site.description}</p>

      <hr style={{ margin: "24px 0" }} />

      <h2>Affiliate disclosure</h2>
      <p>
        This site contains affiliate links. If you buy through them, we may earn a commission at no additional cost to
        you.
      </p>
    </main>
  );
}
