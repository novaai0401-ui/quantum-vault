use clap::{Parser, Subcommand};
use qv_core::{
    Claims, MutationChain, QVRawToken, SuiteId, TokenType, VerifyOutput,
    generate_keypair, issue_token, verify_token, IssueParams,
};
use std::path::PathBuf;

#[derive(Parser)]
#[command(name = "qv", about = "QuantumVault v3.0 — Post-Quantum Token CLI", version = "3.0.0")]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    /// Generate a new ML-DSA-87 keypair and save to files.
    Keygen {
        #[arg(long, default_value = "qv_signing.key")]
        sk_out: PathBuf,
        #[arg(long, default_value = "qv_verifying.pub")]
        vk_out: PathBuf,
        #[arg(long, default_value = "qv_encrypt.key")]
        ek_out: PathBuf,
    },

    /// Issue a new QuantumVault token.
    Issue {
        #[arg(long)]
        sk: PathBuf,
        #[arg(long)]
        ek: PathBuf,
        /// Subject claim value.
        #[arg(long)]
        sub: String,
        /// Issuer claim value.
        #[arg(long, default_value = "qv.local")]
        iss: String,
        /// Additional claims as key=value pairs.
        #[arg(long = "claim")]
        claims: Vec<String>,
        /// Token TTL in seconds.
        #[arg(long, default_value_t = 3600)]
        ttl: u32,
        /// Suite: dilithium5, dual, triple.
        #[arg(long, default_value = "dilithium5")]
        suite: String,
        /// Token type: access, refresh, service.
        #[arg(long, default_value = "access")]
        token_type: String,
        /// Output token file (default: stdout as hex).
        #[arg(long)]
        out: Option<PathBuf>,
    },

    /// Verify a QuantumVault token.
    Verify {
        #[arg(long)]
        vk: PathBuf,
        #[arg(long)]
        ek: PathBuf,
        /// Hex-encoded token or path to binary token file.
        #[arg(long)]
        token: String,
    },

    /// Inspect a token's header without cryptographic verification.
    Inspect {
        /// Hex-encoded token or path to binary token file.
        #[arg(long)]
        token: String,
    },
}

fn main() {
    let cli = Cli::parse();
    if let Err(e) = run(cli.command) {
        eprintln!("Error: {e}");
        std::process::exit(1);
    }
}

fn run(cmd: Command) -> anyhow::Result<()> {
    match cmd {
        Command::Keygen { sk_out, vk_out, ek_out } => cmd_keygen(sk_out, vk_out, ek_out),
        Command::Issue { sk, ek, sub, iss, claims, ttl, suite, token_type, out } => {
            cmd_issue(sk, ek, sub, iss, claims, ttl, &suite, &token_type, out)
        }
        Command::Verify { vk, ek, token } => cmd_verify(vk, ek, token),
        Command::Inspect { token } => cmd_inspect(token),
    }
}

// ─── keygen ──────────────────────────────────────────────────────────────────

fn cmd_keygen(sk_out: PathBuf, vk_out: PathBuf, ek_out: PathBuf) -> anyhow::Result<()> {
    let (sk, vk) = generate_keypair()?;

    let sk_bytes = sk.to_bytes();
    std::fs::write(&sk_out, sk_bytes.as_slice())?;

    let vk_bytes = vk.to_bytes();
    std::fs::write(&vk_out, &vk_bytes)?;

    // Generate random 32-byte symmetric key for XChaCha20.
    use rand::RngCore;
    let mut ek = [0u8; 32];
    rand::rngs::OsRng.fill_bytes(&mut ek);
    std::fs::write(&ek_out, &ek)?;

    println!("Signing key  → {}", sk_out.display());
    println!("Verifying key→ {}", vk_out.display());
    println!("Encrypt key  → {}", ek_out.display());
    Ok(())
}

// ─── issue ───────────────────────────────────────────────────────────────────

fn cmd_issue(
    sk_path: PathBuf, ek_path: PathBuf,
    sub: String, iss: String,
    extra_claims: Vec<String>,
    ttl: u32, suite_str: &str, tt_str: &str,
    out: Option<PathBuf>,
) -> anyhow::Result<()> {

    let sk_bytes = std::fs::read(&sk_path)?;
    let ek_bytes = std::fs::read(&ek_path)?;
    let ek: [u8; 32] = ek_bytes.try_into()
        .map_err(|_| anyhow::anyhow!("encrypt key must be exactly 32 bytes"))?;

    let sk = qv_core::QVSigningKey::from_bytes(&sk_bytes)?;

    let suite = parse_suite(suite_str)?;
    let token_type = parse_token_type(tt_str)?;

    let mut claims = Claims::new();
    claims.insert("sub", sub);
    claims.insert("iss", iss);
    for kv in &extra_claims {
        let (k, v) = kv.split_once('=')
            .ok_or_else(|| anyhow::anyhow!("claim must be key=value, got: {kv}"))?;
        claims.insert(k, v);
    }

    // Ephemeral mutation chain (stateless CLI — use counter 0).
    let mut chain = MutationChain::new([0u8; 32]);

    let params = IssueParams {
        suite, token_type, ttl_secs: ttl,
        device_fp: None, claims: &claims,
        signing_key: &sk, encrypt_key: &ek,
        chain: &mut chain,
    };

    let raw = issue_token(params)?;
    let bytes = raw.to_bytes();
    let hex = hex::encode(&bytes);

    if let Some(path) = out {
        std::fs::write(&path, &bytes)?;
        println!("Token written to {}", path.display());
        println!("Hex: {hex}");
    } else {
        println!("{hex}");
    }

    eprintln!(
        "Issued: suite={} type={} ttl={}s mutation_ctr={} bytes={}",
        suite.name(), tt_str, ttl, raw.header.mutation_ctr, bytes.len()
    );
    Ok(())
}

// ─── verify ──────────────────────────────────────────────────────────────────

fn cmd_verify(vk_path: PathBuf, ek_path: PathBuf, token_arg: String) -> anyhow::Result<()> {
    let vk_bytes = std::fs::read(&vk_path)?;
    let ek_bytes = std::fs::read(&ek_path)?;
    let ek: [u8; 32] = ek_bytes.try_into()
        .map_err(|_| anyhow::anyhow!("encrypt key must be exactly 32 bytes"))?;

    let vk = qv_core::QVVerifyingKey::from_bytes(&vk_bytes)?;
    let token_bytes = load_token_bytes(&token_arg)?;
    let raw = QVRawToken::from_bytes(&token_bytes)?;

    // Stateless verify — accept any counter > 0.
    let chain = MutationChain::from_state([0u8; 32], 0);
    let out: VerifyOutput = verify_token(&raw, &vk, &ek, &chain)?;

    println!("✔ VALID");
    println!("  issued_at  : {}", out.issued_at);
    println!("  ttl        : {}s", out.ttl);
    println!("  mutation   : {}", out.mutation_ctr);
    println!("  claims     :");
    let mut kvs: Vec<_> = out.claims.0.iter().collect();
    kvs.sort_by_key(|(k, _)| k.as_str());
    for (k, v) in kvs {
        println!("    {k} = {v}");
    }
    Ok(())
}

// ─── inspect ─────────────────────────────────────────────────────────────────

fn cmd_inspect(token_arg: String) -> anyhow::Result<()> {
    let bytes = load_token_bytes(&token_arg)?;
    let raw = QVRawToken::from_bytes(&bytes)?;
    let h = &raw.header;

    println!("QuantumVault Token Inspection");
    println!("  version      : {:#06x}", qv_core::VERSION);
    println!("  suite        : {} ({:#04x})", h.suite.name(), h.suite.as_byte());
    println!("  token_type   : {:?} ({:#04x})", h.token_type, h.token_type.as_byte());
    println!("  issued_at    : {} µs", h.issued_at);
    println!("  ttl          : {}s", h.ttl);
    println!("  nonce        : {}", hex::encode(h.nonce));
    println!("  device_fp    : {}", hex::encode(h.device_fp));
    println!("  mutation_ctr : {}", h.mutation_ctr);
    println!("  payload_len  : {} bytes (encrypted)", raw.encrypted_payload.len());
    println!("  sig_len      : {} bytes", raw.signature.len());
    println!("  total        : {} bytes", bytes.len());
    Ok(())
}

// ─── helpers ─────────────────────────────────────────────────────────────────

fn parse_suite(s: &str) -> anyhow::Result<SuiteId> {
    match s {
        "dilithium5" | "0x05" => Ok(SuiteId::Dilithium5),
        "dual"       | "0x09" => Ok(SuiteId::Dual),
        "triple"     | "0xff" => Ok(SuiteId::Triple),
        _ => Err(anyhow::anyhow!("unknown suite: {s} (use dilithium5, dual, triple)")),
    }
}

fn parse_token_type(s: &str) -> anyhow::Result<TokenType> {
    match s {
        "access"  => Ok(TokenType::Access),
        "refresh" => Ok(TokenType::Refresh),
        "service" => Ok(TokenType::Service),
        _ => Err(anyhow::anyhow!("unknown token type: {s}")),
    }
}

fn load_token_bytes(arg: &str) -> anyhow::Result<Vec<u8>> {
    // If the argument is a valid file path, read it; otherwise treat as hex.
    let path = PathBuf::from(arg);
    if path.exists() {
        Ok(std::fs::read(path)?)
    } else {
        Ok(hex::decode(arg)?)
    }
}
