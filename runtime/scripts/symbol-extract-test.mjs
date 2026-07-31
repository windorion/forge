import { extractSymbols } from "../dist/symbolExtract.js";
import assert from "node:assert";
let passed = 0;
const ok = (c, m) => { assert.ok(c, m); passed++; };
const names = (syms) => syms.map((s) => `${s.kind}:${s.name}@${s.line}`);

// TypeScript
{
  const src = [
    "export class Foo {",       // 1 class
    "  bar() {}",               // (method — not captured at top level here)
    "}",
    "export interface Baz {}",  // 4 interface
    "export type Alias = string;", // 5 type
    "export function doThing() {}", // 6 function
    "export const arrow = (x) => x;", // 7 const (arrow)
    "const notExported = 5;",   // not an arrow → not captured
    "// function commented() {}" // comment → skipped
  ].join("\n");
  const s = extractSymbols("TypeScript", src);
  const n = names(s);
  ok(n.includes("class:Foo@1"), "ts class");
  ok(n.includes("interface:Baz@4"), "ts interface");
  ok(n.includes("type:Alias@5"), "ts type");
  ok(n.includes("function:doThing@6"), "ts function");
  ok(n.includes("const:arrow@7"), "ts arrow const");
  ok(!n.some((x) => x.includes("commented")), "ts comment skipped");
  ok(!n.some((x) => x.includes("notExported")), "ts non-arrow const not captured");
}
// Swift
{
  const src = ["struct View {", "  func body() {}", "}", "final class Model {}", "enum State {}", "protocol P {}"].join("\n");
  const n = names(extractSymbols("Swift", src));
  ok(n.includes("struct:View@1") && n.includes("func:body@2") && n.includes("class:Model@4") && n.includes("enum:State@5") && n.includes("protocol:P@6"), "swift decls");
}
// Python
{
  const n = names(extractSymbols("Python", ["class A:", "    def m(self):", "async def go():"].join("\n")));
  ok(n.includes("class:A@1") && n.includes("function:m@2") && n.includes("function:go@3"), "python decls");
}
// Go
{
  const n = names(extractSymbols("Go", ["func Foo() {}", "func (r Repo) Bar() {}", "type T struct {"].join("\n")));
  ok(n.includes("func:Foo@1") && n.includes("func:Bar@2") && n.includes("type:T@3"), "go decls (incl receiver method)");
}
// Rust
{
  const n = names(extractSymbols("Rust", ["pub fn run() {}", "struct S {}", "pub enum E {}", "trait Tr {}"].join("\n")));
  ok(n.includes("function:run@1") && n.includes("struct:S@2") && n.includes("enum:E@3") && n.includes("trait:Tr@4"), "rust decls");
}
// unknown language / empty
ok(extractSymbols("Other", "anything").length === 0, "unknown lang → empty");
ok(extractSymbols("TypeScript", "").length === 0, "empty content → empty");

// The indexer must remain bounded even for generated-looking declaration floods.
const declarationFlood = Array.from({ length: 2_050 }, (_, index) => `export function symbol${index}() {}`).join("\n");
const bounded = extractSymbols("TypeScript", declarationFlood);
ok(bounded.length === 2_000, `symbol cap should be 2000, got ${bounded.length}`);
ok(bounded.at(-1)?.name === "symbol1999", "symbol cap should preserve the first declarations deterministically");

console.log(`Symbol extract test passed: ${passed} assertions.`);
