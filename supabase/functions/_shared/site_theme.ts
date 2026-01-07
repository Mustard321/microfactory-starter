// supabase/functions/_shared/site_theme.ts

export const SITE_THEME_CSS = `
:root{
  /* ---- Color tokens (warm + Apple clean + pastel accents) ---- */
  --bg: #fbfbfc;
  --card: #ffffff;
  --text: #121316;
  --muted: #6b7280;

  --border: rgba(17, 24, 39, 0.10);
  --shadow: 0 10px 30px rgba(17, 24, 39, 0.08);
  --shadow-soft: 0 6px 18px rgba(17, 24, 39, 0.06);

  /* Mustard primary (warm, not neon) */
  --primary: #F3C623;
  --primary-ink: #1a1a1a;

  /* Soft pastels (used for chips/tags only, never big blocks) */
  --p1: #E8F1FF; /* sky */
  --p2: #F3E8FF; /* lilac */
  --p3: #E9FBF1; /* mint */
  --p4: #FFF1E6; /* peach */
  --p5: #FFF7D6; /* butter */

  --chip-ink: #1f2937;

  /* ---- Radius tokens ---- */
  --r-btn: 12px;
  --r-input: 14px;
  --r-card: 20px;

  /* ---- Spacing tokens ---- */
  --s-1: 8px;
  --s-2: 12px;
  --s-3: 16px;
  --s-4: 24px;
  --s-5: 32px;
  --s-6: 40px;

  /* ---- Typography ---- */
  --font: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "Inter", "Segoe UI", Roboto, Helvetica, Arial, "Apple Color Emoji","Segoe UI Emoji";
}

*{ box-sizing: border-box; }
html,body{ height:100%; }
body{
  margin:0;
  font-family: var(--font);
  background: radial-gradient(1200px 700px at 20% -10%, rgba(243,198,35,0.20), rgba(255,255,255,0) 55%),
              radial-gradient(900px 600px at 95% 0%, rgba(232,241,255,0.60), rgba(255,255,255,0) 50%),
              var(--bg);
  color: var(--text);
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

a{ color: inherit; text-decoration: none; }
a:hover{ text-decoration: none; }

.container{
  max-width: 1080px;
  margin: 0 auto;
  padding: var(--s-6) var(--s-4);
}

.topbar{
  position: sticky;
  top: 0;
  z-index: 10;
  backdrop-filter: blur(10px);
  background: rgba(251,251,252,0.78);
  border-bottom: 1px solid var(--border);
}

.topbar-inner{
  max-width: 1080px;
  margin: 0 auto;
  padding: var(--s-3) var(--s-4);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--s-3);
}

.brand{
  display:flex;
  align-items:center;
  gap: var(--s-2);
  font-weight: 700;
  letter-spacing: -0.02em;
}

.brand-dot{
  width: 12px;
  height: 12px;
  border-radius: 999px;
  background: var(--primary);
  box-shadow: 0 0 0 6px rgba(243,198,35,0.25);
}

.search{
  flex: 1;
  display:flex;
  align-items:center;
  gap: var(--s-2);
  max-width: 520px;
}

.input{
  width: 100%;
  padding: 10px 12px;
  border-radius: var(--r-input);
  border: 1px solid var(--border);
  background: rgba(255,255,255,0.9);
  outline: none;
  transition: transform .12s ease, box-shadow .12s ease, border-color .12s ease;
}

.input:focus{
  transform: translateY(-1px);
  border-color: rgba(243,198,35,0.7);
  box-shadow: 0 10px 25px rgba(243,198,35,0.18);
}

.hero{
  padding: var(--s-6) 0 var(--s-4);
}

.h1{
  font-size: 38px;
  line-height: 1.05;
  letter-spacing: -0.03em;
  margin: 0 0 var(--s-2);
}

.sub{
  color: var(--muted);
  font-size: 16px;
  line-height: 1.5;
  max-width: 720px;
  margin: 0 0 var(--s-4);
}

.chips{
  display:flex;
  flex-wrap:wrap;
  gap: 10px;
}

.chip{
  display:inline-flex;
  align-items:center;
  gap: 8px;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: rgba(255,255,255,0.85);
  color: var(--chip-ink);
  cursor: pointer;
  user-select: none;
  transition: transform .12s ease, box-shadow .12s ease;
}

.chip:hover{
  transform: translateY(-1px);
  box-shadow: var(--shadow-soft);
}

.grid{
  display:grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--s-4);
}

@media (max-width: 960px){
  .grid{ grid-template-columns: repeat(2, minmax(0,1fr)); }
}
@media (max-width: 640px){
  .grid{ grid-template-columns: repeat(1, minmax(0,1fr)); }
  .h1{ font-size: 32px; }
}

.card{
  border: 1px solid var(--border);
  border-radius: var(--r-card);
  background: rgba(255,255,255,0.92);
  box-shadow: 0 1px 0 rgba(17,24,39,0.02);
  overflow: hidden;
  transition: transform .14s ease, box-shadow .14s ease;
}

.card:hover{
  transform: translateY(-2px);
  box-shadow: var(--shadow);
}

.card-inner{
  padding: var(--s-4);
  display:flex;
  flex-direction: column;
  gap: var(--s-2);
  min-height: 180px;
}

.meta{
  display:flex;
  align-items:center;
  justify-content: space-between;
  gap: var(--s-2);
  color: var(--muted);
  font-size: 13px;
}

.title{
  font-size: 16px;
  font-weight: 650;
  letter-spacing: -0.01em;
  margin: 0;
}

.note{
  color: var(--muted);
  font-size: 14px;
  line-height: 1.45;
  margin: 0;
}

.actions{
  margin-top: auto;
  display:flex;
  gap: 10px;
  align-items:center;
}

.btn{
  display:inline-flex;
  align-items:center;
  justify-content:center;
  gap: 8px;
  padding: 10px 14px;
  border-radius: var(--r-btn);
  border: 1px solid rgba(0,0,0,0.08);
  background: var(--primary);
  color: var(--primary-ink);
  font-weight: 700;
  cursor: pointer;
  transition: transform .12s ease, box-shadow .12s ease, filter .12s ease;
}

.btn:hover{
  transform: translateY(-1px);
  box-shadow: 0 14px 30px rgba(243,198,35,0.22);
  filter: saturate(1.03);
}

.btn:active{
  transform: translateY(0px) scale(0.99);
}

.btn-ghost{
  background: rgba(255,255,255,0.75);
  color: var(--text);
}

.badge{
  display:inline-flex;
  align-items:center;
  padding: 6px 10px;
  border-radius: 999px;
  border: 1px solid var(--border);
  font-size: 12px;
  color: var(--muted);
  background: rgba(255,255,255,0.85);
}

.footer{
  padding: var(--s-6) 0 var(--s-4);
  color: var(--muted);
  font-size: 13px;
  line-height: 1.5;
}

.kbd-pop{
  display:inline-block;
  padding: 2px 7px;
  border-radius: 10px;
  border: 1px solid var(--border);
  background: rgba(255,255,255,0.9);
  box-shadow: 0 1px 0 rgba(17,24,39,0.03);
}
`;
