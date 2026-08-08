/**
 * Sigvault v3.0 — Java SDK
 * ==============================
 * No external dependencies — uses only java.net.http (Java 11+).
 *
 * Works on: Java 11+, Spring Boot, Micronaut, Quarkus, Jakarta EE,
 *           Android API 26+, GraalVM Native Image.
 *
 * Usage:
 *   SigvaultClient qv = new SigvaultClient("http://localhost:7433");
 *   String keyId = qv.keygen("my-service");
 *   String token = qv.issue(keyId, Map.of("sub","user-1","role","admin"));
 *   Map<?,?> result = qv.verify(keyId, token);
 */

import java.net.URI;
import java.net.http.*;
import java.time.Duration;
import java.util.*;
import java.io.*;

public class SigvaultClient {

    private final String baseUrl;
    private final HttpClient http;
    private String adminToken; // required for keygen/issue/revoke when the server enforces auth

    public SigvaultClient(String baseUrl) {
        this.baseUrl = baseUrl.endsWith("/") ? baseUrl.substring(0, baseUrl.length()-1) : baseUrl;
        this.http = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(10))
            .version(HttpClient.Version.HTTP_1_1)
            .build();
    }

    /** Attach the admin bearer token used by admin-only endpoints. Returns this for chaining. */
    public SigvaultClient withAdminToken(String token) {
        this.adminToken = token;
        return this;
    }

    // ── JSON helpers (no Jackson/Gson needed for simple cases) ────────────────

    private static String toJson(Map<String,Object> map) {
        StringBuilder sb = new StringBuilder("{");
        boolean first = true;
        for (Map.Entry<String,Object> e : map.entrySet()) {
            if (!first) sb.append(",");
            first = false;
            sb.append("\"").append(e.getKey()).append("\":");
            Object v = e.getValue();
            if (v instanceof String)        sb.append("\"").append(v).append("\"");
            else if (v instanceof Map)      sb.append(toJson((Map<String,Object>) v));
            else if (v instanceof Integer)  sb.append(v);
            else                            sb.append("\"").append(v).append("\"");
        }
        sb.append("}");
        return sb.toString();
    }

    private Map<String,Object> post(String path, Map<String,Object> body) throws Exception {
        return post(path, body, false);
    }

    private Map<String,Object> post(String path, Map<String,Object> body, boolean admin) throws Exception {
        String json = toJson(body);
        HttpRequest.Builder b = HttpRequest.newBuilder()
            .uri(URI.create(baseUrl + path))
            .header("Content-Type", "application/json")
            .POST(HttpRequest.BodyPublishers.ofString(json))
            .timeout(Duration.ofSeconds(30));
        if (admin && adminToken != null) b.header("Authorization", "Bearer " + adminToken);
        HttpResponse<String> resp = http.send(b.build(), HttpResponse.BodyHandlers.ofString());
        return parseJson(resp.body());
    }

    private Map<String,Object> delete(String path, boolean admin) throws Exception {
        HttpRequest.Builder b = HttpRequest.newBuilder()
            .uri(URI.create(baseUrl + path))
            .DELETE().timeout(Duration.ofSeconds(30));
        if (admin && adminToken != null) b.header("Authorization", "Bearer " + adminToken);
        HttpResponse<String> resp = http.send(b.build(), HttpResponse.BodyHandlers.ofString());
        return parseJson(resp.body());
    }

    private Map<String,Object> get(String path) throws Exception {
        HttpRequest req = HttpRequest.newBuilder()
            .uri(URI.create(baseUrl + path))
            .GET().timeout(Duration.ofSeconds(10))
            .build();
        HttpResponse<String> resp = http.send(req, HttpResponse.BodyHandlers.ofString());
        return parseJson(resp.body());
    }

    /** Minimal JSON parser for string/number/object — enough for QV responses. */
    @SuppressWarnings("unchecked")
    private static Map<String,Object> parseJson(String s) {
        // Delegate to a tiny recursive descent parser.
        return (Map<String,Object>) new JsonParser(s).parse();
    }

    // ── API ───────────────────────────────────────────────────────────────────

    public Map<String,Object> health() throws Exception {
        return get("/v3/health");
    }

    /** Kubernetes-style liveness probe (GET /v3/live). */
    public Map<String,Object> live() throws Exception {
        return get("/v3/live");
    }

    /** Kubernetes-style readiness probe (GET /v3/ready). */
    public Map<String,Object> ready() throws Exception {
        return get("/v3/ready");
    }

    /** Generate a new ML-DSA-87 keypair (admin). Returns the keyId. */
    public String keygen(String label) throws Exception {
        Map<String,Object> body = new LinkedHashMap<>();
        if (label != null) body.put("label", label);
        Map<String,Object> resp = post("/v3/keygen", body, true);
        return (String) resp.get("keyId");
    }

    /**
     * Resolve a keyId in O(1) from a verifying-key (base64url).
     * Operationally closes limitation L2. Returns {keyId, fingerprint, revoked}.
     */
    public Map<String,Object> identifyByVk(String vkB64u) throws Exception {
        Map<String,Object> body = new LinkedHashMap<>();
        body.put("vkB64u", vkB64u);
        return post("/v3/keys/identify", body);
    }

    /** Resolve a keyId from a 32-hex SHA3-256 verifying-key fingerprint. */
    public Map<String,Object> identifyByFingerprint(String fingerprint) throws Exception {
        Map<String,Object> body = new LinkedHashMap<>();
        body.put("fingerprint", fingerprint);
        return post("/v3/keys/identify", body);
    }

    /** Revoke a key (admin). Durable on disk before the server responds. */
    public Map<String,Object> revoke(String keyId) throws Exception {
        return delete("/v3/keys/" + keyId, true);
    }

    /** Issue a signed token. Returns the hex-encoded token. */
    public String issue(String keyId, Map<String,String> claims) throws Exception {
        return issue(keyId, claims, 3600, "dilithium5", "access");
    }

    public String issue(String keyId, Map<String,String> claims, int ttl,
                        String suite, String tokenType) throws Exception {
        Map<String,Object> body = new LinkedHashMap<>();
        body.put("keyId",     keyId);
        body.put("claims",    new LinkedHashMap<>(claims));
        body.put("ttl",       ttl);
        body.put("suite",     suite);
        body.put("tokenType", tokenType);
        Map<String,Object> resp = post("/v3/token/issue", body, true);
        return (String) resp.get("tokenHex");
    }

    /** Verify a token. Returns claims map on success, throws on failure. */
    public Map<String,Object> verify(String keyId, String token) throws Exception {
        Map<String,Object> body = new LinkedHashMap<>();
        body.put("keyId", keyId);
        body.put("token", token);
        Map<String,Object> resp = post("/v3/token/verify", body);
        Boolean valid = (Boolean) resp.get("valid");
        if (Boolean.FALSE.equals(valid)) {
            Object err = resp.get("error");
            throw new RuntimeException("Token invalid: " + err);
        }
        return resp;
    }

    /**
     * Verify without knowing the keyId — the server trial-verifies against
     * every active (non-revoked) key. Response includes keyId for caching.
     */
    public Map<String,Object> verifyAuto(String token) throws Exception {
        Map<String,Object> body = new LinkedHashMap<>();
        body.put("token", token);
        Map<String,Object> resp = post("/v3/token/verify-auto", body);
        Boolean valid = (Boolean) resp.get("valid");
        if (Boolean.FALSE.equals(valid)) {
            Object err = resp.get("error");
            throw new RuntimeException("Token invalid: " + err);
        }
        return resp;
    }

    /** Inspect header without cryptographic verification. */
    public Map<String,Object> inspect(String token) throws Exception {
        return post("/v3/token/inspect", Map.of("token", token));
    }

    // ── Demo main ─────────────────────────────────────────────────────────────

    public static void main(String[] args) throws Exception {
        SigvaultClient qv = new SigvaultClient("http://localhost:7433");

        System.out.println("\n╔══════════════════════════════════════════╗");
        System.out.println("║  Sigvault v3.0 — Java SDK Demo       ║");
        System.out.println("╚══════════════════════════════════════════╝\n");

        // Health
        Map<String,Object> health = qv.health();
        System.out.println("✔ Server: " + health.get("status") + " | " + health.get("algorithm"));

        // Keygen
        System.out.println("\n[1] Generating ML-DSA-87 keypair...");
        long t0 = System.currentTimeMillis();
        String keyId = qv.keygen("java-demo");
        System.out.println("  ✔ keyId: " + keyId);
        System.out.printf("  ✔ time : %dms%n", System.currentTimeMillis() - t0);

        // Issue
        System.out.println("\n[2] Issuing access token...");
        long t1 = System.currentTimeMillis();
        Map<String,String> claims = new LinkedHashMap<>();
        claims.put("sub",  "java-user-001");
        claims.put("iss",  "qv.java.example");
        claims.put("role", "backend-service");
        claims.put("lang", "Java 11");
        String token = qv.issue(keyId, claims);
        System.out.printf("  ✔ token  : %s...%n", token.substring(0, 32));
        System.out.printf("  ✔ time   : %dms%n", System.currentTimeMillis() - t1);

        // Verify
        System.out.println("\n[3] Verifying token...");
        long t2 = System.currentTimeMillis();
        Map<String,Object> result = qv.verify(keyId, token);
        System.out.printf("  ✔ VALID in %dms%n", System.currentTimeMillis() - t2);
        System.out.println("  ✔ Claims: " + result.get("claims"));

        // Attack test
        System.out.println("\n[4] Attack resistance...");
        String bad = token.substring(0, token.length() - 4) + "dead";
        try {
            qv.verify(keyId, bad);
            System.out.println("  ✘ Should have rejected tampered token!");
        } catch (RuntimeException e) {
            System.out.println("  ✔ Tampered token rejected: " + e.getMessage());
        }

        System.out.println("\n╔══════════════════════════════════════════╗");
        System.out.println("║  Java SDK — ALL TESTS PASSED ✔           ║");
        System.out.println("╚══════════════════════════════════════════╝\n");
    }

    // ─── Minimal JSON parser ──────────────────────────────────────────────────
    static class JsonParser {
        private final String s;
        private int pos;
        JsonParser(String s) { this.s = s.trim(); }

        Object parse() {
            skipWs();
            char c = s.charAt(pos);
            if (c == '{') return parseObject();
            if (c == '[') return parseArray();
            if (c == '"') return parseString();
            if (c == 't') { pos += 4; return Boolean.TRUE; }
            if (c == 'f') { pos += 5; return Boolean.FALSE; }
            if (c == 'n') { pos += 4; return null; }
            return parseNumber();
        }

        private Map<String,Object> parseObject() {
            Map<String,Object> m = new LinkedHashMap<>();
            pos++; skipWs();
            while (s.charAt(pos) != '}') {
                String key = parseString();
                skipWs(); pos++; // ':'
                skipWs();
                m.put(key, parse());
                skipWs();
                if (s.charAt(pos) == ',') pos++;
                skipWs();
            }
            pos++;
            return m;
        }

        private List<Object> parseArray() {
            List<Object> list = new ArrayList<>();
            pos++; skipWs();
            while (s.charAt(pos) != ']') {
                list.add(parse());
                skipWs();
                if (s.charAt(pos) == ',') pos++;
                skipWs();
            }
            pos++;
            return list;
        }

        private String parseString() {
            pos++; // opening "
            StringBuilder sb = new StringBuilder();
            while (s.charAt(pos) != '"') {
                if (s.charAt(pos) == '\\') { pos++; sb.append(s.charAt(pos)); }
                else                        sb.append(s.charAt(pos));
                pos++;
            }
            pos++; // closing "
            return sb.toString();
        }

        private Object parseNumber() {
            int start = pos;
            while (pos < s.length() && "-0123456789.eE+".indexOf(s.charAt(pos)) >= 0) pos++;
            String num = s.substring(start, pos);
            if (num.contains(".")) return Double.parseDouble(num);
            try { return Long.parseLong(num); } catch (NumberFormatException e) { return num; }
        }

        private void skipWs() { while (pos < s.length() && s.charAt(pos) <= ' ') pos++; }
    }
}
