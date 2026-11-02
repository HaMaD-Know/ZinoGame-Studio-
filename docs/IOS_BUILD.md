# Building ZinoGame Studio for iPad (no Mac required)

ZinoGame Studio is packaged as a native iOS/iPadOS app with **Capacitor 8**.
The native build runs on **GitHub-hosted macOS runners** with Apple's Xcode,
so you can build from an iPad without owning a Mac.

The workflow lives in [`.github/workflows/ios-build.yml`](../.github/workflows/ios-build.yml).

## What the workflow produces

| Build | When | Installable on an iPad? |
|---|---|---|
| **A. Unsigned device build** — `ZinoGameStudio-unsigned.ipa` | Always, when no signing secrets are set | **No.** iPadOS only installs signed apps. It proves the native build works and can be re-signed later. |
| **A. Simulator build** — `ZinoGameStudio-simulator.app.zip` | Always | Runs in the iOS Simulator on a Mac only. |
| **B. Signed device build** — `ZinoGameStudio-ad-hoc.ipa` / `-development.ipa` | When signing secrets are set (export method `ad-hoc`, `development` or `enterprise`) | **Yes**, on devices included in the provisioning profile. |
| **C. App Store / TestFlight build** — `ZinoGameStudio-app-store-connect.ipa` | When signing secrets are set and the export method is `app-store-connect` | Through TestFlight / the App Store after uploading to App Store Connect. |

All files are uploaded as one workflow artifact named **`zinogame-studio-ios-build`**,
together with a `README.txt` describing exactly what was built. A playable web
build is uploaded separately as **`zinogame-studio-web-build`**.

> A successful build is **not** the same as a successful installation. Only a
> correctly signed build with a matching provisioning profile can be installed.

## Running the build from an iPad

1. Open **github.com** in Safari (or the GitHub app) and go to this repository.
2. Tap **Actions** → **iOS Build** (left list) → **Run workflow**.
3. Choose:
   - **Configuration**: `Release` (normal) or `Debug` (allows the Safari Web Inspector).
   - **Export method**: only used when signing secrets exist (see below).
   - **Xcode version**: leave empty to use the newest stable Xcode on the runner.
4. Tap the green **Run workflow** button. A run takes roughly 10–15 minutes.

The workflow also runs automatically on pushes to `main` and on pull requests that change the app (source, assets, iOS project, dependencies or build configuration). Documentation-only changes do not start a macOS build, because macOS runner minutes are expensive on private repositories.

## Downloading the result

1. Open the finished run (Actions → iOS Build → the run).
2. Scroll to **Artifacts** and tap **zinogame-studio-ios-build**. GitHub downloads a `.zip`.
3. In the **Files** app, tap the zip to extract it. You get the `.ipa`, the simulator build
   and `README.txt`.

The run's **Summary** page states whether the build was unsigned or signed.

## Signing: what Apple requires to install on a real iPad

iPadOS refuses to install apps that are not signed by Apple-issued certificates.
To install your own build you need:

1. **An Apple Developer Program membership** (paid, individual or organisation).
   A free Apple ID cannot create Ad Hoc or App Store distribution profiles.
2. **A signing certificate** (`.p12` with its private key):
   - *Apple Development* — for `development` builds, or
   - *Apple Distribution* — for `ad-hoc` and `app-store-connect` builds.
3. **An App ID** for the bundle identifier **`com.zinogame.studio`**
   (or change `appId` in `capacitor.config.ts` and the Xcode project to your own).
4. **A provisioning profile** for that App ID and certificate:
   - *Development* or *Ad Hoc* profiles must list your iPad's **UDID**
     (find it via Finder/Apple Configurator, or a UDID-lookup site using a configuration profile).
   - *App Store* profiles need no UDIDs; distribution happens through TestFlight.

### Creating a certificate without a Mac

You can create the certificate request with OpenSSL on any computer (for example a
GitHub Codespace):

```bash
openssl genrsa -out zinogame.key 2048
openssl req -new -key zinogame.key -out zinogame.csr -subj "/emailAddress=you@example.com/CN=Your Name/C=US"
```

Upload `zinogame.csr` at developer.apple.com → Certificates → **+**, download the
`.cer`, then build the `.p12`:

```bash
openssl x509 -in distribution.cer -inform DER -out distribution.pem -outform PEM
openssl pkcs12 -export -inkey zinogame.key -in distribution.pem -out zinogame.p12 -legacy
```

(`-legacy` keeps the `.p12` compatible with macOS `security import`.) Keep
`zinogame.key` and the `.p12` private — **never commit them**; `.gitignore` blocks
common signing file types and the configuration validator fails if one is committed.

### GitHub secrets for signing

In the repository: **Settings → Secrets and variables → Actions → New repository secret**.

| Secret | Required | Value |
|---|---|---|
| `IOS_CERTIFICATE_P12_BASE64` | yes | `base64 -i zinogame.p12` (one line) |
| `IOS_CERTIFICATE_PASSWORD` | yes | The password chosen when exporting the `.p12` |
| `IOS_PROVISIONING_PROFILE_BASE64` | yes | `base64 -i profile.mobileprovision` |
| `IOS_KEYCHAIN_PASSWORD` | no | Password for the temporary CI keychain (random if omitted) |
| `IOS_TEAM_ID` | no | Your 10-character Team ID (read from the profile if omitted) |

Optional repository **variables** (same page, *Variables* tab):

| Variable | Default | Meaning |
|---|---|---|
| `IOS_EXPORT_METHOD` | `ad-hoc` | Export method for push-triggered builds: `ad-hoc`, `development`, `app-store-connect`, `enterprise` |
| `IOS_XCODE_VERSION` | newest stable | Pin an Xcode version, e.g. `16.4` |

When both `IOS_CERTIFICATE_P12_BASE64` and `IOS_PROVISIONING_PROFILE_BASE64` are set,
the workflow imports the certificate into a temporary keychain, installs the profile,
archives with manual signing, exports a signed `.ipa`, and deletes the keychain at the end.
Without them it produces the unsigned build and says so in the summary.

> The signed path is implemented but has **not been exercised** in this repository's
> CI yet, because no signing credentials are configured. Expect to check the first
> signed run's log carefully (common issues: profile does not match the bundle
> identifier, wrong certificate type for the export method, expired profile).

### Installing a signed build on an iPad without a Mac

- **TestFlight (recommended for iPad-only users):** build with export method
  `app-store-connect`, upload the `.ipa` to App Store Connect (for example with
  Apple's *Transporter* app on a Mac, or `xcrun altool --upload-app` from a CI
  step you add with an App Store Connect API key), then install through the
  **TestFlight** app on the iPad.
- **Ad Hoc over the air:** host the `.ipa` plus a `manifest.plist` on an HTTPS
  server and open an `itms-services://?action=download-manifest&url=…` link on the
  iPad. The iPad's UDID must be in the Ad Hoc profile.
- **Apple Configurator / Finder** (requires a Mac): drag the `.ipa` onto the device.

## Local development on a Mac (optional)

```bash
npm ci
npm run ios:build      # type-check, web build, cap sync ios
npx cap open ios       # opens Xcode; choose your team under Signing & Capabilities
```

## How the native project is set up

- Generated with `npx cap add ios --packagemanager SPM` — Capacitor plugins are
  Swift packages, so **no CocoaPods** is needed.
- `ios/App/App/public`, `capacitor.config.json` and `config.xml` are generated by
  `npx cap sync ios` and are not committed; CI runs the sync before building.
- `Info.plist` enables **UIFileSharingEnabled** and
  **LSSupportsOpeningDocumentsInPlace**, so projects exported from the app appear in
  the Files app under *On My iPad → ZinoGame Studio*.
- All orientations are allowed on iPad; the UI adapts to portrait and landscape.
- The app icon (1024×1024, no alpha) and splash screen are generated from
  `resources/zinogame-logo-source.png`.
- `npm run check:capacitor` validates the configuration (bundle id, icon, Info.plist
  keys, Swift packages, workflow pinning/permissions, no committed signing files) on
  any OS before the macOS job starts.

## Troubleshooting

| Problem | Fix |
|---|---|
| "Xcode X is not installed on this runner" | Leave *Xcode version* empty, or pick one listed in the "Select Xcode" step log. |
| Swift package resolution fails | Re-run the job (temporary network issue), or check that `npm ci` succeeded — local plugin packages live in `node_modules`. |
| "No code-signing identity found" | The `.p12` is wrong, has no private key, or the password secret is wrong. |
| "Provisioning profile doesn't include signing certificate" | Regenerate the profile with the same certificate you exported to `.p12`. |
| The `.ipa` won't install | Unsigned builds never install. For Ad Hoc, the iPad's UDID must be in the profile. |
| Build logs | On failure, the run uploads `zinogame-studio-ios-logs` with the full xcodebuild logs. |
