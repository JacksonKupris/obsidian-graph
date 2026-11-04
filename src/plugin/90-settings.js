class VaultGraphSettings extends PluginSettingTab {
  constructor(app, plugin) { super(app, plugin); this.plugin = plugin; }
  display() {
    const el = this.containerEl;
    el.empty();
    // this vault's rules: the value in use and where it comes from; a change is written to the rules file (the
    // analysis reads it too), on Enter or leaving the field
    new Setting(el).setName("This vault").setHeading();
    const where = keys => { const at = (o, ks) => ks.reduce((x, k) => (x && typeof x === "object" ? x[k] : undefined), o);
      if (at(this.plugin.rulesFile, keys) !== undefined) return `from ${this.plugin.settings.rulesPath}`;
      if (keys[0] === "folders" && this.plugin.detected && this.plugin.detected[keys[1]] !== undefined) return "from Obsidian's settings";
      return "default"; };
    RULE_FIELDS.forEach(([keys, name, desc]) => {
      const cur = keys.reduce((x, k) => x[k], VGRules.RULES);
      new Setting(el).setName(name).setDesc(`${desc} · ${where(keys)}`).addText(t => {
        t.setValue(String(cur));
        t.inputEl.addEventListener("change", async () => {
          const raw = t.getValue().trim(), v = typeof cur === "number" ? Number(raw) : raw.replace(/^\/+|\/+$/g, "");
          if (!raw || (typeof cur === "number" && !(v > 0))) { t.setValue(String(cur)); return; }
          if (v === cur) return;
          try { await this.plugin.setRule(keys, v); new Notice(`${name}: ${v}`); } catch (e) { new Notice(`Couldn't save ${name}: ${e.message}`); }
          this.display();
        });
      });
    });
    new Setting(el).setName("Plugin").setHeading();
    new Setting(el).setName("Open Vault HQ at startup").setDesc("Your home screen, when Obsidian opens").addToggle(t => t.setValue(this.plugin.settings.hqAtStart !== false).onChange(async v => { this.plugin.settings.hqAtStart = v; await this.plugin.saveSettings(); }));
    const text = (name, desc, key, placeholder) => new Setting(el).setName(name).setDesc(desc)
      .addText(t => t.setPlaceholder(placeholder).setValue(this.plugin.settings[key])
        .onChange(async v => { this.plugin.settings[key] = v.trim() || DEFAULTS[key]; await this.plugin.saveSettings(); }));
    text("Graph data file", "JSON the plugin writes, relative to the vault.", "dataPath", DEFAULTS.dataPath);
    text("Rules file", "This vault's folder names and thresholds, relative to the vault.", "rulesPath", DEFAULTS.rulesPath);
  }
}
