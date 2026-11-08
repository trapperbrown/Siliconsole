using System.Text.Json;
using Siliconsole.SensorService.Generated;

namespace Siliconsole.SensorService;

internal static class JsonOpts
{
    public static readonly JsonSerializerOptions Options = new(JsonSerializerDefaults.Web);
    public static readonly JsonSerializerOptions Indented = new(Options) { WriteIndented = true };
}

internal static class ConfigLoader
{
    public static AppConfig Load(string? path = null)
    {
        path ??= Path.Combine(AppContext.BaseDirectory, "defaults.json");
        var cfg = JsonSerializer.Deserialize<AppConfig>(File.ReadAllText(path), JsonOpts.Options)
            ?? throw new InvalidDataException($"Config at {path} is empty.");
        var p = cfg.Polling;
        if (p.MinIntervalMs > p.DefaultIntervalMs || p.DefaultIntervalMs > p.MaxIntervalMs)
            throw new InvalidDataException("polling.defaultIntervalMs must lie within [minIntervalMs, maxIntervalMs].");
        return cfg;
    }

    /// <summary>%ProgramData%\{programDataFolder}: the only place the service may write files.</summary>
    public static string ProgramDataDir(AppConfig cfg) =>
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), cfg.Service.ProgramDataFolder);
}
