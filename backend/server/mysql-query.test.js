const test = require("node:test");
const assert = require("node:assert/strict");

const { bindNumberedParameters, parseJsonColumn } = require("./mysql-query");

test("binds numbered parameters in SQL occurrence order", () => {
    const result = bindNumberedParameters("SELECT $2, $1, $2", ["first", "second"]);

    assert.deepEqual(result, {
        sql: "SELECT ?, ?, ?",
        values: ["second", "first", "second"]
    });
});

test("leaves parameter-looking text in strings and comments unchanged", () => {
    const sql = "SELECT '$1', \"$2\", `$3` -- $4\n/* $5 */ WHERE id = $1";
    const result = bindNumberedParameters(sql, ["id"]);

    assert.equal(result.sql, "SELECT '$1', \"$2\", `$3` -- $4\n/* $5 */ WHERE id = ?");
    assert.deepEqual(result.values, ["id"]);
});

test("rejects references to missing parameters", () => {
    assert.throws(() => bindNumberedParameters("SELECT $2", ["only one"]), RangeError);
});

test("normalizes undefined values to SQL null", () => {
    assert.deepEqual(bindNumberedParameters("UPDATE profiles SET name = $1", [undefined]), {
        sql: "UPDATE profiles SET name = ?",
        values: [null]
    });
});

test("parses JSON-backed fields returned as MariaDB text", () => {
    assert.deepEqual(parseJsonColumn("vehicle_details", '{"type":"van"}'), { type: "van" });
    assert.equal(parseJsonColumn("full_name", "A Person"), "A Person");
});