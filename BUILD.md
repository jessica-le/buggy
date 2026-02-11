# Building Buggy

## 📦 Build Sizes

- **Windows**: ~250 MB (Electron includes Chromium browser)
- **macOS**: ~250-300 MB (similar size)

## 🚀 GitHub Actions (Recommended)

Builds happen on GitHub's servers - doesn't use your local space!

### How to trigger a build:

1. **Commit and push your changes:**
   ```bash
   git add .
   git commit -m "Your changes"
   git push
   ```

2. **Create a release tag:**
   ```bash
   git tag v1.0.0
   git push origin v1.0.0
   ```

3. **GitHub Actions will automatically:**
   - Build for Windows
   - Build for macOS (Intel & Apple Silicon)
   - Create a GitHub Release with downloadable ZIPs
   - No local storage used!

4. **Or trigger manually:**
   - Go to your GitHub repo
   - Click "Actions" tab
   - Click "Build Buggy" workflow
   - Click "Run workflow"

### Download builds:
- Go to your repo's "Releases" page
- Download the ZIP for your platform
- Extract and run!

## 💻 Local Builds

### Build for Windows (on Windows):
```bash
npx electron-packager . Buggy --platform=win32 --arch=x64 --out=release --overwrite --icon=src/assets/sprites/icon.ico --ignore="dist.*|node_modules|\.git|\.claude|build.*|release"
```

### Build for macOS (on Mac or Windows):
```bash
npx electron-packager . Buggy --platform=darwin --arch=x64,arm64 --out=release --overwrite --ignore="dist.*|node_modules|\.git|\.claude|build.*|release"
```

**Note:** macOS builds created on Windows won't be signed, so Mac users will need to right-click → Open the first time.

### Build for Linux (optional):
```bash
npx electron-packager . Buggy --platform=linux --arch=x64 --out=release --overwrite --ignore="dist.*|node_modules|\.git|\.claude|build.*|release"
```

## 🧹 Cleanup

All build outputs are in `.gitignore` and won't be committed to your repo.

To delete local builds:
```bash
rm -rf release/ build*/ dist*/
```

## 🍎 Mac Icon

To add a proper Mac icon, you need a `.icns` file:

1. Convert your PNG to ICNS using an online tool like [CloudConvert](https://cloudconvert.com/png-to-icns)
2. Save as `src/assets/sprites/icon.icns`
3. Update the workflow to include `--icon=src/assets/sprites/icon.icns` for macOS builds

## 📝 Notes

- Builds are large because Electron bundles the entire Chromium browser
- GitHub Actions has generous free tier (2000 minutes/month for public repos)
- Builds are stored as GitHub Releases, not in your repo
- Users download pre-built binaries - no build required on their end
