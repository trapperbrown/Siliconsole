using System.IO.Pipes;
using System.Text.Json;
using Siliconsole.SensorService;
using Siliconsole.SensorService.Generated;
using Siliconsole.SensorService.Ipc;

// Connects to the running service and checks that system_info, sensor_catalog and N frames arrive.
// Usage: PipeProbe [--frames N] [--pipe name]
var cfg = ConfigLoader.Load();
var frames = args.SkipWhile(a => a != "--frames").Skip(1).Select(int.Parse).FirstOrDefault(10);
var pipe = args.SkipWhile(a => a != "--pipe").Skip(1).FirstOrDefault() ?? cfg.Ipc.PipeName;
var timeout = TimeSpan.FromMilliseconds(cfg.Polling.MaxIntervalMs * (frames + 2) + cfg.Ipc.HandshakeTimeoutMs);

var r = await ProbeClient.RunAsync(pipe, cfg.Ipc.ProtocolVersion, frames, timeout, cfg.Ipc.MaxMessageBytes);
Console.WriteLine($"hello={r.Hello} system_info={r.SystemInfo} sensor_catalog={r.Catalog} (sensors={r.SensorCount}) sensor_frame={r.Frames} schema_errors={r.SchemaErrors.Count}");
foreach (var e in r.SchemaErrors) Console.WriteLine($"  schema error: {e}");
var ok = r.SystemInfo && r.Catalog && r.Frames >= frames && r.SchemaErrors.Count == 0;
Console.WriteLine(ok ? "PASS" : "FAIL");
return ok ? 0 : 1;

public sealed record ProbeResult(bool Hello, bool SystemInfo, bool Catalog, int SensorCount, int Frames, List<string> SchemaErrors);

public static class ProbeClient
{
    /// <summary>Handshakes, then reads until N frames arrive or the timeout hits. Every message is schema-checked.</summary>
    public static async Task<ProbeResult> RunAsync(string pipeName, int protocolVersion, int frames, TimeSpan timeout, int maxBytes)
    {
        using var cts = new CancellationTokenSource(timeout);
        await using var client = new NamedPipeClientStream(".", pipeName, PipeDirection.InOut, PipeOptions.Asynchronous);
        await client.ConnectAsync(cts.Token);
        await client.WriteAsync(PipeServer.Encode(new ClientHello { ProtocolVersion = protocolVersion, Client = "PipeProbe" }), cts.Token);

        bool hello = false, info = false, catalog = false;
        int sensors = 0, frameCount = 0;
        var errors = new List<string>();
        try
        {
            while (frameCount < frames)
            {
                var bytes = await Framing.ReadAsync(client, maxBytes, cts.Token);
                if (bytes is null) break;
                using var doc = JsonDocument.Parse(bytes);
                if (!MessageValidator.Instance.ValidateService(doc.RootElement, out var err)) errors.Add(err!);
                switch (doc.RootElement.GetProperty("type").GetString())
                {
                    case "hello": hello = true; break;
                    case "system_info": info = true; break;
                    case "sensor_catalog": catalog = true; sensors = doc.RootElement.GetProperty("sensors").GetArrayLength(); break;
                    case "sensor_frame": frameCount++; break;
                }
            }
        }
        catch (OperationCanceledException) { }
        return new ProbeResult(hello, info, catalog, sensors, frameCount, errors);
    }
}
