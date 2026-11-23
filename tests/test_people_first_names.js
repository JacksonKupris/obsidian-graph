#!/usr/bin/env node
// People finds open work that names someone by first name ("Follow up on X with Ana") when only one person has that first name, and never
// when two people share it (two Johns). The rule lives in VGRules.hqPeople, so Home, People and the briefing agree.
const { checks, finish } = require("./kit");
const env = require("./env"), build = require("../build");
const VGRules = () => new Function(`${build.rulesSource(env.rules)}; return VGRules;`)();
const { fails, ok: check } = checks();
try {
  const rules = VGRules();
  const data = { nodes: [{ id: "a", name: "Ana Lopez", person: true }, { id: "b", name: "John Ruff", person: true }, { id: "c", name: "John Adams", person: true }, { id: "d", name: "Dev Patel", person: true }], links: [] };
  const list = [{ kind: "task", text: "Follow up on VPN with Ana" }, { kind: "task", text: "Call John about the quote" }, { kind: "task", text: "Review [[John Ruff]]'s draft" }, { kind: "task", text: "Anagram puzzle" }];
  const by = Object.fromEntries(rules.hqPeople(data, list).map(p => [p.name, p.items.map(i => i.text)]));
  check((by["Ana Lopez"] || []).length === 1 && /with Ana/.test(by["Ana Lopez"][0]), `Ana is the only Ana, so "with Ana" should count for Ana Lopez: ${JSON.stringify(by["Ana Lopez"])}`);
  check(!(by["Ana Lopez"] || []).some(t => /Anagram/.test(t)), "a word that only starts with Ana must not count");
  check(!(by["John Ruff"] || []).some(t => /Call John/.test(t)) && !(by["John Adams"] || []).some(t => /Call John/.test(t)), `"Call John" is ambiguous and must belong to neither John: ${JSON.stringify(by)}`);
  check((by["John Ruff"] || []).some(t => /\[\[John Ruff\]\]/.test(t)), "a full link still counts");
} catch (e) { fails.push(e.message); }
finish(fails, "People matches a unique first name and never an ambiguous one", "people first names");
