#!/bin/bash

# Simple script to download GitHub user-attachments images
# Requires: gh CLI (GitHub CLI) to be installed and authenticated
# Install: https://cli.github.com/
# Login: gh auth login

set -e

echo "Downloading images from GitHub user-attachments..."
echo ""

# Check if gh is installed
if ! command -v gh &> /dev/null; then
    echo "ERROR: GitHub CLI (gh) is not installed."
    echo "Please install it from: https://cli.github.com/"
    echo "Then run: gh auth login"
    exit 1
fi

# Check if gh is authenticated
if ! gh auth status &> /dev/null; then
    echo "ERROR: Not authenticated with GitHub CLI."
    echo "Please run: gh auth login"
    exit 1
fi

echo "✓ GitHub CLI is installed and authenticated"
echo ""

# Download images using authenticated requests
echo "Downloading argocd-example.png..."
curl -L -H "Authorization: Bearer $(gh auth token)" \
     "https://github.com/user-attachments/assets/02eaf245-f49f-4f92-b891-8dc64c4f1aad" \
     -o argocd-example.png

echo "Downloading kubernetes-example.png..."
curl -L -H "Authorization: Bearer $(gh auth token)" \
     "https://github.com/user-attachments/assets/56eb5183-96a0-4044-8298-1d5b0978504a" \
     -o kubernetes-example.png

echo "Downloading state-apps-dispatch.png..."
curl -L -H "Authorization: Bearer $(gh auth token)" \
     "https://github.com/user-attachments/assets/e0ad2171-b708-4ca9-99a4-b18cbcbe95dd" \
     -o state-apps-dispatch.png

echo "Downloading state-apps-dispatch-detail.png..."
curl -L -H "Authorization: Bearer $(gh auth token)" \
     "https://github.com/user-attachments/assets/5a845454-8dfc-46b5-8e62-219f80562659" \
     -o state-apps-dispatch-detail.png

echo "Downloading state-apps-image-update-pr.png..."
curl -L -H "Authorization: Bearer $(gh auth token)" \
     "https://github.com/user-attachments/assets/715d1faf-f37a-484f-8155-e493b6e3d083" \
     -o state-apps-image-update-pr.png

echo "Downloading state-apps-on-demand-deployment.png..."
curl -L -H "Authorization: Bearer $(gh auth token)" \
     "https://github.com/user-attachments/assets/63d1218f-cbef-430b-a822-9a186bcd112e" \
     -o state-apps-on-demand-deployment.png

echo ""
echo "Verifying downloads..."
echo ""

# Check file sizes
for file in argocd-example.png kubernetes-example.png state-apps-dispatch.png state-apps-dispatch-detail.png state-apps-image-update-pr.png state-apps-on-demand-deployment.png; do
    if [ -f "$file" ]; then
        size=$(stat -f%z "$file" 2>/dev/null || stat -c%s "$file" 2>/dev/null)
        if [ "$size" -gt 100 ]; then
            echo "✓ $file ($size bytes)"
        else
            echo "✗ $file (only $size bytes - likely failed)"
        fi
    else
        echo "✗ $file (not found)"
    fi
done

echo ""
echo "Done!"
