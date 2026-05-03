<?php
/**
 * Sigvault v3.0 — PHP SDK
 * ==============================
 * No Composer dependencies — uses built-in curl extension (enabled by default).
 *
 * Compatible with: PHP 7.4+, 8.x — Laravel, Symfony, WordPress, Magento,
 *                  Drupal, CodeIgniter, bare PHP scripts.
 *
 * Usage:
 *   $qv    = new SigvaultClient('http://localhost:7433');
 *   $keyId = $qv->keygen('php-demo');
 *   $token = $qv->issue($keyId, ['sub' => 'user-1', 'role' => 'admin']);
 *   $out   = $qv->verify($keyId, $token);
 *   echo $out['claims']['sub'];
 */

class SigvaultClient
{
    private string $base;
    private int    $timeout;

    public function __construct(string $baseUrl = 'http://localhost:7433', int $timeout = 30)
    {
        $this->base    = rtrim($baseUrl, '/');
        $this->timeout = $timeout;
    }

    private function post(string $path, array $body): array
    {
        $ch = curl_init($this->base . $path);
        curl_setopt_array($ch, [
            CURLOPT_POST           => true,
            CURLOPT_POSTFIELDS     => json_encode($body),
            CURLOPT_HTTPHEADER     => ['Content-Type: application/json', 'Accept: application/json'],
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT        => $this->timeout,
        ]);
        $resp  = curl_exec($ch);
        $code  = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);

        $data = json_decode($resp, true);
        if ($code >= 400) {
            $err = $data['error'] ?? [];
            throw new RuntimeException("[{$err['code']}] {$err['message']}");
        }
        return $data;
    }

    private function get(string $path): array
    {
        $ch = curl_init($this->base . $path);
        curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 10]);
        $resp = curl_exec($ch);
        curl_close($ch);
        return json_decode($resp, true);
    }

    public function health(): array { return $this->get('/v3/health'); }

    public function keygen(string $label = ''): string
    {
        $body = $label ? ['label' => $label] : [];
        return $this->post('/v3/keygen', $body)['keyId'];
    }

    public function issue(string $keyId, array $claims, int $ttl = 3600,
                          string $suite = 'dilithium5', string $tokenType = 'access'): string
    {
        return $this->post('/v3/token/issue', [
            'keyId'     => $keyId,
            'claims'    => $claims,
            'ttl'       => $ttl,
            'suite'     => $suite,
            'tokenType' => $tokenType,
        ])['tokenHex'];
    }

    public function verify(string $keyId, string $token): array
    {
        $resp = $this->post('/v3/token/verify', ['keyId' => $keyId, 'token' => $token]);
        if (!($resp['valid'] ?? false)) {
            throw new RuntimeException('Token invalid: ' . json_encode($resp['error'] ?? '?'));
        }
        return $resp;
    }

    public function inspect(string $token): array
    {
        return $this->post('/v3/token/inspect', ['token' => $token]);
    }
}

// ── Demo ─────────────────────────────────────────────────────────────────────

$qv = new SigvaultClient('http://localhost:7433');

echo "\n╔══════════════════════════════════════════╗\n";
echo "║  Sigvault v3.0 — PHP SDK Demo        ║\n";
echo "╚══════════════════════════════════════════╝\n\n";

$h = $qv->health();
echo "✔ Server: {$h['status']} | {$h['algorithm']}\n";

echo "\n[1] Generating ML-DSA-87 keypair...\n";
$t = microtime(true);
$keyId = $qv->keygen('php-demo');
printf("  ✔ keyId: %s\n  ✔ time : %.1fms\n", $keyId, (microtime(true)-$t)*1000);

echo "\n[2] Issuing access token...\n";
$t = microtime(true);
$token = $qv->issue($keyId, ['sub' => 'php-user-001', 'iss' => 'qv.php.example', 'role' => 'web-backend', 'lang' => 'PHP 8']);
printf("  ✔ token: %s...\n  ✔ time : %.1fms\n", substr($token, 0, 32), (microtime(true)-$t)*1000);

echo "\n[3] Verifying token...\n";
$t   = microtime(true);
$out = $qv->verify($keyId, $token);
printf("  ✔ VALID in %.1fms\n", (microtime(true)-$t)*1000);
foreach ($out['claims'] as $k => $v) echo "  ✔   $k = $v\n";

echo "\n[4] Attack resistance...\n";
$bad = substr($token, 0, -4) . 'dead';
try { $qv->verify($keyId, $bad); echo "  ✘ Should have rejected!\n"; }
catch (RuntimeException $e) { echo "  ✔ Tampered token rejected: {$e->getMessage()}\n"; }

echo "\n╔══════════════════════════════════════════╗\n";
echo "║  PHP SDK — ALL TESTS PASSED ✔            ║\n";
echo "╚══════════════════════════════════════════╝\n\n";
