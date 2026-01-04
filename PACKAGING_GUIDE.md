# Packaging Diagnosis & Improvements

## Problem Diagnosis

Your `PKGBUILD.local` was **hanging at line 28** during the `package()` function:

```bash
npm install --omit=dev --prefix "${pkgdir}/opt/clash-party/resources/app"
```

**Why it hangs:**
- `package()` runs inside **fakeroot environment** with restricted privileges
- Network access may be blocked/throttled in fakeroot
- npm tries to download packages, acquire locks, or times out waiting
- This violates makepkg best practices (no network in package())

## Solutions

### ✅ Option 1: Pre-install in build() - RECOMMENDED
Use `PKGBUILD.local.improved`:
- Moves `npm install` to `build()` function (runs BEFORE fakeroot)
- Creates `build/prod-deps/` directory with pre-installed dependencies
- Copies pre-built node_modules to package in `package()` phase
- Fast, follows makepkg conventions

**Usage:**
```bash
cp PKGBUILD.local.improved PKGBUILD.local
makepkg -f -p PKGBUILD.local
```

### 🚀 Option 2: Use Bun - FASTEST
Use `PKGBUILD.local.bun`:
- Same approach but uses `bun` instead of `npm`
- **5-10x faster** dependency installation
- Requires `bun` package installed (`yay -S bun`)
- You already have `bun.lock`, so project supports it

**Usage:**
```bash
yay -S bun  # if not installed
cp PKGBUILD.local.bun PKGBUILD.local
makepkg -f -p PKGBUILD.local
```

### 📦 Option 3: Bundle node_modules beforehand
If you control the build environment:
```bash
# Before running makepkg
npm install --omit=dev
# Then modify PKGBUILD to just copy node_modules
```

## Comparison

| Method | Speed | Complexity | Reproducibility |
|--------|-------|------------|-----------------|
| Original (broken) | ❌ Hangs | Low | ❌ |
| Option 1 (npm) | ⚡ Fast | Low | ✅ |
| Option 2 (bun) | 🚀 Very Fast | Low | ✅ (if bun in makedepends) |
| Option 3 (manual) | ⚡ Fast | Medium | ⚠️ |

## Recommended Workflow

1. **For testing/local use:** Option 1 (npm in build())
2. **For speed:** Option 2 (bun) if you can add makedepends
3. **For official AUR:** Follow `aur/mihomo-party/PKGBUILD` pattern

## Official AUR PKGBUILDs Comparison

Your project has 5 official PKGBUILDs in `aur/`:
- `mihomo-party-bin` - Downloads pre-built .deb (fastest, no compilation)
- `mihomo-party-electron-bin` - Uses system electron, extracts from .deb
- `mihomo-party` - Builds from source with pnpm
- `mihomo-party-git` - Builds latest git version
- `mihomo-party-electron` - Builds with system electron

**Key difference:** Official PKGBUILDs do full `pnpm build:linux deb` in `build()`, then extract the .deb in `package()`. Your PKGBUILD.local tries to assemble manually.

## Next Steps

1. Try Option 1 first (safest):
   ```bash
   mv PKGBUILD.local PKGBUILD.local.broken
   cp PKGBUILD.local.improved PKGBUILD.local
   makepkg -f -p PKGBUILD.local
   ```

2. If you want speed, try Option 2:
   ```bash
   yay -S bun
   cp PKGBUILD.local.bun PKGBUILD.local
   makepkg -f -p PKGBUILD.local
   ```

3. Time both approaches:
   ```bash
   time makepkg -f -p PKGBUILD.local
   ```
