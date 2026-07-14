export default function Home() {
  return (
    <main>
      <h1>Traffic Exchange for Short Links</h1>
      <p className="muted">
        Earn credits by visiting other members&apos; short links. Spend credits to
        get your own short links in front of real members.
      </p>
      <div className="panel">
        <div className="row">
          <a href="/surf"><button>Start surfing →</button></a>
          <a href="/dashboard"><button>Dashboard</button></a>
        </div>
      </div>
      <p className="muted">
        Foundation build — auth pages, dashboard UI, and admin panel are wired to
        the same API. See <code>README.md</code> for the full API and roadmap.
      </p>
    </main>
  );
}
