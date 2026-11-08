using System.IO.Pipes;
using Microsoft.Extensions.Logging.Abstractions;
using Siliconsole.SensorService;
using Siliconsole.SensorService.Generated;
using Siliconsole.SensorService.Ipc;
using Siliconsole.SensorService.Telemetry;

namespace Siliconsole.SensorService.Tests;

/// <summary>Deterministic telemetry so the pipe server can be tested without hardware or elevation.</summary>
internal sealed class FakeTelemetrySource : ITelemetrySource
{
    private readonly SampleHistory _history = new(16);
    private long _tick;
    public FakeTelemetrySource() => _history.Reset(["/fake/0/temperature/0"]);

    public Task Ready => Task.CompletedTask;
    public int IntervalMs { get; private set; } = 1000;
    public void SetInterval(int intervalMs) => IntervalMs = intervalMs;
    public event Action<SensorFrameMessage>? FrameProduced;
    public event Action<SensorCatalogMessage>? CatalogChanged;

    public SystemInfo GetSystemInfo() => new()
    {
        CollectedAt = 1,
        Cpus = [new CpuInfo { Name = "Fake CPU", Vendor = "AMD", Codename = null, Family = 26, Model = 68, Stepping = 0, Socket = "AM5", Cores = 8, Threads = 16, BaseClockMhz = 4700, L1CacheKb = 640, L2CacheKb = 8192, L3CacheKb = 98304, TjMaxC = null, Microcode = null, InstructionSets = ["AVX2"] }],
        Board = new BoardInfo { Manufacturer = "Fake", Product = "Board", Version = null },
        Bios = new BiosInfo { Vendor = null, Version = "1.0", ReleaseDate = "2026-01-01" },
        Memory = new MemoryInfo { TotalBytes = 1024, SlotsTotal = 2, Modules = [] },
        Gpus = [],
        Storage = [],
        Os = new OsInfo { Name = "Windows", Version = "10.0", DisplayVersion = null, Build = null, Architecture = "64-bit", InstallDate = null, ComputerName = "PC" },
    };

    public SensorCatalogMessage GetCatalog() => new()
    {
        Hardware = [new HardwareEntry { Id = "/fake/0", Name = "Fake", HardwareType = "Cpu", ParentId = null }],
        Sensors = [new SensorEntry { Id = "/fake/0/temperature/0", Name = "Core", HardwareId = "/fake/0", SensorType = "Temperature", Index = 0 }],
    };

    public HistoryResponse GetHistory(HistoryRequest r) => _history.Query(r.RequestId, r.Ids, r.MaxSamples);

    public SensorFrameMessage MakeFrame()
    {
        var t = ++_tick;
        _history.Append(t, [40f + t]);
        return new SensorFrameMessage { Timestamp = t, Values = [new SensorValue { Id = "/fake/0/temperature/0", Value = 40 + t, Min = 41, Max = 40 + t }] };
    }

    public void Emit() => FrameProduced?.Invoke(MakeFrame());
    public void EmitCatalog() => CatalogChanged?.Invoke(GetCatalog());
}

public sealed class PipeServerTests : IAsyncLifetime
{
    private readonly AppConfig _cfg;
    private readonly FakeTelemetrySource _source = new();
    private readonly PipeServer _server;
    private readonly CancellationTokenSource _cts = new();
    private Task? _emitter;

    public PipeServerTests()
    {
        var baseCfg = ConfigLoader.Load(Path.Combine(AppContext.BaseDirectory, "defaults.json"));
        _cfg = baseCfg with { Ipc = baseCfg.Ipc with { PipeName = $"siliconsole-test-{Guid.NewGuid():N}" } };
        _server = new PipeServer(_cfg, _source, NullLogger<PipeServer>.Instance);
    }

    public async Task InitializeAsync()
    {
        await _server.StartAsync(default);
        _emitter = Task.Run(async () =>
        {
            while (!_cts.IsCancellationRequested) { _source.Emit(); await Task.Delay(20); }
        });
    }

    public async Task DisposeAsync()
    {
        await _cts.CancelAsync();
        await _emitter!;
        await _server.StopAsync(default);
    }

    [Fact]
    public async Task ClientReceivesSystemInfoCatalogAndTenFrames()
    {
        var r = await ProbeClient.RunAsync(_cfg.Ipc.PipeName, _cfg.Ipc.ProtocolVersion, 10, TimeSpan.FromSeconds(10), _cfg.Ipc.MaxMessageBytes);
        Assert.True(r.Hello);
        Assert.True(r.SystemInfo);
        Assert.True(r.Catalog);
        Assert.Equal(1, r.SensorCount);
        Assert.Equal(10, r.Frames);
        Assert.Empty(r.SchemaErrors);
    }

    [Fact]
    public async Task ReconnectingClientGetsAFreshHandshake()
    {
        for (var i = 0; i < 3; i++)
        {
            var r = await ProbeClient.RunAsync(_cfg.Ipc.PipeName, _cfg.Ipc.ProtocolVersion, 2, TimeSpan.FromSeconds(10), _cfg.Ipc.MaxMessageBytes);
            Assert.True(r.Hello && r.SystemInfo && r.Catalog && r.Frames == 2);
        }
    }

    [Fact]
    public async Task WrongProtocolVersionGetsServiceHelloThenDisconnect()
    {
        await using var c = await Connect();
        await c.WriteAsync(PipeServer.Encode(new ClientHello { ProtocolVersion = _cfg.Ipc.ProtocolVersion + 1, Client = "old" }));
        var first = await Framing.ReadAsync(c, _cfg.Ipc.MaxMessageBytes, Timeout());
        Assert.Contains("\"type\":\"hello\"", System.Text.Encoding.UTF8.GetString(first!));
        Assert.Null(await Framing.ReadAsync(c, _cfg.Ipc.MaxMessageBytes, Timeout()));
    }

    [Fact]
    public async Task InvalidFirstMessageIsRejected()
    {
        await using var c = await Connect();
        await c.WriteAsync(Framing.Frame("""{"type":"set_interval","intervalMs":500}"""u8));
        Assert.Null(await Framing.ReadAsync(c, _cfg.Ipc.MaxMessageBytes, Timeout()));
    }

    [Fact]
    public async Task RejectedMessagesKeepTheSessionAliveAndRequestsAreAnswered()
    {
        await using var c = await Connect();
        await c.WriteAsync(PipeServer.Encode(new ClientHello { ProtocolVersion = _cfg.Ipc.ProtocolVersion, Client = "t" }));
        await c.WriteAsync(Framing.Frame("""{"type":"format_disk"}"""u8));
        await c.WriteAsync(Framing.Frame("not json"u8));
        await c.WriteAsync(PipeServer.Encode(new SetInterval { IntervalMs = _cfg.Polling.MaxIntervalMs + 1 }));
        await c.WriteAsync(PipeServer.Encode(new SetInterval { IntervalMs = _cfg.Polling.MinIntervalMs }));
        await c.WriteAsync(PipeServer.Encode(new HistoryRequest { RequestId = 42, Ids = ["/fake/0/temperature/0"], MaxSamples = 3 }));

        var gotHistory = false;
        while (!gotHistory)
        {
            var msg = System.Text.Encoding.UTF8.GetString((await Framing.ReadAsync(c, _cfg.Ipc.MaxMessageBytes, Timeout()))!);
            gotHistory = msg.Contains("\"type\":\"history_response\"") && msg.Contains("\"requestId\":42");
        }
        Assert.Equal(_cfg.Polling.MinIntervalMs, _source.IntervalMs);
    }

    [Fact]
    public async Task CatalogChangesAreBroadcast()
    {
        await using var c = await Connect();
        await c.WriteAsync(PipeServer.Encode(new ClientHello { ProtocolVersion = _cfg.Ipc.ProtocolVersion, Client = "t" }));
        var catalogs = 0;
        while (catalogs < 2)
        {
            var msg = System.Text.Encoding.UTF8.GetString((await Framing.ReadAsync(c, _cfg.Ipc.MaxMessageBytes, Timeout()))!);
            if (msg.Contains("\"type\":\"sensor_catalog\""))
            {
                catalogs++;
                if (catalogs == 1) _source.EmitCatalog();
            }
        }
    }

    private async Task<NamedPipeClientStream> Connect()
    {
        var c = new NamedPipeClientStream(".", _cfg.Ipc.PipeName, PipeDirection.InOut, PipeOptions.Asynchronous);
        await c.ConnectAsync(Timeout());
        return c;
    }

    private static CancellationToken Timeout() => new CancellationTokenSource(TimeSpan.FromSeconds(10)).Token;
}
