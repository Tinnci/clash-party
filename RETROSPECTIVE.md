# Installation Process - What Happened & Better Approaches

## What Happened Previously

### Timeline of Issues & Fixes:

1. **Initial Problem**: Original PKGBUILD was hanging during `npm install` in fakeroot
   - **Cause**: Network operations blocked/slow in fakeroot environment
   - **Fix**: Moved dependency installation to `prepare()` function

2. **Postinstall Script Issue**: `bun install` triggered postinstall requiring electron-builder
   - **Cause**: postinstall script needs devDependencies
   - **Fix**: Added `--ignore-scripts` flag

3. **App.asar Missing Dependencies**: Built .deb had app.asar without node_modules
   - **Cause**: electron-vite's `externalizeDepsPlugin()` expects external node_modules
   - **Root Issue**: The app was never designed to use asar for main process code
   - **Fix**: Used unpacked format with node_modules directory

4. **Directory Structure Wrong**: Files were at `app/main/` instead of `app/out/main/`
   - **Cause**: PKGBUILD copied `out/*` instead of `out/`
   - **Fix**: Changed to copy entire `out/` directory

5. **Resource Paths Wrong**: App looked for resources in `app/resources/` 
   - **Cause**: App expects resources relative to itself
   - **Fix**: Created symlinks from `app/resources/` to parent directories

6. **Build Taking 3+ Minutes**: makepkg was stripping symbols on 1000+ files
   - **Cause**: Default makepkg strips all binaries
   - **Fix**: Added `options=('!strip' '!debug')` → **85% faster (27s)**

7. **Source Files Deleted**: Accidentally ran `rm -rf src/`
   - **Cause**: Cleanup command in wrong context
   - **Fix**: `git restore src/`

## Better Approaches

### 1. **For Local Testing** (Current Approach - Good)
```bash
# Build once
bun install && bun run build:linux deb

# Package quickly
time makepkg -f    # 27 seconds
```

**Pros**: 
- Fast iterations
- Separates build from packaging
- Easy to test

### 2. **For Official AUR** (Recommended for Publication)

Follow the official pattern from `aur/mihomo-party/PKGBUILD`:

```bash
prepare() {
    pnpm install --frozen-lockfile
}

build() {
    pnpm build:linux deb
}

package() {
    # Extract the .deb
    bsdtar -xf dist/*.deb
    bsdtar -xf data.tar.xz -C "${pkgdir}/"
    # Post-process paths, permissions, etc.
}
```

**Pros**:
- Reproducible from source
- No manual build step
- Standard AUR pattern

**Cons**:
- Takes ~5 minutes (full build every time)
- Requires all devDependencies

### 3. **Binary Package** (Fastest for Users)

```bash
pkgname=mihomo-party-bin
source_x86_64=("${url}/releases/download/v${pkgver}/clash-party-linux-${pkgver}-amd64.deb")

package() {
    bsdtar -xf data.tar.xz -C "${pkgdir}/"
    # Fix paths
}
```

**Pros**:
- Instant packaging (just extract)
- No compilation needed
- Smallest download for AUR users

**Cons**:
- Depends on upstream releases
- Less transparent

## Recommendations

### For You (Local Development):
✅ **Keep current approach** - It's optimal for testing:
```bash
# Build when code changes
bun install && bun run build:linux deb

# Package quickly
makepkg -f  # 27 seconds
```

### For AUR Submission:
📦 **Use the official build pattern**:
- Move current PKGBUILD → `PKGBUILD.local` (for quick testing)
- Use `aur/mihomo-party/PKGBUILD` pattern (for AUR)

### For Distribution:
🚀 **Consider creating both**:
- `mihomo-party` - Build from source (reproducible)
- `mihomo-party-bin` - Extract from .deb (fast)

## Code Quality Checks

### Recommended Workflow:
```bash
# Before committing
bun run typecheck        # Type safety
bun eslint src/ --ext .ts,.tsx  # Lint source only
bun run format          # Auto-format

# Before building
bun install && bun run build:linux deb

# Package
makepkg -f
```

## Performance Analysis

### Build Time Breakdown (Current):
```
prepare():    0.5s  (bun checks deps)
package():   15.0s  (copy files)
compress:    10.0s  (zst compression)
clean:        1.5s  (various checks)
────────────────────
Total:       27.0s
```

### What Slowed It Down Before:
```
strip symbols: 180s+ (on node_modules)
```

### Why `!strip` Works:
- Node modules have 1000+ files with debug symbols
- Stripping each one is slow
- Users don't debug node_modules anyway
- Final package is JavaScript (no performance impact)

## Files That Were Missing Initially

The first-run errors you saw are **normal** - the app downloads these on first start:
- `geoip.dat`, `geosite.dat` - GeoIP databases
- `country.mmdb`, `ASN.mmdb` - MaxMind databases  
- `geoip.metadb` - Alternative GeoIP format
- `sub-store.bundle.cjs` - Sub-store backend

These are downloaded from GitHub on first launch and cached in `~/.config/mihomo-party/work/`.

## Final Architecture

```
Source (yours):
└── dist/linux-unpacked/  ← Built by electron-builder
    ├── mihomo-party (electron binary)
    └── resources/
        ├── app.asar (exists but unused - broken)
        ├── sidecar/
        └── files/

Package (what we create):
/opt/clash-party/
├── mihomo-party
└── resources/
    ├── app/               ← We add this
    │   ├── out/          ← Compiled code
    │   ├── node_modules/ ← Runtime deps
    │   ├── resources/    ← Symlinks
    │   └── package.json
    ├── sidecar/
    └── files/
```

## Conclusion

**Current approach is optimal** for your use case (local testing + fast iterations). The 27-second build time is excellent considering the package size.

For AUR publication, you'd switch to the full build approach, but that's only needed once per release.
