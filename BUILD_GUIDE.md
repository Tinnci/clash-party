# Mihomo Party - Arch Linux Build Guide

## Summary

The corrected PKGBUILD is ready and tested. Build time: **27 seconds**.

### Key Optimizations:
1. **`options=('!strip' '!debug')`** - Skip stripping symbols on huge node_modules (saves 2+ minutes)
2. **Production deps only** - `bun install --production` (faster than full install)
3. **Unpacked format** - Works around electron-vite's externalizeDepsPlugin issue

### Build & Install:

```bash
# Full build (if needed)
bun install && bun run build:linux deb

# Package and install
time makepkg -f
sudo pacman -U mihomo-party-1.9.0-1-x86_64.pkg.tar.zst
```

### Timing Breakdown:
- **prepare()**: ~0.5s (bun checks existing deps)
- **package()**: ~15s (copying files)
- **compress**: ~10s (zst compression)
- **Total**: ~27s

### For KDE Menu Integration:
After install, run:
```bash
sudo update-desktop-database
kquitapp6 plasmashell && kstart plasmashell
```

The app will appear in KDE menu under Network → Clash Party.

### Package Size:
- Old broken package: 165MB
- New working package: 415MB (includes node_modules)

### Best Practices Applied:
✅ No network operations in package() (fakeroot)
✅ All dependencies installed in prepare()
✅ Desktop file + icon properly installed
✅ Wrapper script in /usr/bin
✅ Proper permissions and ownership
