using LibreHardwareMonitor.Hardware;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Siliconsole.SensorService.Generated;
using Siliconsole.SensorService.SystemInfoCollection;
using SensorValue = Siliconsole.SensorService.Generated.SensorValue;

namespace Siliconsole.SensorService.Telemetry;

/// <summary>Owns the LibreHardwareMonitor <see cref="Computer"/>, polls it, and keeps the ring buffer.</summary>
internal sealed class HardwareMonitor : BackgroundService, ITelemetrySource
{
    private readonly AppConfig _cfg;
    private readonly ILogger _log;
    private readonly SampleHistory _history;
    private readonly TaskCompletionSource _ready = new(TaskCreationOptions.RunContinuationsAsynchronously);
    private Computer? _computer;
    private volatile ISensor[] _sensors = [];
    private volatile SensorCatalogMessage _catalog = new() { Hardware = [], Sensors = [] };
    private SystemInfo? _systemInfo;
    private float[] _scratch = [];
    private volatile int _intervalMs;
    private PeriodicTimer? _timer;

    public HardwareMonitor(AppConfig cfg, ILogger<HardwareMonitor> log)
    {
        _cfg = cfg;
        _log = log;
        _history = new SampleHistory(cfg.RingBufferSamples);
        _intervalMs = cfg.Polling.DefaultIntervalMs;
    }

    public Task Ready => _ready.Task;
    public int IntervalMs => _intervalMs;
    public event Action<SensorFrameMessage>? FrameProduced;
    public event Action<SensorCatalogMessage>? CatalogChanged;

    public SystemInfo GetSystemInfo() => _systemInfo ?? throw new InvalidOperationException("Not ready.");
    public SensorCatalogMessage GetCatalog() => _catalog;
    public HistoryResponse GetHistory(HistoryRequest r) => _history.Query(r.RequestId, r.Ids, r.MaxSamples);

    public void SetInterval(int intervalMs)
    {
        var p = _cfg.Polling;
        if (intervalMs < p.MinIntervalMs || intervalMs > p.MaxIntervalMs)
            throw new ArgumentOutOfRangeException(nameof(intervalMs), $"Allowed range is {p.MinIntervalMs} to {p.MaxIntervalMs} ms.");
        _intervalMs = intervalMs;
        if (_timer is not null) _timer.Period = TimeSpan.FromMilliseconds(intervalMs);
        _log.LogInformation("Polling interval set to {Interval} ms", intervalMs);
    }

    public void Open()
    {
        var g = _cfg.HardwareGroups;
        _computer = new Computer
        {
            IsCpuEnabled = g.Cpu,
            IsGpuEnabled = g.Gpu,
            IsMemoryEnabled = g.Memory,
            IsMotherboardEnabled = g.Motherboard,
            IsControllerEnabled = g.Controller,
            IsStorageEnabled = g.Storage,
            IsNetworkEnabled = g.Network,
            IsBatteryEnabled = g.Battery,
            IsPsuEnabled = g.Psu,
        };
        _computer.Open();
        UpdateAll();
        RebuildCatalog();
    }

    public SystemInfo CollectSystemInfo() => _systemInfo = SystemInfoCollector.Collect(_computer!, _log);

    public void UpdateAll()
    {
        foreach (var hw in _computer!.Hardware) Update(hw);
        static void Update(IHardware hw)
        {
            hw.Update();
            foreach (var sub in hw.SubHardware) Update(sub);
        }
    }

    /// <summary>Reads current sensor values into a frame and appends them to the ring buffer.</summary>
    public SensorFrameMessage BuildFrame()
    {
        var sensors = _sensors;
        if (_scratch.Length != sensors.Length) _scratch = new float[sensors.Length];
        var values = new SensorValue[sensors.Length];
        for (var i = 0; i < sensors.Length; i++)
        {
            var s = sensors[i];
            _scratch[i] = s.Value ?? float.NaN;
            values[i] = new SensorValue
            {
                Id = s.Identifier.ToString(),
                Value = SampleHistory.Sanitize(s.Value),
                Min = SampleHistory.Sanitize(s.Min),
                Max = SampleHistory.Sanitize(s.Max),
            };
        }
        var ts = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        _history.Append(ts, _scratch);
        return new SensorFrameMessage { Timestamp = ts, Values = values };
    }

    private IEnumerable<IHardware> AllHardware()
    {
        foreach (var hw in _computer!.Hardware)
        {
            yield return hw;
            foreach (var sub in hw.SubHardware) yield return sub;
        }
    }

    private int CountSensors() => AllHardware().Sum(h => h.Sensors.Length);

    private void RebuildCatalog()
    {
        var hardware = new List<HardwareEntry>();
        var sensors = new List<ISensor>();
        foreach (var hw in AllHardware())
        {
            hardware.Add(new HardwareEntry
            {
                Id = hw.Identifier.ToString(),
                Name = hw.Name,
                HardwareType = hw.HardwareType.ToString(),
                ParentId = hw.Parent?.Identifier.ToString(),
            });
            foreach (var s in hw.Sensors)
            {
                s.ValuesTimeWindow = TimeSpan.Zero; // we keep our own history; stop LHM's per-sensor list growing
                sensors.Add(s);
            }
        }
        _sensors = sensors.ToArray();
        _history.Reset(sensors.Select(s => s.Identifier.ToString()).ToList());
        _catalog = new SensorCatalogMessage
        {
            Hardware = hardware,
            Sensors = sensors.Select(s => new SensorEntry
            {
                Id = s.Identifier.ToString(),
                Name = s.Name,
                HardwareId = s.Hardware.Identifier.ToString(),
                SensorType = s.SensorType.ToString(),
                Index = s.Index,
            }).ToList(),
        };
        _log.LogInformation("Sensor catalog: {Hardware} hardware, {Sensors} sensors", hardware.Count, sensors.Count);
    }

    protected override async Task ExecuteAsync(CancellationToken ct)
    {
        await Task.Yield();
        try
        {
            Open();
            CollectSystemInfo();
            _ready.TrySetResult();
        }
        catch (Exception e)
        {
            _log.LogCritical(e, "Hardware monitor failed to start");
            _ready.TrySetException(e);
            throw;
        }

        _timer = new PeriodicTimer(TimeSpan.FromMilliseconds(_intervalMs));
        try
        {
            do
            {
                try { Tick(); }
                catch (Exception e) { _log.LogError(e, "Poll tick failed"); }
            } while (await _timer.WaitForNextTickAsync(ct));
        }
        catch (OperationCanceledException) { }
    }

    private void Tick()
    {
        UpdateAll();
        if (CountSensors() != _sensors.Length)
        {
            RebuildCatalog();
            CatalogChanged?.Invoke(_catalog);
        }
        FrameProduced?.Invoke(BuildFrame());
    }

    public override async Task StopAsync(CancellationToken ct)
    {
        await base.StopAsync(ct);
        Close();
    }

    public void Close()
    {
        _computer?.Close();
        _computer = null;
    }
}
