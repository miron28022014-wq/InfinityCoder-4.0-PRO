/**
 * Tool-call parser regression tests.
 *
 * The 2.0 parser matched exactly one literal tag and silently dropped every
 * other shape the model emits. These cases pin down the formats we accept and,
 * more importantly, prove that half-written JSON never reaches the transcript.
 *
 *   npx tsx test/parse.test.mts
 */
import { parseToolCalls, stripCalls, visiblePrefix } from "../src/lib/parse.ts";

const LT = String.fromCharCode(60);
const OPEN = `${LT}tool_call>`;
const CLOSE = `${LT}/tool_call>`;
const ZWSP = String.fromCharCode(0x200b);

let pass = 0;
let fail = 0;

function eq(name: string, got: unknown, want: unknown) {
  const a = JSON.stringify(got);
  const b = JSON.stringify(want);
  if (a === b) {
    pass++;
  } else {
    fail++;
    console.log(`FAIL  ${name}\n  got:  ${a}\n  want: ${b}`);
  }
}

const calls = (s: string) => parseToolCalls(s).map(c => [c.tool, c.args]);

/* ---------------- accepted shapes ---------------- */

eq("tag", calls(`ok${OPEN}{"tool":"read_file","args":{"path":"a.ts"}}${CLOSE}`), [
  ["read_file", { path: "a.ts" }]
]);

eq("zero-width spaces", calls(`${OPEN}${ZWSP}{"tool":"list_dir","args":{"path":"src"}}${CLOSE}`), [
  ["list_dir", { path: "src" }]
]);

eq("fenced", calls('```tool_call\n{"tool":"run_command","args":{"command":"ls"}}\n```'), [
  ["run_command", { command: "ls" }]
]);

eq("bare json", calls(`{"tool":"write_file","args":{"path":"b.ts","content":"x"}}`), [
  ["write_file", { path: "b.ts", content: "x" }]
]);

eq("openai shape", calls(`{"name":"read_file","arguments":"{\\"path\\":\\"c.ts\\"}"}`), [
  ["read_file", { path: "c.ts" }]
]);

eq("several in one turn", calls(`${OPEN}{"tool":"a","args":{}}${CLOSE} текст ${OPEN}{"tool":"b","args":{}}${CLOSE}`), [
  ["a", {}],
  ["b", {}]
]);

eq("uppercase tag", calls(`${LT}TOOL_CALL>{"tool":"z","args":{}}${LT}/TOOL_CALL>`), [["z", {}]]);

eq("args as string", calls(`${OPEN}{"tool":"t","args":"{\\"k\\":1}"}${CLOSE}`), [["t", { k: 1 }]]);

eq("no false positives", calls('Объект {"a":1} и {"b":2} — это не вызовы'), []);

/* ---------------- stripping ---------------- */

eq("strip tag", stripCalls(`Сделаю.${OPEN}{"tool":"x","args":{}}${CLOSE}Готово.`), "Сделаю.Готово.");

// the double space left behind by removing the call must collapse
eq("strip bare", stripCalls(`Ответ {"tool":"x","args":{}} конец`), "Ответ конец");

/* ---------------- streaming ---------------- */

let s = "";
for (const chunk of ["Читаю файл. ", `${OPEN}{"tool":"read_file",`, '"args":{"path":"a.ts"}}', CLOSE, " Готово."]) {
  s += chunk;
}
eq("stream complete", visiblePrefix(s), "Читаю файл. Готово.");

eq("stream half-written tag", visiblePrefix(`Читаю файл. ${OPEN}{"tool":"read_file","ar`), "Читаю файл.");

eq("stream half-written bare", visiblePrefix('Ответ {"tool":"rea'), "Ответ");

eq("stream bare complete", visiblePrefix('Текст {"tool":"read_file","args":{"path":"a.ts"}} ещё'), "Текст ещё");

/* ---------------- salvage ---------------- */

const broken = parseToolCalls(`${OPEN}{"tool":"write_file","args":{"path":${CLOSE}`);
eq("salvage broken payload", broken.map(c => [c.tool, c.broken]), [["write_file", true]]);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);