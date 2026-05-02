import { Link } from 'react-router-dom';
import {
  TkxCard, TkxCardBody, TkxButton, TkxBadge, TkxDivider,
} from 'tekivex-ui';

export default function Landing() {
  return (
    <>
      <section style={{ padding: '40px 0 10px' }}>
        <h1>Post-quantum tokens you can run anywhere.</h1>
        <p className="lead">
          Sigvault is a sovereign token system built on NIST-standardised
          post-quantum signatures (ML-DSA-87, Falcon-512/1024). One auditable
          Rust core, three embedding surfaces — native FFI, portable WASM,
          and a zero-dependency REST server — so you can use it from Python,
          C, Go, C#, Java, Rust, or anything that can load a shared library.
        </p>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, margin: '18px 0 24px' }}>
          <TkxBadge variant="solid" colorScheme="primary">ML-DSA-87 (FIPS 204)</TkxBadge>
          <TkxBadge variant="outline">Falcon-512 / Falcon-1024</TkxBadge>
          <TkxBadge variant="outline">Zero npm · Zero pip</TkxBadge>
          <TkxBadge variant="outline">Stdlib-only server</TkxBadge>
          <TkxBadge variant="outline">127 KB WASM</TkxBadge>
        </div>

        <div className="qv-cta">
          <Link to="/quickstart">
            <TkxButton colorScheme="primary" size="lg">Start in 60 seconds →</TkxButton>
          </Link>
          <Link to="/demo">
            <TkxButton variant="outline" size="lg">Try the live demo</TkxButton>
          </Link>
          <Link to="/architecture">
            <TkxButton variant="ghost" size="lg">Read the architecture</TkxButton>
          </Link>
        </div>
      </section>

      <h2>Why it exists</h2>
      <p>
        Most token libraries either depend on a large npm/pip supply chain
        that can ship malware overnight, or are locked to one language.
        Sigvault takes the opposite position: <b>one auditable core in
        Rust, multiple narrow embedding surfaces, and no runtime package
        manager</b>. The Node server uses only Node's stdlib; the native
        library is a single <code>qv.dll</code>/<code>libqv.so</code>;
        the WASM module declares exactly one host import
        (<code>qv_host_random</code>).
      </p>

      <h2>Numbers that matter</h2>
      <div className="qv-grid stats">
        <StatCard
          title="Falcon-512 signature"
          num="656 B"
          sub="7.1× smaller than ML-DSA-87's 4627 B — JWT-class payloads, quantum-secure."
        />
        <StatCard
          title="WASM module size"
          num="127 KB"
          sub="Full ML-DSA-87 engine. No wasm-bindgen, no JS glue, one host import."
        />
        <StatCard
          title="Verify throughput"
          num="6 990 /s"
          sub="Falcon-512 from Python via ctypes. 4-worker batch-verify: 558/s end-to-end."
        />
        <StatCard
          title="npm dependencies"
          num="0"
          sub="The sovereign server has no package.json deps. Node stdlib only."
        />
      </div>

      <h2>Three ways to embed</h2>
      <div className="qv-grid two">
        <SurfaceCard
          title="Native FFI"
          pill="fastest"
          pillColor="success"
          desc={<>Single <code>qv.dll</code> / <code>libqv.so</code> / <code>libqv.dylib</code>. Plain C ABI.</>}
          good="Python, Go, Java, .NET, Ruby, Swift — anywhere with FFI."
        />
        <SurfaceCard
          title="WebAssembly"
          pill="portable"
          desc={<>127 KB <code>qv_wasm.wasm</code>. Exactly one host import for entropy.</>}
          good="Browsers, Cloudflare Workers, Deno, Bun, any WASI runtime."
        />
        <SurfaceCard
          title="REST server"
          pill="hosted"
          desc={<>Node <code>server-sovereign.mjs</code>. Zero npm deps. Persistent state.</>}
          good="Microservices, centralised key management, batch verify."
        />
      </div>

      <TkxDivider style={{ margin: '40px 0 20px' }} />

      <h2>Get going</h2>
      <div className="qv-cta">
        <Link to="/quickstart"><TkxButton colorScheme="primary">Quickstart →</TkxButton></Link>
        <Link to="/languages"><TkxButton variant="outline">Pick your language</TkxButton></Link>
        <Link to="/api"><TkxButton variant="outline">REST API reference</TkxButton></Link>
      </div>
    </>
  );
}

function StatCard({ title, num, sub }: { title: string; num: string; sub: string }) {
  return (
    <TkxCard variant="elevated">
      <TkxCardBody>
        <div style={{ color: '#8a94a0', fontSize: 13.5, marginBottom: 4 }}>{title}</div>
        <div className="qv-bignum">{num}</div>
        <div className="qv-mut">{sub}</div>
      </TkxCardBody>
    </TkxCard>
  );
}

function SurfaceCard({
  title, pill, pillColor, desc, good,
}: {
  title: string;
  pill: string;
  pillColor?: 'success' | 'warning' | 'primary';
  desc: React.ReactNode;
  good: string;
}) {
  return (
    <TkxCard variant="elevated">
      <TkxCardBody>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <h3 style={{ margin: 0 }}>{title}</h3>
          <TkxBadge variant="subtle" colorScheme={pillColor ?? 'primary'} size="sm">{pill}</TkxBadge>
        </div>
        <div style={{ color: '#cbd5e1', fontSize: 14.5 }}>{desc}</div>
        <div className="qv-mut" style={{ marginTop: 10 }}>
          <b style={{ color: '#e6e8eb' }}>Best for:</b> {good}
        </div>
      </TkxCardBody>
    </TkxCard>
  );
}
