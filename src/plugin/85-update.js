// The plugin updates itself: it asks GitHub for the latest release, and when that is newer than the one running it
// downloads main.js, manifest.json and styles.css, checks them (VGRelease.problem, the same rule scripts/install_release.js
// uses), writes them whole and reloads. Works on every device, Android included, with or without BRAT. The plugin's
// settings (data.json) are never touched. Turn it off in the plugin's settings; the command checks once by hand.
class VaultGraphUpdater {
  constructor(plugin) { this.plugin = plugin; this.busy = false; }
  get version() { return this.plugin.manifest.version; }
  // the newest release if it is newer than this one, else null; throws when GitHub can't be reached
  async latest() {
    const r = await requestUrl({ url: `https://api.github.com/repos/${VGRelease.REPO}/releases/latest`, headers: { Accept: "application/vnd.github+json" } });
    const rel = r.json;
    return rel && VGRelease.newer(rel.tag_name, this.version) ? rel : null;
  }
  // download, check, then write: nothing is written unless every file arrived and passed, so a failure leaves the running version whole
  async install(rel) {
    const urls = VGRelease.assetUrls(rel), gone = VGRelease.missing(rel);
    if (gone.length) throw new Error(`release ${rel.tag_name} has no ${gone.join(", ")}`);
    const files = {};
    for (const f of VGRelease.FILES) files[f] = (await requestUrl({ url: urls[f] })).text;
    const bad = VGRelease.problem(rel, files, this.plugin.manifest.id);
    if (bad) throw new Error(bad);
    const ad = this.plugin.app.vault.adapter, dir = this.plugin.manifest.dir;
    for (const f of VGRelease.FILES) await ad.write(`${dir}/${f}.new`, files[f]);
    for (const f of VGRelease.FILES) { if (await ad.exists(`${dir}/${f}`)) await ad.remove(`${dir}/${f}`); await ad.rename(`${dir}/${f}.new`, `${dir}/${f}`); }
  }
  // the app reads the manifest again first: without it the old version is enabled again
  async reload() {
    const id = this.plugin.manifest.id, plugins = this.plugin.app.plugins;
    await plugins.loadManifests(); await plugins.disablePlugin(id); await plugins.enablePlugin(id);
  }
  // check once. manual: say the result either way. -> "updated" | "current" | "found" (auto-update is off) | "failed"
  async check({ manual = false } = {}) {
    if (this.busy) return "busy";
    this.busy = true;
    const say = (text, important) => { if (manual || important) new Notice(text, 8000); };
    try {
      this.plugin.settings.lastUpdateCheck = Date.now();
      const rel = await this.latest();
      if (!rel) { say(`Vault Graph ${this.version} is the latest`); return "current"; }
      if (!manual && this.plugin.settings.autoUpdate === false) { say(`Vault Graph ${rel.tag_name} is out (this is ${this.version}). Run "Update Vault Graph" to install it`, true); return "found"; }
      await this.install(rel);
      new Notice(`Vault Graph updated ${this.version} to ${rel.tag_name}`, 8000);
      await this.plugin.saveSettings();
      await this.reload();
      return "updated";
    } catch (e) {
      say(`Vault Graph couldn't update: ${e.message}`, !/Request failed|net::|offline/i.test(String(e.message)));
      return "failed";
    } finally { this.busy = false; }
  }
  // on start (once a few minutes have passed since the last check) and every six hours after
  start() {
    const p = this.plugin, HOUR = 3600e3;
    p.addCommand({ id: "update", name: "Update Vault Graph", callback: () => this.check({ manual: true }) });
    p.app.workspace.onLayoutReady(() => setTimeout(() => { if (p.settings.autoUpdate !== false && Date.now() - (p.settings.lastUpdateCheck || 0) > HOUR / 4) this.check(); }, 20000));
    p.registerInterval(window.setInterval(() => { if (p.settings.autoUpdate !== false) this.check(); }, 6 * HOUR));
  }
}
