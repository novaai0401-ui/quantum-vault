use clap::{Parser, Subcommand};
use qv_core::{
    Claims, MutationChain, QVRawToken, SuiteId, TokenType, VerifyOutput,
    generate_keypair, issue_token, verify_token, IssueParams,
};
use std::path::PathBuf;

#[derive(Parser)]
#[command(name = "qv", about = "Sigvault v3.0 — Post-Quantum Token CLI", version = "3.0.0")]
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

    /// Issue a new Sigvault token.
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

    /// Verify a Sigvault token.
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

    /// Generate a Falcon-512 / Falcon-1024 keypair.
    ///
    /// Available only when qv-cli is built with the `falcon` feature
    /// (default). On platforms without a C toolchain (rare for the
    /// CLI), build with `--no-default-features`.
    #[cfg(feature = "falcon")]
    FalconKeygen {
        /// 512 or 1024 — NIST level 1 vs level 5.
        #[arg(long, default_value = "512", value_parser = parse_falcon_n)]
        n: u16,
        #[arg(long)]
        sk_out: PathBuf,
        #[arg(long)]
        vk_out: PathBuf,
    },

    /// Sign arbitrary bytes with a Falcon signing key. Output is the
    /// raw signature, hex-encoded by default.
    #[cfg(feature = "falcon")]
    FalconSign {
        #[arg(long, default_value = "512", value_parser = parse_falcon_n)]
        n: u16,
        /// Path to the secret-key file produced by `falcon-keygen`.
        #[arg(long)]
        sk: PathBuf,
        /// Path to the message file. If omitted, reads from stdin.
        #[arg(long)]
        msg: Option<PathBuf>,
        /// hex (default) | base64 | binary
        #[arg(long, default_value = "hex")]
        format: String,
    },

    /// Verify a Falcon signature against a message.
    #[cfg(feature = "falcon")]
    FalconVerify {
        #[arg(long, default_value = "512", value_parser = parse_falcon_n)]
        n: u16,
        /// Path to the verifying-key file produced by `falcon-keygen`.
        #[arg(long)]
        vk: PathBuf,
        /// Path to the message file. If omitted, reads from stdin.
        #[arg(long)]
        msg: Option<PathBuf>,
        /// Path to the signature file (raw bytes), or hex/base64 string.
        #[arg(long)]
        sig: String,
    },
}

#[cfg(feature = "falcon")]
fn parse_falcon_n(s: &str) -> Result<u16, String> {
    match s {
        "512"  => Ok(512),
        "1024" => Ok(1024),
        _ => Err(format!("--n must be 512 or 1024 (got {s})")),
    }
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
        #[cfg(feature = "falcon")]
        Command::FalconKeygen { n, sk_out, vk_out } => falcon::cmd_keygen(n, sk_out, vk_out),
        #[cfg(feature = "falcon")]
        Command::FalconSign   { n, sk, msg, format } => falcon::cmd_sign(n, sk, msg, &format),
        #[cfg(feature = "falcon")]
        Command::FalconVerify { n, vk, msg, sig } => falcon::cmd_verify(n, vk, msg, &sig),
    }
}

// ─── Falcon subcommand implementations ────────────────────────────────────────

#[cfg(feature = "falcon")]
mod falcon {
    use std::path::PathBuf;
    use std::io::Read;
    use anyhow::Context;
    use qv_core::falcon::{falcon512, falcon1024};

    fn read_msg(path: &Option<PathBuf>) -> anyhow::Result<Vec<u8>> {
        match path {
            Some(p) => Ok(std::fs::read(p).with_context(|| format!("read {}", p.display()))?),
            None => {
                let mut buf = Vec::new();
                std::io::stdin().read_to_end(&mut buf)?;
                Ok(buf)
            }
        }
    }

    fn parse_sig(s: &str) -> anyhow::Result<Vec<u8>> {
        // 1) Path on disk → raw bytes.
        if std::path::Path::new(s).is_file() {
            return Ok(std::fs::read(s)?);
        }
        // 2) Hex.
        if s.chars().all(|c| c.is_ascii_hexdigit()) && s.len() % 2 == 0 {
            return Ok(hex::decode(s)?);
        }
        // 3) base64.
        crate::base64_decode_minimal::decode(s)
    }

    fn write_secure(path: &PathBuf, bytes: &[u8]) -> anyhow::Result<()> {
        std::fs::write(path, bytes)?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mut perms = std::fs::metadata(path)?.permissions();
            perms.set_mode(0o600);
            std::fs::set_permissions(path, perms)?;
        }
        Ok(())
    }

    pub fn cmd_keygen(n: u16, sk_out: PathBuf, vk_out: PathBuf) -> anyhow::Result<()> {
        match n {
            512 => {
                let (sk, vk) = falcon512::generate_keypair()?;
                write_secure(&sk_out, &sk.to_bytes())?;
                std::fs::write(&vk_out, vk.to_bytes())?;
            }
            1024 => {
                let (sk, vk) = falcon1024::generate_keypair()?;
                write_secure(&sk_out, &sk.to_bytes())?;
                std::fs::write(&vk_out, vk.to_bytes())?;
            }
            _ => unreachable!("clap rejects other values"),
        }
        eprintln!("✔ Falcon-{n} keypair → sk={} vk={}", sk_out.display(), vk_out.display());
        Ok(())
    }

    pub fn cmd_sign(n: u16, sk_path: PathBuf, msg_path: Option<PathBuf>, format: &str) -> anyhow::Result<()> {
        let msg = read_msg(&msg_path)?;
        let sk_bytes = std::fs::read(&sk_path)?;
        let sig = match n {
            512 => {
                let sk = falcon512::QVFalcon512SigningKey::from_bytes(&sk_bytes)?;
                falcon512::sign(&sk, &msg)?
            }
            1024 => {
                let sk = falcon1024::QVFalcon1024SigningKey::from_bytes(&sk_bytes)?;
                falcon1024::sign(&sk, &msg)?
            }
            _ => unreachable!(),
        };
        match format {
            "hex"    => println!("{}", hex::encode(&sig)),
            "base64" => println!("{}", crate::base64_encode_minimal::encode(&sig)),
            "binary" => {
                use std::io::Write;
                std::io::stdout().write_all(&sig)?;
            }
            _ => anyhow::bail!("--format must be hex|base64|binary, got {format}"),
        }
        Ok(())
    }

    pub fn cmd_verify(n: u16, vk_path: PathBuf, msg_path: Option<PathBuf>, sig_arg: &str) -> anyhow::Result<()> {
        let msg = read_msg(&msg_path)?;
        let vk_bytes = std::fs::read(&vk_path)?;
        let sig = parse_sig(sig_arg)?;
        let r = match n {
            512 => {
                let vk = falcon512::QVFalcon512VerifyingKey::from_bytes(&vk_bytes)?;
                falcon512::verify(&vk, &msg, &sig)
            }
            1024 => {
                let vk = falcon1024::QVFalcon1024VerifyingKey::from_bytes(&vk_bytes)?;
                falcon1024::verify(&vk, &msg, &sig)
            }
            _ => unreachable!(),
        };
        match r {
            Ok(()) => { println!("VALID"); Ok(()) }
            Err(e) => {
                eprintln!("INVALID: {e}");
                std::process::exit(2);
            }
        }
    }
}

// ─── Tiny base64 helpers (zero-dep — `base64` would be one more crate) ────────
//
// We pull in nothing else: encode/decode standard base64 with padding.
// Implemented inline to avoid pulling `base64` crate just for the CLI.

#[cfg(feature = "falcon")]
mod base64_encode_minimal {
    const A: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    pub fn encode(data: &[u8]) -> String {
        let mut out = String::with_capacity(((data.len() + 2) / 3) * 4);
        let chunks = data.chunks(3);
        for c in chunks {
            let n = match c.len() {
                3 => ((c[0] as u32) << 16) | ((c[1] as u32) << 8) | (c[2] as u32),
                2 => ((c[0] as u32) << 16) | ((c[1] as u32) << 8),
                1 => (c[0] as u32) << 16,
                _ => unreachable!(),
            };
            out.push(A[((n >> 18) & 0x3F) as usize] as char);
            out.push(A[((n >> 12) & 0x3F) as usize] as char);
            if c.len() > 1 { out.push(A[((n >> 6) & 0x3F) as usize] as char); } else { out.push('='); }
            if c.len() > 2 { out.push(A[(n & 0x3F) as usize]        as char); } else { out.push('='); }
        }
        out
    }
}

#[cfg(feature = "falcon")]
mod base64_decode_minimal {
    pub fn decode(s: &str) -> anyhow::Result<Vec<u8>> {
        let mut out = Vec::with_capacity((s.len() / 4) * 3);
        let mut buf = 0u32; let mut bits = 0;
        for c in s.chars() {
            let v: u32 = match c {
                'A'..='Z' => c as u32 - 'A' as u32,
                'a'..='z' => c as u32 - 'a' as u32 + 26,
                '0'..='9' => c as u32 - '0' as u32 + 52,
                '+' | '-' => 62,
                '/' | '_' => 63,
                '=' | '\n' | '\r' | ' ' | '\t' => continue,
                _ => anyhow::bail!("invalid base64 char {c:?}"),
            };
            buf = (buf << 6) | v;
            bits += 6;
            if bits >= 8 {
                bits -= 8;
                out.push((buf >> bits) as u8);
                buf &= (1 << bits) - 1;
            }
        }
        Ok(out)
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

    println!("Sigvault Token Inspection");
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
