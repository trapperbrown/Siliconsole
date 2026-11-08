using System.Security.AccessControl;
using System.Security.Principal;
using Microsoft.Extensions.Logging;
using Siliconsole.SensorService.Generated;

namespace Siliconsole.SensorService;

/// <summary>Size-rotated text log under %ProgramData%. Falls back to no-op if the folder is not writable.</summary>
internal sealed class FileLogProvider : ILoggerProvider
{
    private readonly object _gate = new();
    private readonly string? _path;
    private readonly long _maxBytes;
    private readonly int _retained;
    private readonly LogLevel _minLevel;

    public FileLogProvider(AppConfig cfg)
    {
        _maxBytes = cfg.ServiceLog.MaxFileBytes;
        _retained = cfg.ServiceLog.RetainedFiles;
        _minLevel = Enum.Parse<LogLevel>(cfg.ServiceLog.MinLevel);
        try
        {
            var root = ConfigLoader.ProgramDataDir(cfg);
            if (WindowsIdentity.GetCurrent().IsSystem) Secure(root);
            var dir = Path.Combine(root, cfg.ServiceLog.Subfolder);
            RejectReparsePoint(Directory.CreateDirectory(dir));
            _path = Path.Combine(dir, cfg.ServiceLog.FileName);
            if (File.Exists(_path) && new FileInfo(_path).Attributes.HasFlag(FileAttributes.ReparsePoint))
                throw new IOException($"{_path} is a reparse point.");
            File.AppendAllText(_path, "");
        }
        catch (Exception e) when (e is UnauthorizedAccessException or IOException)
        {
            _path = null;
        }
    }

    /// <summary>
    /// ProgramData lets ordinary users create subfolders. Running as SYSTEM, lock our folder down
    /// (SYSTEM and Administrators write, Users read) so nobody can plant a junction and redirect our writes.
    /// </summary>
    private static void Secure(string dir)
    {
        var info = Directory.CreateDirectory(dir);
        RejectReparsePoint(info);
        var sec = new DirectorySecurity();
        sec.SetAccessRuleProtection(isProtected: true, preserveInheritance: false);
        sec.SetOwner(new SecurityIdentifier(WellKnownSidType.LocalSystemSid, null));
        const InheritanceFlags inherit = InheritanceFlags.ContainerInherit | InheritanceFlags.ObjectInherit;
        void Allow(WellKnownSidType sid, FileSystemRights rights) =>
            sec.AddAccessRule(new FileSystemAccessRule(new SecurityIdentifier(sid, null), rights, inherit, PropagationFlags.None, AccessControlType.Allow));
        Allow(WellKnownSidType.LocalSystemSid, FileSystemRights.FullControl);
        Allow(WellKnownSidType.BuiltinAdministratorsSid, FileSystemRights.FullControl);
        Allow(WellKnownSidType.BuiltinUsersSid, FileSystemRights.ReadAndExecute);
        info.SetAccessControl(sec);
    }

    private static void RejectReparsePoint(DirectoryInfo info)
    {
        if (info.Attributes.HasFlag(FileAttributes.ReparsePoint))
            throw new IOException($"{info.FullName} is a reparse point.");
    }

    public string? FilePath => _path;

    public ILogger CreateLogger(string categoryName) => new FileLogger(this, categoryName);

    public void Dispose() { }

    private void Write(string line)
    {
        if (_path is null) return;
        lock (_gate)
        {
            try
            {
                var info = new FileInfo(_path);
                if (info.Exists && info.Length > _maxBytes) Rotate();
                File.AppendAllText(_path, line + Environment.NewLine);
            }
            catch (IOException) { }
        }
    }

    private void Rotate()
    {
        for (var i = _retained - 1; i >= 1; i--)
        {
            var src = i == 1 ? _path! : $"{_path}.{i - 1}";
            var dst = $"{_path}.{i}";
            if (File.Exists(src)) File.Move(src, dst, overwrite: true);
        }
        if (_retained <= 1) File.Delete(_path!);
    }

    private sealed class FileLogger(FileLogProvider owner, string category) : ILogger
    {
        public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;
        public bool IsEnabled(LogLevel logLevel) => logLevel >= owner._minLevel && owner._path is not null;

        public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception? exception, Func<TState, Exception?, string> formatter)
        {
            if (!IsEnabled(logLevel)) return;
            var msg = $"{DateTime.Now:yyyy-MM-dd HH:mm:ss.fff} [{logLevel}] {category}: {formatter(state, exception)}";
            if (exception is not null) msg += Environment.NewLine + exception;
            owner.Write(msg);
        }
    }
}
