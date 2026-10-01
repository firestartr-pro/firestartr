# Images Directory

This directory contains screenshots and diagrams referenced in the public documentation.

## Downloaded Images

All images have been successfully downloaded from GitHub user-attachments:

### 1. argocd-example.png
- **Description**: ArgoCD application view showing the Application Set
- **Original URL**: https://github.com/user-attachments/assets/02eaf245-f49f-4f92-b891-8dc64c4f1aad
- **Used in**: Migrating-to-our-new-app-state-repo-structure.md (line 262)
- **Size**: 314 KB (1436×806 PNG)
- **Status**: ✅ Downloaded

### 2. kubernetes-example.png
- **Description**: Kubernetes pods view showing deployed resources
- **Original URL**: https://github.com/user-attachments/assets/56eb5183-96a0-4044-8298-1d5b0978504a
- **Used in**: Migrating-to-our-new-app-state-repo-structure.md (line 266)
- **Size**: 61 KB
- **Status**: ✅ Downloaded

### 3. state-apps-dispatch.png
- **Description**: State Apps dispatch flow diagram showing automatic and on-demand deployments
- **Original URL**: https://github.com/user-attachments/assets/e0ad2171-b708-4ca9-99a4-b18cbcbe95dd
- **Used in**: state-apps-repository.md (line 58)
- **Size**: 69 KB
- **Status**: ✅ Downloaded

### 4. state-apps-dispatch-detail.png
- **Description**: Detailed State Apps dispatch process diagram
- **Original URL**: https://github.com/user-attachments/assets/5a845454-8dfc-46b5-8e62-219f80562659
- **Used in**: state-apps-repository.md (line 68)
- **Size**: 63 KB
- **Status**: ✅ Downloaded

### 5. state-apps-image-update-pr.png
- **Description**: Screenshot of image update pull request with reviewer and labels
- **Original URL**: https://github.com/user-attachments/assets/715d1faf-f37a-484f-8155-e493b6e3d083
- **Used in**: state-apps-repository.md (line 72)
- **Size**: 62 KB
- **Status**: ✅ Downloaded

### 6. state-apps-on-demand-deployment.png
- **Description**: Screenshot of on-demand deployment pull request
- **Original URL**: https://github.com/user-attachments/assets/63d1218f-cbef-430b-a822-9a186bcd112e
- **Used in**: state-apps-repository.md (line 90)
- **Size**: 57 KB
- **Status**: ✅ Downloaded

## Scripts

### download-images-simple.sh
Simple script to download all images using GitHub CLI authentication.

**Usage:**
```bash
./download-images-simple.sh
```

**Requirements:**
- GitHub CLI (`gh`) installed and authenticated
- Run: `gh auth login` before using the script

## Re-downloading Images

If you need to re-download the images:

```bash
cd /path/to/docs/public/images
bash download-images-simple.sh
```

All images are now version-controlled and self-contained within the repository.
