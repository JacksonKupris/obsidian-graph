// release.js - what a published release of the plugin must hold and when one is newer than the one running. One copy: the
// plugin updates itself with it (plugin/85-update.js) and scripts/install_release.js installs with it, so the two can't
// disagree about a release. Pure: it reads nothing and writes nothing.
const VGRelease = (() => {
  const REPO = "JacksonKupris/obsidian-graph";
  const FILES = ["main.js", "manifest.json", "styles.css"];   // what Obsidian and BRAT install
  const SEMVER = /^\d+\.\d+\.\d+$/;
  // is version a newer than b? Only plain x.y.z counts, so a pre-release or a stray tag never replaces a release
  const newer = (a, b) => {
    if (!SEMVER.test(a) || !SEMVER.test(b)) return false;
    const x = a.split(".").map(Number), y = b.split(".").map(Number);
    for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i];
    return false;
  };
  const assetUrls = release => Object.fromEntries(((release && release.assets) || []).map(a => [a.name, a.browser_download_url]));
  const missing = release => FILES.filter(f => !assetUrls(release)[f]);
  // what is wrong with a release's downloaded files, or null when they are what the release says: all three present, the
  // manifest the tag's version and (when ownId is given) this plugin's, and a main.js that is code rather than an error page
  const problem = (release, files, ownId) => {
    const gone = FILES.filter(f => typeof (files || {})[f] !== "string" || !files[f].trim());
    if (gone.length) return `release ${release.tag_name} has no ${gone.join(", ")}`;
    let man; try { man = JSON.parse(files["manifest.json"]); } catch (e) { return `release ${release.tag_name}'s manifest.json isn't JSON`; }
    if (man.version !== release.tag_name) return `release ${release.tag_name} carries manifest ${man.version}`;
    if (ownId && man.id !== ownId) return `release ${release.tag_name} is plugin "${man.id}", not "${ownId}"`;
    if (!/module\.exports/.test(files["main.js"])) return `release ${release.tag_name}'s main.js isn't a plugin`;
    return null;
  };
  return { REPO, FILES, newer, assetUrls, missing, problem };
})();
