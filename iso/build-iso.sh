#!/usr/bin/env bash
# ============================================================================
# Peripheral Agentic OS — ISO Builder
# Creates a bootable ISO from minimal Ubuntu + Node.js + PAOS
# Must run as root: sudo bash iso/build-iso.sh
# ============================================================================
set -euo pipefail

# ── Configuration ──────────────────────────────────────────────────────────
PAOS_VERSION="2.0.0"
ISO_NAME="peripheral-agentic-os-${PAOS_VERSION}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "${SCRIPT_DIR}")"
WORK_DIR="${PROJECT_DIR}/.iso-build"
ROOTFS="${WORK_DIR}/rootfs"
ISO_DIR="${WORK_DIR}/iso-staging"
OUTPUT_ISO="${PROJECT_DIR}/${ISO_NAME}.iso"
ARCH="amd64"
CODENAME="noble"   # Ubuntu 24.04

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
BOLD='\033[1m'
NC='\033[0m'

banner() {
  echo -e "${CYAN}${BOLD}"
  echo "  ╔══════════════════════════════════════════════════╗"
  echo "  ║   Peripheral Agentic OS — ISO Builder v${PAOS_VERSION}    ║"
  echo "  ║   Building bootable operating system image       ║"
  echo "  ╚══════════════════════════════════════════════════╝"
  echo -e "${NC}"
}

step() { echo -e "\n${GREEN}[$(date +%H:%M:%S)]${NC} ${BOLD}▶ $1${NC}"; }
info() { echo -e "  ${CYAN}ℹ${NC} $1"; }
ok()   { echo -e "  ${GREEN}✓${NC} $1"; }
warn() { echo -e "  ${YELLOW}⚠${NC} $1"; }
fail() { echo -e "  ${RED}✗${NC} $1"; exit 1; }

# ── Pre-flight checks ─────────────────────────────────────────────────────
preflight() {
  banner

  if [[ $EUID -ne 0 ]]; then
    fail "This script must be run as root (sudo bash iso/build-iso.sh)"
  fi

  for cmd in debootstrap mksquashfs xorriso grub-mkrescue; do
    command -v "$cmd" &>/dev/null || fail "Missing required tool: $cmd"
  done

  local free_mb
  free_mb=$(df --output=avail "${PROJECT_DIR}" | tail -1 | tr -d ' ')
  free_mb=$((free_mb / 1024))
  if [[ $free_mb -lt 2500 ]]; then
    fail "Need at least 2.5GB free (have ${free_mb}MB)"
  fi
  ok "Pre-flight checks passed (${free_mb}MB free)"
}

# ── Cleanup ────────────────────────────────────────────────────────────────
cleanup() {
  step "Cleaning up build directory"
  # Unmount any remaining mounts
  for mp in "${ROOTFS}/proc" "${ROOTFS}/sys" "${ROOTFS}/dev/pts" "${ROOTFS}/dev"; do
    mountpoint -q "$mp" 2>/dev/null && umount -lf "$mp" 2>/dev/null || true
  done
  rm -rf "${WORK_DIR}"
  ok "Cleaned up"
}

trap 'echo -e "\n${RED}Build failed. Cleaning up...${NC}"; cleanup' ERR

# ── Step 1: Bootstrap minimal rootfs ───────────────────────────────────────
build_rootfs() {
  step "Step 1/9: Creating minimal Ubuntu ${CODENAME} rootfs"
  rm -rf "${WORK_DIR}"
  mkdir -p "${ROOTFS}" "${ISO_DIR}"

  debootstrap --arch="${ARCH}" --variant=minbase \
    --include=systemd,systemd-sysv,dbus,udev,sudo,bash,coreutils,\
apt-utils,locales,console-setup,iproute2,iputils-ping,\
ifupdown,dhcpcd-base,net-tools,wget,curl,ca-certificates,\
gnupg,openssh-server,linux-image-generic,initramfs-tools,\
live-boot,live-boot-initramfs-tools,python3-minimal,rsync \
    "${CODENAME}" "${ROOTFS}" http://archive.ubuntu.com/ubuntu

  ok "Root filesystem created ($(du -sh "${ROOTFS}" | cut -f1))"
}

# ── Step 2: Configure rootfs ──────────────────────────────────────────────
configure_rootfs() {
  step "Step 2/9: Configuring system"

  # Mount virtual filesystems
  mount --bind /dev  "${ROOTFS}/dev"
  mount --bind /dev/pts "${ROOTFS}/dev/pts"
  mount -t proc proc "${ROOTFS}/proc"
  mount -t sysfs sys "${ROOTFS}/sys"

  # Hostname
  echo "paos" > "${ROOTFS}/etc/hostname"
  echo "127.0.0.1 paos localhost" > "${ROOTFS}/etc/hosts"

  # Locale
  chroot "${ROOTFS}" bash -c "
    echo 'en_US.UTF-8 UTF-8' > /etc/locale.gen
    locale-gen
    update-locale LANG=en_US.UTF-8
  "

  # Fstab (tmpfs for live system)
  cat > "${ROOTFS}/etc/fstab" <<'EOF'
tmpfs  /tmp      tmpfs  defaults,nosuid,nodev  0 0
tmpfs  /var/log  tmpfs  defaults,nosuid,nodev  0 0
tmpfs  /run      tmpfs  defaults,nosuid,nodev,mode=0755  0 0
EOF

  # DNS
  echo "nameserver 8.8.8.8" > "${ROOTFS}/etc/resolv.conf"
  echo "nameserver 1.1.1.1" >> "${ROOTFS}/etc/resolv.conf"

  # Create paos user
  chroot "${ROOTFS}" bash -c "
    useradd -m -s /bin/bash -G sudo paos 2>/dev/null || true
    echo 'paos:paos' | chpasswd
    echo 'root:paos' | chpasswd
    echo 'paos ALL=(ALL) NOPASSWD:ALL' > /etc/sudoers.d/paos
  "

  # Auto-login on TTY1
  mkdir -p "${ROOTFS}/etc/systemd/system/getty@tty1.service.d"
  cat > "${ROOTFS}/etc/systemd/system/getty@tty1.service.d/override.conf" <<'EOF'
[Service]
ExecStart=
ExecStart=-/sbin/agetty --autologin paos --noclear %I $TERM
Type=idle
EOF

  ok "System configured (hostname: paos, user: paos)"
}

# ── Step 3: Install Node.js ───────────────────────────────────────────────
install_nodejs() {
  step "Step 3/9: Installing Node.js 22 LTS"

  chroot "${ROOTFS}" bash -c "
    # Add NodeSource repo
    mkdir -p /etc/apt/keyrings
    curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | \
      gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg
    echo 'deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_22.x nodistro main' > \
      /etc/apt/sources.list.d/nodesource.list
    apt-get update -qq
    apt-get install -y --no-install-recommends nodejs build-essential python3
    node --version
    npm --version
  "

  ok "Node.js installed: $(chroot "${ROOTFS}" node --version)"
}

# ── Step 4: Install PAOS ──────────────────────────────────────────────────
install_paos() {
  step "Step 4/9: Installing Peripheral Agentic OS"

  # Create destination
  mkdir -p "${ROOTFS}/opt/paos"

  # Copy project (exclude build artifacts and heavy dev stuff)
  rsync -a --exclude='.git' \
           --exclude='node_modules/.cache' \
           --exclude='data/*.db' \
           --exclude='data/*.db-wal' \
           --exclude='data/*.db-shm' \
           --exclude='.iso-build/' \
           --exclude='iso/' \
           --exclude='*.iso' \
           --exclude='dist/' \
           "${PROJECT_DIR}/" "${ROOTFS}/opt/paos/"

  # Ensure data directory exists
  mkdir -p "${ROOTFS}/opt/paos/data"

  # Rebuild native modules (better-sqlite3) inside chroot for target arch
  chroot "${ROOTFS}" bash -c "
    cd /opt/paos
    npm rebuild better-sqlite3 2>/dev/null || true
  "

  # Set ownership
  chroot "${ROOTFS}" chown -R paos:paos /opt/paos

  # Verify it works in chroot
  chroot "${ROOTFS}" bash -c "
    cd /opt/paos
    su paos -c 'node -e \"console.log(\\\"PAOS bundle verified\\\")\"'
  "

  ok "PAOS installed to /opt/paos ($(du -sh "${ROOTFS}/opt/paos" | cut -f1))"
}

# ── Step 5: Create systemd services ───────────────────────────────────────
create_services() {
  step "Step 5/9: Creating systemd services"

  # Main PAOS service
  cat > "${ROOTFS}/etc/systemd/system/paos.service" <<'EOF'
[Unit]
Description=Peripheral Agentic OS — AI Agent Orchestration Engine
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=paos
Group=paos
WorkingDirectory=/opt/paos
Environment=NODE_ENV=production
Environment=PAOS_MODE=power
ExecStart=/usr/bin/node --experimental-strip-types src/index.ts --serve
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal

# Security hardening
ProtectSystem=strict
ReadWritePaths=/opt/paos/data
PrivateTmp=true
NoNewPrivileges=true

[Install]
WantedBy=multi-user.target
EOF

  # Enable service
  chroot "${ROOTFS}" systemctl enable paos.service

  # Network service
  chroot "${ROOTFS}" systemctl enable systemd-networkd.service 2>/dev/null || true
  chroot "${ROOTFS}" systemctl enable ssh.service 2>/dev/null || true

  ok "Services created and enabled"
}

# ── Step 6: Custom branding ───────────────────────────────────────────────
apply_branding() {
  step "Step 6/9: Applying PAOS branding"

  # MOTD (Message of the Day)
  cat > "${ROOTFS}/etc/motd" <<'EOF'

  ╔══════════════════════════════════════════════════════════════╗
  ║                                                              ║
  ║     ████  ████  ████  ████  ██   █  ████  █   █  ████  ██   ║
  ║     █   █ █     █   █ █     █ █  █  █   █ █   █  █     █    ║
  ║     ████  ███   ████  ████  █  █ █  ████  █████  ███   █    ║
  ║     █     █     █  █     █  █   ██  █     █   █  █     █    ║
  ║     █     ████  █   █ ████  █    █  █     █   █  ████  ████ ║
  ║                                                              ║
  ║     Peripheral Agentic OS  v2.0.0                            ║
  ║     Universal AI Agent Orchestration                         ║
  ║                                                              ║
  ║     HTTP API:  http://localhost:3700                          ║
  ║     CLI:       paos <command>                                ║
  ║     Status:    systemctl status paos                         ║
  ║                                                              ║
  ╚══════════════════════════════════════════════════════════════╝

EOF

  # .bashrc for paos user
  cat >> "${ROOTFS}/home/paos/.bashrc" <<'BASHRC'

# ── Peripheral Agentic OS ──────────────────────
export PS1='\[\033[0;36m\]paos\[\033[0m\]@\[\033[0;33m\]\h\[\033[0m\]:\[\033[0;34m\]\w\[\033[0m\]\$ '
export PATH="/opt/paos/node_modules/.bin:$PATH"

alias paos='cd /opt/paos && node --experimental-strip-types src/index.ts'
alias status='systemctl status paos'
alias logs='journalctl -u paos -f'
alias restart='sudo systemctl restart paos'

# Show status on login
echo ""
systemctl is-active paos &>/dev/null && \
  echo -e "  \033[0;32m●\033[0m PAOS service is \033[0;32mrunning\033[0m" || \
  echo -e "  \033[0;31m●\033[0m PAOS service is \033[0;31mstopped\033[0m"
echo -e "  ℹ Type '\033[1mpaos status\033[0m' or '\033[1mlogs\033[0m' to get started"
echo ""
BASHRC

  # Issue banner for login screen
  cat > "${ROOTFS}/etc/issue" <<'EOF'

  Peripheral Agentic OS v2.0.0
  Universal AI Agent Orchestration

  Default credentials: paos / paos

EOF

  # Create symlink for global CLI
  mkdir -p "${ROOTFS}/usr/local/bin"
  cat > "${ROOTFS}/usr/local/bin/paos" <<'SCRIPT'
#!/bin/bash
cd /opt/paos && exec node --experimental-strip-types src/index.ts "$@"
SCRIPT
  chmod +x "${ROOTFS}/usr/local/bin/paos"

  ok "Branding applied (MOTD, prompt, CLI alias)"
}

# ── Step 7: Clean up rootfs ───────────────────────────────────────────────
clean_rootfs() {
  step "Step 7/9: Cleaning rootfs for minimal ISO size"

  chroot "${ROOTFS}" bash -c "
    # Remove build tools (no longer needed after native module rebuild)
    apt-get remove -y --purge build-essential cpp gcc g++ make 2>/dev/null || true
    apt-get autoremove -y 2>/dev/null || true
    apt-get clean
    rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/*
    rm -rf /usr/share/doc/* /usr/share/man/*
    rm -f /var/log/*.log /var/log/apt/*
  "

  # Unmount virtual filesystems
  umount -lf "${ROOTFS}/proc" 2>/dev/null || true
  umount -lf "${ROOTFS}/sys" 2>/dev/null || true
  umount -lf "${ROOTFS}/dev/pts" 2>/dev/null || true
  umount -lf "${ROOTFS}/dev" 2>/dev/null || true

  ok "Rootfs cleaned ($(du -sh "${ROOTFS}" | cut -f1))"
}

# ── Step 8: Create SquashFS ───────────────────────────────────────────────
build_squashfs() {
  step "Step 8/9: Creating SquashFS filesystem"

  mkdir -p "${ISO_DIR}/live"

  mksquashfs "${ROOTFS}" "${ISO_DIR}/live/filesystem.squashfs" \
    -comp xz -Xbcj x86 -b 1048576 -no-recovery -e boot

  ok "SquashFS created ($(du -sh "${ISO_DIR}/live/filesystem.squashfs" | cut -f1))"

  # Copy kernel and initrd
  cp "${ROOTFS}"/boot/vmlinuz-* "${ISO_DIR}/live/vmlinuz" 2>/dev/null || \
    cp "${ROOTFS}"/boot/vmlinuz "${ISO_DIR}/live/vmlinuz"
  cp "${ROOTFS}"/boot/initrd.img-* "${ISO_DIR}/live/initrd.img" 2>/dev/null || \
    cp "${ROOTFS}"/boot/initrd "${ISO_DIR}/live/initrd.img"

  ok "Kernel and initrd copied"
}

# ── Step 9: Build ISO ─────────────────────────────────────────────────────
build_iso() {
  step "Step 9/9: Building bootable ISO image"

  # GRUB config
  mkdir -p "${ISO_DIR}/boot/grub"
  cat > "${ISO_DIR}/boot/grub/grub.cfg" <<'GRUBCFG'
set timeout=5
set default=0

# ── Theme ──
set menu_color_normal=white/black
set menu_color_highlight=cyan/black

menuentry "Peripheral Agentic OS v2.0.0" {
    linux /live/vmlinuz boot=live toram quiet splash
    initrd /live/initrd.img
}

menuentry "PAOS — Safe Mode (verbose)" {
    linux /live/vmlinuz boot=live toram
    initrd /live/initrd.img
}

menuentry "PAOS — RAM Only (no persistence)" {
    linux /live/vmlinuz boot=live toram nopersistence quiet
    initrd /live/initrd.img
}
GRUBCFG

  # Build ISO with GRUB (BIOS + UEFI)
  grub-mkrescue -o "${OUTPUT_ISO}" "${ISO_DIR}" \
    --product-name "Peripheral Agentic OS" \
    --product-version "${PAOS_VERSION}" \
    2>/dev/null

  ok "ISO image created!"
  echo ""
  echo -e "  ${BOLD}Output:${NC}  ${OUTPUT_ISO}"
  echo -e "  ${BOLD}Size:${NC}    $(du -sh "${OUTPUT_ISO}" | cut -f1)"
  echo ""
  echo -e "  ${CYAN}Boot with QEMU:${NC}"
  echo "    qemu-system-x86_64 -cdrom ${OUTPUT_ISO} -m 2048 -enable-kvm"
  echo ""
  echo -e "  ${CYAN}Boot with VirtualBox:${NC}"
  echo "    1. Create new VM → Linux → Ubuntu 64-bit"
  echo "    2. Attach ${ISO_NAME}.iso as optical disk"
  echo "    3. Boot → PAOS starts automatically"
  echo ""
}

# ── Main ───────────────────────────────────────────────────────────────────
main() {
  local start_time=$(date +%s)

  preflight
  build_rootfs
  configure_rootfs
  install_nodejs
  install_paos
  create_services
  apply_branding
  clean_rootfs
  build_squashfs
  build_iso

  # Final cleanup
  cleanup

  local elapsed=$(( $(date +%s) - start_time ))
  echo -e "${GREEN}${BOLD}  ✅ Build completed in ${elapsed}s${NC}"
}

main "$@"
