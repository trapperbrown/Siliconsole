using System.Text.Json;
using System.Text.RegularExpressions;

namespace Siliconsole.SensorService.Ipc;

/// <summary>
/// Minimal JSON Schema validator for the subset used in shared/schemas (same subset and behavior as
/// desktop/src/lib/validate.ts): type incl. nullable arrays, properties, required, additionalProperties,
/// enum, const, items, min/maxItems, min/maxLength, minimum/maximum/exclusiveMinimum, pattern, oneOf, local $ref.
/// </summary>
internal sealed class SchemaValidator(JsonElement root)
{
    private const int MaxErrors = 10;

    public List<string> Validate(JsonElement value, string? def = null)
    {
        var errors = new List<string>();
        Check(def is null ? root : root.GetProperty("$defs").GetProperty(def), value, "$", errors);
        return errors.Take(MaxErrors).ToList();
    }

    private JsonElement Resolve(string reference)
    {
        if (!reference.StartsWith("#/")) throw new NotSupportedException($"Unsupported $ref {reference}");
        var node = root;
        foreach (var part in reference[2..].Split('/')) node = node.GetProperty(part);
        return node;
    }

    private static string TypeOf(JsonElement v) => v.ValueKind switch
    {
        JsonValueKind.Null => "null",
        JsonValueKind.Array => "array",
        JsonValueKind.Object => "object",
        JsonValueKind.String => "string",
        JsonValueKind.True or JsonValueKind.False => "boolean",
        JsonValueKind.Number => v.TryGetInt64(out _) || (v.TryGetDouble(out var d) && d == Math.Floor(d)) ? "integer" : "number",
        _ => "undefined",
    };

    private static bool Has(JsonElement s, string key, out JsonElement value) => s.TryGetProperty(key, out value);

    private void Check(JsonElement s, JsonElement v, string path, List<string> errors)
    {
        if (Has(s, "$ref", out var r)) { Check(Resolve(r.GetString()!), v, path, errors); return; }
        if (Has(s, "oneOf", out var oneOf))
        {
            var passing = oneOf.EnumerateArray().Count(sub => { var e = new List<string>(); Check(sub, v, path, e); return e.Count == 0; });
            if (passing != 1) errors.Add($"{path}: must match exactly one allowed shape");
            return;
        }
        if (Has(s, "const", out var c) && !JsonElement.DeepEquals(c, v)) errors.Add($"{path}: must be {c.GetRawText()}");
        if (Has(s, "enum", out var en) && !en.EnumerateArray().Any(x => JsonElement.DeepEquals(x, v))) errors.Add($"{path}: not an allowed value");
        if (Has(s, "type", out var type))
        {
            var types = type.ValueKind == JsonValueKind.Array ? type.EnumerateArray().Select(t => t.GetString()!).ToList() : [type.GetString()!];
            var actual = TypeOf(v);
            if (!types.Contains(actual) && !(actual == "integer" && types.Contains("number")))
            {
                errors.Add($"{path}: expected {string.Join(" or ", types)}, got {actual}");
                return;
            }
        }
        switch (v.ValueKind)
        {
            case JsonValueKind.Number:
                var n = v.GetDouble();
                if (Has(s, "minimum", out var min) && n < min.GetDouble()) errors.Add($"{path}: below {min}");
                if (Has(s, "maximum", out var max) && n > max.GetDouble()) errors.Add($"{path}: above {max}");
                if (Has(s, "exclusiveMinimum", out var xmin) && n <= xmin.GetDouble()) errors.Add($"{path}: must exceed {xmin}");
                break;
            case JsonValueKind.String:
                var str = v.GetString()!;
                if (Has(s, "minLength", out var minL) && str.Length < minL.GetInt32()) errors.Add($"{path}: too short");
                if (Has(s, "maxLength", out var maxL) && str.Length > maxL.GetInt32()) errors.Add($"{path}: too long");
                if (Has(s, "pattern", out var pat) && !Regex.IsMatch(str, pat.GetString()!)) errors.Add($"{path}: does not match {pat}");
                break;
            case JsonValueKind.Array:
                var len = v.GetArrayLength();
                if (Has(s, "minItems", out var minI) && len < minI.GetInt32()) errors.Add($"{path}: needs at least {minI} items");
                if (Has(s, "maxItems", out var maxI) && len > maxI.GetInt32()) errors.Add($"{path}: allows at most {maxI} items");
                if (Has(s, "items", out var items))
                {
                    var i = 0;
                    foreach (var item in v.EnumerateArray()) Check(items, item, $"{path}[{i++}]", errors);
                }
                break;
            case JsonValueKind.Object:
                if (Has(s, "required", out var req))
                    foreach (var key in req.EnumerateArray())
                        if (!v.TryGetProperty(key.GetString()!, out _)) errors.Add($"{path}: missing {key.GetString()}");
                Has(s, "properties", out var props);
                var hasAdditional = Has(s, "additionalProperties", out var additional);
                foreach (var p in v.EnumerateObject())
                {
                    if (props.ValueKind == JsonValueKind.Object && props.TryGetProperty(p.Name, out var ps)) Check(ps, p.Value, $"{path}.{p.Name}", errors);
                    else if (hasAdditional && additional.ValueKind == JsonValueKind.False) errors.Add($"{path}: unknown property {p.Name}");
                    else if (hasAdditional && additional.ValueKind == JsonValueKind.Object) Check(additional, p.Value, $"{path}.{p.Name}", errors);
                }
                break;
        }
    }
}
