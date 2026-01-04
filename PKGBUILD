# Mihomo Party - Arch Linux PKGBUILD
pkgname=mihomo-party
pkgver=1.9.0
pkgrel=1
pkgdesc="Another Mihomo GUI."
arch=('x86_64')
url="https://github.com/mihomo-party-org/mihomo-party"
license=('GPL3')
depends=('gtk3' 'libnotify' 'nss' 'libxss' 'libxtst' 'xdg-utils' 'at-spi2-core' 'util-linux-libs' 'libsecret')
optdepends=('libappindicator-gtk3: System tray integration')
makedepends=('bun')
options=('!strip' '!debug')

prepare() {
    cd "$startdir"
    bun install --production --frozen-lockfile --ignore-scripts
}

package() {
    cd "$startdir"
    
    # Install electron app
    install -dm755 "${pkgdir}/opt/clash-party"
    cp -r dist/linux-unpacked/* "${pkgdir}/opt/clash-party/"
    
    # Remove broken asar, use unpacked format
    rm -f "${pkgdir}/opt/clash-party/resources/app.asar"
    
    # Install app with dependencies (keep out/ structure for package.json)
    install -dm755 "${pkgdir}/opt/clash-party/resources/app"
    cp -r out "${pkgdir}/opt/clash-party/resources/app/"
    cp package.json "${pkgdir}/opt/clash-party/resources/app/"
    cp -r node_modules "${pkgdir}/opt/clash-party/resources/app/"
    
    # Create symlinks for resources that app expects in app/resources/
    install -dm755 "${pkgdir}/opt/clash-party/resources/app/resources"
    ln -sf ../../sidecar "${pkgdir}/opt/clash-party/resources/app/resources/sidecar"
    ln -sf ../../files "${pkgdir}/opt/clash-party/resources/app/resources/files"
    # Copy icon for tray (can't be a symlink outside the app directory)
    install -Dm644 build/icon.png "${pkgdir}/opt/clash-party/resources/app/resources/icon.png"
    
    # Permissions
    chmod +x "${pkgdir}/opt/clash-party/mihomo-party"
    chmod +sx "${pkgdir}/opt/clash-party/chrome-sandbox" 2>/dev/null || true
    chmod +sx "${pkgdir}/opt/clash-party/resources/sidecar/mihomo"* 2>/dev/null || true
    
    # Desktop integration
    install -Dm644 build/icon.png "${pkgdir}/usr/share/icons/hicolor/512x512/apps/mihomo-party.png"
    install -Dm644 /dev/stdin "${pkgdir}/usr/share/applications/mihomo-party.desktop" << 'EOF'
[Desktop Entry]
Name=Clash Party
Comment=Another Mihomo GUI
Exec=mihomo-party %U
Icon=mihomo-party
Terminal=false
Type=Application
Categories=Network;Utility;
StartupWMClass=mihomo-party
MimeType=x-scheme-handler/clash;x-scheme-handler/mihomo
EOF
    
    # Launcher
    install -Dm755 /dev/stdin "${pkgdir}/usr/bin/mihomo-party" << 'EOF'
#!/bin/sh
exec /opt/clash-party/mihomo-party "$@"
EOF
    
    chown -R root:root "${pkgdir}"
}
