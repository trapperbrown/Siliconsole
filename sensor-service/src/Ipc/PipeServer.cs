using System.Collections.Concurrent;
using System.IO.Pipes;
using System.Reflection;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Text.Json;
using System.Threading.Channels;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Siliconsole.SensorService.Generated;
using Siliconsole.SensorService.Telemetry;

namespace Siliconsole.SensorService.Ipc;

/// <summary>
/// Named pipe server. The only way data leaves the service: no TCP, and the pipe ACL allows only
/// SYSTEM, interactive users, and the service's own account. Remote clients are rejected by .NET.
/// </summary>
internal sealed class PipeServer(AppConfig cfg, ITelemetrySource source, ILogger<PipeServer> log) : BackgroundService
{
    private readonly ConcurrentDictionary<Session, byte> _sessions = new();
    private readonly SemaphoreSlim _slots = new(cfg.Ipc.MaxClients, cfg.Ipc.MaxClients);
    private readonly string _serviceVersion =
        Assembly.GetExecutingAssembly().GetName().Version?.ToString(3) ?? "0.0.0";

    public static byte[] Encode<T>(T message) => Framing.Frame(JsonSerializer.SerializeToUtf8Bytes(message, JsonOpts.Options));

    protected override async Task ExecuteAsync(CancellationToken ct)
    {
        // Serialize each broadcast once, then hand the same bytes to every session.
        source.FrameProduced += OnFrame;
        source.CatalogChanged += OnCatalog;
        log.LogInformation("Listening on pipe {Pipe}", cfg.Ipc.PipeName);
        var first = true;
        var sessions = new List<Task>();
        try
        {
            while (!ct.IsCancellationRequested)
            {
                await _slots.WaitAsync(ct);
                NamedPipeServerStream pipe;
                try
                {
                    pipe = CreatePipe(first);
                    first = false;
                    await pipe.WaitForConnectionAsync(ct);
                }
                catch
                {
                    _slots.Release();
                    throw;
                }
                sessions.RemoveAll(t => t.IsCompleted);
                sessions.Add(RunSessionAsync(pipe, ct));
            }
        }
        catch (OperationCanceledException) { }
        finally
        {
            source.FrameProduced -= OnFrame;
            source.CatalogChanged -= OnCatalog;
            await Task.WhenAll(sessions);
        }
    }

    private void OnFrame(SensorFrameMessage frame)
    {
        if (_sessions.IsEmpty) return;
        var bytes = Encode(frame);
        foreach (var s in _sessions.Keys) s.EnqueueBroadcast(bytes);
    }

    private void OnCatalog(SensorCatalogMessage catalog)
    {
        var bytes = Encode(catalog);
        foreach (var s in _sessions.Keys) s.EnqueueBroadcast(bytes);
    }

    private NamedPipeServerStream CreatePipe(bool first)
    {
        var security = new PipeSecurity();
        security.AddAccessRule(new PipeAccessRule(new SecurityIdentifier(WellKnownSidType.LocalSystemSid, null), PipeAccessRights.FullControl, AccessControlType.Allow));
        // ReadWrite deliberately excludes CreateNewInstance, so a user process cannot squat extra pipe instances.
        security.AddAccessRule(new PipeAccessRule(new SecurityIdentifier(WellKnownSidType.InteractiveSid, null), PipeAccessRights.ReadWrite, AccessControlType.Allow));
        // The service's own account (SYSTEM in production, the developer when run with --console).
        security.AddAccessRule(new PipeAccessRule(WindowsIdentity.GetCurrent().User!, PipeAccessRights.FullControl, AccessControlType.Allow));
        var options = PipeOptions.Asynchronous | (first ? PipeOptions.FirstPipeInstance : PipeOptions.None);
        return NamedPipeServerStreamAcl.Create(cfg.Ipc.PipeName, PipeDirection.InOut, cfg.Ipc.MaxClients,
            PipeTransmissionMode.Byte, options, cfg.Ipc.PipeBufferBytes, cfg.Ipc.PipeBufferBytes, security);
    }

    private async Task RunSessionAsync(NamedPipeServerStream pipe, CancellationToken ct)
    {
        using var cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
        var session = new Session(cfg.Ipc.ClientQueueCapacity);
        Task? writer = null;
        try
        {
            var hello = await HandshakeAsync(pipe, cts.Token);
            if (hello is null) return;
            await source.Ready.WaitAsync(cts.Token);

            writer = WriteLoopAsync(pipe, session, cts.Token);
            _sessions.TryAdd(session, 0);
            session.Start(Encode(ServiceHello()), Encode(new SystemInfoMessage { Info = source.GetSystemInfo() }), () => Encode(source.GetCatalog()));
            log.LogInformation("Client connected: {Client}", hello.Client);

            while (!cts.IsCancellationRequested)
            {
                var bytes = await Framing.ReadAsync(pipe, cfg.Ipc.MaxMessageBytes, cts.Token);
                if (bytes is null) break;
                Handle(bytes, session);
            }
        }
        catch (Exception e) when (e is IOException or InvalidDataException or OperationCanceledException or ObjectDisposedException)
        {
            log.LogDebug("Session ended: {Reason}", e.Message);
        }
        catch (Exception e)
        {
            log.LogError(e, "Session failed");
        }
        finally
        {
            _sessions.TryRemove(session, out _);
            session.Complete();
            await cts.CancelAsync();
            if (writer is not null) { try { await writer; } catch { /* already logged by the read side */ } }
            await pipe.DisposeAsync();
            _slots.Release();
        }
    }

    private async Task<ClientHello?> HandshakeAsync(NamedPipeServerStream pipe, CancellationToken ct)
    {
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
        timeout.CancelAfter(cfg.Ipc.HandshakeTimeoutMs);
        var bytes = await Framing.ReadAsync(pipe, cfg.Ipc.MaxMessageBytes, timeout.Token);
        if (bytes is null) return null;
        if (Parse(bytes) is not { } msg || msg.Type != "hello")
        {
            log.LogWarning("Rejected connection: first message was not a valid hello");
            return null;
        }
        var hello = msg.Element.Deserialize<ClientHello>(JsonOpts.Options)!;
        if (hello.ProtocolVersion != cfg.Ipc.ProtocolVersion)
        {
            log.LogWarning("Rejected client {Client}: protocol {Theirs}, service speaks {Ours}", hello.Client, hello.ProtocolVersion, cfg.Ipc.ProtocolVersion);
            // Tell the client which version we speak before closing, so it can show a useful error.
            await pipe.WriteAsync(Encode(ServiceHello()), ct);
            return null;
        }
        return hello;
    }

    private ServiceHello ServiceHello() => new()
    {
        ProtocolVersion = cfg.Ipc.ProtocolVersion,
        AppName = cfg.AppName,
        ServiceVersion = _serviceVersion,
        IntervalMs = source.IntervalMs,
        MinIntervalMs = cfg.Polling.MinIntervalMs,
        MaxIntervalMs = cfg.Polling.MaxIntervalMs,
        RingBufferSamples = cfg.RingBufferSamples,
    };

    private readonly record struct Parsed(string Type, JsonElement Element);

    /// <summary>Parses and schema-validates one inbound message. Logs and returns null on rejection.</summary>
    private Parsed? Parse(byte[] bytes)
    {
        JsonElement element;
        try
        {
            using var doc = JsonDocument.Parse(bytes);
            element = doc.RootElement.Clone();
        }
        catch (JsonException e)
        {
            log.LogWarning("Rejected message: invalid JSON ({Error})", e.Message);
            return null;
        }
        if (!MessageValidator.Instance.ValidateClient(element, out var error))
        {
            log.LogWarning("Rejected message: {Error}", error);
            return null;
        }
        return new Parsed(element.GetProperty("type").GetString()!, element);
    }

    private void Handle(byte[] bytes, Session session)
    {
        if (Parse(bytes) is not { } msg) return;
        switch (msg.Type)
        {
            case "history_request":
                var req = msg.Element.Deserialize<HistoryRequest>(JsonOpts.Options)!;
                session.Enqueue(Encode(source.GetHistory(req)));
                break;
            case "set_interval":
                var set = msg.Element.Deserialize<SetInterval>(JsonOpts.Options)!;
                try { source.SetInterval(set.IntervalMs); }
                catch (ArgumentOutOfRangeException e) { log.LogWarning("Rejected set_interval: {Error}", e.Message); }
                break;
            default:
                log.LogWarning("Rejected message: unexpected {Type} after handshake", msg.Type);
                break;
        }
    }

    private static async Task WriteLoopAsync(Stream pipe, Session session, CancellationToken ct)
    {
        await foreach (var bytes in session.Reader.ReadAllAsync(ct))
        {
            await pipe.WriteAsync(bytes, ct);
            await pipe.FlushAsync(ct);
        }
    }

    /// <summary>
    /// Per-client outbound queue. Bounded and drop-oldest so one stalled client cannot grow memory.
    /// Broadcasts are held back until the initial hello, system_info and catalog are queued.
    /// </summary>
    private sealed class Session(int capacity)
    {
        private readonly object _gate = new();
        private readonly Channel<byte[]> _queue = Channel.CreateBounded<byte[]>(
            new BoundedChannelOptions(capacity) { FullMode = BoundedChannelFullMode.DropOldest, SingleReader = true });
        private bool _started;

        public ChannelReader<byte[]> Reader => _queue.Reader;

        public void Start(byte[] hello, byte[] systemInfo, Func<byte[]> catalog)
        {
            lock (_gate)
            {
                _queue.Writer.TryWrite(hello);
                _queue.Writer.TryWrite(systemInfo);
                _queue.Writer.TryWrite(catalog()); // read under the lock so a concurrent catalog change is never lost
                _started = true;
            }
        }

        public void EnqueueBroadcast(byte[] bytes)
        {
            lock (_gate) { if (_started) _queue.Writer.TryWrite(bytes); }
        }

        public void Enqueue(byte[] bytes) => _queue.Writer.TryWrite(bytes);

        public void Complete() => _queue.Writer.TryComplete();
    }
}
