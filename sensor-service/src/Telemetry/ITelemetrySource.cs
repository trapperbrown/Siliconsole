using Siliconsole.SensorService.Generated;

namespace Siliconsole.SensorService.Telemetry;

/// <summary>What the pipe server needs from the hardware side. Lets tests run without real hardware.</summary>
internal interface ITelemetrySource
{
    /// <summary>Completes once the catalog and system info are available.</summary>
    Task Ready { get; }
    int IntervalMs { get; }
    void SetInterval(int intervalMs);
    SystemInfo GetSystemInfo();
    SensorCatalogMessage GetCatalog();
    HistoryResponse GetHistory(HistoryRequest request);
    event Action<SensorFrameMessage>? FrameProduced;
    event Action<SensorCatalogMessage>? CatalogChanged;
}
