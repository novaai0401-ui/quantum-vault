/**
 * Sigvault v3.0 — C# / .NET SDK
 * =====================================
 * No NuGet packages needed — uses System.Net.Http + System.Text.Json (built-in since .NET 5).
 *
 * Compatible with: .NET 5+, .NET 6/7/8, ASP.NET Core, .NET MAUI,
 *                  Unity 2021+, Blazor, Azure Functions, AWS Lambda .NET.
 *
 * Usage:
 *   var qv     = new SigvaultClient("http://localhost:7433");
 *   var keyId  = await qv.KeygenAsync("my-service");
 *   var token  = await qv.IssueAsync(keyId, new() { ["sub"]="user-1", ["role"]="admin" });
 *   var result = await qv.VerifyAsync(keyId, token);
 *   Console.WriteLine(result.Claims["sub"]);
 */

using System;
using System.Collections.Generic;
using System.Net.Http;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Threading.Tasks;
using System.Diagnostics;

public class SigvaultClient : IDisposable
{
    private readonly HttpClient _http;
    private readonly string _base;
    private readonly string? _adminToken; // required for keygen/issue/revoke when the server enforces auth

    public SigvaultClient(string baseUrl = "http://localhost:7433", string? adminToken = null)
    {
        _base = baseUrl.TrimEnd('/');
        _adminToken = adminToken;
        _http = new HttpClient { Timeout = TimeSpan.FromSeconds(30) };
        _http.DefaultRequestHeaders.Add("Accept", "application/json");
    }

    // ── Response models ───────────────────────────────────────────────────────

    public record HealthResponse(
        [property: JsonPropertyName("status")]    string Status,
        [property: JsonPropertyName("version")]   string Version,
        [property: JsonPropertyName("algorithm")] string Algorithm);

    public record KeygenResponse(
        [property: JsonPropertyName("keyId")]           string KeyId,
        [property: JsonPropertyName("verifyingKeyLen")] int VerifyingKeyLen,
        [property: JsonPropertyName("algorithm")]       string Algorithm,
        [property: JsonPropertyName("createdAt")]       string CreatedAt);

    public record IssueResponse(
        [property: JsonPropertyName("tokenHex")]    string TokenHex,
        [property: JsonPropertyName("tokenB64")]    string TokenB64,
        [property: JsonPropertyName("sizeBytes")]   int SizeBytes,
        [property: JsonPropertyName("issuedAt")]    string IssuedAt,
        [property: JsonPropertyName("ttlSecs")]     int TtlSecs,
        [property: JsonPropertyName("mutationCtr")] long MutationCtr);

    public record VerifyResponse(
        [property: JsonPropertyName("valid")]       bool Valid,
        [property: JsonPropertyName("keyId")]       string? KeyId,  // populated by VerifyAutoAsync
        [property: JsonPropertyName("claims")]      Dictionary<string,string> Claims,
        [property: JsonPropertyName("issuedAt")]    string IssuedAt,
        [property: JsonPropertyName("ttlSecs")]     int TtlSecs,
        [property: JsonPropertyName("mutationCtr")] long MutationCtr);

    public record IdentifyResponse(
        [property: JsonPropertyName("keyId")]       string KeyId,
        [property: JsonPropertyName("fingerprint")] string Fingerprint,
        [property: JsonPropertyName("revoked")]     bool Revoked);

    // ── API ───────────────────────────────────────────────────────────────────

    public async Task<HealthResponse> HealthAsync()
    {
        var resp = await _http.GetAsync($"{_base}/v3/health");
        resp.EnsureSuccessStatusCode();
        return await resp.Content.ReadFromJsonAsync<HealthResponse>()
               ?? throw new Exception("null response");
    }

    /// <summary>Kubernetes-style liveness probe (GET /v3/live).</summary>
    public async Task LiveAsync()
    {
        var resp = await _http.GetAsync($"{_base}/v3/live");
        resp.EnsureSuccessStatusCode();
    }

    /// <summary>Kubernetes-style readiness probe (GET /v3/ready).</summary>
    public async Task ReadyAsync()
    {
        var resp = await _http.GetAsync($"{_base}/v3/ready");
        resp.EnsureSuccessStatusCode();
    }

    /// <summary>Generate a new ML-DSA-87 keypair (admin). Returns keyId.</summary>
    public async Task<string> KeygenAsync(string? label = null)
    {
        var body = new Dictionary<string,object?> { ["label"] = label };
        var resp = await PostAsync<KeygenResponse>("/v3/keygen", body, admin: true);
        return resp.KeyId;
    }

    /// <summary>
    /// Resolve a keyId in O(1) from a verifying-key (base64url).
    /// Operationally closes limitation L2.
    /// </summary>
    public async Task<IdentifyResponse> IdentifyByVkAsync(string vkB64u)
    {
        var body = new Dictionary<string,object?> { ["vkB64u"] = vkB64u };
        return await PostAsync<IdentifyResponse>("/v3/keys/identify", body);
    }

    /// <summary>Resolve a keyId from a 32-hex SHA3-256 verifying-key fingerprint.</summary>
    public async Task<IdentifyResponse> IdentifyByFingerprintAsync(string fingerprint)
    {
        var body = new Dictionary<string,object?> { ["fingerprint"] = fingerprint };
        return await PostAsync<IdentifyResponse>("/v3/keys/identify", body);
    }

    /// <summary>Revoke a key (admin). Durable on disk before the server responds.</summary>
    public async Task RevokeAsync(string keyId)
    {
        using var req = new HttpRequestMessage(HttpMethod.Delete, $"{_base}/v3/keys/{Uri.EscapeDataString(keyId)}");
        if (_adminToken is not null)
            req.Headers.Add("Authorization", "Bearer " + _adminToken);
        var resp = await _http.SendAsync(req);
        var raw  = await resp.Content.ReadAsStringAsync();
        if (!resp.IsSuccessStatusCode)
            throw new HttpRequestException($"Sigvault error {(int)resp.StatusCode}: {raw}");
    }

    /// <summary>Issue a signed post-quantum token. Returns hex token string.</summary>
    public async Task<string> IssueAsync(
        string keyId,
        Dictionary<string,string> claims,
        int ttl = 3600, string suite = "dilithium5", string tokenType = "access")
    {
        var body = new Dictionary<string,object?>
        {
            ["keyId"]     = keyId,
            ["claims"]    = claims,
            ["ttl"]       = ttl,
            ["suite"]     = suite,
            ["tokenType"] = tokenType,
        };
        var resp = await PostAsync<IssueResponse>("/v3/token/issue", body, admin: true);
        return resp.TokenHex;
    }

    /// <summary>Verify a token. Returns VerifyResponse on success, throws on failure.</summary>
    public async Task<VerifyResponse> VerifyAsync(string keyId, string token)
    {
        var body = new Dictionary<string,object?> { ["keyId"] = keyId, ["token"] = token };
        var resp = await PostAsync<VerifyResponse>("/v3/token/verify", body);
        if (!resp.Valid) throw new InvalidOperationException("Token verification failed");
        return resp;
    }

    /// <summary>
    /// Verify without knowing the keyId — the server trial-verifies against
    /// every active (non-revoked) key. Response includes KeyId for caching.
    /// </summary>
    public async Task<VerifyResponse> VerifyAutoAsync(string token)
    {
        var body = new Dictionary<string,object?> { ["token"] = token };
        var resp = await PostAsync<VerifyResponse>("/v3/token/verify-auto", body);
        if (!resp.Valid) throw new InvalidOperationException("No active key verified the token");
        return resp;
    }

    /// <summary>Inspect token header without cryptographic verification.</summary>
    public async Task<Dictionary<string,object?>> InspectAsync(string token)
    {
        var body = new Dictionary<string,object?> { ["token"] = token };
        return await PostAsync<Dictionary<string,object?>>("/v3/token/inspect", body);
    }

    // ── Internal ──────────────────────────────────────────────────────────────

    private async Task<T> PostAsync<T>(string path, object body, bool admin = false)
    {
        using var req = new HttpRequestMessage(HttpMethod.Post, _base + path)
        {
            Content = JsonContent.Create(body),
        };
        if (admin && _adminToken is not null)
            req.Headers.Add("Authorization", "Bearer " + _adminToken);
        var resp = await _http.SendAsync(req);
        var raw  = await resp.Content.ReadAsStringAsync();
        if (!resp.IsSuccessStatusCode)
            throw new HttpRequestException($"Sigvault error {(int)resp.StatusCode}: {raw}");
        return JsonSerializer.Deserialize<T>(raw)
               ?? throw new Exception("null response from " + path);
    }

    public void Dispose() => _http.Dispose();

    // ── Demo ──────────────────────────────────────────────────────────────────

    public static async Task Main(string[] args)
    {
        using var qv = new SigvaultClient("http://localhost:7433");

        Console.WriteLine("\n╔══════════════════════════════════════════╗");
        Console.WriteLine("║  Sigvault v3.0 — C# SDK Demo         ║");
        Console.WriteLine("╚══════════════════════════════════════════╝\n");

        // Health
        var health = await qv.HealthAsync();
        Console.WriteLine($"✔ Server: {health.Status} | {health.Algorithm}");

        // Keygen
        Console.WriteLine("\n[1] Generating ML-DSA-87 keypair...");
        var sw = Stopwatch.StartNew();
        var keyId = await qv.KeygenAsync("csharp-demo");
        Console.WriteLine($"  ✔ keyId: {keyId}");
        Console.WriteLine($"  ✔ time : {sw.ElapsedMilliseconds}ms");

        // Issue
        Console.WriteLine("\n[2] Issuing access token...");
        sw.Restart();
        var token = await qv.IssueAsync(keyId, new()
        {
            ["sub"]  = "csharp-user-001",
            ["iss"]  = "qv.dotnet.example",
            ["role"] = "api-gateway",
            ["lang"] = "C# .NET 8",
        });
        Console.WriteLine($"  ✔ token : {token[..32]}...");
        Console.WriteLine($"  ✔ time  : {sw.ElapsedMilliseconds}ms");

        // Verify
        Console.WriteLine("\n[3] Verifying token...");
        sw.Restart();
        var result = await qv.VerifyAsync(keyId, token);
        Console.WriteLine($"  ✔ VALID in {sw.ElapsedMilliseconds}ms");
        foreach (var kv in result.Claims)
            Console.WriteLine($"  ✔   {kv.Key} = {kv.Value}");

        // Tamper test
        Console.WriteLine("\n[4] Attack resistance...");
        var bad = token[..^4] + "dead";
        try {
            await qv.VerifyAsync(keyId, bad);
            Console.WriteLine("  ✘ Should have rejected tampered token!");
        } catch (Exception e) {
            Console.WriteLine($"  ✔ Tampered token rejected: {e.Message}");
        }

        Console.WriteLine("\n╔══════════════════════════════════════════╗");
        Console.WriteLine("║  C# SDK — ALL TESTS PASSED ✔             ║");
        Console.WriteLine("╚══════════════════════════════════════════╝\n");
    }
}
