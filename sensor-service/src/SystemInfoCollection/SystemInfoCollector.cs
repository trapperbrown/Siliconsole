using System.Globalization;
using System.Management;
using System.Reflection;
using System.Text.Json;
using LibreHardwareMonitor.Hardware;
using LibreHardwareMonitor.Hardware.Cpu;
using Microsoft.Extensions.Logging;
using Microsoft.Win32;
using Siliconsole.SensorService.Generated;

namespace Siliconsole.SensorService.SystemInfoCollection;

/// <summary>Static "CPU-Z side" snapshot. Every collector is best effort: a failure yields nulls, not a crash.</summary>
internal static class SystemInfoCollector
{
    private sealed record CodenameEntry(string Vendor, int Family, int Model, string Codename);

    private sealed record HardwareData(
        Dictionary<string, string> PciVendors,
        Dictionary<string, string> MemoryTypes,
        Dictionary<string, string> MemoryFormFactors,
        Dictionary<string, string> BusTypes,
        Dictionary<string, string> MediaTypes,
        Dictionary<string, string> HealthStatus,
        List<CodenameEntry> CpuCodenames);

    private static readonly Lazy<HardwareData> Data = new(() =>
    {
        using var s = Assembly.GetExecutingAssembly().GetManifestResourceStream("hardware-data.json")!;
        return JsonSerializer.Deserialize<HardwareData>(s, JsonOpts.Options)!;
    });

    public static SystemInfo Collect(IComputer computer, ILogger log)
    {
        var hardware = new List<IHardware>();
        foreach (var hw in computer.Hardware) { hardware.Add(hw); hardware.AddRange(hw.SubHardware); }

        T Try<T>(string what, Func<T> f, T fallback)
        {
            try { return f(); }
            catch (Exception e) { log.LogWarning(e, "System info: {What} failed", what); return fallback; }
        }

        return new SystemInfo
        {
            CollectedAt = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
            Cpus = Try("cpu", () => Cpus(hardware), []),
            Board = Try("board", Board, new BoardInfo { Manufacturer = null, Product = null, Version = null }),
            Bios = Try("bios", Bios, new BiosInfo { Vendor = null, Version = null, ReleaseDate = null }),
            Memory = Try("memory", Memory, new MemoryInfo { TotalBytes = 0, SlotsTotal = null, Modules = [] }),
            Gpus = Try("gpu", () => Gpus(hardware), []),
            Storage = Try("storage", () => Storage(hardware), []),
            Os = Try("os", Os, new OsInfo { Name = null, Version = null, DisplayVersion = null, Build = null, Architecture = null, InstallDate = null, ComputerName = null }),
        };
    }

    private static List<ManagementObject> Wmi(string query, string scope = @"root\cimv2")
    {
        using var searcher = new ManagementObjectSearcher(scope, query);
        return searcher.Get().Cast<ManagementObject>().ToList();
    }

    private static string? Str(ManagementBaseObject o, string prop) =>
        o[prop]?.ToString()?.Trim() is { Length: > 0 } s ? s : null;

    private static long Long(ManagementBaseObject o, string prop) =>
        o[prop] is { } v ? Convert.ToInt64(v, CultureInfo.InvariantCulture) : 0;

    private static int? Int(ManagementBaseObject o, string prop) =>
        o[prop] is { } v ? Convert.ToInt32(v, CultureInfo.InvariantCulture) : null;

    private static string? CimDate(ManagementBaseObject o, string prop) =>
        Str(o, prop) is { } s ? ManagementDateTimeConverter.ToDateTime(s).ToString("yyyy-MM-dd", CultureInfo.InvariantCulture) : null;

    private static string? Lookup(Dictionary<string, string> map, object? key) =>
        key is not null && map.TryGetValue(Convert.ToString(key, CultureInfo.InvariantCulture)!, out var v) ? v : null;

    // ---------- CPU ----------
    private static List<CpuInfo> Cpus(List<IHardware> hardware)
    {
        var wmi = Wmi("SELECT Name, NumberOfCores, NumberOfLogicalProcessors, MaxClockSpeed, L2CacheSize, L3CacheSize, SocketDesignation FROM Win32_Processor");
        var l1Kb = Wmi("SELECT InstalledSize, Purpose FROM Win32_CacheMemory")
            .Where(c => Str(c, "Purpose")?.Contains("L1", StringComparison.OrdinalIgnoreCase) == true)
            .Sum(c => Long(c, "InstalledSize"));
        var cpus = hardware.OfType<GenericCpu>().ToList();
        var result = new List<CpuInfo>();
        for (var i = 0; i < Math.Max(cpus.Count, wmi.Count); i++)
        {
            var lhm = i < cpus.Count ? cpus[i] : null;
            var w = i < wmi.Count ? wmi[i] : null;
            var id = lhm?.CpuId.FirstOrDefault()?.FirstOrDefault();
            var vendor = id?.Vendor.ToString() ?? "Unknown";
            var family = (int)(id?.Family ?? 0);
            var model = (int)(id?.Model ?? 0);
            result.Add(new CpuInfo
            {
                Name = lhm?.Name ?? (w is null ? "Unknown" : Str(w, "Name") ?? "Unknown"),
                Vendor = vendor,
                Codename = Data.Value.CpuCodenames.FirstOrDefault(c => c.Vendor == vendor && c.Family == family && c.Model == model)?.Codename,
                Family = family,
                Model = model,
                Stepping = (int)(id?.Stepping ?? 0),
                Socket = w is null ? null : Str(w, "SocketDesignation"),
                Cores = w is null ? lhm?.CpuId.Length ?? 0 : Int(w, "NumberOfCores") ?? 0,
                Threads = w is null ? lhm?.CpuId.Sum(c => c.Length) ?? 0 : Int(w, "NumberOfLogicalProcessors") ?? 0,
                BaseClockMhz = w is null ? null : Int(w, "MaxClockSpeed"),
                L1CacheKb = l1Kb > 0 && i == 0 ? (int)l1Kb : null,
                L2CacheKb = w is null ? null : Int(w, "L2CacheSize"),
                L3CacheKb = w is null ? null : Int(w, "L3CacheSize"),
                TjMaxC = lhm is null ? null : TjMax(lhm),
                Microcode = Microcode(),
                InstructionSets = id is null ? [] : InstructionSets(id),
            });
        }
        return result;
    }

    /// <summary>Intel exposes "Distance to TjMax"; TjMax = core temp + distance. Null when unavailable (most AMD parts).</summary>
    private static double? TjMax(IHardware cpu)
    {
        var temps = cpu.Sensors.Where(s => s.SensorType == SensorType.Temperature).ToList();
        foreach (var d in temps.Where(s => s.Name.StartsWith("Distance to TjMax", StringComparison.OrdinalIgnoreCase)))
        {
            var core = temps.FirstOrDefault(s => s.Index == d.Index && s != d && !s.Name.StartsWith("Distance", StringComparison.OrdinalIgnoreCase));
            if (core?.Value is { } t && d.Value is { } dist) return Math.Round(t + dist);
        }
        return null;
    }

    private static string? Microcode()
    {
        using var key = Registry.LocalMachine.OpenSubKey(@"HARDWARE\DESCRIPTION\System\CentralProcessor\0");
        if (key?.GetValue("Update Revision") is not byte[] { Length: >= 8 } b) return null;
        var rev = BitConverter.ToUInt32(b, 4);
        if (rev == 0) rev = BitConverter.ToUInt32(b, 0);
        return rev == 0 ? null : $"0x{rev:X}";
    }

    private static List<string> InstructionSets(CpuId id)
    {
        var sets = new List<string>();
        uint Reg(uint[,] data, int leaf, int reg) => data.GetLength(0) > leaf ? data[leaf, reg] : 0;
        bool Bit(uint value, int bit) => (value & (1u << bit)) != 0;
        const int Ebx = 1, Ecx = 2, Edx = 3;
        var d = id.Data;
        uint ecx1 = Reg(d, 1, Ecx), edx1 = Reg(d, 1, Edx), ebx7 = Reg(d, 7, Ebx), edx81 = Reg(id.ExtData, 1, Edx);
        void Add(bool has, string name) { if (has) sets.Add(name); }
        Add(Bit(edx1, 23), "MMX");
        Add(Bit(edx1, 25), "SSE");
        Add(Bit(edx1, 26), "SSE2");
        Add(Bit(ecx1, 0), "SSE3");
        Add(Bit(ecx1, 9), "SSSE3");
        Add(Bit(ecx1, 19), "SSE4.1");
        Add(Bit(ecx1, 20), "SSE4.2");
        Add(Bit(edx81, 29), "x86-64");
        Add(Bit(ecx1, 25), "AES");
        Add(Bit(ecx1, 28), "AVX");
        Add(Bit(ebx7, 5), "AVX2");
        Add(Bit(ebx7, 16), "AVX-512F");
        Add(Bit(ecx1, 12), "FMA3");
        Add(Bit(ebx7, 29), "SHA");
        Add(Bit(ecx1, 5), "VT-x");
        return sets;
    }

    // ---------- Board / BIOS ----------
    private static BoardInfo Board()
    {
        var b = Wmi("SELECT Manufacturer, Product, Version FROM Win32_BaseBoard").FirstOrDefault();
        return new BoardInfo
        {
            Manufacturer = b is null ? null : Str(b, "Manufacturer"),
            Product = b is null ? null : Str(b, "Product"),
            Version = b is null ? null : Str(b, "Version"),
        };
    }

    private static BiosInfo Bios()
    {
        var b = Wmi("SELECT Manufacturer, SMBIOSBIOSVersion, ReleaseDate FROM Win32_BIOS").FirstOrDefault();
        return new BiosInfo
        {
            Vendor = b is null ? null : Str(b, "Manufacturer"),
            Version = b is null ? null : Str(b, "SMBIOSBIOSVersion"),
            ReleaseDate = b is null ? null : CimDate(b, "ReleaseDate"),
        };
    }

    // ---------- Memory ----------
    private static MemoryInfo Memory()
    {
        var modules = Wmi("SELECT DeviceLocator, BankLabel, Capacity, Speed, ConfiguredClockSpeed, Manufacturer, PartNumber, FormFactor, SMBIOSMemoryType FROM Win32_PhysicalMemory")
            .Select(m => new MemoryModule
            {
                Slot = Str(m, "DeviceLocator"),
                Bank = Str(m, "BankLabel"),
                CapacityBytes = Long(m, "Capacity"),
                SpeedMts = Int(m, "Speed"),
                ConfiguredSpeedMts = Int(m, "ConfiguredClockSpeed"),
                Manufacturer = Str(m, "Manufacturer"),
                PartNumber = Str(m, "PartNumber"),
                FormFactor = Lookup(Data.Value.MemoryFormFactors, m["FormFactor"]),
                MemoryType = Lookup(Data.Value.MemoryTypes, m["SMBIOSMemoryType"]),
            }).ToList();
        var slots = Wmi("SELECT MemoryDevices FROM Win32_PhysicalMemoryArray").Sum(a => Long(a, "MemoryDevices"));
        return new MemoryInfo { TotalBytes = modules.Sum(m => m.CapacityBytes), SlotsTotal = slots > 0 ? (int)slots : null, Modules = modules };
    }

    // ---------- GPU ----------
    private static List<GpuInfo> Gpus(List<IHardware> hardware)
    {
        var controllers = Wmi("SELECT Name, DriverVersion, DriverDate, PNPDeviceID FROM Win32_VideoController");
        var lhmGpus = hardware.Where(h => h.HardwareType is HardwareType.GpuNvidia or HardwareType.GpuAmd or HardwareType.GpuIntel).ToList();
        return Dxgi.EnumerateAdapters().Select(a =>
        {
            var tag = $"VEN_{a.VendorId:X4}&DEV_{a.DeviceId:X4}";
            var wmi = controllers.FirstOrDefault(c => Str(c, "PNPDeviceID")?.Contains(tag, StringComparison.OrdinalIgnoreCase) == true);
            var vendor = Lookup(Data.Value.PciVendors, a.VendorId.ToString("X4"));
            var driver = wmi is null ? null : Str(wmi, "DriverVersion");
            return new GpuInfo
            {
                Name = a.Description,
                Vendor = vendor,
                DedicatedVideoMemoryBytes = a.DedicatedVideoMemory,
                SharedSystemMemoryBytes = a.SharedSystemMemory,
                DriverVersion = FormatDriver(a.VendorId, driver),
                DriverDate = wmi is null ? null : CimDate(wmi, "DriverDate"),
                HardwareId = lhmGpus.FirstOrDefault(h => SameName(h.Name, a.Description))?.Identifier.ToString(),
            };
        }).ToList();
    }

    private const uint NvidiaVendorId = 0x10DE;

    /// <summary>NVIDIA's marketing version is the last 5 digits of the Windows driver version: 32.0.15.8180 is 581.80.</summary>
    internal static string? FormatDriver(uint vendorId, string? version)
    {
        if (version is null || vendorId != NvidiaVendorId) return version;
        var parts = version.Split('.');
        if (parts.Length != 4) return version;
        var digits = parts[2] + parts[3];
        if (digits.Length < 5) return version;
        var tail = digits[^5..];
        return $"{tail[..3]}.{tail[3..]} ({version})";
    }

    private static bool SameName(string a, string b) =>
        a.Contains(b, StringComparison.OrdinalIgnoreCase) || b.Contains(a, StringComparison.OrdinalIgnoreCase);

    // ---------- Storage ----------
    private static List<StorageInfo> Storage(List<IHardware> hardware)
    {
        var lhmDisks = hardware.Where(h => h.HardwareType == HardwareType.Storage).ToList();
        return Wmi("SELECT FriendlyName, FirmwareVersion, BusType, MediaType, Size, HealthStatus FROM MSFT_PhysicalDisk", @"root\Microsoft\Windows\Storage")
            .Select(d =>
            {
                var model = Str(d, "FriendlyName") ?? "Unknown";
                return new StorageInfo
                {
                    Model = model,
                    Firmware = Str(d, "FirmwareVersion"),
                    Interface = Lookup(Data.Value.BusTypes, d["BusType"]),
                    MediaType = Lookup(Data.Value.MediaTypes, d["MediaType"]),
                    SizeBytes = Long(d, "Size"),
                    Health = Lookup(Data.Value.HealthStatus, d["HealthStatus"]),
                    HardwareId = lhmDisks.FirstOrDefault(h => SameName(h.Name, model))?.Identifier.ToString(),
                };
            }).ToList();
    }

    // ---------- OS ----------
    private static OsInfo Os()
    {
        var o = Wmi("SELECT Caption, Version, BuildNumber, OSArchitecture, InstallDate, CSName FROM Win32_OperatingSystem").FirstOrDefault();
        using var key = Registry.LocalMachine.OpenSubKey(@"SOFTWARE\Microsoft\Windows NT\CurrentVersion");
        var ubr = key?.GetValue("UBR");
        var build = o is null ? null : Str(o, "BuildNumber");
        return new OsInfo
        {
            Name = o is null ? null : Str(o, "Caption"),
            Version = o is null ? null : Str(o, "Version"),
            DisplayVersion = key?.GetValue("DisplayVersion") as string,
            Build = build is not null && ubr is not null ? $"{build}.{ubr}" : build,
            Architecture = o is null ? null : Str(o, "OSArchitecture"),
            InstallDate = o is null ? null : CimDate(o, "InstallDate"),
            ComputerName = o is null ? null : Str(o, "CSName"),
        };
    }
}
