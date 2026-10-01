# Image Download Instructions

This document explains how to download the GitHub user-attachments images for the public documentation.

## Quick Start (Recommended)

The simplest way to download all images:

```bash
cd /path/to/docs/public/images
bash download-images-simple.sh
```

## Prerequisites

### GitHub CLI (gh)

You need the GitHub CLI installed and authenticated.

**Install GitHub CLI:**

```bash
# macOS
brew install gh

# Linux (Debian/Ubuntu)
curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | sudo dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | sudo tee /etc/apt/sources.list.d/github-cli.list > /dev/null
sudo apt update
sudo apt install gh

# Windows
# See: https://github.com/cli/cli#windows
```

**Authenticate:**

```bash
gh auth login
```

Follow the prompts to authenticate with your GitHub account.

## Available Script

### download-images-simple.sh

This script downloads all 6 images used in the public documentation.

**Features:**
- Uses GitHub CLI for authentication
- Verifies downloads by checking file sizes
- Provides clear status messages
- Simple and reliable

**Images downloaded:**
1. argocd-example.png (314 KB)
2. kubernetes-example.png (61 KB)
3. state-apps-dispatch.png (69 KB)
4. state-apps-dispatch-detail.png (63 KB)
5. state-apps-image-update-pr.png (62 KB)
6. state-apps-on-demand-deployment.png (57 KB)

## Manual Download

If the script doesn't work, you can manually download each image:

1. Visit the GitHub page where these images are embedded
2. Right-click each image → "Save image as..."
3. Save with the exact filenames listed above

Original URLs are documented in `README.md`.

## Verification

After downloading, verify all images:

```bash
ls -lh *.png
```

All files should be larger than 1 KB. Successfully downloaded images range from 57 KB to 314 KB.

## Troubleshooting

### "gh: command not found"
Install GitHub CLI (see Prerequisites above)

### "Not authenticated"
Run: `gh auth login`

### Files are too small (< 1 KB)
The download failed. Check your GitHub authentication and try again.

### "Permission denied"
Make the script executable:
```bash
chmod +x download-images-simple.sh
```

## Support

For issues with the download scripts or images, refer to:
- GitHub CLI docs: https://cli.github.com/manual/
- Original image URLs in `README.md`
