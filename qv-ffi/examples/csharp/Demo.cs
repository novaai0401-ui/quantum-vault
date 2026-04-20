/*
 * QuantumVault v4.0 - C# DllImport Demo
 * =======================================
 * Calls qv.dll directly via P/Invoke. NO HTTP. NO NuGet packages.
 *
 * Build:
 *   dotnet new console -n qv-csharp-demo
 *   copy Demo.cs qv-csharp-demo\Program.cs
 *   copy ..\..\..\target\release\qv.dll qv-csharp-demo\
 *   cd qv-csharp-demo && dotnet run -c Release
 */
using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;

internal static class Qv {
    const string LIB = "qv";
    [DllImport(LIB)] public static extern uint qv_abi_version();
    [DllImport(LIB)] public static extern uint qv_vk_len();
    [DllImport(LIB)] public static extern uint qv_sk_len();
    [DllImport(LIB)] public static extern uint qv_sig_len();
    [DllImport(LIB)] public static extern int  qv_keygen(byte[] sk, uint sk_len, byte[] vk, uint vk_len);
    [DllImport(LIB)] public static extern int  qv_sign  (byte[] sk, uint sk_len, byte[] msg, uint msg_len, byte[] sig, uint sig_cap);
    [DllImport(LIB)] public static extern int  qv_verify(byte[] vk, uint vk_len, byte[] msg, uint msg_len, byte[] sig, uint sig_len);
}

internal class Program {
    static int Main() {
        Console.WriteLine("\n================================================");
        Console.WriteLine("  QuantumVault v4.0 -- C# FFI Demo");
        Console.WriteLine("  P/Invoke | NO HTTP | NO NuGet");
        Console.WriteLine("================================================\n");
        Console.WriteLine($"ABI version: {Qv.qv_abi_version()}");
        uint SK = Qv.qv_sk_len(), VK = Qv.qv_vk_len(), SIG = Qv.qv_sig_len();
        Console.WriteLine($"Sizes      : sk={SK} vk={VK} sig={SIG}\n");

        byte[] sk = new byte[SK], vk = new byte[VK], sig = new byte[SIG];
        byte[] msg = Encoding.UTF8.GetBytes("QuantumVault sovereign -- C# says hi");

        var sw = Stopwatch.StartNew();
        if (Qv.qv_keygen(sk, SK, vk, VK) != 0) { Console.WriteLine("keygen FAILED"); return 1; }
        Console.WriteLine($"[1] Keygen : {sw.Elapsed.TotalMilliseconds,6:F2} ms   vk[0:4]={vk[0]:x2}{vk[1]:x2}{vk[2]:x2}{vk[3]:x2}");

        sw.Restart();
        if (Qv.qv_sign(sk, SK, msg, (uint)msg.Length, sig, SIG) != 0) { Console.WriteLine("sign FAILED"); return 1; }
        Console.WriteLine($"[2] Sign   : {sw.Elapsed.TotalMilliseconds,6:F2} ms");

        sw.Restart();
        if (Qv.qv_verify(vk, VK, msg, (uint)msg.Length, sig, SIG) != 1) { Console.WriteLine("verify FAILED"); return 1; }
        Console.WriteLine($"[3] Verify : {sw.Elapsed.TotalMilliseconds,6:F2} ms   VALID [OK]");

        sig[100] ^= 0xFF;
        if (Qv.qv_verify(vk, VK, msg, (uint)msg.Length, sig, SIG) != 0) { Console.WriteLine("tamper not rejected"); return 1; }
        sig[100] ^= 0xFF;
        Console.WriteLine("[4] Tamper :    -      REJECTED [OK]");

        const int N = 100;
        sw.Restart();
        for (int i = 0; i < N; i++) Qv.qv_verify(vk, VK, msg, (uint)msg.Length, sig, SIG);
        double dur = sw.Elapsed.TotalMilliseconds;
        Console.WriteLine($"[5] Bench  : {N} verifies in {dur:F1} ms -> {dur/N:F2} ms/verify ({N/dur*1000:F0}/s)");

        Console.WriteLine("\n================================================");
        Console.WriteLine("  C# FFI -- ALL TESTS PASSED [OK]");
        Console.WriteLine("================================================\n");
        return 0;
    }
}
