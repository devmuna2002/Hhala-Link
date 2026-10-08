const jsonColumns = new Set([
    "vehicle_details",
    "vehicle_photos",
    "features",
    "images",
    "amenities",
    "service_areas",
    "vehicle_types",
    "data",
    "owner"
]);

function parseJsonColumn(name, value) {
    if (value == null || !jsonColumns.has(name)) return value;
    try {
        return JSON.parse(value);
    } catch {
        return value;
    }
}

function bindNumberedParameters(sql, parameters = []) {
    let output = "";
    const values = [];
    let index = 0;
    let state = "normal";

    while (index < sql.length) {
        const character = sql[index];
        const next = sql[index + 1];

        if (state === "single" || state === "double" || state === "backtick") {
            const terminator = state === "single" ? "'" : state === "double" ? '"' : "`";
            output += character;
            index += 1;
            if (character === "\\" && index < sql.length) {
                output += sql[index];
                index += 1;
            } else if (character === terminator) {
                if (sql[index] === terminator) {
                    output += sql[index];
                    index += 1;
                } else {
                    state = "normal";
                }
            }
            continue;
        }

        if (state === "line-comment") {
            output += character;
            index += 1;
            if (character === "\n") state = "normal";
            continue;
        }

        if (state === "block-comment") {
            output += character;
            index += 1;
            if (character === "*" && next === "/") {
                output += next;
                index += 1;
                state = "normal";
            }
            continue;
        }

        if (character === "'") state = "single";
        else if (character === '"') state = "double";
        else if (character === "`") state = "backtick";
        else if (character === "-" && next === "-") state = "line-comment";
        else if (character === "/" && next === "*") state = "block-comment";

        if (character === "$") {
            const match = /^\$(\d+)/.exec(sql.slice(index));
            if (match) {
                const parameterIndex = Number(match[1]) - 1;
                if (parameterIndex < 0 || parameterIndex >= parameters.length) {
                    throw new RangeError(`Missing value for SQL parameter $${match[1]}`);
                }
                output += "?";
                const value = parameters[parameterIndex];
                values.push(value === undefined ? null : value);
                index += match[0].length;
                continue;
            }
        }

        output += character;
        index += 1;
    }

    return { sql: output, values };
}

module.exports = { bindNumberedParameters, parseJsonColumn };