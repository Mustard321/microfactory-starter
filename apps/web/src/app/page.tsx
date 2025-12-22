import Link from "next/link";

export default function Home() {
  return (
    <main>
      <h1>MicroFactory</h1>
      <p>Static microsites generated from Supabase data.</p>
      <p><Link href="/sites/demo">View demo site</Link></p>
    </main>
  );
}
