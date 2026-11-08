using System.Reflection;
using System.Text.Json;

namespace Siliconsole.SensorService.Ipc;

/// <summary>Validates messages against shared/schemas/protocol.schema.json (embedded at build time).</summary>
internal sealed class MessageValidator
{
    public static readonly MessageValidator Instance = new();

    private readonly SchemaValidator _schema;

    private MessageValidator()
    {
        using var s = Assembly.GetExecutingAssembly().GetManifestResourceStream("protocol.schema.json")!;
        _schema = new SchemaValidator(JsonDocument.Parse(s).RootElement.Clone());
    }

    public bool ValidateClient(JsonElement message, out string? error) => Validate("ClientMessage", message, out error);

    public bool ValidateService(JsonElement message, out string? error) => Validate("ServiceMessage", message, out error);

    private bool Validate(string def, JsonElement message, out string? error)
    {
        var errors = _schema.Validate(message, def);
        error = errors.Count == 0 ? null : string.Join("; ", errors);
        return errors.Count == 0;
    }
}
