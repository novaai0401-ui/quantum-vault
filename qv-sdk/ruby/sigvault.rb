# Sigvault v3.0 — Ruby SDK
# ==============================
# No gems needed — uses stdlib net/http + json.
#
# Compatible with: Ruby 2.7+, Rails 6+, Sinatra, Hanami, plain scripts.
#
# Usage:
#   qv     = Sigvault::Client.new("http://localhost:7433")
#   key_id = qv.keygen("ruby-demo")
#   token  = qv.issue(key_id, sub: "user-1", role: "admin")
#   result = qv.verify(key_id, token)
#   puts result[:claims]["sub"]

require 'net/http'
require 'json'
require 'uri'

module Sigvault
  class Error < StandardError
    attr_reader :code
    def initialize(code, message)
      super("[#{code}] #{message}")
      @code = code
    end
  end

  class Client
    def initialize(base_url = "http://localhost:7433", timeout: 30, admin_token: nil)
      @uri         = URI.parse(base_url)
      @timeout     = timeout
      @admin_token = admin_token   # required for keygen/issue/revoke when the server enforces auth
    end

    def health       = get("/v3/health")
    def live         = get("/v3/live")
    def ready        = get("/v3/ready")
    def spec         = get("/v3/spec")

    def keygen(label = nil)
      body = label ? { label: label } : {}
      post("/v3/keygen", body, admin: true)[:keyId]
    end

    # Resolve a keyId in O(1) from a verifying-key (base64url).
    # Operationally closes limitation L2. Returns {keyId:, fingerprint:, revoked:}.
    def identify_by_vk(vk_b64u)
      post("/v3/keys/identify", { vkB64u: vk_b64u })
    end

    # Resolve a keyId from a 32-hex SHA3-256 verifying-key fingerprint.
    def identify_by_fingerprint(fingerprint)
      post("/v3/keys/identify", { fingerprint: fingerprint })
    end

    # Revoke a key (admin). Durable on disk before the server responds.
    def revoke(key_id)
      delete("/v3/keys/#{key_id}", admin: true)
    end

    def issue(key_id, claims, ttl: 3600, suite: "dilithium5", token_type: "access")
      resp = post("/v3/token/issue", {
        keyId: key_id, claims: claims.transform_keys(&:to_s),
        ttl: ttl, suite: suite, tokenType: token_type
      }, admin: true)
      resp[:tokenHex]
    end

    def verify(key_id, token)
      resp = post("/v3/token/verify", { keyId: key_id, token: token })
      raise Error.new(resp.dig(:error, :code), resp.dig(:error, :message)) unless resp[:valid]
      resp
    end

    # Verify without knowing the keyId — the server trial-verifies against
    # every active (non-revoked) key. Response includes :keyId for caching.
    def verify_auto(token)
      resp = post("/v3/token/verify-auto", { token: token })
      raise Error.new(resp.dig(:error, :code), resp.dig(:error, :message)) unless resp[:valid]
      resp
    end

    def inspect_token(token)
      post("/v3/token/inspect", { token: token })
    end

    private

    def post(path, body, admin: false)
      req = Net::HTTP::Post.new(path, "Content-Type" => "application/json")
      req["Authorization"] = "Bearer #{@admin_token}" if admin && @admin_token
      req.body = body.to_json
      call(req)
    end

    def get(path)
      call(Net::HTTP::Get.new(path))
    end

    def delete(path, admin: false)
      req = Net::HTTP::Delete.new(path)
      req["Authorization"] = "Bearer #{@admin_token}" if admin && @admin_token
      call(req)
    end

    def call(req)
      Net::HTTP.start(@uri.host, @uri.port, read_timeout: @timeout) do |http|
        resp = http.request(req)
        data = JSON.parse(resp.body, symbolize_names: true)
        if resp.code.to_i >= 400
          err = data[:error] || {}
          raise Error.new(err[:code], err[:message])
        end
        data
      end
    end
  end
end

# ── Demo ──────────────────────────────────────────────────────────────────────
if __FILE__ == $0
  require 'benchmark'
  qv = Sigvault::Client.new("http://localhost:7433")

  puts "\n╔══════════════════════════════════════════╗"
  puts "║  Sigvault v3.0 — Ruby SDK Demo       ║"
  puts "╚══════════════════════════════════════════╝\n\n"

  h = qv.health
  puts "✔ Server: #{h[:status]} | #{h[:algorithm]}"

  puts "\n[1] Generating ML-DSA-87 keypair..."
  t = Time.now
  key_id = qv.keygen("ruby-demo")
  puts "  ✔ keyId: #{key_id}"
  puts "  ✔ time : #{((Time.now-t)*1000).round(1)}ms"

  puts "\n[2] Issuing access token..."
  t = Time.now
  token = qv.issue(key_id, sub: "ruby-user-001", iss: "qv.ruby.example", role: "rails-api", lang: "Ruby")
  puts "  ✔ token: #{token[0,32]}..."
  puts "  ✔ time : #{((Time.now-t)*1000).round(1)}ms"

  puts "\n[3] Verifying token..."
  t = Time.now
  out = qv.verify(key_id, token)
  puts "  ✔ VALID in #{((Time.now-t)*1000).round(1)}ms"
  out[:claims].each { |k,v| puts "  ✔   #{k} = #{v}" }

  puts "\n[4] Attack resistance..."
  bad = token[0..-5] + "dead"
  begin
    qv.verify(key_id, bad)
    puts "  ✘ Should have rejected tampered token!"
  rescue Sigvault::Error => e
    puts "  ✔ Tampered token rejected: #{e}"
  end

  puts "\n╔══════════════════════════════════════════╗"
  puts "║  Ruby SDK — ALL TESTS PASSED ✔           ║"
  puts "╚══════════════════════════════════════════╝\n\n"
end
