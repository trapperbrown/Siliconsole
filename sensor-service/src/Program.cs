using System.Text.Json;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Hosting.WindowsServices;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;
using Siliconsole.SensorService;
using Siliconsole.SensorService.Ipc;
using Siliconsole.SensorService.Telemetry;

var cfg = ConfigLoader.Load();

if (args.Contains("--dump"))
{
    // Prints the catalog, one frame and the static system info as JSON, then exits.
    var monitor = new HardwareMonitor(cfg, NullLogger<HardwareMonitor>.Instance);
    monitor.Open();
    Thread.Sleep(cfg.Polling.DefaultIntervalMs); // load and rate sensors need two samples
    monitor.UpdateAll();
    var dump = new { catalog = monitor.GetCatalog(), frame = monitor.BuildFrame(), systemInfo = monitor.CollectSystemInfo() };
    Console.OutputEncoding = System.Text.Encoding.UTF8;
    Console.WriteLine(JsonSerializer.Serialize(dump, JsonOpts.Indented));
    monitor.Close();
    return 0;
}

var builder = Host.CreateApplicationBuilder(args);
builder.Services.AddWindowsService(o => o.ServiceName = cfg.Service.Name);
builder.Logging.ClearProviders();
var fileLog = new FileLogProvider(cfg);
builder.Logging.AddProvider(fileLog);
if (args.Contains("--console") || !WindowsServiceHelpers.IsWindowsService())
    builder.Logging.AddSimpleConsole(o => o.TimestampFormat = "HH:mm:ss ");

builder.Services.AddSingleton(cfg);
builder.Services.AddSingleton<HardwareMonitor>();
builder.Services.AddSingleton<ITelemetrySource>(sp => sp.GetRequiredService<HardwareMonitor>());
builder.Services.AddHostedService(sp => sp.GetRequiredService<HardwareMonitor>());
builder.Services.AddHostedService<PipeServer>();

var host = builder.Build();
host.Services.GetRequiredService<ILogger<HardwareMonitor>>()
    .LogInformation("{App} sensor service starting, log file: {Log}", cfg.AppName, fileLog.FilePath ?? "(none)");
host.Run();
return 0;
