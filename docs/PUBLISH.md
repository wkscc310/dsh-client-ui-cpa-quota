# Publishing runbook / 发布流程

Everything needed to cut a release. The plugin ships through two channels
that should stay in sync: **npm** (what `dsh plugin add dsh-client-ui-cpa-quota`
resolves) and **GitHub** (source + tags + this repository's Releases page).

## 1. Pre-flight

```sh
node --check lib/client.js && node --check lib/index.js
node tests/smoke.mjs
git diff --check
```

Bump `version` in `package.json` and add a `CHANGELOG.md` section for the
release. Commit.

## 2. Publish to npm

Publishing requires 2FA on the npm account (npm enforces it for all
publishers). Interactive OTP prompt:

```sh
npm publish --registry=https://registry.npmjs.org
```

Notes:

- The default registry on this machine is `npmmirror.com` (a read-only
  mirror) — publishing must target `registry.npmjs.org` explicitly.
- `npmmirror` syncs from npm automatically within minutes; nothing to do.
- The `files` whitelist in `package.json` keeps the tarball to `lib/`, the
  bundle patch, `screenshots.json` and the screenshots. Verify with
  `npm pack --dry-run` first.

## 3. Tag and push

```sh
git tag vX.Y.Z
git push origin main vX.Y.Z
```

Then create a GitHub Release for the tag and paste the matching
`CHANGELOG.md` section as the notes.

## 4. awesome-dsh-plugin listing

The plugin is listed by [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin)
(and through it, [dsh-market](https://github.com/dsh-market/dsh-market) inside
DSH's settings). Update the entry when the description changes:

1. Fork the list, add/edit `data/plugins/wkscc310__dsh-client-ui-cpa-quota.yml`
   (one YAML file per plugin; the READMEs are generated — never edited by hand):

   ```yaml
   url: https://github.com/wkscc310/dsh-client-ui-cpa-quota
   name: wkscc310/dsh-client-ui-cpa-quota
   category: usage
   description:
     en: 'CLIProxyAPI quota for DeepSeek Harness: a ring beside the model picker plus a settings panel listing every account quota windows with plans and reset times.'
     zh: 模型选择器旁的 CLIProxyAPI 额度圆环，设置面板仿 CPA 管理页列出全部账号的额度窗口、套餐与刷新时间。
   ```

2. Regenerate and commit together with the YAML:

   ```sh
   npm ci && node scripts/generate-readme.mjs
   ```

3. Open a PR. CI checks the `dsh.bundle` manifest, repository age/commits,
   awesome-lint and the site build — the manifest lives in this repo's
   `package.json`, so keep it intact across refactors.

## Checklist

- [ ] tests green (`node tests/smoke.mjs`)
- [ ] `version` bumped + `CHANGELOG.md` section
- [ ] `npm publish --registry=https://registry.npmjs.org`
- [ ] tag pushed, GitHub Release notes pasted
- [ ] awesome-dsh-plugin entry updated (only when the description changes)
